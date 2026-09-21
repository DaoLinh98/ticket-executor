import { NextResponse } from "next/server";
import { collectNotificationSources } from "@/lib/notificationSources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The notification sources the server owns: the scheduler's log, the pull
 * request inbox, and recent comments on the developer's work.
 *
 * The gathering itself lives in `lib/notificationSources.ts` because this
 * endpoint is no longer its only caller: the push watcher asks the same
 * question on its own tick, with no browser to ask it for, and a second
 * implementation of "what is the developer's current notification set" would be
 * a second thing to drift.
 */
export async function GET(req: Request) {
  const sources = await collectNotificationSources(
    new URL(req.url).searchParams.get("provider") ?? undefined,
  );
  return NextResponse.json(sources);
}
