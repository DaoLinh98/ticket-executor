"use client";

import { COLORS, FONT, card, ctaButtonStyle, sectionCaption } from "@/lib/ui";
import ActionButton, { type ActionVariant } from "./ActionButton";

// Every row action on Flow Runner, drawn as an icon. The label is the button's
// accessible name and tooltip; ActionLegend lists them all so the icon is never
// the only place its meaning lives (a phone has no tooltip).
export const ACTIONS = {
  watch: { label: "Watch", hint: "Open the run in flight", variant: "outline", d: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" },
  result: { label: "Result", hint: "Open the last run's result", variant: "ghost", d: "M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z M14 3v6h6 M8 13h8 M8 17h5" },
  release: { label: "Release", hint: "Publish the PR, add reviewers, move the status", variant: "primary", d: "M22 2L11 13 M22 2l-7 20-4-9-9-4z" },
  retry: { label: "Retry", hint: "Queue the failed run again", variant: "warning", d: "M3 12a9 9 0 1 0 3-6.7L3 8 M3 3v5h5" },
  resume: { label: "Resume", hint: "Put a held ticket back in the queue", variant: "warning", d: "M7 4l13 8-13 8z" },
  fixReview: { label: "Fix review", hint: "Resolve open review comments", variant: "outline", d: "M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z" },
  waitingReviewer: { label: "Waiting for reviewer", hint: "Review fixed — the reviewer has to answer", variant: "ghost", d: "M6 2h12 M6 22h12 M6 2c0 6 6 6 6 10s-6 4-6 10 M18 2c0 6-6 6-6 10s6 4 6 10" },
  draftReply: { label: "Draft reply", hint: "Draft a reply to QC's comments", variant: "outline", d: "M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12z M8 12h.01 M12 12h.01 M16 12h.01" },
  readDraft: { label: "Read draft", hint: "Jump to the drafted QC reply", variant: "outline", d: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z M7 8h10 M7 12h6" },
  qaFix: { label: "Start QA fix", hint: "Fix what QA sent back", variant: "warning", d: "M8 9a4 4 0 0 1 8 0v5a4 4 0 0 1-8 0z M12 11v7 M4 11h4 M16 11h4 M4 16h4 M16 16h4 M9 4l1.5 2 M15 4l-1.5 2" },
  moveToQa: { label: "Move to In QA", hint: "PR merged — hand the ticket to QA", variant: "primary", d: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M8 12l3 3 5-6" },
  doNext: { label: "Do next", hint: "Move to the top of the queue", variant: "ghost", d: "M5 4h14 M12 20V8 M6 14l6-6 6 6" },
  hold: { label: "Hold", hint: "Keep it out of the queue for now", variant: "ghost", d: "M8 5v14 M16 5v14" },
  remove: { label: "Remove", hint: "Stop tracking it — add it back by hand any time", variant: "ghost", d: "M3 6h18 M8 6V4h8v2 M6 6l1 15h10l1-15 M10 11v6 M14 11v6" },
  forceReady: { label: "Force ready", hint: "Run it although triage flagged it", variant: "outline", d: "M5 11h14v10H5z M8 11V7a4 4 0 0 1 7.5-2" },
  overridden: { label: "Overridden", hint: "Forced ready — click to undo", variant: "success", d: "M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6z M9 12l2 2 4-4" },
} as const satisfies Record<string, { label: string; hint: string; variant: ActionVariant; d: string }>;

export type ActionKey = keyof typeof ACTIONS;

export function ActionGlyph({ action, size = 15 }: { action: ActionKey; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={ACTIONS[action].d} />
    </svg>
  );
}

export function IconAction({ action, onClick, busy, disabled }: { action: ActionKey; onClick: () => void; busy?: boolean; disabled?: boolean }) {
  const a = ACTIONS[action];
  return <ActionButton label={a.label} variant={a.variant} icon={<ActionGlyph action={action} />} onClick={onClick} busy={busy} disabled={disabled} />;
}

export function ActionLegend() {
  return (
    <div style={{ ...card({ padding: "12px 0 12px 12px" }), display: "flex", flexDirection: "column", gap: "10px", minHeight: 0, maxHeight: "100%" }}>
      <span style={sectionCaption()}>ACTIONS</span>
      <div className="te-scroll" style={{ display: "flex", flexDirection: "column", gap: "10px", minHeight: 0, overflowY: "auto", paddingRight: "12px" }}>
      {(Object.keys(ACTIONS) as ActionKey[]).map((key) => {
        const a = ACTIONS[key];
        return (
          <div key={key} style={{ display: "flex", alignItems: "flex-start", gap: "9px" }}>
            <span aria-hidden style={{ ...ctaButtonStyle(a.variant, { height: "26px", cornerPx: 6 }), width: "26px", padding: 0, justifyContent: "center", flex: "0 0 auto", cursor: "default" }}>
              <ActionGlyph action={key} size={13} />
            </span>
            <span style={{ display: "flex", flexDirection: "column", gap: "1px", minWidth: 0 }}>
              <span style={{ fontSize: FONT.sm, fontWeight: 700, color: COLORS.text }}>{a.label}</span>
              <span style={{ fontSize: FONT.xs, color: COLORS.textMuted, lineHeight: 1.4 }}>{a.hint}</span>
            </span>
          </div>
        );
      })}
      </div>
    </div>
  );
}
