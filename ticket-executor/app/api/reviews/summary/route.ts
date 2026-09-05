import { NextResponse } from "next/server";
import { latestPrUrls, loadReviewsSummary, normalizeProvider } from "@/lib/tickets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function idList(value: string | null): string[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * The review bell's summary.
 *
 * `ids` is everything on screen; `reviewable` is the subset the client's own
 * status lane says could have an open PR (`isReviewable()` in lib/ui.ts). Only
 * the **union** of that subset and the tickets this app has actually recorded a
 * PR for is polled.
 *
 * Both halves are load-bearing. Status alone misses a PR whose ticket was never
 * moved, or whose process template names the review lane something the set has
 * not heard of. A recorded PR alone misses a PR a human opened. Polling every
 * ticket — what this used to do — costs one provider round-trip per ticket per
 * poll for a sprint where two of them are in review.
 *
 * The client sends the lane subset rather than the server deriving it because
 * the tracker's state for a ticket lives in the client's already-loaded list;
 * re-fetching the sprint here to learn it would cost more than it saves.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const provider = normalizeProvider(url.searchParams.get("provider"));
  const ids = idList(url.searchParams.get("ids"));
  if (!ids.length) return NextResponse.json({ reviews: [], degraded: false });

  // A caller that sends no `reviewable` at all gets the old behaviour (every id
  // is a candidate) rather than silent emptiness — the parameter is a narrowing
  // hint, and a missing hint must never read as "narrow to nothing".
  const reviewableParam = url.searchParams.get("reviewable");
  const reviewable = reviewableParam === null ? new Set(ids) : new Set(idList(reviewableParam));

  try {
    const prUrls = await latestPrUrls(provider, ids);

    const candidates = ids.filter((id) => reviewable.has(id) || prUrls.has(id));
    const result = await loadReviewsSummary(provider, candidates, prUrls);
    return NextResponse.json({
      reviews: result.reviews,
      degraded: result.degraded,
      polled: candidates.length,
      ...(result.notice ? { error: result.notice } : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // `degraded` is what stops the bell from rendering this as "all clear".
    return NextResponse.json({ reviews: [], degraded: true, error: message });
  }
}
