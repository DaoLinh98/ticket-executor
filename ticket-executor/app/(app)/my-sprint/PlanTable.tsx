"use client";

import { useState } from "react";
import LoadingRing from "../../ticket-executor/LoadingRing";
import { COLORS, FONT, card, fieldInput, pill, sectionCaption, statusPill } from "@/lib/ui";
import { isFixingQa, MAX_QA_ROUNDS, QA_STAGES, stageOf } from "@/lib/ticketLifecycle";
import type { QueueMove } from "@/lib/sprintPlan";
import type { TriagedTicket } from "@/lib/execution/triage";
import { CLAUDE_MODELS, DEFAULT_PLAN_EFFORT, DEFAULT_PLAN_MODEL, modelLabel, resolveModelId } from "@/lib/claudeOptions";
import { useClaudeModels } from "../../queries";
import { IconAction } from "./actionIcons";
import {
  CLAIM,
  READINESS,
  dayLabel,
  originLabel,
  usd,
  stateOf,
  type MySprint,
  type PlannedRow,
  type QaDraft,
} from "./model";

const GRID = "84px 1fr 60px 132px 132px 104px 176px";
const HEADERS = ["QUEUE", "TICKET", "PTS", "TRACKER", "RELEASE", "RUN", "ACTIONS"];
const LABELS = ["Queue", "", "Pts", "Tracker", "Release", "Run", ""];

export type PlanHandlers = {
  openExecution: (ticketId: string, tab: "execution" | "result") => void;
  setUnblocked: (plannedId: string, unblocked: boolean) => void;
  resolveReview: (plannedId: string, ticketId: string) => void;
  retry: (plannedId: string) => void;
  release: (row: PlannedRow) => void;
  draftReply: (plannedId: string) => void;
  startQaFix: (plannedId: string, ticketId: string) => void;
  moveToQa: (plannedId: string) => void;
  remove: (plannedId: string, ticketId: string) => void;
  move: (plannedId: string, move: QueueMove) => void;
  setReleaseDay: (plannedId: string, day: string) => void;
  hold: (plannedId: string) => void;
  history: (ticketId: string) => void;
  runOptions: (row: PlannedRow) => void;
};

const isMovable = (t: PlannedRow) =>
  !!t.id && t.implementState === "pending" && t.implementOrder > 0 && t.claim === "mine" && !t.runId && !t.prUrl && !t.releasedAt;

function ArrowButton({ label, direction, disabled, onClick }: { label: string; direction: "up" | "down"; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className="te-icon-btn"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      style={{ width: "24px", height: "24px", display: "inline-flex", alignItems: "center", justifyContent: "center", border: "none", background: "transparent", color: disabled ? COLORS.faint : COLORS.accent, cursor: disabled ? "default" : "pointer", padding: 0 }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
        <path d={direction === "up" ? "M6 15l6-6 6 6" : "M6 9l6 6 6-6"} />
      </svg>
    </button>
  );
}

export default function PlanTable({
  rows,
  data,
  drafts,
  triaged,
  busy,
  releaseDayOptions,
  costs,
  reorderable,
  selected,
  onSelect,
  handlers: h,
}: {
  rows: PlannedRow[];
  data: MySprint | null;
  drafts: QaDraft[];
  triaged: Map<string, TriagedTicket>;
  busy: ReadonlySet<string>;
  releaseDayOptions: string[];
  costs: Record<string, number>;
  reorderable: boolean;
  selected: ReadonlySet<string>;
  onSelect: (plannedId: string, on: boolean) => void;
  handlers: PlanHandlers;
}) {
  const modelOptions = useClaudeModels().data?.models ?? CLAUDE_MODELS;
  // Drag a queued row onto another queued row to take its place; the arrows stay for touch screens.
  const [dragId, setDragId] = useState("");
  const [overId, setOverId] = useState("");
  const movable = rows.filter(isMovable).sort((a, b) => a.implementOrder - b.implementOrder);
  const firstMovable = movable[0]?.id;
  const lastMovable = movable[movable.length - 1]?.id;
  const knownUrls = [...(data?.tickets ?? []), ...(data?.claimed?.map((c) => c.ticket) ?? [])].map((x) => x.url);
  const adoBase = knownUrls.map((u) => /^https:\/\/dev\.azure\.com\/[^/]+/.exec(u ?? "")?.[0]).find(Boolean);
  const ticketHref = (t: PlannedRow, url?: string) =>
    url || (adoBase && t.project ? `${adoBase}/${encodeURIComponent(t.project)}/_workitems/edit/${t.ticketId}` : undefined);

  return (
    <div className="te-table-scroll te-scroll" style={{ ...card({ padding: "0" }), flex: "1 1 auto", minWidth: 0, minHeight: 0, overflowY: "auto", overflowX: "hidden" }}>
      <div className="te-table-body te-plan-table">
        <div className="te-plan-head" style={{ position: "sticky", top: 0, zIndex: 2, background: COLORS.panelBg, display: "grid", gridTemplateColumns: GRID, gap: "10px", padding: "10px 14px", borderBottom: "1px solid " + COLORS.borderSubtle }}>
          {HEADERS.map((hd) => (
            <span key={hd} style={{ ...sectionCaption(), ...(hd === "ACTIONS" ? { textAlign: "right" as const } : null) }}>{hd}</span>
          ))}
        </div>
        {rows.length === 0 ? (
          <div style={{ padding: "18px 14px", fontSize: FONT.base, color: COLORS.textMuted }}>
            Nothing is assigned to you in any project for this sprint window.
          </div>
        ) : (
          rows.map((t, i) => {
            const claimed = data?.claimed?.find((c) => c.ticket.id === t.ticketId);
            const ticket = claimed?.ticket;
            const claim = t.claim ?? claimed?.claim ?? "mine";
            const assigneeNow = t.assigneeNow || claimed?.assigneeNow || "";
            const tri = triaged.get(t.ticketId);
            const origin = originLabel(ticket?.iterationPath, data?.sprint ?? "");
            const state = stateOf(t, ticket?.status ?? "");
            const due = !!t.prUrl && t.implementState === "implemented" && !t.releasedAt;
            const canOverride = t.blocked && claim === "mine" && t.implementState === "pending";
            const replyWaiting = drafts.some((d) => d.plannedTicketId === t.id && d.status !== "failed");
            const canMove = reorderable && isMovable(t);
            const held = t.implementState === "skipped" && claim === "mine" && !t.prUrl;
            const cost = costs[t.ticketId] ?? 0;
            const redatable = !!t.id && !t.releasedAt && claim === "mine" && t.implementOrder > 0;
            const days = t.releaseDay && !releaseDayOptions.includes(t.releaseDay) ? [t.releaseDay, ...releaseDayOptions] : releaseDayOptions;
            const stage = stageOf(t.stage || ticket?.status || "");
            const cells = [
              <span key="order" style={{ display: "flex", alignItems: "center", gap: "2px" }}>
                {t.id && (
                  <input
                    type="checkbox"
                    aria-label={`Select #${t.ticketId}`}
                    checked={selected.has(t.id)}
                    onChange={(e) => onSelect(t.id, e.target.checked)}
                    style={{ width: "16px", height: "16px", margin: "0 6px 0 0", accentColor: COLORS.accent, cursor: "pointer", flex: "0 0 auto" }}
                  />
                )}
                <span style={{ fontSize: FONT.sm, fontWeight: 700, minWidth: "20px", color: t.implementOrder ? COLORS.accent : COLORS.faint }}>
                  {t.implementOrder || "—"}
                </span>
                {canMove && (
                  <>
                    <ArrowButton label={`Move #${t.ticketId} up the queue`} direction="up" disabled={t.id === firstMovable || busy.has("move-" + t.id)} onClick={() => h.move(t.id, "up")} />
                    <ArrowButton label={`Move #${t.ticketId} down the queue`} direction="down" disabled={t.id === lastMovable || busy.has("move-" + t.id)} onClick={() => h.move(t.id, "down")} />
                  </>
                )}
              </span>,
              null,
              <span key="pts" style={{ fontSize: FONT.base, fontWeight: 700, color: t.points ? COLORS.text : COLORS.faint }}>
                {t.points || "—"}
                {tri && tri.suggestedPoints > tri.currentPoints && (
                  <span style={{ fontSize: FONT.sm, color: COLORS.warning }}> ↑</span>
                )}
              </span>,
              <span key="status" style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                {claim !== "mine" ? (
                  <span style={pill({ color: CLAIM[claim].color, size: "xs", weight: 700 })}>{CLAIM[claim].label}</span>
                ) : tri ? (
                  <span title={READINESS[tri.readiness]?.means ?? ""} style={pill({ color: READINESS[tri.readiness]?.color ?? COLORS.textDim, size: "xs", weight: 700 })}>
                    {READINESS[tri.readiness]?.label ?? tri.readiness}
                  </span>
                ) : (
                  ticket?.status ? (
                  <span style={statusPill(ticket.status)}>{ticket.status}</span>
                ) : (
                  <span style={{ fontSize: FONT.base, color: COLORS.faint }}>—</span>
                )
                )}
              </span>,
              redatable ? (
                <select
                  key="release"
                  aria-label={`Release day for #${t.ticketId}`}
                  value={t.releaseDay}
                  disabled={busy.has("redate-" + t.id)}
                  onChange={(e) => h.setReleaseDay(t.id, e.target.value)}
                  style={{ ...fieldInput({ height: "32px", fontSize: FONT.sm }), width: "100%", padding: "0 6px", color: t.releaseDay === data?.today ? COLORS.accent : COLORS.textMuted, fontWeight: 600 }}
                >
                  {!t.releaseDay && <option value="">—</option>}
                  {days.map((d) => <option key={d} value={d}>{dayLabel(d)}</option>)}
                </select>
              ) : (
                <span key="release" style={{ fontSize: FONT.base, fontWeight: 600, color: t.releasedAt ? COLORS.success : t.releaseDay === data?.today ? COLORS.accent : COLORS.textMuted }}>
                  {dayLabel(t.releasedAt ? t.releasedAt.slice(0, 10) : t.releaseDay)}
                </span>
              ),
              <span key="state" style={{ display: "flex", alignItems: "center", gap: "7px", minWidth: 0 }}>
                {t.implementState === "running" && <LoadingRing size={13} />}
                <span style={pill({ color: state.color, size: "xs", weight: 700 })}>{state.label}</span>
              </span>,
            ];

            return (
              <div
                key={t.ticketId}
                className="te-plan-row"
                draggable={canMove}
                onDragStart={canMove ? (e) => { e.dataTransfer.effectAllowed = "move"; setDragId(t.id); } : undefined}
                onDragEnd={() => { setDragId(""); setOverId(""); }}
                onDragOver={canMove && dragId && dragId !== t.id ? (e) => { e.preventDefault(); setOverId(t.id); } : undefined}
                onDragLeave={() => setOverId((o) => (o === t.id ? "" : o))}
                onDrop={canMove && dragId && dragId !== t.id ? (e) => { e.preventDefault(); h.move(dragId, { to: t.id }); setDragId(""); setOverId(""); } : undefined}
                style={{
                  cursor: canMove ? "grab" : undefined,
                  boxShadow: overId === t.id ? `inset 0 2px 0 ${COLORS.accent}` : undefined,
                  display: "grid", gridTemplateColumns: GRID, gap: "10px",
                  padding: "11px 14px", alignItems: "center",
                  borderTop: i === 0 ? "none" : "1px solid " + COLORS.borderSubtle,
                  opacity: claim === "dropped" ? 0.55 : 1,
                  animation: "fadeUp .4s both", animationDelay: i * 30 + "ms",
                }}
              >
                {cells.map((cell, ci) =>
                  ci === 1 ? (
                    <span key="ticket" className="te-plan-ticket" style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: "3px" }}>
                      <span style={{ display: "flex", alignItems: "center", gap: "4px", minWidth: 0 }}>
                      <a
                        href={ticketHref(t, ticket?.url)}
                        target="_blank"
                        rel="noreferrer"
                        title={`#${t.ticketId} · ${t.title}`}
                        style={{ fontSize: FONT.base, color: COLORS.text, fontWeight: 600, textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                      >
                        #{t.ticketId} · {t.title}
                      </a>
                      <button
                        type="button"
                        className="te-icon-btn"
                        aria-label={`History of #${t.ticketId}`}
                        title="History"
                        onClick={() => h.history(t.ticketId)}
                        style={{ flex: "0 0 auto", width: "24px", height: "24px", display: "inline-flex", alignItems: "center", justifyContent: "center", border: "none", background: "transparent", color: COLORS.textDim, cursor: "pointer", padding: 0 }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
                      </button>
                      {t.id && claim === "mine" && (
                        (t.implementState === "pending" && t.implementOrder > 0 && !t.runId && !t.prUrl && !t.releasedAt) ||
                        (t.prPublished && !t.prMerged && t.reviewState !== "running")
                      ) && (
                        <button
                          type="button"
                          className="te-icon-btn"
                          aria-label={`Model and effort for #${t.ticketId}`}
                          title={`${modelLabel(resolveModelId(t.model || DEFAULT_PLAN_MODEL, modelOptions), modelOptions)} · ${t.effort || DEFAULT_PLAN_EFFORT}`}
                          onClick={() => h.runOptions(t)}
                          style={{ flex: "0 0 auto", width: "24px", height: "24px", display: "inline-flex", alignItems: "center", justifyContent: "center", border: "none", background: "transparent", color: COLORS.textDim, cursor: "pointer", padding: 0 }}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
                        </button>
                      )}
                      </span>
                      {(t.project || ticket?.project || origin || cost > 0) && (
                        <span style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                          {(t.project || ticket?.project) && (
                            <span style={pill({ color: COLORS.info, size: "xs", weight: 700 })}>{t.project || ticket?.project}</span>
                          )}
                          {origin && <span style={pill({ color: COLORS.indigo, size: "xs", weight: 700 })}>{origin}</span>}
                          {cost > 0 && <span title="Spent on all runs for this ticket" style={pill({ color: COLORS.textMuted, size: "xs", weight: 700 })}>{usd(cost)} all runs</span>}
                        </span>
                      )}
                      {tri?.reason && (
                        <span style={{ fontSize: FONT.sm, color: COLORS.textDim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {tri.reason}
                        </span>
                      )}
                      {claim !== "mine" && (
                        <span style={{ fontSize: FONT.sm, color: COLORS.textDim }}>
                          {claim === "handed-off"
                            ? assigneeNow
                              ? "handed off — now with " + assigneeNow
                              : "handed off — no longer in your sprint"
                            : assigneeNow
                              ? "reassigned to " + assigneeNow + " before you started it"
                              : "left your sprint before you started it"}
                        </span>
                      )}
                      {t.releaseError && <span style={{ fontSize: FONT.sm, color: COLORS.danger }}>{t.releaseError}</span>}
                      {t.reviewError && <span style={{ fontSize: FONT.sm, color: COLORS.danger }}>Review fix: {t.reviewError}</span>}
                      {t.pendingAction === "move-to-qa" && (
                        <span style={{ fontSize: FONT.sm, color: COLORS.accent }}>Pull request merged — confirm to move this ticket to In QA.</span>
                      )}
                      {t.pendingAction === "fix-qa" && (
                        <span style={{ fontSize: FONT.sm, color: isFixingQa(t) ? COLORS.accent : COLORS.danger }}>
                          {isFixingQa(t)
                            ? t.implementState === "running"
                              ? `QA fix round ${t.qaRounds} in progress.`
                              : "QA fix is in a draft pull request — release it when you have looked at it."
                            : t.qaRounds >= MAX_QA_ROUNDS
                              ? `${t.qaRounds} QA fixes did not close this ticket — it needs you.`
                              : t.implementState === "no-fix-needed" && replyWaiting
                                ? "QC's findings were reviewed and none is a defect — post the drafted reply, or dismiss it to fix anyway."
                                : "Came back from QA — start the QA fix to review QC's findings and fix the real defects."}
                        </span>
                      )}
                      {t.reviewState === "needs-human" && (
                        <span style={{ fontSize: FONT.sm, color: COLORS.warning }}>
                          {t.reviewRounds} rounds of automatic fixes did not close this review — the rest needs a decision.
                        </span>
                      )}
                    </span>
                  ) : (
                    <span key={HEADERS[ci]} className="te-plan-cell" data-label={LABELS[ci]} style={{ minWidth: 0, display: "flex", alignItems: "center" }}>
                      {cell}
                    </span>
                  )
                )}
                <span className="te-plan-actions" style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "7px", flexWrap: "nowrap" }}>
                  {canOverride &&
                    (t.unblockedByUser ? (
                      <IconAction action="overridden" onClick={() => h.setUnblocked(t.id, false)} busy={busy.has("unblock-" + t.id)} />
                    ) : (
                      <IconAction action="forceReady" onClick={() => h.setUnblocked(t.id, true)} busy={busy.has("unblock-" + t.id)} />
                    ))}
                  {t.implementState === "running" || t.reviewState === "running" ? (
                    <IconAction action="watch" onClick={() => h.openExecution(t.ticketId, "execution")} />
                  ) : t.runId || t.reviewRunId ? (
                    <IconAction action="result" onClick={() => h.openExecution(t.ticketId, "result")} />
                  ) : null}
                  {t.id && t.prPublished && !t.prMerged && t.openComments > 0 && t.reviewState !== "running" && claim === "mine" &&
                    (t.reviewState === "resolved" ? (
                      <IconAction action="waitingReviewer" onClick={() => {}} disabled />
                    ) : (
                      <IconAction action="fixReview" onClick={() => h.resolveReview(t.id, t.ticketId)} busy={busy.has("fixreview-" + t.id)} />
                    ))}
                  {t.id && claim === "mine" && !t.prUrl && t.implementOrder > 0 &&
                    (t.implementState === "failed" || t.implementState === "skipped") && (
                      <IconAction action={held ? "resume" : "retry"} onClick={() => h.retry(t.id)} busy={busy.has("retry-" + t.id)} />
                    )}
                  {due && t.id && <IconAction action="release" onClick={() => h.release(t)} busy={busy.has("release-" + t.id)} />}
                  {t.id && QA_STAGES.has(stage) && t.pendingAction !== "fix-qa" && stage !== "qa-failed" && claim !== "dropped" && !replyWaiting && (
                    <IconAction action="draftReply" onClick={() => h.draftReply(t.id)} busy={busy.has("draft-" + t.id)} />
                  )}
                  {t.id && t.pendingAction === "fix-qa" && !isFixingQa(t) && t.qaRounds < MAX_QA_ROUNDS && !replyWaiting &&
                    t.implementState !== "running" && t.reviewState !== "running" && claim === "mine" && (
                      <IconAction action="qaFix" onClick={() => h.startQaFix(t.id, t.ticketId)} busy={busy.has("qafix-" + t.id)} />
                    )}
                  {t.id && t.pendingAction === "move-to-qa" && (
                    <IconAction action="moveToQa" onClick={() => h.moveToQa(t.id)} busy={busy.has("qa-" + t.id)} />
                  )}
                  {canMove && t.id !== firstMovable && (
                    <IconAction action="doNext" onClick={() => h.move(t.id, "top")} busy={busy.has("move-" + t.id)} />
                  )}
                  {t.id && t.implementState === "pending" && t.implementOrder > 0 && claim === "mine" && !t.runId && !t.prUrl && !t.releasedAt && (
                    <IconAction action="hold" onClick={() => h.hold(t.id)} busy={busy.has("hold-" + t.id)} />
                  )}
                  {t.id && t.implementState !== "running" && t.reviewState !== "running" && (
                    <IconAction action="remove" onClick={() => h.remove(t.id, t.ticketId)} busy={busy.has("remove-" + t.id)} />
                  )}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
