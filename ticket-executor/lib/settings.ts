import { prisma } from "@/lib/prisma";
import { cached, DB_CACHE_PREFIX, invalidatePrefix } from "@/lib/redis";

/**
 * The settings row is read by almost every request — each API route resolves the
 * provider through it, and so do the runner and the scheduler — while being
 * written from exactly one place (`POST /api/settings`). That ratio is what
 * makes it worth caching, and the single writer is what makes it safe: the write
 * drops the key, so the only staleness a reader can see is its own process
 * racing that invalidation by milliseconds, not a whole TTL.
 *
 * The TTL is a backstop, not the mechanism. Host and container share one
 * Postgres, and they now also share one Redis — so an invalidation from either
 * is seen by both, which an in-process memo could never have managed.
 */
const SETTING_KEY = `${DB_CACHE_PREFIX}setting`;
const SETTING_TTL = 60;

type Setting = Awaited<ReturnType<typeof read>>;

async function read() {
  const existing = await prisma.setting.findUnique({ where: { id: "default" } });
  if (existing) return existing;
  return prisma.setting.create({ data: { id: "default" } });
}

/** The settings row, created on first read. */
export async function getOrCreateSetting(): Promise<Setting> {
  const row = await cached(SETTING_KEY, SETTING_TTL, read);
  // JSON has no date type, so a cached row hands `updatedAt` back as a string.
  // Revived here rather than at the call sites: the declared type says Date and
  // a consumer is entitled to believe it.
  return { ...row, updatedAt: new Date(row.updatedAt) };
}

/** Drop the cached row. Called by the one route that writes it. */
export async function invalidateSetting(): Promise<void> {
  await invalidatePrefix(SETTING_KEY);
}
