import { NextResponse } from "next/server";
import {
  deleteClaudeCredential, listClaudeCredentials, moveClaudeCredential, saveClaudeCredential,
} from "@/lib/claudeAccounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const clean = (s: unknown) => (typeof s === "string" ? s.replace(/[\r\n]+/g, "").trim() : "");

// A missing table (P2021) means the migration has not been applied — say so instead of a bare 500.
const guarded = (handler: (req: Request) => Promise<Response>) => async (req: Request) => {
  try {
    return await handler(req);
  } catch (e) {
    const missing = (e as { code?: string })?.code === "P2021";
    console.error("[claude-credentials]", e);
    return NextResponse.json(
      { error: missing ? "The ClaudeCredential table does not exist yet — run `npx prisma migrate deploy` and restart the app." : e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
};

// GET /api/claude-credentials — the saved Claude accounts in the order runs try
// them (the machine login comes after all of them). Never returns a token.
export const GET = guarded(async () => NextResponse.json({ credentials: await listClaudeCredentials() }));

// POST /api/claude-credentials — create one, or update its name / enabled flag /
// token ({ id?, label, token?, enabled? }). `token` is a `claude setup-token`
// token or the contents of a .credentials.json.
export const POST = guarded(async (req: Request) => {
  const body = await req.json().catch(() => ({}));
  const r = await saveClaudeCredential({
    id: typeof body.id === "string" && body.id ? body.id : undefined,
    label: clean(body.label),
    token: typeof body.token === "string" ? body.token : "",
    enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
  });
  if (r.error) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ credentials: await listClaudeCredentials() });
});

// PATCH /api/claude-credentials — { id, move: -1 | 1 } moves one up or down the order.
export const PATCH = guarded(async (req: Request) => {
  const body = await req.json().catch(() => ({}));
  const id = typeof body.id === "string" ? body.id : "";
  if (!id || (body.move !== -1 && body.move !== 1)) return NextResponse.json({ error: "id and move (-1 or 1) are required." }, { status: 400 });
  await moveClaudeCredential(id, body.move);
  return NextResponse.json({ credentials: await listClaudeCredentials() });
});

// DELETE /api/claude-credentials?id=…
export const DELETE = guarded(async (req: Request) => {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });
  if (!(await deleteClaudeCredential(id))) return NextResponse.json({ error: "Credential not found." }, { status: 404 });
  return NextResponse.json({ credentials: await listClaudeCredentials() });
});
