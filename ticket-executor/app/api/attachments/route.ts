import { NextResponse } from "next/server";
import { adoCreds } from "@/lib/ado";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stream a provider attachment (the screenshots embedded in a ticket's
 * Description / Acceptance Criteria).
 *
 * The browser cannot fetch these directly: Azure DevOps serves them from
 * `_apis/wit/attachments/<guid>` behind the same PAT the rest of the API needs,
 * so an `<img src>` pointing at the original URL renders as a broken image. The
 * sanitizer rewrites those `src`s to this route, which re-issues the request
 * with the stored credential.
 *
 * The `url` parameter is **not** fetched as given. It must be an
 * `https://dev.azure.com/<configured org>/…` attachment URL — otherwise this
 * endpoint would be an open proxy that signs arbitrary outbound requests with
 * the user's token.
 */
export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("url") ?? "";
  if (!raw) return new NextResponse("url is required", { status: 400 });

  const creds = await adoCreds();
  if (!creds) return new NextResponse("Azure DevOps is not configured", { status: 404 });

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return new NextResponse("Invalid url", { status: 400 });
  }

  const host = target.hostname.toLowerCase();
  const orgOk =
    (host === "dev.azure.com" && target.pathname.toLowerCase().startsWith(`/${creds.org.toLowerCase()}/`)) ||
    host === `${creds.org.toLowerCase()}.visualstudio.com`;
  if (target.protocol !== "https:" || !orgOk || !/\/_apis\/wit\/attachments\//i.test(target.pathname)) {
    return new NextResponse("Only attachments of the configured organization can be proxied", { status: 403 });
  }

  const upstream = await fetch(target.toString(), {
    headers: { Authorization: "Basic " + Buffer.from(":" + creds.pat).toString("base64") },
    cache: "no-store",
  });
  if (!upstream.ok || !upstream.body) {
    return new NextResponse("Attachment could not be loaded", { status: upstream.status || 502 });
  }

  return new NextResponse(upstream.body, {
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream",
      // Private: the response is only meaningful for this authenticated user, and
      // the browser re-requesting it costs one cheap round trip.
      "Cache-Control": "private, max-age=300",
      // The attachment is arbitrary user-uploaded content — never let the browser
      // sniff it into something executable, and never render it as a document.
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
    },
  });
}
