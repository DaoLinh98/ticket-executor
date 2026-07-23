"use client";

import { useCallback, useEffect, useState } from "react";
import type { CSSProperties } from "react";
import Link from "next/link";
import SelectMenu from "../SelectMenu";
import Reactor from "../Reactor";
import LoadingRing from "../ticket-executor/LoadingRing";
import type { CountEntry, DashboardMetrics } from "@/lib/executionStore";
import { COLORS, logoText, pill, ringBorder, tintedCard } from "@/lib/ui";
import { useBoltsContext } from "../BoltsContext";

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

const sectionHeading: CSSProperties = {
  margin: "0 0 14px", fontFamily: "var(--font-space), sans-serif", fontSize: "11px",
  fontWeight: 700, letterSpacing: ".16em", color: COLORS.faint,
};

function KpiTile({ label, value, sub, tone, index = 0 }: { label: string; value: string; sub?: string; tone?: string; index?: number }) {
  return (
    <div
      style={{
        padding: "16px 18px", borderRadius: "13px", display: "flex", flexDirection: "column", gap: "8px",
        transition: "transform .22s cubic-bezier(.2,.8,.2,1), box-shadow .22s",
        animation: "fadeUp .45s both", animationDelay: `${index * 55}ms`,
        ...ringBorder({ fill: COLORS.panelBg, duration: 4.2 + index * 0.3, shape: "none" }),
      }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 14px 34px -20px var(--accent)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = "none"; }}
    >
      <div style={{ fontSize: "10.5px", letterSpacing: ".13em", color: COLORS.faint, fontWeight: 600 }}>{label}</div>
      <div style={{ fontFamily: "var(--font-space), sans-serif", fontSize: "26px", fontWeight: 700, color: tone ?? COLORS.text, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: "11.5px", color: COLORS.textDim }}>{sub}</div>}
    </div>
  );
}

// Horizontal bars for a categorical breakdown (by provider / project / skill).
function BarList({ rows, color }: { rows: CountEntry[]; color: string }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  if (!rows.length) return <div style={{ fontSize: "12.5px", color: COLORS.faint }}>No runs yet.</div>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "9px" }}>
      {rows.map((r) => (
        <div key={r.key} style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{ width: "34%", minWidth: 0, fontFamily: "var(--font-mono), monospace", fontSize: "12px", color: "#C7CCD8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.key}>{r.key}</div>
          <div style={{ flex: 1, height: "9px", borderRadius: "999px", background: "rgba(255,255,255,.04)", overflow: "hidden" }}>
            <div style={{ width: `${(r.count / max) * 100}%`, height: "100%", borderRadius: "999px", background: color, transformOrigin: "left", animation: "growX .5s cubic-bezier(.16,1,.3,1) both" }} />
          </div>
          <div style={{ width: "38px", textAlign: "right", fontFamily: "var(--font-mono), monospace", fontSize: "12px", fontWeight: 600, color: COLORS.text }}>{r.count}</div>
        </div>
      ))}
    </div>
  );
}

// Cost-over-time line + area chart (inline SVG, no dependency).
function CostTrend({ trend }: { trend: DashboardMetrics["cost"]["trend"] }) {
  if (!trend.length) return <div style={{ fontSize: "12.5px", color: COLORS.faint }}>No cost data yet.</div>;
  const W = 640, H = 160, PAD = 8;
  const max = Math.max(...trend.map((t) => t.costUsd), 0.0001);
  const n = trend.length;
  const x = (i: number) => (n === 1 ? W / 2 : PAD + (i * (W - 2 * PAD)) / (n - 1));
  const y = (v: number) => H - PAD - (v / max) * (H - 2 * PAD);
  const pts = trend.map((t, i) => `${x(i)},${y(t.costUsd)}`).join(" ");
  const area = `${PAD},${H - PAD} ${pts} ${x(n - 1)},${H - PAD}`;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="160" preserveAspectRatio="none" style={{ display: "block" }}>
        <defs>
          <linearGradient id="costFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={COLORS.accent} stopOpacity="0.28" />
            <stop offset="100%" stopColor={COLORS.accent} stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={area} fill="url(#costFill)" />
        <polyline points={pts} fill="none" stroke={COLORS.accent} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {trend.map((t, i) => (
          <circle key={t.date} cx={x(i)} cy={y(t.costUsd)} r="2.6" fill={COLORS.accent} />
        ))}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: "6px", fontSize: "10.5px", color: COLORS.faint, fontFamily: "var(--font-mono), monospace" }}>
        <span>{trend[0].date}</span>
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
        {!segs.length && <span style={{ fontSize: "12.5px", color: COLORS.faint }}>No runs yet.</span>}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { fireBoltFromEvent } = useBoltsContext();
  const [data, setData] = useState<DashboardMetrics | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [provider, setProvider] = useState("");
  const [project, setProject] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (provider) qs.set("provider", provider);
      if (project) qs.set("project", project);
      const res = await fetch(`/api/dashboard?${qs.toString()}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load metrics");
      setData(json as DashboardMetrics);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [provider, project]);

  useEffect(() => {
    void load();
  }, [load]);

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

  return (
    <div style={{ position: "relative", minHeight: "100vh", background: "transparent", color: COLORS.text, display: "flex", flexDirection: "column", ["--accent" as string]: COLORS.accent }}>
      <Reactor accent={COLORS.accent} />
      <header style={{ position: "relative", zIndex: 1, height: "60px", flex: "0 0 auto", display: "flex", alignItems: "center", gap: "16px", padding: "0 22px", borderBottom: "1px solid rgba(255,255,255,.06)", background: "rgba(14,17,23,.72)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{ width: "34px", height: "34px", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 8px 22px -8px var(--accent)", ...ringBorder({ fill: "var(--accent)", variant: "filled", duration: 3.4 }) }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" stroke="#0B0C10" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </div>
          <div style={{ display: "flex", flexDirection: "column", lineHeight: 1 }}>
            <span style={logoText("16px")}>Run Metrics</span>
            <span style={{ fontSize: "10px", letterSpacing: ".16em", fontWeight: 600, marginTop: "4px", background: "linear-gradient(90deg,#5B6273 0%,#5B6273 30%,#FFD9BE 45%,var(--accent) 52%,#5B6273 65%,#5B6273 100%)", backgroundSize: "220% 100%", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent", animation: "subtitleFlow 3.2s linear infinite" }}>D-AGENT · ANALYTICS</span>
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ width: "200px" }}>
          <SelectMenu variant="filter" alwaysGlow value={provider} onChange={setProvider} options={data?.filters.providers ?? []} allLabel="Provider: All" ariaLabel="Filter by provider" />
        </div>
        <div style={{ width: "220px" }}>
          <SelectMenu variant="filter" alwaysGlow value={project} onChange={setProject} options={data?.filters.projects ?? []} allLabel="Project: All" ariaLabel="Filter by project" />
        </div>
        <Link href="/" onClick={(e) => fireBoltFromEvent(e)} style={{ display: "flex", alignItems: "center", gap: "7px", height: "30px", padding: "0 13px", color: "#C7CCD8", fontSize: "12px", fontWeight: 600, textDecoration: "none", ...ringBorder({ fill: "#14171D", duration: 3.4, cornerPx: 7 }) }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
          Back
        </Link>
      </header>

      <main className="te-scroll" style={{ position: "relative", zIndex: 1, flex: 1, overflowY: "auto", padding: "26px 28px 48px", background: "linear-gradient(110deg,rgba(6,7,10,.5) 0%,rgba(6,7,10,.22) 52%,rgba(6,7,10,0) 100%)" }}>
        <div style={{ maxWidth: "1100px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "26px" }}>
          {error && (
            <div style={{ ...tintedCard("danger"), animation: "fadeUp .4s both" }}>
              <div style={{ fontSize: "13px", color: COLORS.danger, fontWeight: 600 }}>{error}</div>
            </div>
          )}
          {loading && !data && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "20px", minHeight: "calc(100vh - 220px)" }}>
              <LoadingRing size={100} />
            </div>
          )}

          {data && (
            <>
              {/* KPI tiles */}
              <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "12px", ...sectionDelay(0) }}>
                <KpiTile index={0} label="TOTAL RUNS" value={`${data.volume.total}`} sub={`${data.reliability.running} running · ${data.reliability.awaitingApproval} awaiting`} />
                <KpiTile index={1} label="SUCCESS RATE" value={fmtPct(data.reliability.successRate)} tone={COLORS.success} sub={`${data.reliability.completed} ok · ${data.reliability.failed} failed`} />
                <KpiTile index={2} label="AVG DURATION" value={data.speed.count ? fmtMs(data.speed.avgMs) : "—"} sub={data.speed.count ? `p50 ${fmtMs(data.speed.p50Ms)} · p95 ${fmtMs(data.speed.p95Ms)}` : "no completed runs"} />
                <KpiTile index={3} label="TOTAL SPEND" value={fmtUsd(data.cost.totalUsd)} tone={COLORS.accent} sub={`${data.cost.withUsageCount} runs w/ usage`} />
                <KpiTile index={4} label="AVG COST / RUN" value={fmtUsd(data.cost.avgUsdPerRun)} sub={`${fmtTokens(data.cost.avgTokensPerRun)} tokens/run`} />
                <KpiTile index={5} label="CACHE HIT RATIO" value={fmtPct(data.efficiency.cacheHitRatio)} tone={COLORS.info} sub={`${fmtTokens(data.efficiency.cacheReadTokens)} cached reads`} />
              </section>

              {/* Reliability + Speed */}
              <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", ...sectionDelay(1) }}>
                <div style={panelStyle(3.8)}>
                  <h3 style={sectionHeading}>RELIABILITY</h3>
                  <StatusBar r={data.reliability} />
                </div>
                <div style={panelStyle(4.2)}>
                  <h3 style={sectionHeading}>SPEED (COMPLETED RUNS)</h3>
                  <div style={{ display: "flex", gap: "24px" }}>
                    {[
                      { l: "AVG", v: data.speed.avgMs },
                      { l: "P50", v: data.speed.p50Ms },
                      { l: "P95", v: data.speed.p95Ms },
                    ].map((s) => (
                      <div key={s.l}>
                        <div style={{ fontSize: "10.5px", letterSpacing: ".13em", color: COLORS.faint, fontWeight: 600, marginBottom: "6px" }}>{s.l}</div>
                        <div style={{ fontFamily: "var(--font-space), sans-serif", fontSize: "20px", fontWeight: 700, color: COLORS.text }}>{data.speed.count ? fmtMs(s.v) : "—"}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize: "11.5px", color: COLORS.textDim, marginTop: "14px" }}>{data.speed.count} completed run{data.speed.count === 1 ? "" : "s"} measured</div>
                </div>
              </section>

              {/* Cost trend — the hero chart, same scanline + top-accent-line + spinning ring
                  treatment as the live-log panel in ExecutionTab. */}
              <section style={heroPanelStyle(2)}>
                <div style={scanlineOverlay} />
                <div style={topAccentLine} />
                <div style={{ position: "relative", zIndex: 1 }}>
                  <h3 style={sectionHeading}>COST OVER TIME (USD / DAY)</h3>
                  <CostTrend trend={data.cost.trend} />
                </div>
              </section>

              {/* Token breakdown */}
              <section style={panelStyle(4.6, 3)}>
                <h3 style={sectionHeading}>TOKEN USAGE</h3>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "16px" }}>
                  {[
                    { l: "INPUT", v: data.cost.totalInputTokens },
                    { l: "OUTPUT", v: data.cost.totalOutputTokens },
                    { l: "CACHE READ", v: data.efficiency.cacheReadTokens },
                    { l: "TOTAL (IN+OUT)", v: data.cost.totalTokens },
                  ].map((t) => (
                    <div key={t.l}>
                      <div style={{ fontSize: "10.5px", letterSpacing: ".13em", color: COLORS.faint, fontWeight: 600, marginBottom: "6px" }}>{t.l}</div>
                      <div style={{ fontFamily: "var(--font-mono), monospace", fontSize: "18px", fontWeight: 700, color: COLORS.text }}>{fmtTokens(t.v)}</div>
                    </div>
                  ))}
                </div>
              </section>

              {/* Volume breakdowns */}
              <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "16px", ...sectionDelay(4) }}>
                <div style={panelStyle(3.6)}>
                  <h3 style={sectionHeading}>RUNS BY PROVIDER</h3>
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
            </>
          )}
        </div>
      </main>
    </div>
  );
}
