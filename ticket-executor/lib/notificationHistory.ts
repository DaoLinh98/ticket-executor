import { prisma } from "@/lib/prisma";
import { cached, DB_CACHE_PREFIX, invalidatePrefix } from "@/lib/redis";
import {
  historyWorthy, notificationKey,
  type AppNotification, type NotificationKind, type NotificationSeverity, type NotificationTab,
} from "@/lib/notifications";

const HISTORY_CACHE_PREFIX = `${DB_CACHE_PREFIX}notifHistory:`;
const HISTORY_TTL_SECONDS = 30;
export const HISTORY_PAGE_MAX = 50;

export function historyScope(provider: string, org: string, email: string): string {
  return `${provider}:${org}:${email.toLowerCase()}`;
}

export async function recordHistory(scope: string, list: AppNotification[]): Promise<void> {
  const rows = historyWorthy(list);
  if (!rows.length) return;
  const { count } = await prisma.notificationHistory.createMany({
    data: rows.map((n) => ({
      scope,
      key: notificationKey(n),
      kind: n.kind,
      ticketId: n.ticketId,
      refId: n.refId,
      severity: n.severity,
      summary: n.summary,
      tab: n.tab,
      href: n.href ?? "",
      fingerprint: n.fingerprint,
      at: new Date(n.at),
    })),
    skipDuplicates: true,
  });
  if (count) await invalidatePrefix(`${HISTORY_CACHE_PREFIX}${scope}:`);
}

export type HistoryPage = { items: AppNotification[]; next: string | null };

/** `before` is the opaque cursor a previous page returned: `<iso>|<key>`. */
export async function loadHistory(scope: string, before: string | null, limit: number): Promise<HistoryPage> {
  const take = Math.min(Math.max(1, limit), HISTORY_PAGE_MAX);
  return cached(`${HISTORY_CACHE_PREFIX}${scope}:${before ?? ""}:${take}`, HISTORY_TTL_SECONDS, async () => {
    const sep = before ? before.indexOf("|") : -1;
    const cursorAt = sep > 0 ? new Date(before!.slice(0, sep)) : null;
    const cursorKey = sep > 0 ? before!.slice(sep + 1) : "";
    const valid = cursorAt && !Number.isNaN(cursorAt.getTime());

    const rows = await prisma.notificationHistory.findMany({
      where: {
        scope,
        ...(valid ? { OR: [{ at: { lt: cursorAt } }, { at: cursorAt, key: { lt: cursorKey } }] } : {}),
      },
      orderBy: [{ at: "desc" }, { key: "desc" }],
      take: take + 1,
    });

    const page = rows.slice(0, take);
    const last = page[page.length - 1];
    return {
      items: page.map((r) => ({
        kind: r.kind as NotificationKind,
        ticketId: r.ticketId,
        refId: r.refId,
        severity: r.severity as NotificationSeverity,
        summary: r.summary,
        at: r.at.toISOString(),
        tab: r.tab as NotificationTab,
        ...(r.href ? { href: r.href } : {}),
        fingerprint: r.fingerprint,
      })),
      next: rows.length > take && last ? `${last.at.toISOString()}|${last.key}` : null,
    };
  });
}
