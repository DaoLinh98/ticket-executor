import { NextResponse } from "next/server";
import { loadSprints, normalizeProvider } from "@/lib/tickets";

export const dynamic = "force-dynamic";

// Sprint picker data: the full iteration list (newest first) plus whichever the
// provider considers "current" today.
//
// The dispatch lives in `lib/tickets.ts`, not here, so hub mode is decided in
// the one place every other provider read decides it. This route used to call
// `listIterations()` straight from `lib/ado.ts`, which with the hub switched on
// would have been the single call site still reaching for a credential the app
// no longer holds.
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const provider = normalizeProvider(params.get("provider") ?? process.env.TICKET_PROVIDER);
  const project = params.get("project") ?? "";
  try {
    return NextResponse.json(await loadSprints(provider, project));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message, sprints: [], current: "" }, { status: 500 });
  }
}
