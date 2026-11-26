// How much of a Claude account's quota is used — the pure half.
//
// The account reports two rolling windows as a percentage: the 5-hour *session*
// and the *weekly* total (plus a per-model weekly one on some plans). A step's
// cost in quota is the change between a reading taken as its turn starts and one
// taken as it ends. No Prisma, no network: what is worth asserting is how a
// reading is parsed and how readings turn into "this run used X%".

export type QuotaWindow = { pct: number; resetsAt: string | null };

/** One reading of an account's usage. `session` / `week` are null when the plan has no such window. */
export type Quota = {
  session: QuotaWindow | null;
  week: QuotaWindow | null;
  weekSonnet: QuotaWindow | null;
  weekOpus: QuotaWindow | null;
  /** When the reading was taken (ISO). */
  at: string;
};

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

function windowOf(raw: unknown): QuotaWindow | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as { utilization?: unknown; resets_at?: unknown };
  const pct = num(o.utilization);
  if (pct === null) return null;
  const at = typeof o.resets_at === "string" && !Number.isNaN(Date.parse(o.resets_at)) ? new Date(o.resets_at).toISOString() : null;
  return { pct: Math.min(100, Math.max(0, pct)), resetsAt: at };
}

/** The usage endpoint's body → a reading; null when it carries neither the session nor the weekly window. */
export function parseQuota(raw: unknown, now = new Date()): Quota | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const session = windowOf(o.five_hour);
  const week = windowOf(o.seven_day);
  if (!session && !week) return null;
  return { session, week, weekSonnet: windowOf(o.seven_day_sonnet), weekOpus: windowOf(o.seven_day_opus), at: now.toISOString() };
}

/** A stored reading (Json column) back to a `Quota`, or null when it is not one. */
export function quotaOf(raw: unknown): Quota | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Partial<Quota>;
  if (typeof o.at !== "string") return null;
  const w = (x: unknown) => (x && typeof x === "object" && typeof (x as QuotaWindow).pct === "number" ? (x as QuotaWindow) : null);
  const q: Quota = { session: w(o.session), week: w(o.week), weekSonnet: w(o.weekSonnet), weekOpus: w(o.weekOpus), at: o.at };
  return q.session || q.week ? q : null;
}

/** Percentage points one window moved. A window that reset in between (end < start) cannot be told apart from
 *  a smaller one, so what is on the meter now is what accrued since the reset — a lower bound, never negative. */
const moved = (a: QuotaWindow | null, b: QuotaWindow | null): number | null => {
  if (!a || !b) return null;
  const d = Math.round((b.pct - a.pct) * 1e4) / 1e4;
  return d >= 0 ? d : b.pct;
};

/** What one step spent, in points of each window; null when either reading is missing. */
export type QuotaSpent = { session: number | null; week: number | null };

export function quotaSpent(start: Quota | null, end: Quota | null): QuotaSpent | null {
  if (!start || !end) return null;
  const s = { session: moved(start.session, end.session), week: moved(start.week, end.week) };
  return s.session === null && s.week === null ? null : s;
}

/** Points of each window per dollar of turn cost — what the account's meter has been seen to cost. */
export type QuotaRate = { session: number | null; week: number | null; samples: number };

const MIN_STEP_COST = 0.2; // below this the meter's own rounding swamps the move
const MIN_SAMPLES = 3;

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** The meter's price of a dollar, from steps whose usage was read before and after. A step's move also holds
 *  anything else that used the account, so each is a ceiling on its own cost; the median of many keeps one noisy
 *  step from setting the rate. Null until there are enough steps to say. */
export function quotaRate(steps: { costUsd: number; quotaStart?: unknown; quotaEnd?: unknown }[]): QuotaRate | null {
  const per = (pick: (d: QuotaSpent) => number | null) => {
    const xs = steps.flatMap((s) => {
      if (!(s.costUsd >= MIN_STEP_COST)) return [];
      const d = quotaSpent(quotaOf(s.quotaStart), quotaOf(s.quotaEnd));
      const v = d ? pick(d) : null;
      return v === null ? [] : [v / s.costUsd];
    });
    return xs.length >= MIN_SAMPLES ? { rate: median(xs), n: xs.length } : null;
  };
  const session = per((d) => d.session);
  const week = per((d) => d.week);
  return session || week ? { session: session?.rate ?? null, week: week?.rate ?? null, samples: Math.max(session?.n ?? 0, week?.n ?? 0) } : null;
}

/** What `costUsd` of turns is expected to take off each window; null without a rate or a cost. */
export function estimateQuota(costUsd: number, rate: QuotaRate | null): QuotaSpent | null {
  if (!rate || !(costUsd > 0)) return null;
  return { session: rate.session === null ? null : costUsd * rate.session, week: rate.week === null ? null : costUsd * rate.week };
}

/** "7.4%" — one decimal under 10 points, whole above; "<0.1%" for a sliver that did register. */
export function pctText(points: number): string {
  if (points <= 0) return "0%";
  if (points < 0.05) return "<0.1%";
  return `${points < 10 ? points.toFixed(1) : Math.round(points)}%`;
}
