"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { COLORS, FONT, card, ctaButtonStyle, pill, ringBorder, tintedCard } from "@/lib/ui";
import { useBoltsContext } from "../../BoltsContext";
import LoadingRing from "../LoadingRing";

type Props = {
  /** The plan markdown as the run last produced it. */
  plan: string;
  /** True only at the review gate. False both while the run is still drafting the
   *  plan and for a one-shot (auto) run, which has no gate — either way the
   *  actions are hidden and the plan is read-only. */
  awaiting: boolean;
  busy: boolean;
  /** Which action's POST is currently in flight — drives which button shows a spinner. */
  busyAction?: "approve" | "revise" | "cancel";
  onApprove: (plan: string) => void;
  onRevise: (plan: string, feedback: string) => void;
  onCancel: () => void;
};

// Section headings the skills' plan.md templates use — each gets its own
// accent-colored marker icon in Preview so the eye has something to latch onto
// instead of a wall of uniform headings. The implement and review flows share
// most of them; "Scope" is the implement template's, "Thread Decisions" the
// review one's.
const SECTION_ICON: Record<string, { glyph: string; color: string }> = {
  Understanding: { glyph: "◎", color: COLORS.info },
  Scope: { glyph: "◫", color: COLORS.indigo },
  "Thread Decisions": { glyph: "◫", color: COLORS.indigo },
  Changes: { glyph: "✎", color: COLORS.accent },
  Verification: { glyph: "✓", color: COLORS.success },
  "Risks / Assumptions": { glyph: "!", color: COLORS.warning },
};

// Two jobs, told apart by `awaiting`:
//   awaiting — the plan-review gate. Read (or edit) what Claude intends to do
//              before any source file is touched, then accept it, send it back
//              with feedback, or drop the run entirely.
//   otherwise — a read-only record. The one-shot (auto) flow has no gate: it
//              writes its plan, then runs on to the pull request in the same
//              turn. The plan is kept so the finished run can still be read
//              without reconstructing its intent from the diff.
export default function PlanTab({ plan, awaiting, busy, busyAction, onApprove, onRevise, onCancel }: Props) {
  const { fireBoltFromEvent } = useBoltsContext();
  const [draft, setDraft] = useState(plan);
  const [editing, setEditing] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const lastPlanRef = useRef(plan);

  // A re-plan replaces the whole document — adopt it unless the user is mid-edit.
  // Keyed off whether `plan` itself changed, not `editing` — otherwise toggling
  // editing off (e.g. via Save) would re-fire this and stomp the user's draft
  // back to the stale server plan.
  useEffect(() => {
    if (plan !== lastPlanRef.current) {
      lastPlanRef.current = plan;
      if (!editing) setDraft(plan);
    }
  }, [plan, editing]);

  useEffect(() => () => { if (savedTimer.current) clearTimeout(savedTimer.current); }, []);

  const edited = draft.trim() !== plan.trim();
  // Keyed off the server's plan, not the local draft: the header describes what
  // the run produced, and it must not change while someone types in the editor.
  const hasPlan = !!plan.trim();
  const lineCount = useMemo(() => draft.split("\n").length, [draft]);

  function handleSave() {
    setEditing(false);
    setJustSaved(true);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setJustSaved(false), 2200);
  }

  function syncGutterScroll() {
    if (gutterRef.current && textareaRef.current) gutterRef.current.scrollTop = textareaRef.current.scrollTop;
  }

  return (
    <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "18px", animation: "fadeUp .35s both" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "14px", ...tintedCard(awaiting ? "accent" : hasPlan ? "success" : "warning", { padding: "16px 18px", radius: "13px" }) }}>
        <span style={{ flex: "0 0 auto", width: "40px", height: "40px", borderRadius: "11px", background: "rgba(251,114,80,.14)", border: `1px solid ${COLORS.accent}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" strokeWidth="2.2" style={{ stroke: COLORS.accent }}><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
        </span>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: "var(--font-space), sans-serif", fontSize: FONT.lg, fontWeight: 700, color: COLORS.text }}>
            {awaiting ? "Plan ready for your review" : hasPlan ? "Implementation plan" : "Drafting the plan…"}
          </div>
          <div style={{ fontSize: FONT.base, color: COLORS.textDim, marginTop: "2px" }}>
            {awaiting
              ? "Nothing has been changed in the repo yet. Edit the plan if you want, then accept it to let the run continue."
              : hasPlan
                ? "What Claude set out to do, written before it touched any file. This run doesn't stop for approval — the plan is kept so you can read back what it intended."
                : "Claude is reading the ticket and the codebase. The plan will appear here when it's done."}
          </div>
        </div>
        {justSaved && (
          <span style={{ ...pill({ color: COLORS.success, border: "#24382F", size: "sm" }), animation: "fadeUp .2s both" }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5"><path d="M5 13l4 4L19 7" /></svg>
            Saved
          </span>
        )}
        {!justSaved && edited && <span style={pill({ color: COLORS.warning, border: COLORS.border, size: "sm" })}>Unsaved edits</span>}
      </div>

      {awaiting && (
        <PreviewEditToggle editing={editing} onPreview={() => setEditing(false)} onEdit={() => setEditing(true)} />
      )}

      {editing ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <div className="te-scroll" style={{ display: "flex", width: "100%", minHeight: "460px", maxHeight: "620px", overflow: "auto", ...card({ padding: "0", radius: "13px", background: COLORS.panelBgDark }) }}>
            <div
              ref={gutterRef}
              className="te-scroll"
              style={{
                flex: "0 0 auto", overflow: "hidden", userSelect: "none", textAlign: "right",
                padding: "16px 10px 16px 14px", borderRight: `1px solid ${COLORS.borderSubtle}`,
                fontFamily: "var(--font-mono), monospace", fontSize: FONT.base, lineHeight: 1.7, color: COLORS.faint,
              }}
            >
              {Array.from({ length: lineCount }, (_, i) => <div key={i}>{i + 1}</div>)}
            </div>
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onScroll={syncGutterScroll}
              spellCheck={false}
              autoFocus
              style={{
                flex: 1, minHeight: "460px", resize: "none", outline: "none", border: "none",
                fontFamily: "var(--font-mono), monospace", fontSize: FONT.base, lineHeight: 1.7,
                color: COLORS.text, background: "transparent", padding: "16px 18px 16px 12px",
              }}
            />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "9px" }}>
            <button
              onClick={(e) => { fireBoltFromEvent(e); handleSave(); }}
              disabled={!edited}
              style={{ ...ctaButtonStyle("success", { height: "32px" }), padding: "0 16px", fontSize: FONT.base, opacity: edited ? 1 : 0.45, cursor: edited ? "pointer" : "not-allowed" }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" style={{ position: "relative", zIndex: 1 }}><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" /><path d="M17 21v-8H7v8M7 3v5h8" /></svg>
              <span style={{ position: "relative", zIndex: 1 }}>Save & preview</span>
            </button>
            <span style={{ fontSize: FONT.sm, color: COLORS.textMuted }}>
              {edited ? "You have unsaved edits — save to confirm them before accepting." : "No changes yet."}
            </span>
          </div>
        </div>
      ) : (
        <div className="md-body te-scroll" style={{ ...card({ padding: "20px 26px", radius: "13px" }), maxHeight: "620px", overflowY: "auto" }}>
          {draft.trim() ? (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                h2: ({ children, ...props }) => {
                  const text = String(children);
                  const icon = SECTION_ICON[text];
                  return (
                    <h2 {...props} style={icon ? { borderLeftColor: icon.color } : undefined}>
                      {icon && <span style={{ color: icon.color, marginRight: "8px" }}>{icon.glyph}</span>}
                      {children}
                    </h2>
                  );
                },
              }}
            >
              {draft}
            </ReactMarkdown>
          ) : (
            <span style={{ color: COLORS.faint, fontSize: FONT.base }}>No plan yet.</span>
          )}
        </div>
      )}

      {awaiting && feedbackOpen && (
        <div style={{ display: "flex", flexDirection: "column", gap: "9px", ...card({ padding: "14px 16px", radius: "12px" }) }}>
          <div style={{ fontSize: FONT.base, fontWeight: 700, color: COLORS.text }}>What should change about this plan?</div>
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            autoFocus
            placeholder="e.g. don't touch the settings API — the mapping belongs in lib/tickets.ts instead"
            style={{
              width: "100%", minHeight: "90px", resize: "vertical", outline: "none",
              fontFamily: "var(--font-hanken), sans-serif", fontSize: FONT.base, lineHeight: 1.6,
              color: COLORS.text, background: "transparent", border: `1px solid ${COLORS.border}`,
              borderRadius: "9px", padding: "10px 12px",
            }}
          />
          <div style={{ fontSize: FONT.sm, color: COLORS.textMuted }}>
            The same Claude session is resumed to re-plan, so it keeps everything it already learned about the ticket and the code.
          </div>
        </div>
      )}

      {awaiting && (
        <div style={{ display: "flex", alignItems: "center", gap: "9px" }}>
          <button
            disabled={busy || editing}
            onClick={(e) => { fireBoltFromEvent(e, { big: true }); onApprove(draft); }}
            title={editing ? "Save your edits first" : undefined}
            style={{ ...ctaButtonStyle("success", { height: "36px" }), padding: "0 18px", fontSize: FONT.base, opacity: busy || editing ? 0.5 : 1, cursor: busy || editing ? "not-allowed" : "pointer" }}
          >
            {busyAction === "approve" ? (
              <span style={{ position: "relative", zIndex: 1, display: "inline-flex" }}><LoadingRing size={13} /></span>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" style={{ position: "relative", zIndex: 1 }}><path d="M5 13l4 4L19 7" /></svg>
            )}
            <span style={{ position: "relative", zIndex: 1 }}>{edited ? "Accept edited plan" : "Accept & implement"}</span>
          </button>
          <button
            disabled={busy || editing || (feedbackOpen && !feedback.trim())}
            onClick={(e) => {
              fireBoltFromEvent(e);
              if (!feedbackOpen) {
                setFeedbackOpen(true);
                return;
              }
              onRevise(draft, feedback.trim());
            }}
            title={editing ? "Save your edits first" : undefined}
            style={{ ...ctaButtonStyle("ghost", { height: "36px" }), padding: "0 18px", fontSize: FONT.base, opacity: busy || editing || (feedbackOpen && !feedback.trim()) ? 0.5 : 1 }}
          >
            {busyAction === "revise" ? (
              <span style={{ position: "relative", zIndex: 1, display: "inline-flex" }}><LoadingRing size={13} /></span>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ position: "relative", zIndex: 1 }}><path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><path d="M21 3v5h-5" /></svg>
            )}
            <span style={{ position: "relative", zIndex: 1 }}>Request changes</span>
          </button>
          <div style={{ flex: 1 }} />
          <button
            disabled={busy}
            onClick={(e) => { fireBoltFromEvent(e); onCancel(); }}
            style={{ ...ctaButtonStyle("danger", { height: "36px" }), padding: "0 18px", fontSize: FONT.base, opacity: busy ? 0.5 : 1 }}
          >
            {busyAction === "cancel" ? (
              <span style={{ position: "relative", zIndex: 1, display: "inline-flex" }}><LoadingRing size={13} /></span>
            ) : (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" style={{ position: "relative", zIndex: 1 }}><path d="M18 6 6 18M6 6l12 12" /></svg>
            )}
            <span style={{ position: "relative", zIndex: 1 }}>Cancel run</span>
          </button>
        </div>
      )}

      {!awaiting && !draft.trim() && (
        <div style={{ display: "flex", justifyContent: "center", padding: "10px 0" }}>
          <span style={{ ...pill({ color: COLORS.warning, border: COLORS.border, size: "md" }), ...ringBorder({ fill: "#1A1E25", ring: COLORS.warning, highlight: COLORS.warning, duration: 3, shape: "pill" }) }}>
            Analyzing…
          </span>
        </div>
      )}
    </div>
  );
}

// Segmented Preview/Edit control — a sliding accent highlight instead of two
// static outline buttons, so the active mode is unmistakable at a glance.
function PreviewEditToggle({ editing, onPreview, onEdit }: { editing: boolean; onPreview: () => void; onEdit: () => void }) {
  const { fireBoltFromEvent } = useBoltsContext();
  const trackStyle: CSSProperties = {
    position: "relative", display: "inline-grid", gridTemplateColumns: "1fr 1fr",
    width: "200px", height: "34px", padding: "3px", borderRadius: "10px",
    border: `1px solid ${COLORS.border}`, background: COLORS.panelBgDark,
  };
  const thumbStyle: CSSProperties = {
    position: "absolute", top: "3px", bottom: "3px", left: "3px",
    width: "calc(50% - 3px)", borderRadius: "8px",
    transform: editing ? "translateX(100%)" : "translateX(0)",
    transition: "transform .22s cubic-bezier(.4,0,.2,1)",
    ...ringBorder({ fill: "#22160F", variant: "filled", shape: "none" }),
  };
  const btnStyle = (active: boolean): CSSProperties => ({
    position: "relative", zIndex: 1, border: "none", background: "transparent", cursor: "pointer",
    display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
    fontSize: FONT.sm, fontWeight: 700, color: active ? COLORS.accent : COLORS.textDim,
    transition: "color .18s",
  });
  return (
    <div style={trackStyle}>
      <div style={thumbStyle} />
      <button onClick={(e) => { fireBoltFromEvent(e); onPreview(); }} style={btnStyle(!editing)}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z" /><circle cx="12" cy="12" r="3" /></svg>
        Preview
      </button>
      <button onClick={(e) => { fireBoltFromEvent(e); onEdit(); }} style={btnStyle(editing)}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
        Edit
      </button>
    </div>
  );
}
