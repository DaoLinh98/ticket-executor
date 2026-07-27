import { NextResponse } from "next/server";
import { runPreflight } from "@/lib/preflight";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/preflight?rootRepo=<path>&deep=1
// Local-only checks by default; `deep=1` adds the two network-touching ones
// (live token test, git push --dry-run) which the page triggers on demand.
// rootRepo is optional — there is no app-wide default, it's a per-ticket value,
// so the repo checks only run for a path the user typed in.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const rootRepo = searchParams.get("rootRepo") ?? "";
  const deep = searchParams.get("deep") === "1";
  try {
    return NextResponse.json(await runPreflight({ rootRepo, deep }));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
