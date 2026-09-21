import { NextResponse } from "next/server";

/**
 * `no-store`, for the reads a second device must not be able to answer from its
 * own cache.
 *
 * `dynamic = "force-dynamic"` only stops *Next* from caching the route; it
 * attaches no cache header to the response, and a body with no header and no
 * validator is exactly what Safari heuristically caches. That turns the app's
 * re-read-on-resume into a re-read that cannot see the change it exists for, so
 * anything whose whole point is to converge across browsers says so here.
 */
export function jsonNoStore(body: unknown, init?: ResponseInit): NextResponse {
  const res = NextResponse.json(body, init);
  res.headers.set("Cache-Control", "no-store, must-revalidate");
  return res;
}
