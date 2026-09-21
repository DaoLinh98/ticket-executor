import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publicKey, pushEnabled } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** What the browser needs before it can subscribe, and whether this device
 *  already has. Keyed by endpoint because that is the only identity a push
 *  subscription has — see the PushSubscription model. */
export async function GET(req: Request) {
  const endpoint = new URL(req.url).searchParams.get("endpoint") ?? "";
  const subscribed = endpoint
    ? (await prisma.pushSubscription.count({ where: { endpoint } })) > 0
    : false;
  return NextResponse.json({ enabled: pushEnabled(), publicKey: publicKey(), subscribed });
}

type SubscribeBody = {
  endpoint?: string;
  keys?: { p256dh?: string; auth?: string };
  label?: string;
};

/**
 * Store a subscription.
 *
 * An upsert on the endpoint, not a create: a browser re-issues the *same*
 * endpoint when the app re-subscribes after a reload, and its keys can change
 * when permission is revoked and granted again. Inserting would accumulate
 * duplicates of one device and push to it twice.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as SubscribeBody;
  const endpoint = body.endpoint ?? "";
  const p256dh = body.keys?.p256dh ?? "";
  const auth = body.keys?.auth ?? "";
  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: "Incomplete subscription" }, { status: 400 });
  }

  const label = (body.label ?? "").slice(0, 80);
  await prisma.pushSubscription.upsert({
    where: { endpoint },
    update: { p256dh, auth, label },
    create: { endpoint, p256dh, auth, label },
  });
  return NextResponse.json({ ok: true });
}

/** Forget one device. The browser unsubscribes locally either way; this only
 *  stops the server sending to an address that would go on accepting pushes. */
export async function DELETE(req: Request) {
  const endpoint = new URL(req.url).searchParams.get("endpoint") ?? "";
  if (endpoint) await prisma.pushSubscription.deleteMany({ where: { endpoint } });
  return NextResponse.json({ ok: true });
}
