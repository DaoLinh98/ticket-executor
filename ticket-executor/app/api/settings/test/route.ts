import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/crypto";
import { normalizeProvider } from "@/lib/tickets";

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

async function withTimeout(url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal, cache: "no-store" });
  } finally {
    clearTimeout(t);
  }
}

async function testAdo(url: string, token: string): Promise<Result> {
  const base = url.replace(/\/+$/, "");
  const auth = "Basic " + Buffer.from(":" + token).toString("base64");
  const r = await withTimeout(`${base}/_apis/projects?api-version=7.0&$top=1`, {
    headers: { Authorization: auth },
  });
  if (r.ok) return { ok: true, message: "Connected to Azure DevOps." };
  return { ok: false, message: `Azure DevOps returned ${r.status} ${r.statusText}. Check the organization URL and token scope.` };
}

async function testGithub(token: string): Promise<Result> {
  const r = await withTimeout("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
  });
  if (r.ok) {
    const u = (await r.json().catch(() => ({}))) as { login?: string };
    return { ok: true, message: `Connected to GitHub${u.login ? ` as ${u.login}` : ""}.` };
  }
  return { ok: false, message: `GitHub returned ${r.status} ${r.statusText}. Check the token.` };
}

async function testGitlab(url: string, token: string): Promise<Result> {
  const r = await withTimeout(`${origin(url)}/api/v4/user`, {
    headers: { "PRIVATE-TOKEN": token },
  });
  if (r.ok) {
    const u = (await r.json().catch(() => ({}))) as { username?: string };
    return { ok: true, message: `Connected to GitLab${u.username ? ` as ${u.username}` : ""}.` };
  }
  return { ok: false, message: `GitLab returned ${r.status} ${r.statusText}. Check the URL and token.` };
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const provider = normalizeProvider(body.provider);
  const url = typeof body.org === "string" ? body.org.trim() : "";

  // Use the token from the form if supplied; otherwise the stored (decrypted) one.
  let token = typeof body.pat === "string" ? body.pat.trim() : "";
  if (!token) {
    const s = await prisma.setting.findUnique({ where: { id: "default" } });
    token = decryptSecret(s?.pat);
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
