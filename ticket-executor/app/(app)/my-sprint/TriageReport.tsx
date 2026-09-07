"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useBoltsContext } from "../../BoltsContext";
import {
  COLORS,
  FONT,
  card,
  ctaButtonStyle,
  modalOverlayStyle,
  modalShellStyle,
  pill,
  ringBorder,
  sectionCaption,
  tintedCard,
} from "@/lib/ui";
import type { TriagedTicket } from "@/lib/execution/triage";

// The full triage report, at the largest size the viewport allows.
//
// The row in the plan table can only ever carry a verdict and a truncated
// sentence, which is enough to scan and not enough to act on. This is the other
// half: for each ticket, what is missing, what to do next, what to ask, and what
// in the codebase the verdict rests on — laid out as separate, named sections so
// a developer reads down one ticket rather than parsing a paragraph.

export type TriageReportData = {
  summary?: string;
  finalNotes?: string[];
  tickets?: TriagedTicket[];
};

const READINESS: Record<
  TriagedTicket["readiness"],
  { color: string; label: string; means: string }
> = {
  ready: {
    color: COLORS.success,
    label: "Ready",
    means: "Nothing is missing. Start it as it stands.",
  },
  "ready-with-notes": {
    color: COLORS.info,
    label: "Ready · notes",
    means:
      "Also startable today — nobody has to answer anything. The notes are context to carry into the work: shared code it touches, an edge case the criteria do not name, a regression to watch.",
  },
  "needs-clarification": {
    color: COLORS.warning,
    label: "Needs clarification",
    means:
      "A person has to answer something first. The questions are listed on the ticket; the scheduler will not run it until it is cleared.",
  },
  blocked: {
    color: COLORS.danger,
    label: "Blocked",
    means:
      "Work cannot start at all — a dependency does not exist yet, or only the client can resolve a contradiction.",
  },
};

const VERDICT: Record<TriagedTicket["estimateVerdict"], { color: string; label: string }> = {
  reasonable: { color: COLORS.success, label: "Estimate reasonable" },
  increase: { color: COLORS.warning, label: "Consider increasing" },
  high: { color: COLORS.info, label: "May be high" },
  "cannot-evaluate": { color: COLORS.textDim, label: "Cannot evaluate" },
};

const RISK: Record<TriagedTicket["risk"], { color: string; label: string }> = {
  low: { color: COLORS.success, label: "Low risk" },
  medium: { color: COLORS.warning, label: "Medium risk" },
  high: { color: COLORS.danger, label: "High risk" },
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      <span style={sectionCaption()}>{title}</span>
      {children}
    </div>
  );
}

/** A named list inside a ticket card. Rendered only when it has entries — an
 *  empty "Blockers" heading reads as an unanswered question rather than as the
 *  good news it actually is. */
function Bullets({
  title,
  items,
  color,
  mono,
}: {
  title: string;
  items: string[];
  color: string;
  mono?: boolean;
}) {
  if (!items.length) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
      <span style={{ fontSize: FONT.xs, fontWeight: 700, letterSpacing: ".08em", color }}>
        {title.toUpperCase()}
      </span>
      {items.map((it, i) => (
        <span
          key={i}
          style={{
            fontSize: FONT.base,
            color: COLORS.textMuted,
            lineHeight: 1.6,
            display: "flex",
            gap: "8px",
            ...(mono ? { fontFamily: "var(--font-mono), monospace", fontSize: FONT.sm } : {}),
          }}
        >
          <span style={{ color, flex: "0 0 auto" }}>•</span>
          <span>{it}</span>
        </span>
      ))}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const { fireBoltFromEvent } = useBoltsContext();
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={(e) => {
        fireBoltFromEvent(e);
        void navigator.clipboard.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        });
      }}
      style={{ ...ctaButtonStyle("ghost", { height: "26px", cornerPx: 6 }), cursor: "pointer" }}
    >
      {done ? "Copied" : "Copy comment"}
    </button>
  );
}

export default function TriageReport({
  data,
  sprint,
  costUsd,
  onClose,
}: {
  data: TriageReportData;
  sprint: string;
  costUsd: number;
  onClose: () => void;
}) {
  const { fireBoltFromEvent } = useBoltsContext();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const tickets = [...(data.tickets ?? [])].sort((a, b) => a.workOrder - b.workOrder);
  const count = (r: TriagedTicket["readiness"]) => tickets.filter((t) => t.readiness === r).length;
  const startable = count("ready") + count("ready-with-notes");
  const waiting = tickets.filter((t) => t.needsClarification).length;
  const resize = tickets.filter((t) => t.estimateVerdict === "increase").length;
  const drafts = tickets.filter((t) => t.clientCommentDraft.trim().length > 0);
  // No ticket cites anything it read: the whole report rests on the work item
  // text. That is a legitimate mode, but it changes how far every verdict below
  // can be trusted, so it is said once at the top rather than left to a note at
  // the bottom.
  const codeBlind = tickets.length > 0 && tickets.every((t) => t.evidence.length === 0);
  const usedReadiness = (Object.keys(READINESS) as TriagedTicket["readiness"][]).filter((r) =>
    tickets.some((t) => t.readiness === r)
  );

  const stat = (label: string, value: string, color: string) => (
    <span
      key={label}
      style={{ ...card({ padding: "10px 14px" }), display: "flex", flexDirection: "column", gap: "3px", minWidth: "132px" }}
    >
      <span style={{ fontSize: FONT.xl, fontWeight: 800, color }}>{value}</span>
      <span style={{ fontSize: FONT.sm, color: COLORS.textDim, fontWeight: 600 }}>{label}</span>
    </span>
  );

  // Portalled to <body> rather than rendered in place. The page's own shell is a
  // sidebar plus a clipped flex column, and a `fixed` overlay left inside that
  // column is laid out against the column instead of the viewport — the report
  // opened offset behind the sidebar and ran off the right edge. The body is the
  // only parent that guarantees the whole screen.
  const body = (
    <div
      style={{ ...modalOverlayStyle({ zIndex: 60 }), padding: "20px" }}
      onClick={onClose}
    >
      <div
        style={{ width: "min(1720px, 96vw)", height: "94vh", display: "flex", flexDirection: "column", overflow: "hidden", ...modalShellStyle() }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "16px 20px", borderBottom: "1px solid " + COLORS.border, flex: "0 0 auto" }}>
          <span style={{ fontSize: FONT.lg, fontWeight: 700, color: COLORS.text }}>Triage report</span>
          <span style={pill({ color: COLORS.textMuted, size: "xs", weight: 600 })}>{sprint}</span>
          <span style={pill({ color: COLORS.textMuted, size: "xs", weight: 600 })}>${costUsd.toFixed(2)}</span>
          <div style={{ flex: 1 }} />
          <button
            onClick={(e) => { fireBoltFromEvent(e); onClose(); }}
            style={{ width: "26px", height: "26px", flex: "0 0 auto", color: COLORS.textDim, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", ...ringBorder({ fill: COLORS.panelBgDark, duration: 4, cornerPx: 6 }) }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "20px", display: "flex", flexDirection: "column", gap: "22px" }}>
          <Section title="SUMMARY">
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              {stat("Reviewed", String(tickets.length), COLORS.text)}
              {stat("Can start now", String(startable), COLORS.success)}
              {stat("Waiting on an answer", String(waiting), COLORS.warning)}
              {stat("Re-estimate", String(resize), COLORS.indigo)}
              {stat("Comment drafts", String(drafts.length), COLORS.info)}
            </div>
            {data.summary && (
              <span style={{ fontSize: FONT.base, color: COLORS.textMuted, lineHeight: 1.7 }}>{data.summary}</span>
            )}
            {codeBlind && (
              <div style={tintedCard("warning")}>
                <span style={{ fontSize: FONT.base, color: COLORS.warning, fontWeight: 600, lineHeight: 1.7 }}>
                  No code was read — every verdict below comes from the work item text alone. Set the project&apos;s
                  root repo on the triage card and re-run to get readiness and sizing the codebase actually backs.
                </span>
              </div>
            )}
          </Section>

          {usedReadiness.length > 0 && (
            <Section title="WHAT THE VERDICTS MEAN">
              <div style={{ ...card({ padding: "14px 16px" }), display: "flex", flexDirection: "column", gap: "10px" }}>
                {usedReadiness.map((r) => (
                  <div key={r} style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
                    <span style={{ ...pill({ color: READINESS[r].color, size: "xs", weight: 700 }), flex: "0 0 auto", minWidth: "132px", justifyContent: "center" }}>
                      {READINESS[r].label}
                    </span>
                    <span style={{ fontSize: FONT.sm, color: COLORS.textMuted, lineHeight: 1.6 }}>{READINESS[r].means}</span>
                  </div>
                ))}
              </div>
            </Section>
          )}

          <Section title="TICKETS · IN PICK-UP ORDER">
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {tickets.map((t) => (
                <div key={t.id} style={{ ...card({ padding: "16px 18px" }), display: "flex", flexDirection: "column", gap: "14px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                    <span style={{ fontSize: FONT.lg, fontWeight: 800, color: COLORS.accent, minWidth: "26px" }}>{t.workOrder}</span>
                    <span style={{ fontSize: FONT.base, fontWeight: 700, color: COLORS.text }}>
                      #{t.id} · {t.title}
                    </span>
                    <div style={{ flex: 1 }} />
                    <span style={pill({ color: READINESS[t.readiness]?.color ?? COLORS.textDim, size: "xs", weight: 700 })}>
                      {READINESS[t.readiness]?.label ?? t.readiness}
                    </span>
                    <span style={pill({ color: RISK[t.risk]?.color ?? COLORS.textDim, size: "xs", weight: 700 })}>
                      {RISK[t.risk]?.label ?? t.risk}
                    </span>
                    <span style={pill({ color: VERDICT[t.estimateVerdict]?.color ?? COLORS.textDim, size: "xs", weight: 700 })}>
                      {VERDICT[t.estimateVerdict]?.label ?? t.estimateVerdict}
                      {t.suggestedPoints !== t.currentPoints
                        ? ` · ${t.currentPoints || 0} → ${t.suggestedPoints}`
                        : ` · ${t.currentPoints || 0}pt`}
                    </span>
                    {t.dependsOn.length > 0 && (
                      <span style={pill({ color: COLORS.indigo, size: "xs", weight: 700 })}>
                        after {t.dependsOn.map((d) => "#" + d).join(", ")}
                      </span>
                    )}
                  </div>

                  {t.reason && (
                    <span style={{ fontSize: FONT.base, color: COLORS.textMuted, lineHeight: 1.7 }}>{t.reason}</span>
                  )}

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "18px" }}>
                    <Bullets title="Do next" items={t.actions} color={COLORS.accent} />
                    <Bullets title="Blocking this ticket" items={t.blockers} color={COLORS.warning} />
                    <Bullets title="Questions to ask" items={t.questions} color={COLORS.danger} />
                    <Bullets title="From the codebase" items={t.evidence} color={COLORS.indigo} mono />
                  </div>

                  {t.estimateReason && (
                    <span style={{ fontSize: FONT.sm, color: COLORS.textDim, lineHeight: 1.6 }}>
                      <span style={{ fontWeight: 700, color: COLORS.textMuted }}>Sizing — </span>
                      {t.estimateReason}
                    </span>
                  )}

                  {t.clientCommentDraft.trim() && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <span style={{ fontSize: FONT.xs, fontWeight: 700, letterSpacing: ".08em", color: COLORS.info }}>
                          COMMENT DRAFT
                        </span>
                        <div style={{ flex: 1 }} />
                        <CopyButton text={t.clientCommentDraft} />
                      </div>
                      <span style={{ fontSize: FONT.sm, color: COLORS.textMuted, lineHeight: 1.7, whiteSpace: "pre-wrap", padding: "10px 12px", borderRadius: "8px", background: "color-mix(in srgb, var(--te-text) 3%, transparent)", border: "1px solid " + COLORS.borderSubtle }}>
                        {t.clientCommentDraft}
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Section>

          {(data.finalNotes ?? []).length > 0 && (
            <Section title="FINAL NOTES">
              <div style={{ ...card({ padding: "14px 16px" }), display: "flex", flexDirection: "column", gap: "6px" }}>
                {(data.finalNotes ?? []).map((n, i) => (
                  <span key={i} style={{ fontSize: FONT.base, color: COLORS.textMuted, lineHeight: 1.7, display: "flex", gap: "8px" }}>
                    <span style={{ color: COLORS.textDim }}>•</span>
                    <span>{n}</span>
                  </span>
                ))}
              </div>
            </Section>
          )}
        </div>
      </div>
    </div>
  );

  return mounted ? createPortal(body, document.body) : null;
}
