import { NextResponse } from "next/server";
import { resolveCredential } from "@/lib/providerCredentials";
import { normalizeProvider } from "@/lib/tickets";
import { parseAdoUrl } from "@/lib/ado";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Result = { ok: boolean; message: string };

function origin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url.replace(/\/+$/, "");
  }
}

// A rejected credential does not always come back as an error status.
//
// Azure DevOps answers an unauthenticated request to `dev.azure.com` with a
// **redirect to its sign-in page**, and `fetch` follows redirects by default —
// so a wrong PAT produced a 200 carrying an HTML login document, `r.ok` was
// true, and this route reported "connected" for a credential that could not read
// a single work item. That is the bug every page then hit as "no data".
//
// Two guards, applied to every provider: never follow a redirect (a redirect out
// of an API endpoint *is* the rejection), and never accept a 200 that is not
// JSON of the shape the endpoint promises. Both are cheap and neither can be
// satisfied by a login page.
async function apiGet(url: string, headers: Record<string, string>): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    return await fetch(url, {
      headers: { Accept: "application/json", ...headers },
      signal: ctrl.signal,
      cache: "no-store",
      redirect: "manual",
    });
  } finally {
    clearTimeout(t);
  }
}

/** A 2xx that actually carried the JSON it promised, or null. */
async function jsonBody(r: Response): Promise<Record<string, unknown> | null> {
  if (!(r.headers.get("content-type") ?? "").toLowerCase().includes("json")) return null;
  const body = await r.json().catch(() => null);
  return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
}

/** True when the response is the provider bouncing us at its sign-in page.
 *  `redirect: "manual"` surfaces this as a 3xx (undici) or an opaque 0. */
function isSignInBounce(r: Response): boolean {
  return r.status === 0 || (r.status >= 300 && r.status < 400) || r.type === "opaqueredirect";
}

const ADO_REJECTED =
  "Azure DevOps rejected the token. Check the PAT, that it has not expired, and its scopes (Work Items: Read, Code: Read).";

async function testAdo(url: string, token: string): Promise<Result> {
  const { org } = parseAdoUrl(url);
  if (!org) {
    return {
      ok: false,
      message: "Enter the organization URL, e.g. https://dev.azure.com/your-org.",
    };
  }
  const auth = "Basic " + Buffer.from(":" + token).toString("base64");
  // Org-level project list validates the org and the token in one call; the
  // specific project is now chosen per request, not baked into the connection.
  const r = await apiGet(
    `https://dev.azure.com/${org}/_apis/projects?api-version=7.0`,
    { Authorization: auth }
  );
  if (isSignInBounce(r)) return { ok: false, message: ADO_REJECTED };
  if (r.ok) {
    const data = await jsonBody(r);
    // A 200 that is not the project list is the sign-in page in disguise. The
    // `value` array is what every caller of this org actually consumes, so it is
    // the right thing to require before calling the connection good.
    if (!data || !Array.isArray(data.value)) return { ok: false, message: ADO_REJECTED };
    const n = typeof data.count === "number" ? data.count : data.value.length;
    return { ok: true, message: `Connected to Azure DevOps — ${org} (${n} project${n === 1 ? "" : "s"}).` };
  }
  if (r.status === 404)
    return { ok: false, message: `Organization "${org}" not found. Check the organization URL.` };
  if (r.status === 401 || r.status === 203 || r.status === 403)
    return { ok: false, message: ADO_REJECTED };
  return { ok: false, message: `Azure DevOps returned ${r.status} ${r.statusText}.` };
}

async function testGithub(token: string): Promise<Result> {
  const r = await apiGet("https://api.github.com/user", {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
  });
  if (isSignInBounce(r)) return { ok: false, message: "GitHub rejected the token. Check it has not expired." };
  if (r.ok) {
    const u = await jsonBody(r);
    if (!u || typeof u.login !== "string")
      return { ok: false, message: "GitHub rejected the token. Check it has not expired." };
    return { ok: true, message: `Connected to GitHub as ${u.login}.` };
  }
  return { ok: false, message: `GitHub returned ${r.status} ${r.statusText}. Check the token.` };
}

async function testGitlab(url: string, token: string): Promise<Result> {
  const r = await apiGet(`${origin(url)}/api/v4/user`, { "PRIVATE-TOKEN": token });
  if (isSignInBounce(r)) return { ok: false, message: "GitLab rejected the token. Check it has not expired." };
  if (r.ok) {
    const u = await jsonBody(r);
    if (!u || typeof u.username !== "string")
      return { ok: false, message: "GitLab rejected the token. Check the URL and token." };
    return { ok: true, message: `Connected to GitLab as ${u.username}.` };
  }
  return { ok: false, message: `GitLab returned ${r.status} ${r.statusText}. Check the URL and token.` };
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const provider = normalizeProvider(body.provider);

  // Use whatever the form supplied; for anything it did not, fall back to the
  // credential this provider would actually run with — the EmeHub one when hub
  // mode is on, the locally-stored one otherwise. Testing the local row while
  // runs use the hub's would be a test of the wrong thing, and in hub mode the
  // form supplies neither field because neither is editable there.
  let url = typeof body.org === "string" ? body.org.trim() : "";
  let token = typeof body.pat === "string" ? body.pat.trim() : "";
  if (!url || !token) {
    const cred = await resolveCredential(provider);
    if (!url) url = cred.org;
    if (!token) token = cred.pat;
  }
  if (!url) return NextResponse.json({ ok: false, message: "URL is required." });
  if (!token) return NextResponse.json({ ok: false, message: "Access token is required." });

  try {
    let result: Result;
    if (provider === "azure-devops") result = await testAdo(url, token);
    else if (provider === "github") result = await testGithub(token);
    else if (provider === "gitlab") result = await testGitlab(url, token);
    else result = { ok: false, message: "Automated test isn't available for Jira yet — save and load tickets to verify." };
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, message: `Connection failed: ${message}` });
  }
}
