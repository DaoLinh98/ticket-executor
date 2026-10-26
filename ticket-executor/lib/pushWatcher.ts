import { prisma } from "@/lib/prisma";
import { buildNotifications, notificationKey, notificationPath, type AppNotification } from "@/lib/notifications";
import { collectNotificationSources } from "@/lib/notificationSources";
import { pushEnabled, pushToAll } from "@/lib/push";

/**
 * The server half of the bell: it asks the same question the browser asks, on
 * its own clock, and pushes whatever is new.
 *
 * It exists because the browser's poll only runs while a tab is open. The
 * scheduler works a plan overnight and reviewers comment during a meeting —
 * precisely the hours nobody is looking at the app — so "what is new" has to be
 * answered by something that is awake, and on this stack the only thing awake
 * is this process.
 *
 * Deliberately not part of the scheduler tick. The scheduler takes a Postgres
 * advisory lock so one of several instances does the work; that is right for
 * starting runs and wrong here, since this reads and pushes without touching a
 * run — and its interval answers to how fresh a notification should be, not to
 * how often a plan should be considered.
 */

/** How often the server re-asks. Matches the browser's own poll: the sources
 *  are the same provider calls, and asking faster would cost the provider more
 *  without making a comment any newer than the provider's own index makes it. */
const WATCH_MS = 120_000;

/** Per tick. A quiet hour produces none of these; a backlog that produces more
 *  is summarised into one line instead, because eleven banners on a lock screen
 *  is not eleven times as useful as one. */
const MAX_PER_TICK = 5;

/** How long a delivery record is kept. Comfortably longer than the three-day
 *  window the sources themselves are read over, so a notification cannot age
 *  out of this table while still being produced — which would push it again. */
const DELIVERY_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** The row that records that seeding has happened. A real delivery row cannot
 *  serve as that evidence: they expire, and a fortnight quiet enough to empty
 *  the table would make the next notification look like a first run and be
 *  swallowed. This one is never expired. */
const SEED_MARKER = "__seeded__";

/** Keyed by content, not just identity: a review that went from two open
 *  comments to three is news again, and that is exactly what `fingerprint`
 *  changing means. */
function deliveryKey(n: AppNotification): string {
  return `${notificationKey(n)}::${n.fingerprint}`;
}

/** Where a tap lands. The same two destinations the bell itself offers — the
 *  ticket, or the provider's page when the notification is about somebody
 *  else's work item. */
function destination(n: AppNotification): string {
  if (!n.ticketId) return n.href ?? "/";
  return notificationPath(n.ticketId, n.tab);
}

function title(n: AppNotification): string {
  return n.ticketId ? `Ticket ${n.ticketId}` : "D-Agent";
}

/**
 * One pass: collect, diff against what was already pushed, send, record.
 *
 * Exported so the Settings page can prove the whole chain works on demand
 * rather than asking the developer to wait two minutes and hope.
 */
export async function pushTick(): Promise<{ sent: number; seeded: number }> {
  if (!pushEnabled()) return { sent: 0, seeded: 0 };

  // Nothing subscribed means nothing to compute. This is the normal state on a
  // machine whose owner never enabled push, and it must cost no provider calls.
  const subscribers = await prisma.pushSubscription.count();
  if (!subscribers) return { sent: 0, seeded: 0 };

  const sources = await collectNotificationSources();
  const notifications = buildNotifications(sources);
  if (!notifications.length) return { sent: 0, seeded: 0 };

  const keys = notifications.map(deliveryKey);
  const known = new Set(
    (await prisma.pushDelivery.findMany({ where: { key: { in: keys } }, select: { key: true } }))
      .map((d) => d.key),
  );
  const fresh = notifications.filter((n) => !known.has(deliveryKey(n)));
  if (!fresh.length) return { sent: 0, seeded: 0 };

  // The first pass after a device subscribes faces the entire standing
  // backlog — every open review comment, every active pull request — none of
  // which is news. It is recorded as delivered without being sent, so push
  // starts from "from now on" rather than announcing the last three days.
  const seeding = (await prisma.pushDelivery.count({ where: { key: SEED_MARKER } })) === 0;

  const record = () =>
    prisma.pushDelivery.createMany({
      data: fresh.map((n) => ({ key: deliveryKey(n) })),
      skipDuplicates: true,
    });

  if (seeding) {
    await record();
    await prisma.pushDelivery.create({ data: { key: SEED_MARKER } });
    return { sent: 0, seeded: fresh.length };
  }

  if (fresh.length > MAX_PER_TICK) {
    await pushToAll({
      title: "D-Agent",
      body: `${fresh.length} new notifications`,
      url: "/",
      tag: "digest",
    });
  } else {
    for (const n of fresh) {
      await pushToAll({
        title: title(n),
        body: n.summary,
        url: destination(n),
        tag: notificationKey(n),
      });
    }
  }

  await record();
  await prisma.pushDelivery.deleteMany({
    where: { sentAt: { lt: new Date(Date.now() - DELIVERY_TTL_MS) }, key: { not: SEED_MARKER } },
  });

  return { sent: fresh.length, seeded: 0 };
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startPushWatcher() {
  if (timer) return;
  if (!pushEnabled()) {
    console.log("[ticket-executor] push watcher off — VAPID keys not configured");
    return;
  }
  timer = setInterval(() => {
    void pushTick().catch((e) => console.error("[ticket-executor] push tick failed:", e));
  }, WATCH_MS);
  // Node keeps the process alive for an interval; this one must not be a reason
  // not to exit.
  timer.unref?.();
  console.log(`[ticket-executor] push watcher started (every ${WATCH_MS / 1000}s)`);
}
