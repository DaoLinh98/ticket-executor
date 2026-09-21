import { NextResponse } from "next/server";
import { pushEnabled, pushToAll } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Prove the chain — server, VAPID keys, push service, service worker, lock
 * screen — with one tap.
 *
 * Worth its own endpoint because that chain has five links that fail
 * independently and silently: a wrong key pair, a subscription issued against a
 * different origin, a service worker that never installed, notifications muted
 * for the app in iOS Settings. Waiting for a real notification to find out
 * which one broke is a two-minute answer at best and an overnight one at worst.
 */
export async function POST() {
  if (!pushEnabled()) {
    return NextResponse.json({ error: "VAPID keys are not configured" }, { status: 400 });
  }
  const delivered = await pushToAll({
    title: "D-Agent",
    body: "Push notifications are working.",
    url: "/",
    tag: "test",
  });
  return NextResponse.json({ delivered });
}
