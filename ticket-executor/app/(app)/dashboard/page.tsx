"use client";

import { useCallback, useEffect, useState } from "react";
import type { CSSProperties } from "react";
import SelectMenu from "../../SelectMenu";
import LoadingRing from "../../ticket-executor/LoadingRing";
import type { CountEntry, DashboardMetrics, SkillConsistency } from "@/lib/executionStore";
import { COLORS, FONT, card, pill, ringBorder, tintedCard } from "@/lib/ui";
import ProviderBadge from "../ProviderBadge";
import PageHeading from "../PageHeading";
import NotificationCenter from "../NotificationCenter";
import PageToolbar from "../PageToolbar";
import { CONNECTION_CHANGED_EVENT } from "../../connectionEvents";
import { usePagePrefs } from "../../pagePrefs";

// ---- formatting helpers (view-only) ----
const fmtUsd = (n: number) => (n >= 1 || n === 0 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`);
const fmtTokens = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : `${n}`;
const fmtPct = (r: number) => `${(r * 100).toFixed(1)}%`;
const fmtMs = (ms: number) => {
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
};
const fmtHours = (h: number) => (h >= 10 ? `${h.toFixed(0)}h` : h >= 1 ? `${h.toFixed(1)}h` : `${Math.round(h * 60)}m`);
const fmtX = (n: number) => `${n.toFixed(2)}×`;

// Lookback windows offered in the header. Label → days; "" = all time.
const RANGES: Record<string, number> = {
  "Last 7 days": 7,
  "Last 30 days": 30,
  "Last 90 days": 90,
};

const sectionHeading: CSSProperties = {
  margin: "0 0 14px", fontFamily: "var(--font-space), sans-serif", fontSize: FONT.xs,
  fontWeight: 700, letterSpacing: ".16em", color: COLORS.faint,
};

// The band that opens each of the three tiers (VALUE / QUALITY / OPERATIONS).
// Same type treatment as sectionHeading, one step up, with a rule to its right.
function TierHeading({ n, title, blurb }: { n: string; title: string; blurb: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: "12px", margin: "6px 0 -8px" }}>
      <span style={{ ...pill({ color: COLORS.accent, border: COLORS.border, size: "xs", weight: 700 }) }}>{n}</span>
      <span style={{ fontFamily: "var(--font-space), sans-serif", fontSize: FONT.base, fontWeight: 700, letterSpacing: ".14em", color: COLORS.text }}>{title}</span>
      <span style={{ fontSize: FONT.sm, color: COLORS.textMuted, flex: 1, minWidth: 0 }}>{blurb}</span>
    </div>
  );
}

function KpiTile({
  label, value, sub, hint, tone, index = 0, big = false,
}: {
  label: string; value: string; sub?: string; hint?: string; tone?: string; index?: number; big?: boolean;
}) {
  return (
    <div
      style={{
        padding: big ? "18px 20px" : "16px 18px", borderRadius: "13px", display: "flex", flexDirection: "column", gap: "8px",
        transition: "transform .22s cubic-bezier(.2,.8,.2,1), box-shadow .22s",
        ...ringBorder({
          fill: COLORS.panelBg, duration: 4.2 + index * 0.3, shape: "none",
          extraAnimation: "fadeUp .45s both", extraAnimationDelay: `${index * 55}ms`,
        }),
      }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 14px 34px -20px var(--accent)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = "none"; }}
    >
      <div style={{ fontSize: FONT.xs, letterSpacing: ".13em", color: COLORS.faint, fontWeight: 600 }}>{label}</div>
      <div style={{ fontFamily: "var(--font-space), sans-serif", fontSize: big ? "34px" : "26px", fontWeight: 700, color: tone ?? COLORS.text, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: FONT.sm, color: COLORS.textDim }}>{sub}</div>}
      {/* The comparison baseline, stated on the tile itself — a leverage number
          means nothing without saying what it is leverage *over*. */}
      {hint && <div style={{ fontSize: FONT.xs, color: COLORS.textMuted, fontStyle: "italic" }}>{hint}</div>}
    </div>
  );
}

// Horizontal bars for a categorical breakdown (by provider / project / skill).
function BarList({ rows, color }: { rows: CountEntry[]; color: string }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  if (!rows.length) return <div style={{ fontSize: FONT.base, color: COLORS.faint }}>No runs yet.</div>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "9px" }}>
      {rows.map((r) => (
        <div key={r.key} style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{ width: "34%", minWidth: 0, fontFamily: "var(--font-mono), monospace", fontSize: FONT.sm, color: COLORS.textSoft, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.key}>{r.key}</div>
          <div style={{ flex: 1, height: "9px", borderRadius: "999px", background: "rgba(255,255,255,.04)", overflow: "hidden" }}>
            <div style={{ width: `${(r.count / max) * 100}%`, height: "100%", borderRadius: "999px", background: color, transformOrigin: "left", animation: "growX .5s cubic-bezier(.16,1,.3,1) both" }} />
          </div>
          <div style={{ width: "38px", textAlign: "right", fontFamily: "var(--font-mono), monospace", fontSize: FONT.sm, fontWeight: 600, color: COLORS.text }}>{r.count}</div>
        </div>
      ))}
    </div>
  );
}

// What GET /api/dashboard/funnel returns — the provider-resolved half of the
// funnel, loaded separately so PR round-trips never delay the main metrics.
type FunnelData = {
  prCreated: number;
  merged: number;
  mergedClean: number;
  sampled: number;
  providerBacked: boolean;
  notice?: string;
  error?: string;
};

// Delivery funnel: each stage as a proportion of the first. Stages the provider
// hasn't been polled for render as an explicit "not measured" slot rather than a
// zero, so an unwired (or still-loading) stage never reads as a failure.
function Funnel({ f, live }: { f: DashboardMetrics["funnel"]; live: FunnelData | null }) {
  const backed = live?.providerBacked ?? false;
  const stages = [
    { label: "Runs", n: f.runs, c: COLORS.indigo, known: true },
    { label: "PR created", n: f.prCreated, c: COLORS.info, known: true },
    { label: "Merged", n: live?.merged ?? 0, c: COLORS.success, known: backed },
    { label: "Merged clean", n: live?.mergedClean ?? 0, c: COLORS.accent, known: backed },
  ];
  const base = Math.max(1, f.runs);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      {stages.map((s, i) => (
        <div key={s.label} style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{ width: "92px", fontSize: FONT.sm, color: COLORS.textDim, fontWeight: 600 }}>{s.label}</div>
          <div style={{ flex: 1, height: "13px", borderRadius: "999px", background: "rgba(255,255,255,.04)", overflow: "hidden" }}>
            {s.known && (
              <div style={{ width: `${(s.n / base) * 100}%`, height: "100%", borderRadius: "999px", background: s.c, animation: "growX .5s cubic-bezier(.16,1,.3,1) both", animationDelay: `${i * 70}ms` }} />
            )}
          </div>
          <div style={{ width: "82px", textAlign: "right", fontFamily: "var(--font-mono), monospace", fontSize: FONT.sm, fontWeight: 600, color: s.known ? COLORS.text : COLORS.faint }}>
            {s.known ? `${s.n} · ${fmtPct(s.n / base)}` : live ? "not measured" : "…"}
          </div>
        </div>
      ))}
      {(live?.notice || live?.error) && (
        <div style={{ fontSize: FONT.xs, color: live.error ? COLORS.danger : COLORS.textMuted, marginTop: "2px" }}>
          {live.error ?? live.notice}
        </div>
      )}
      {backed && live && live.sampled > 0 && (
        <div style={{ fontSize: FONT.xs, color: COLORS.textMuted }}>
          {live.sampled} PR{live.sampled === 1 ? "" : "s"} resolved against the provider.
        </div>
      )}
    </div>
  );
}

// Per-skill duration spread. A standardized skill should be predictable; a wide
// CV means the workflow is not actually repeatable yet.
function ConsistencyTable({ rows }: { rows: SkillConsistency[] }) {
  if (!rows.length) return <div style={{ fontSize: FONT.base, color: COLORS.faint }}>No completed runs yet.</div>;
  const tone = (cv: number) => (cv <= 0.35 ? COLORS.success : cv <= 0.7 ? COLORS.warning : COLORS.danger);
  const verdict = (cv: number) => (cv <= 0.35 ? "predictable" : cv <= 0.7 ? "variable" : "erratic");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      {rows.map((r) => (
        <div key={r.skill} style={{ ...card({ padding: "9px 12px" }), display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{ flex: 1, minWidth: 0, fontFamily: "var(--font-mono), monospace", fontSize: FONT.sm, color: COLORS.textSoft, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.skill}</div>
          <div style={{ fontSize: FONT.xs, color: COLORS.textMuted, whiteSpace: "nowrap" }}>{r.count} runs</div>
          <div style={{ fontFamily: "var(--font-mono), monospace", fontSize: FONT.sm, color: COLORS.textDim, whiteSpace: "nowrap" }}>
            p50 {fmtMs(r.p50Ms)} · p95 {fmtMs(r.p95Ms)}
          </div>
          <span style={pill({ color: tone(r.cv), border: COLORS.border, size: "xs" })}>
            CV {r.cv.toFixed(2)} · {verdict(r.cv)}
          </span>
        </div>
      ))}
    </div>
  );
}

// Cost-over-time line + area chart, with completed runs per day overlaid on its
// own normalized scale — cost alone reads as spend, cost against output reads as
// efficiency.
function CostTrend({ trend }: { trend: DashboardMetrics["cost"]["trend"] }) {
  if (!trend.length) return <div style={{ fontSize: FONT.base, color: COLORS.faint }}>No cost data yet.</div>;
  const W = 640, H = 160, PAD = 8;
  const maxCost = Math.max(...trend.map((t) => t.costUsd), 0.0001);
  const maxShipped = Math.max(...trend.map((t) => t.shipped), 1);
  const n = trend.length;
  const x = (i: number) => (n === 1 ? W / 2 : PAD + (i * (W - 2 * PAD)) / (n - 1));
  const y = (v: number, max: number) => H - PAD - (v / max) * (H - 2 * PAD);
  const pts = trend.map((t, i) => `${x(i)},${y(t.costUsd, maxCost)}`).join(" ");
  const shippedPts = trend.map((t, i) => `${x(i)},${y(t.shipped, maxShipped)}`).join(" ");
  const area = `${PAD},${H - PAD} ${pts} ${x(n - 1)},${H - PAD}`;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="160" preserveAspectRatio="none" style={{ display: "block" }}>
        <defs>
          <linearGradient id="costFill" x1="0" y1="0" x2="0" y2="1">
            {/* Through `style`, not the presentation attribute: the palette is
                CSS custom properties now, and an SVG attribute does not resolve
                var(). Same reason for every stroke/fill below. */}
            <stop offset="0%" style={{ stopColor: COLORS.accent }} stopOpacity="0.28" />
            <stop offset="100%" style={{ stopColor: COLORS.accent }} stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={area} fill="url(#costFill)" />
        <polyline points={shippedPts} fill="none" style={{ stroke: COLORS.success }} strokeWidth="1.6" strokeDasharray="4 3" strokeLinejoin="round" strokeLinecap="round" opacity="0.85" />
        <polyline points={pts} fill="none" style={{ stroke: COLORS.accent }} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {trend.map((t, i) => (
          <circle key={t.date} cx={x(i)} cy={y(t.costUsd, maxCost)} r="2.6" style={{ fill: COLORS.accent }} />
        ))}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "6px", fontSize: FONT.xs, color: COLORS.faint, fontFamily: "var(--font-mono), monospace" }}>
        <span>{trend[0].date}</span>
        <span style={{ display: "flex", gap: "12px", fontFamily: "inherit" }}>
          <span style={{ color: COLORS.accent }}>— cost/day</span>
          <span style={{ color: COLORS.success }}>-- runs completed/day</span>
        </span>
        <span>{trend[trend.length - 1].date}</span>
      </div>
    </div>
  );
}

// Stacked status bar for run reliability.
function StatusBar({ r }: { r: DashboardMetrics["reliability"] }) {
  const segs = [
    { label: "Completed", n: r.completed, c: COLORS.success },
    { label: "Failed", n: r.failed, c: COLORS.danger },
    { label: "Cancelled", n: r.cancelled, c: COLORS.textMuted },
    { label: "Running", n: r.running, c: COLORS.warning },
    { label: "Awaiting", n: r.awaitingApproval, c: COLORS.indigo },
  ].filter((s) => s.n > 0);
  const total = segs.reduce((s, x) => s + x.n, 0) || 1;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <div style={{ display: "flex", height: "12px", borderRadius: "999px", overflow: "hidden", background: "rgba(255,255,255,.04)" }}>
        {segs.map((s) => (
          <div key={s.label} style={{ width: `${(s.n / total) * 100}%`, background: s.c }} title={`${s.label}: ${s.n}`} />
        ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
        {segs.map((s) => (
          <span key={s.label} style={pill({ color: s.c, border: COLORS.border, size: "xs" })}>
            <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: s.c }} />
            {s.label} {s.n}
          </span>
        ))}
        {!segs.length && <span style={{ fontSize: FONT.base, color: COLORS.faint }}>No runs yet.</span>}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardMetrics | null>(null);
  const [funnel, setFunnel] = useState<FunnelData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const { prefs, ready: prefsReady, save: savePrefs } = usePagePrefs<{
    provider: string;
    project: string;
    rangeLabel: string;
  }>("dashboard", { provider: "", project: "", rangeLabel: "" });
  const [provider, setProvider] = useState("");
  const [project, setProject] = useState("");
  const [rangeLabel, setRangeLabel] = useState("");
  // Bumped when the header switches organization. The server scopes these
  // metrics to the active connection, so the same query string is a different
  // question after a switch — and the project filter is another organization's
  // list, so it comes back from that organization's own remembered filters.
  const [orgEpoch, setOrgEpoch] = useState(0);

  useEffect(() => {
    const onChanged = () => { setOrgEpoch((n) => n + 1); };
    window.addEventListener(CONNECTION_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(CONNECTION_CHANGED_EVENT, onChanged);
  }, []);

  // The filters this organization was last looking at. Applied before the first
  // fetch so the dashboard is not queried twice for two different questions.
  useEffect(() => {
    if (!prefsReady) return;
    setProvider(prefs.provider);
    setProject(prefs.project);
    setRangeLabel(prefs.rangeLabel);
  }, [prefsReady, prefs]);

  useEffect(() => {
    if (!prefsReady) return;
    savePrefs({ provider, project, rangeLabel });
  }, [prefsReady, provider, project, rangeLabel, savePrefs]);

  // A remembered filter that this organization has no runs for would show an
  // empty dashboard and look broken. Drop it back to All instead.
  useEffect(() => {
    if (!data) return;
    if (project && !data.filters.projects.includes(project)) setProject("");
    if (provider && !data.filters.providers.includes(provider)) setProvider("");
  }, [data, project, provider]);

  const query = useCallback(() => {
    const qs = new URLSearchParams();
    if (provider) qs.set("provider", provider);
    if (project) qs.set("project", project);
    if (rangeLabel && RANGES[rangeLabel]) qs.set("days", String(RANGES[rangeLabel]));
    return qs.toString();
  }, [provider, project, rangeLabel]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/dashboard?${query()}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load metrics");
      setData(json as DashboardMetrics);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    if (!prefsReady) return;
    void load();
  }, [prefsReady, load, orgEpoch]);

  // The funnel talks to the provider (one or two round-trips per PR), so it is
  // fetched on its own and merged in when it lands — a slow or unreachable
  // provider must never hold up the rest of the dashboard.
  useEffect(() => {
    if (!prefsReady) return;
    let cancelled = false;
    setFunnel(null);
    void (async () => {
      try {
        const res = await fetch(`/api/dashboard/funnel?${query()}`, { cache: "no-store" });
        const json = await res.json();
        if (!cancelled) setFunnel(res.ok ? (json as FunnelData) : { ...json, providerBacked: false, prCreated: 0, merged: 0, mergedClean: 0, sampled: 0 });
      } catch (e) {
        if (!cancelled) {
          setFunnel({ prCreated: 0, merged: 0, mergedClean: 0, sampled: 0, providerBacked: false, error: e instanceof Error ? e.message : String(e) });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [prefsReady, query, orgEpoch]);

  // Same rounded-panel-with-spinning-ring treatment as the log panel in ExecutionTab —
  // shape:"none" keeps the ring's animated conic-gradient background while letting us
  // set our own border-radius instead of the hexagon chip cut used for buttons/pills.
  // delayIndex is only passed when this panelStyle is applied directly to the entrance-
  // animated section itself (not a plain inner div) — ringBorder's extraAnimation keeps
  // the spin and the fadeUp from clobbering each other's `animation` property.
  const panelStyle = (duration = 4.2, delayIndex?: number): CSSProperties => ({
    padding: "18px 20px", borderRadius: "14px", position: "relative", overflow: "hidden",
    ...ringBorder({
      fill: COLORS.panelBg, duration, shape: "none",
      ...(delayIndex !== undefined
        ? { extraAnimation: "fadeUp .45s both", extraAnimationDelay: `${delayIndex * 70}ms` }
        : {}),
    }),
  });
  const heroPanelStyle = (delayIndex?: number): CSSProperties => ({
    ...panelStyle(5.5, delayIndex),
    boxShadow: "0 24px 60px -34px #000",
  });
  const scanlineOverlay: CSSProperties = {
    position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none",
    background: "repeating-linear-gradient(0deg,rgba(255,255,255,.016) 0px,rgba(255,255,255,.016) 1px,transparent 1px,transparent 3px)",
  };
  const topAccentLine: CSSProperties = {
    position: "absolute", top: 0, left: 0, right: 0, height: "1px", zIndex: 0, pointerEvents: "none",
    background: "linear-gradient(90deg,transparent,var(--accent),transparent)", opacity: 0.55,
  };
  const sectionDelay = (i: number) => ({ animation: "fadeUp .45s both", animationDelay: `${i * 70}ms` } as CSSProperties);
  // Tier 3 is reference material, not the argument — dim it so the eye lands on
  // tiers 1 and 2 first.
  const opsTier: CSSProperties = { display: "flex", flexDirection: "column", gap: "16px", opacity: 0.86 };

  return (
    <div style={{ position: "relative", height: "100vh", overflow: "hidden", background: "transparent", color: COLORS.text, display: "flex", flexDirection: "column", ["--accent" as string]: COLORS.accent }}>
      <header style={{ position: "relative", zIndex: 30, height: "60px", flex: "0 0 auto", display: "flex", alignItems: "center", gap: "16px", padding: "0 22px", borderBottom: "1px solid rgba(255,255,255,.06)", background: "rgba(14,17,23,.72)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)" }}>
        <PageHeading title="Run Metrics" kicker="D-AGENT · ANALYTICS" icon={<path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />} />
        <div style={{ flex: 1 }} />
        <NotificationCenter />
        <ProviderBadge />
      </header>

      {/* This page's own filters — what the metrics below are counted over. */}
      <PageToolbar>
        <div style={{ width: "170px" }}>
          <SelectMenu variant="filter" alwaysGlow value={rangeLabel} onChange={setRangeLabel} options={Object.keys(RANGES)} allLabel="Range: All time" ariaLabel="Filter by time range" />
        </div>
        <div style={{ width: "190px" }}>
          <SelectMenu variant="filter" alwaysGlow value={provider} onChange={setProvider} options={data?.filters.providers ?? []} allLabel="Provider: All" ariaLabel="Filter by provider" />
        </div>
        <div style={{ width: "210px" }}>
          <SelectMenu variant="filter" alwaysGlow value={project} onChange={setProject} options={data?.filters.projects ?? []} allLabel="Project: All" ariaLabel="Filter by project" />
        </div>
      </PageToolbar>

      <main className="te-scroll" style={{ position: "relative", zIndex: 1, flex: 1, overflowY: "auto", padding: "26px 28px 48px", background: "linear-gradient(110deg,rgba(6,7,10,.5) 0%,rgba(6,7,10,.22) 52%,rgba(6,7,10,0) 100%)" }}>
        <div style={{ maxWidth: "1100px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "26px" }}>
          {error && (
            <div style={{ ...tintedCard("danger"), animation: "fadeUp .4s both" }}>
              <div style={{ fontSize: FONT.base, color: COLORS.danger, fontWeight: 600 }}>{error}</div>
            </div>
          )}
          {loading && !data && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "20px", minHeight: "calc(100vh - 220px)" }}>
              <LoadingRing size={100} />
            </div>
          )}

          {data && (
            <>
              {/* ---------- TIER 1 · VALUE ---------- */}
              <TierHeading n="01" title="VALUE" blurb="What this app adds over driving the Claude CLI by hand, one session at a time." />

              <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "12px", ...sectionDelay(0) }}>
                <KpiTile big index={0} label="COMPRESSION" value={fmtX(data.leverage.compressionFactor)} tone={COLORS.accent}
                  sub={`peak ${data.leverage.concurrentPeak} runs in flight`}
                  hint="vs. one sequential CLI session" />
                <KpiTile big index={1} label="HOURS SAVED" value={fmtHours(data.leverage.hoursSaved)} tone={COLORS.success}
                  sub={`${fmtHours(data.leverage.wallClockHours)} wall-clock`}
                  hint="time overlap bought you" />
                <KpiTile big index={2} label="AGENT HOURS" value={fmtHours(data.leverage.agentActiveHours)}
                  sub={`${fmtHours(data.leverage.humanWaitHours)} waiting on review`}
                  hint="CLI compute time delivered" />
                <KpiTile big index={3} label="TICKETS SHIPPED" value={`${data.quality.ticketsShipped}`}
                  sub={`of ${data.quality.ticketsAttempted} attempted`}
                  hint={`${fmtUsd(data.cost.costPerShippedTicket)} per shipped ticket`} />
              </section>

              <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px", ...sectionDelay(1) }}>
                <KpiTile index={4} label="BLOCKED BEFORE SPAWN" value={`${data.leverage.blockedBeforeSpawn}`} tone={COLORS.warning}
                  sub={`≈ ${fmtUsd(data.leverage.wasteAvertedUsd)} of tokens not burned`}
                  hint="preflight caught it; a bare CLI would have run and failed" />
                <KpiTile index={5} label="SESSIONS RECOVERED" value={`${data.leverage.sessionsRecovered}`} tone={COLORS.info}
                  sub="parked plans resumed after a restart"
                  hint="a closed terminal loses these" />
                <KpiTile index={6} label="SUPERVISION LOAD" value={fmtPct(data.leverage.humanWaitHours / Math.max(0.0001, data.leverage.agentActiveHours + data.leverage.humanWaitHours))}
                  sub="of run wall-clock spent waiting on a human"
                  hint="lower = the agent runs unattended longer" />
              </section>

              {/* A different baseline from everything above it — priced against the
                  team's own estimates, i.e. not using an agent at all. Shown only
                  when a real hourly rate is configured; a guessed one would be
                  worse than no number. */}
              {data.roi.configured && (
                <section style={{ ...tintedCard("accent"), ...sectionDelay(2) }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: "10px", marginBottom: "14px", flexWrap: "wrap" }}>
                    <h3 style={{ ...sectionHeading, margin: 0 }}>ESTIMATED VALUE</h3>
                    <span style={{ fontSize: FONT.xs, color: COLORS.textMuted, fontStyle: "italic" }}>
                      vs. not using an agent at all — priced from your own ticket estimates at {fmtUsd(data.roi.hourlyRateUsd)}/h
                    </span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "16px" }}>
                    {[
                      { l: "ESTIMATED HOURS", v: fmtHours(data.roi.estimatedHours), c: COLORS.text },
                      { l: "VALUE DELIVERED", v: fmtUsd(data.roi.estimatedValueUsd), c: COLORS.success },
                      { l: "TOKEN SPEND", v: fmtUsd(data.roi.tokenSpendUsd), c: COLORS.accent },
                      { l: "NET", v: fmtUsd(data.roi.netUsd), c: data.roi.netUsd >= 0 ? COLORS.success : COLORS.danger },
                      { l: "RETURN", v: data.roi.multiple ? fmtX(data.roi.multiple) : "—", c: COLORS.text },
                    ].map((t) => (
                      <div key={t.l}>
                        <div style={{ fontSize: FONT.xs, letterSpacing: ".13em", color: COLORS.faint, fontWeight: 600, marginBottom: "6px" }}>{t.l}</div>
                        <div style={{ fontFamily: "var(--font-space), sans-serif", fontSize: FONT.xl, fontWeight: 700, color: t.c }}>{t.v}</div>
                      </div>
                    ))}
                  </div>
                  {/* Coverage is the honesty check: a big number from two sized
                      tickets out of forty is not a result. */}
                  <div style={{ fontSize: FONT.sm, color: COLORS.textDim, marginTop: "14px" }}>
                    Based on {data.roi.sizedTickets} of {data.quality.ticketsShipped} shipped tickets that carried an estimate ({fmtPct(data.roi.coverage)} coverage).
                    {data.roi.coverage < 0.5 && " Size more tickets before quoting this figure."}
                  </div>
                </section>
              )}

              {/* ---------- TIER 2 · QUALITY ---------- */}
              <TierHeading n="02" title="QUALITY" blurb="Measured per ticket, not per run — rework is exactly what a per-run view hides." />

              <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "12px", ...sectionDelay(2) }}>
                <KpiTile index={7} label="FIRST-PASS RATE" value={fmtPct(data.quality.firstPassRate)} tone={COLORS.success}
                  sub={`${data.quality.ticketsAttempted} tickets attempted`}
                  hint="shipped on the first run, no retry" />
                <KpiTile index={8} label="REWORK FACTOR" value={data.quality.ticketsAttempted ? `${data.quality.reworkFactor.toFixed(2)}×` : "—"}
                  sub={`${data.quality.implementRuns} implement runs`}
                  hint="1.00× would mean no ticket was ever re-run" />
                <KpiTile index={9} label="PLAN APPROVAL" value={data.quality.planReviewedCount ? fmtPct(data.quality.planApprovalRate) : "—"} tone={COLORS.indigo}
                  sub={`${data.quality.planReviewedCount} plans · ${data.quality.avgPlanRevisions.toFixed(2)} revisions each`}
                  hint="did the agent read the ticket right?" />
                <KpiTile index={10} label="REVIEW-FIX RATIO" value={data.quality.implementRuns ? fmtPct(data.quality.reviewFixRatio) : "—"} tone={COLORS.warning}
                  sub={`${data.quality.fixReviewRuns} fix-review runs`}
                  hint="lower = less reviewer pushback per feature" />
                <KpiTile index={11} label="CHANGE SIZE" value={data.quality.avgFilesPerRun ? `${data.quality.avgFilesPerRun.toFixed(1)} files` : "—"}
                  sub={data.quality.avgLinesPerRun ? `${Math.round(data.quality.avgLinesPerRun)} lines changed per run` : "no diffs recorded"}
                  hint="real work, not a one-line edit" />
              </section>

              <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", ...sectionDelay(3) }}>
                <div style={panelStyle(3.8)}>
                  <h3 style={sectionHeading}>DELIVERY FUNNEL</h3>
                  <Funnel f={data.funnel} live={funnel} />
                </div>
                <div style={panelStyle(4.2)}>
                  <h3 style={sectionHeading}>CONSISTENCY BY SKILL</h3>
                  <ConsistencyTable rows={data.consistency} />
                </div>
              </section>

              {/* ---------- TIER 3 · OPERATIONS ---------- */}
              <TierHeading n="03" title="OPERATIONS" blurb="Day-to-day running of the engine: spend, reliability, and where the runs went." />

              <div style={opsTier}>
                {/* Cost trend — the hero chart, same scanline + top-accent-line + spinning ring
                    treatment as the live-log panel in ExecutionTab. */}
                <section style={heroPanelStyle(4)}>
                  <div style={scanlineOverlay} />
                  <div style={topAccentLine} />
                  <div style={{ position: "relative", zIndex: 1 }}>
                    <h3 style={sectionHeading}>COST OVER TIME vs. RUNS COMPLETED</h3>
                    <CostTrend trend={data.cost.trend} />
                  </div>
                </section>

                <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                  <div style={panelStyle(3.6)}>
                    <h3 style={sectionHeading}>RELIABILITY</h3>
                    <StatusBar r={data.reliability} />
                  </div>
                  <div style={panelStyle(4.4)}>
                    <h3 style={sectionHeading}>SPEED (COMPLETED RUNS)</h3>
                    <div style={{ display: "flex", gap: "24px" }}>
                      {[
                        { l: "AVG", v: data.speed.avgMs },
                        { l: "P50", v: data.speed.p50Ms },
                        { l: "P95", v: data.speed.p95Ms },
                      ].map((s) => (
                        <div key={s.l}>
                          <div style={{ fontSize: FONT.xs, letterSpacing: ".13em", color: COLORS.faint, fontWeight: 600, marginBottom: "6px" }}>{s.l}</div>
                          <div style={{ fontFamily: "var(--font-space), sans-serif", fontSize: FONT.xl, fontWeight: 700, color: COLORS.text }}>{data.speed.count ? fmtMs(s.v) : "—"}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{ fontSize: FONT.sm, color: COLORS.textDim, marginTop: "14px" }}>{data.speed.count} completed run{data.speed.count === 1 ? "" : "s"} measured</div>
                  </div>
                </section>

                {/* Spend & tokens condensed to one strip — needed to run the thing,
                    but it is not the argument for using it. */}
                <section style={panelStyle(4.6)}>
                  <h3 style={sectionHeading}>SPEND & TOKENS</h3>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "16px" }}>
                    {[
                      { l: "TOTAL SPEND", v: fmtUsd(data.cost.totalUsd) },
                      { l: "PER RUN", v: fmtUsd(data.cost.avgUsdPerRun) },
                      { l: "PER TICKET", v: fmtUsd(data.cost.costPerShippedTicket) },
                      { l: "IN / OUT", v: `${fmtTokens(data.cost.totalInputTokens)} / ${fmtTokens(data.cost.totalOutputTokens)}` },
                      { l: "CACHE HIT", v: fmtPct(data.efficiency.cacheHitRatio) },
                      { l: "AVG TURNS", v: data.ops.avgTurns.toFixed(1) },
                    ].map((t) => (
                      <div key={t.l}>
                        <div style={{ fontSize: FONT.xs, letterSpacing: ".13em", color: COLORS.faint, fontWeight: 600, marginBottom: "6px" }}>{t.l}</div>
                        <div style={{ fontFamily: "var(--font-mono), monospace", fontSize: FONT.lg, fontWeight: 700, color: COLORS.text }}>{t.v}</div>
                      </div>
                    ))}
                  </div>
                </section>

                <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "16px" }}>
                  <div style={panelStyle(3.6)}>
                    <h3 style={sectionHeading}>PROVIDER COVERAGE</h3>
                    <BarList rows={data.volume.byProvider} color={COLORS.indigo} />
                  </div>
                  <div style={panelStyle(4.4)}>
                    <h3 style={sectionHeading}>RUNS BY PROJECT</h3>
                    <BarList rows={data.volume.byProject} color={COLORS.info} />
                  </div>
                  <div style={panelStyle(5.0)}>
                    <h3 style={sectionHeading}>RUNS BY SKILL</h3>
                    <BarList rows={data.volume.bySkill} color={COLORS.accent} />
                  </div>
                </section>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
