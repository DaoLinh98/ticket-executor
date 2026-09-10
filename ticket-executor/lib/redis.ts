import Redis from "ioredis";

/**
 * Optional Redis, used as a shared read cache in front of the provider.
 *
 * Optional is the contract, not a fallback: with `REDIS_URL` unset — and on any
 * connection error afterwards — every helper here degrades to calling through,
 * which is exactly the behaviour the app had before Redis existed. Nothing in
 * the app may treat a cache miss as a failure, because a machine with no Redis
 * running must stay fully usable.
 *
 * Only *reads* go through here, and only the stable ones (see `lib/ado.ts`).
 * Anything a write can invalidate within one click is left uncached.
 */

let client: Redis | null = null;
let disabled = false;
let errorLogged = false;
/** Circuit breaker: while set in the future, every helper behaves as if Redis
 *  were not configured. Without it a permanently down Redis would cost each
 *  request a `commandTimeout` before falling through, turning a cache miss into
 *  a slowdown — the opposite of the point. */
let unavailableUntil = 0;
const BREAKER_MS = 30_000;

/** The live client, or null when Redis is not configured / currently unusable. */
export function redis(): Redis | null {
  if (disabled) return null;
  if (Date.now() < unavailableUntil) return null;
  if (client) return client;
  const url = process.env.REDIS_URL?.trim();
  if (!url) {
    disabled = true;
    return null;
  }
  client = new Redis(url, {
    // The offline queue stays on: the app's first reads land before the socket
    // is ready, and rejecting those would leave the cache permanently cold.
    // `commandTimeout` is what keeps that from being a stall — a page load never
    // waits longer than this on a cache, connecting or not.
    maxRetriesPerRequest: 1,
    commandTimeout: 1000,
    connectTimeout: 1500,
    retryStrategy: (times) => Math.min(times * 500, 5000),
  });
  client.on("ready", () => { unavailableUntil = 0; });
  client.on("error", (e: Error) => {
    unavailableUntil = Date.now() + BREAKER_MS;
    // ioredis reconnects on its own; log once per burst rather than per command.
    if (!errorLogged) {
      errorLogged = true;
      console.warn(`[redis] ${e.message} — falling back to uncached provider reads`);
      setTimeout(() => { errorLogged = false; }, BREAKER_MS).unref?.();
    }
  });
  return client;
}

/** Whether Redis is configured at all (used by the system check). */
export function redisConfigured(): boolean {
  return Boolean(process.env.REDIS_URL?.trim());
}

/** Round-trip probe for the system check. Never throws. */
export async function redisPing(): Promise<{ ok: boolean; detail: string }> {
  // Bypass the breaker: the whole point of the check is to report the live
  // state, and a probe that answers from a 30s-old failure is not that.
  unavailableUntil = 0;
  const c = redis();
  if (!c) return { ok: false, detail: "REDIS_URL is not set." };
  try {
    const started = Date.now();
    await c.ping();
    return { ok: true, detail: `PONG in ${Date.now() - started}ms.` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

// In-process single-flight. Two components asking the same question in the same
// tick (the sprint picker and the ticket load both want the iteration list)
// share one round-trip instead of racing to fill the same key.
const inflight = new Map<string, Promise<unknown>>();

/**
 * Prefix for everything cached out of this app's own Postgres, as opposed to
 * the provider. Kept separate from `ADO_CACHE_PREFIX` so an organization switch
 * clears the provider's answers without throwing away the app's.
 */
export const DB_CACHE_PREFIX = "db:";

/**
 * Read `key` from Redis, else run `load()` and store its result for `ttlSeconds`.
 *
 * Values round-trip through JSON, so only JSON-safe shapes may be cached: a
 * `Date` comes back as a string and a `Map` as `{}`. A caller caching a Prisma
 * row with date columns has to revive them itself (see `lib/settings.ts`).
 *
 * `load()` is always awaited on a miss and its value is always returned, so a
 * caller cannot tell whether Redis participated. A rejected `load()` caches
 * nothing — the next caller retries rather than inheriting the failure.
 */
export async function cached<T>(key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;

  const run = (async () => {
    const c = redis();
    if (c) {
      try {
        const hit = await c.get(key);
        if (hit !== null) return JSON.parse(hit) as T;
      } catch {
        /* unreachable cache is a miss */
      }
    }
    const value = await load();
    if (c) {
      try {
        await c.set(key, JSON.stringify(value), "EX", ttlSeconds);
      } catch {
        /* the answer is already computed; failing to store it changes nothing */
      }
    }
    return value;
  })();

  inflight.set(key, run);
  run.finally(() => inflight.delete(key)).catch(() => {});
  return run;
}

/**
 * Drop every key under `prefix`. Called when the active organization changes:
 * the cached answers describe the organization the app is no longer acting as.
 */
export async function invalidatePrefix(prefix: string): Promise<void> {
  const c = redis();
  if (!c) return;
  try {
    let cursor = "0";
    do {
      const [next, keys] = await c.scan(cursor, "MATCH", `${prefix}*`, "COUNT", 500);
      cursor = next;
      if (keys.length) await c.del(...keys);
    } while (cursor !== "0");
  } catch {
    /* a cache that cannot be cleared still expires on its own TTL */
  }
}
