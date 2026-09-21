import { prisma } from "@/lib/prisma";
import { jsonNoStore } from "@/lib/http";
import type { ReadMap } from "@/lib/notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The bell's read state, for every browser and device at once.
 *
 * It used to live in `localStorage`, which made it a fact about a browser
 * rather than about the developer: a notification opened on the laptop stayed
 * unread on the phone, and the badge disagreed with itself across devices. One
 * developer per installation (see **Auth** in CLAUDE.md) is what lets the
 * notification key alone identify a row.
 */

// Rows older than this are dropped on the next write. The notification they
// describe is long gone from every source by then — a scheduler event, a
// resolved review thread, a merged pull request — so the row can only ever be
// matched by a key that will never be asked about again. Without it the table
// is append-only for the life of the installation.
const KEEP_DAYS = 60;

function toMap(rows: { key: string; seen: string; readAt: Date }[]): ReadMap {
  return Object.fromEntries(
    rows.map((r) => [r.key, { seen: r.seen, readAt: r.readAt.toISOString() }]),
  );
}

export async function GET() {
  return jsonNoStore({ read: toMap(await prisma.notificationRead.findMany()) });
}

export async function POST(req: Request) {
  const body = await req.json();
  const entries: { key: string; seen: string }[] = Array.isArray(body?.entries)
    ? body.entries.filter(
        (e: unknown): e is { key: string; seen: string } =>
          !!e &&
          typeof (e as { key?: unknown }).key === "string" &&
          typeof (e as { seen?: unknown }).seen === "string",
      )
    : [];

  const readAt = new Date();
  // Upsert rather than createMany+skipDuplicates: a key that is already read
  // with an older fingerprint has to take the new one, which is what makes a
  // changed-then-re-read notification stay read.
  await prisma.$transaction(
    entries.map((e) =>
      prisma.notificationRead.upsert({
        where: { key: e.key },
        create: { key: e.key, seen: e.seen, readAt },
        update: { seen: e.seen, readAt },
      }),
    ),
  );

  if (entries.length) {
    await prisma.notificationRead.deleteMany({
      where: { readAt: { lt: new Date(Date.now() - KEEP_DAYS * 86_400_000) } },
    });
  }

  // The whole map back, not an acknowledgement: the caller applied its change
  // optimistically and this is what reconciles it with what other devices have
  // marked read since.
  return jsonNoStore({ read: toMap(await prisma.notificationRead.findMany()) });
}
