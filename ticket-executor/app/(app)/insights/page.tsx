"use client";

import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { COLORS, FONT, card, chipShape, displayText, pill, sectionCaption, tabStyle, tintedCard } from "@/lib/ui";
import type { InsightsPayload, InsightsPeriod } from "@/lib/dagent/insights";
import type { FailureClass } from "@/lib/dagent/retryPolicy";
import type { Pace } from "@/lib/runMetrics";
import { dur, usd } from "@/lib/workflow/meta";
import { INSIGHTS_PREFIX, useInsights } from "../../queries";
import { useLiveInvalidate } from "../../useLive";
import LoadingRing from "../../ticket-executor/LoadingRing";
import { MONO } from "../../ticket-executor/workflow/parts";
import PageHeading from "../PageHeading";
import NotificationCenter from "../NotificationCenter";
import ProviderBadge from "../ProviderBadge";
import PageToolbar from "../PageToolbar";

// What D-Agent runs cost and where they stop, for one window: the last 14 days or the active plan's sprint.
// The numbers are folded by lib/runMetrics.ts; this page only lays them out. The period lives in the URL.

const PERIODS: [InsightsPeriod, string][] = [["14d", "Last 14 days"], ["sprint", "Current sprint"]];
const FLOW_LABEL = { implement: "Implement", review: "Fix review", qa: "Fix QA" } as const;
const CLASS_META: Record<FailureClass, { label: string; hint: string; color: string }> = {
  transient: { label: "Transient", hint: "Network, quota or restart — a retry usually passes.", color: COLORS.info },
  env: { label: "Environment", hint: "Repo, credential or tool is wrong — fix the setup before retrying.", color: COLORS.warning },
  agent: { label: "Agent", hint: "The work itself stopped — read why on the run.", color: COLORS.danger },
};
const NODE_GRID = "minmax(150px, 2fr) 70px 80px 90px 90px 90px 90px";
const NODE_COLUMNS = ["Node", "Visits", "Failed", "Runs ended", "Success", "Total cost", "Avg cost"];

const pct = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const dayOf = (t: number) => new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
      <div style={sectionCaption()}>{title}</div>
      {hint ? <div style={{ fontSize: FONT.sm, color: COLORS.textDim, lineHeight: 1.4 }}>{hint}</div> : null}
      {children}
    </section>
  );
}

function Tile({ label, value, sub, color }: { label: string; value: string; sub: string; color?: string }) {
  return (
    <div style={{ ...card({ padding: "9px 12px" }), display: "flex", flexDirection: "column", gap: "3px", minWidth: 0 }}>
      <div style={{ fontSize: FONT.sm, color: COLORS.textDim, fontWeight: 600 }}>{label}</div>
      <div style={{ ...displayText("stat", color), fontSize: "clamp(22px, 5vw, 30px)" }}>{value}</div>
      <div style={{ fontSize: FONT.sm, color: COLORS.textMuted }}>{sub}</div>
    </div>
  );
}

function paceAdvice(p: Pace): { tone: "success" | "warning" | "accent"; text: string } {
  const n = `${p.sample} delivered ticket${p.sample === 1 ? "" : "s"}`;
  if (p.verdict === "too-few")
    return { tone: "warning", text: `Only ${n} with points in this window — too few to re-pace the plan on. Keep the current pace and look again once at least 3 have reached a PR.` };
  if (p.verdict === "no-plan") return { tone: "accent", text: `No active plan to compare with. Build one on Flow Runner at about ${p.suggestedPointsPerDay} points/day.` };
  if (p.verdict === "faster")
    return { tone: "success", text: `The agent is delivering faster than planned. Rebuild the plan at ${p.suggestedPointsPerDay} points/day (Settings → Flow Runner) to pull more work forward.` };
  if (p.verdict === "slower")
    return { tone: "warning", text: `The agent is delivering slower than planned, so release days will slip. Rebuild the plan at ${p.suggestedPointsPerDay} points/day (Settings → Flow Runner), or look at why runs fail below.` };
  return { tone: "success", text: "Actual pace is within 15% of the plan. Leave it as it is." };
}

function PaceCard({ pace }: { pace: Pace }) {
  const advice = paceAdvice(pace);
  return (
    <div style={{ ...tintedCard(advice.tone, { padding: "9px 14px" }), display: "flex", flexDirection: "column", gap: "6px" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 24px" }}>
        {[
          ["Actual", pace.suggestedPointsPerDay == null ? "—" : String(pace.suggestedPointsPerDay)],
          ["Planned", pace.plannedPointsPerDay == null ? "—" : String(pace.plannedPointsPerDay)],
        ].map(([label, value]) => (
          <div key={label} style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
            <span style={{ fontSize: FONT.sm, color: COLORS.textDim, fontWeight: 600 }}>{label} points / day</span>
            <span style={{ ...displayText("stat"), fontSize: "clamp(22px, 5vw, 30px)" }}>{value}</span>
          </div>
        ))}
        <div style={{ display: "flex", flexDirection: "column", gap: "3px", justifyContent: "flex-end", fontSize: FONT.sm, color: COLORS.textMuted }}>
          <span>
            {pace.deliveredPoints} pts over {pace.workingDays} working day{pace.workingDays === 1 ? "" : "s"}
          </span>
          <span>
            Sample: {pace.sample} ticket{pace.sample === 1 ? "" : "s"}
            {pace.verdict === "too-few" ? " · too small to trust" : ""}
          </span>
        </div>
      </div>
      <div style={{ fontSize: FONT.base, color: COLORS.text, lineHeight: 1.4 }}>{advice.text}</div>
    </div>
  );
}

function NodeTable({ nodes }: { nodes: InsightsPayload["nodes"] }) {
  return (
    <div className="te-table-scroll" style={{ ...card({ padding: "0" }) }}>
      <div className="te-table-body">
        <div className="te-table-sticky-head" style={{ display: "grid", gridTemplateColumns: NODE_GRID, gap: "10px", padding: "10px 14px", borderBottom: `1px solid ${COLORS.borderSubtle}`, fontSize: FONT.xs, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: COLORS.faint }}>
          {NODE_COLUMNS.map((c) => (
            <span key={c}>{c}</span>
          ))}
        </div>
        {nodes.map((n) => (
          <div key={n.nodeId} style={{ display: "grid", gridTemplateColumns: NODE_GRID, gap: "10px", alignItems: "center", padding: "10px 14px", borderBottom: `1px solid ${COLORS.borderSubtle}`, fontSize: FONT.base, color: COLORS.textSoft }}>
            <span style={{ minWidth: 0, color: COLORS.text, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={n.nodeId}>
              {n.label}
            </span>
            <span>{n.visits}</span>
            <span style={{ color: n.failures ? COLORS.danger : undefined }} title={n.refusals ? `${n.refusals} sent back by a verdict` : undefined}>
              {n.failures}
              {n.refusals ? <span style={{ color: COLORS.textDim }}>{` +${n.refusals}↺`}</span> : null}
            </span>
            <span style={{ color: n.runsEndedHere ? COLORS.danger : undefined, fontWeight: n.runsEndedHere ? 700 : undefined }}>{n.runsEndedHere}</span>
            <span>{pct(n.successRate)}</span>
            <span>{usd(n.totalCostUsd)}</span>
            <span>{usd(n.avgCostUsd)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Insights() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const period: InsightsPeriod = params.get("period") === "sprint" ? "sprint" : "14d";
  const q = useInsights(period);
  useLiveInvalidate("/api/dagent/runs/stream", INSIGHTS_PREFIX, false);
  const d = q.data;

  const setPeriod = (p: InsightsPeriod) => router.replace(p === "14d" ? pathname : `${pathname}?period=${p}`, { scroll: false });

  return (
    <>
      <PageToolbar>
        <div role="group" aria-label="Period" style={{ display: "flex", gap: "6px" }}>
          {PERIODS.map(([p, label]) => (
            <button key={p} type="button" className="te-action-btn" aria-pressed={period === p} onClick={() => setPeriod(p)} style={{ ...tabStyle({ active: period === p }), marginBottom: 0 }}>
              {label}
            </button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        {d ? (
          <span style={{ fontSize: FONT.sm, color: COLORS.textDim }}>
            {d.period === "sprint" && d.sprint ? `${d.sprint} · ` : ""}
            {dayOf(d.from)} – {dayOf(d.to)}
          </span>
        ) : null}
        {q.isPlaceholderData ? <LoadingRing size={16} /> : null}
      </PageToolbar>

      <main className="te-scroll te-main" style={{ position: "relative", zIndex: 1, flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflowY: "auto", padding: "20px 28px", background: "var(--te-page-veil)" }}>
        {q.isPending ? (
          <div style={{ display: "flex", justifyContent: "center", padding: "60px 0" }}>
            <LoadingRing size={96} />
          </div>
        ) : q.error ? (
          <div style={{ ...tintedCard("danger"), fontSize: FONT.base }}>{q.error.message}</div>
        ) : d ? (
          <div className="te-sprint-page" style={{ width: "100%", flex: "1 1 0", minHeight: 0, display: "flex", flexDirection: "column", gap: "10px" }}>
            {period === "sprint" && d.period !== "sprint" ? (
              <div style={{ ...tintedCard("warning"), fontSize: FONT.base, flex: "0 0 auto" }}>No active plan with sprint dates — showing the last 14 days instead.</div>
            ) : null}

            <div style={{ flex: "0 0 auto", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "8px" }}>
              <Tile label="Runs" value={String(d.totals.runs)} sub={`${d.totals.finished} finished`} />
              <Tile label="Success rate" value={pct(d.totals.successRate)} sub="of finished runs" color={d.totals.successRate != null && d.totals.successRate < 0.6 ? COLORS.danger : undefined} />
              <Tile label="Total cost" value={usd(d.totals.costUsd)} sub={d.budgetUsd ? `Budget ${usd(d.budgetUsd)} / ticket` : "No ticket budget set"} />
              <Tile label="Cost / point" value={d.totals.costPerPoint == null ? "—" : usd(d.totals.costPerPoint)} sub="tickets with points" />
            </div>

            <div style={{ flex: "0 0 auto" }}>
              <Section title="Pace" hint="Points of tickets that reached a PR or were released, per working day, against the plan's points/day.">
                <PaceCard pace={d.pace} />
              </Section>
            </div>

            <div style={{ flex: "0 0 auto" }}>
              <Section title="By flow">
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "8px" }}>
                  {d.flows.map((f) => (
                    <div key={f.flow} style={{ ...card({ padding: "8px 12px" }), display: "flex", flexDirection: "column", gap: "5px" }}>
                      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "8px" }}>
                        <span style={{ ...displayText("heading"), fontSize: "clamp(16px, 3.5vw, 19px)" }}>{FLOW_LABEL[f.flow]}</span>
                        <span style={{ fontSize: FONT.sm, color: COLORS.textDim }}>{f.runs} runs</span>
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
                        {(
                          [
                            ["succeeded", f.succeeded, COLORS.success],
                            ["for review", f.endedForReview, COLORS.info],
                            ["failed", f.failed, COLORS.danger],
                            ["cancelled", f.cancelled, COLORS.textDim],
                            ["waiting PO", f.waitingForPo, COLORS.warning],
                            ["running", f.running, COLORS.accent],
                          ] as const
                        )
                          .filter(([, n]) => n)
                          .map(([label, n, color]) => (
                            <span key={label} style={pill({ color, border: COLORS.border, size: "xs" })}>
                              {n} {label}
                            </span>
                          ))}
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 16px", fontSize: FONT.sm, color: COLORS.textMuted }}>
                        <span>Avg {usd(f.avgCostUsd)}</span>
                        <span>Avg {f.avgDurationSec == null ? "—" : dur(f.avgDurationSec)}</span>
                        {f.avgFixRounds != null ? <span>{f.avgFixRounds} fix rounds / run</span> : null}
                      </div>
                    </div>
                  ))}
                </div>
              </Section>
            </div>

            <div
              className="te-sprint-split"
              style={{ flex: "1 1 0", minHeight: 0, display: "grid", gridTemplateColumns: "minmax(0, 1.3fr) minmax(0, 1fr)", gridTemplateRows: "minmax(0, 1fr)", gap: "12px" }}
            >
              <div className="te-scroll-hidden te-sprint-pane" style={{ gridColumn: 1, gridRow: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: "8px" }}>
                <Section title="Where runs fail" hint="Per node. “Runs ended” counts failed runs that stopped there; ↺ are verdicts that sent the run back. Sorted by runs ended.">
                  {d.nodes.length ? <NodeTable nodes={d.nodes} /> : <div style={{ ...card(), fontSize: FONT.base, color: COLORS.textMuted }}>No run in this window.</div>}
                </Section>
              </div>

              <div className="te-scroll te-sprint-pane" style={{ gridColumn: 2, gridRow: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: "16px", paddingRight: "4px" }}>
                <Section title="Failure reasons">
                  <div className="te-grid-2" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 2fr)", gap: "12px" }}>
                    <div style={{ ...card({ padding: "12px 14px" }), display: "flex", flexDirection: "column", gap: "10px" }}>
                      {(Object.keys(CLASS_META) as FailureClass[]).map((c) => (
                        <div key={c} style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
                          <span style={{ ...displayText("heading", d.failures.classes[c] ? CLASS_META[c].color : COLORS.faint), minWidth: "34px" }}>{d.failures.classes[c]}</span>
                          <span style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                            <span style={{ fontSize: FONT.base, color: COLORS.text, fontWeight: 600 }}>{CLASS_META[c].label}</span>
                            <span style={{ fontSize: FONT.sm, color: COLORS.textDim }}>{CLASS_META[c].hint}</span>
                          </span>
                        </div>
                      ))}
                    </div>
                    <div style={{ ...card({ padding: "6px 14px" }), display: "flex", flexDirection: "column" }}>
                      {d.failures.top.length ? (
                        d.failures.top.map((r) => (
                          <div key={r.reason} style={{ display: "flex", gap: "10px", alignItems: "baseline", padding: "8px 0", borderBottom: `1px solid ${COLORS.borderSubtle}` }}>
                            <span style={{ fontWeight: 700, color: COLORS.text, minWidth: "28px" }}>×{r.count}</span>
                            <span style={{ flex: 1, minWidth: 0, fontSize: FONT.sm, color: COLORS.textSoft, overflowWrap: "anywhere" }}>{r.reason}</span>
                            <span style={pill({ color: CLASS_META[r.cls].color, border: COLORS.border, size: "xs" })}>{CLASS_META[r.cls].label}</span>
                          </div>
                        ))
                      ) : (
                        <div style={{ padding: "8px 0", fontSize: FONT.base, color: COLORS.textMuted }}>No failed run in this window.</div>
                      )}
                    </div>
                  </div>
                </Section>

                <Section
                  title="Over budget"
                  hint={d.budgetUsd ? `Tickets whose runs in this window cost ${usd(d.budgetUsd)} or more. A warning only — no run is stopped.` : "Set a per-ticket budget in Settings → Flow Runner to flag expensive tickets."}
                >
                  {d.budgetUsd ? (
                    d.overBudget.length ? (
                      <div style={{ ...card({ padding: "4px 0" }), display: "flex", flexDirection: "column" }}>
                        {d.overBudget.map((t) => (
                          <Link
                            key={t.ticketId}
                            href={`/workflow?ticket=${encodeURIComponent(t.ticketId)}`}
                            className="te-run-row"
                            style={{ display: "flex", alignItems: "center", gap: "10px", minHeight: "44px", padding: "6px 14px", borderBottom: `1px solid ${COLORS.borderSubtle}`, textDecoration: "none", color: COLORS.textSoft, fontSize: FONT.base }}
                          >
                            <span style={{ ...chipShape(6), flex: "0 0 auto", padding: "3px 7px", fontSize: FONT.xs, fontFamily: MONO, background: "var(--te-indigo-soft)", color: COLORS.indigo }}>{t.ticketId}</span>
                            <span className="te-run-title" style={{ flex: 1, minWidth: 0, color: COLORS.text, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {t.title || "Untitled ticket"}
                            </span>
                            <span style={{ color: COLORS.textDim, fontSize: FONT.sm, whiteSpace: "nowrap" }}>{t.runs} runs</span>
                            <span style={{ color: COLORS.danger, fontWeight: 700, whiteSpace: "nowrap" }}>{usd(t.costUsd)}</span>
                          </Link>
                        ))}
                      </div>
                    ) : (
                      <div style={{ ...card(), fontSize: FONT.base, color: COLORS.textMuted }}>No ticket reached the budget in this window.</div>
                    )
                  ) : null}
                </Section>
              </div>
            </div>
          </div>
        ) : null}
      </main>
    </>
  );
}

// The header sits outside the Suspense boundary the search params need, so it hydrates with the page.
export default function InsightsPage() {
  return (
    <div style={{ position: "relative", height: "var(--te-app-h)", overflow: "hidden", display: "flex", flexDirection: "column", color: COLORS.text }}>
      <header className="te-page-header" style={{ position: "relative", zIndex: 30, height: "60px", flex: "0 0 auto", display: "flex", alignItems: "center", gap: "14px", padding: "0 28px", borderBottom: "1px solid rgba(255,255,255,.06)", background: "var(--te-header-bg)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)" }}>
        <PageHeading title="Insights" kicker="D-AGENT · COST & PACE" icon={<path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />} />
        <div style={{ flex: 1 }} />
        <NotificationCenter />
        <ProviderBadge />
      </header>
      <Suspense>
        <Insights />
      </Suspense>
    </div>
  );
}
