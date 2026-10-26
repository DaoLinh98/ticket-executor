import LoadingRing from "../../ticket-executor/LoadingRing";
import { COLORS, FONT, card, fieldInput, pill, sectionCaption } from "@/lib/ui";
import { TRIGGER_LABEL, type FindingKind } from "@/lib/qaFollowUp";
import ActionButton from "./ActionButton";
import type { QaCase } from "./model";

const STATUS: Record<QaCase["status"], { text: string; color: string }> = {
  pending: { text: "Waiting for analysis", color: COLORS.textMuted },
  running: { text: "Analysing…", color: COLORS.accent },
  ready: { text: "Your decision", color: COLORS.warning },
  failed: { text: "Analysis failed", color: COLORS.danger },
  fixing: { text: "Fixing…", color: COLORS.accent },
  fixed: { text: "Fixed — post the reply", color: COLORS.success },
};

const KIND: Record<FindingKind, { text: string; color: string }> = {
  defect: { text: "Defect", color: COLORS.danger },
  "needs-info": { text: "Needs info", color: COLORS.warning },
  "new-scope": { text: "New scope", color: COLORS.indigo },
  question: { text: "Question", color: COLORS.info },
  "not-defect": { text: "Not a defect", color: COLORS.success },
};

const RECOMMENDATION: Record<string, { text: string; color: string }> = {
  fix: { text: "Fix needed", color: COLORS.danger },
  decide: { text: "Needs your call", color: COLORS.warning },
  reply: { text: "Reply is enough", color: COLORS.success },
};

/** The findings a case starts with ticked: every real defect. */
export function defaultPicks(c: QaCase): number[] {
  return (c.findings ?? []).flatMap((f, i) => (f.kind === "defect" ? [i] : []));
}

export default function QaFollowUps({
  cases,
  edits,
  picks,
  notes,
  busy,
  onEdit,
  onPick,
  onNote,
  onAnalyze,
  onApprove,
  onPost,
  onDismiss,
  onWatch,
}: {
  cases: QaCase[];
  edits: Record<string, string>;
  picks: Record<string, number[]>;
  notes: Record<string, string>;
  busy: ReadonlySet<string>;
  onEdit: (id: string, body: string) => void;
  onPick: (id: string, picked: number[]) => void;
  onNote: (id: string, note: string) => void;
  onAnalyze: (c: QaCase) => void;
  onApprove: (c: QaCase) => void;
  onPost: (c: QaCase) => void;
  onDismiss: (c: QaCase) => void;
  onWatch: (ticketId: string) => void;
}) {
  if (cases.length === 0) return null;
  return (
    <div id="qa-follow-ups" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <span style={sectionCaption()}>QC FOLLOW-UP</span>
      {cases.map((c) => {
        const body = edits[c.id] ?? c.body;
        const picked = picks[c.id] ?? defaultPicks(c);
        const findings = c.findings ?? [];
        const deciding = c.status === "ready";
        const st = STATUS[c.status];
        const rec = RECOMMENDATION[c.recommendation];
        return (
          <div key={c.id} style={{ ...card({ padding: "14px 16px" }), display: "flex", flexDirection: "column", gap: "10px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              <span style={{ fontSize: FONT.base, color: COLORS.text, fontWeight: 700 }}>#{c.ticketId}</span>
              {(c.status === "running" || c.status === "fixing") && <LoadingRing size={14} />}
              <span style={pill({ color: st.color, size: "xs", weight: 700 })}>{st.text}</span>
              {rec && deciding && <span style={pill({ color: rec.color, size: "xs", weight: 700 })}>{rec.text}</span>}
              {c.triggers.map((t) => (
                <span key={t} style={pill({ color: COLORS.textMuted, size: "xs" })}>{TRIGGER_LABEL[t] ?? t}</span>
              ))}
            </div>
            {c.summary && <span style={{ fontSize: FONT.sm, color: COLORS.textMuted, lineHeight: 1.6 }}>{c.summary}</span>}
            {c.errorMessage && <span style={{ fontSize: FONT.sm, color: COLORS.danger }}>{c.errorMessage}</span>}

            {findings.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {findings.map((f, i) => {
                  const k = KIND[f.kind] ?? KIND["needs-info"];
                  const on = picked.includes(i);
                  return (
                    <label key={i} style={{ display: "flex", alignItems: "flex-start", gap: "10px", minHeight: "40px", cursor: deciding ? "pointer" : "default" }}>
                      <input
                        type="checkbox"
                        aria-label={`Fix: ${f.finding}`}
                        checked={on}
                        disabled={!deciding}
                        onChange={(e) => onPick(c.id, e.target.checked ? [...picked, i] : picked.filter((x) => x !== i))}
                        style={{ width: "16px", height: "16px", margin: "2px 0 0", accentColor: COLORS.accent, cursor: deciding ? "pointer" : "default", flex: "0 0 auto" }}
                      />
                      <span style={{ display: "flex", flexDirection: "column", gap: "3px", minWidth: 0 }}>
                        <span style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                          <span style={pill({ color: k.color, size: "xs", weight: 700 })}>{k.text}</span>
                          {f.weak && <span style={pill({ color: COLORS.warning, size: "xs" })}>unproven &ldquo;not a defect&rdquo;</span>}
                          <span style={{ fontSize: FONT.base, color: COLORS.text }}>{f.finding}</span>
                        </span>
                        <span style={{ fontSize: FONT.sm, color: COLORS.textMuted, lineHeight: 1.5, overflowWrap: "anywhere" }}>{f.reason}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            )}

            {deciding && picked.length > 0 && (
              <input
                value={notes[c.id] ?? ""}
                onChange={(e) => onNote(c.id, e.target.value)}
                placeholder="Note for the fix (optional)"
                aria-label="Note for the fix"
                style={fieldInput()}
              />
            )}
            {(deciding || c.status === "fixed") && (
              <textarea
                value={body}
                onChange={(e) => onEdit(c.id, e.target.value)}
                rows={4}
                aria-label="Reply to QC"
                style={{ ...fieldInput(), minHeight: "96px", padding: "10px 13px", resize: "vertical", lineHeight: 1.5 }}
              />
            )}

            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              {deciding && picked.length > 0 && (
                <ActionButton label={`Approve fix (${picked.length})`} variant="primary" onClick={() => onApprove(c)} busy={busy.has("qafix-" + c.id)} />
              )}
              {(deciding || c.status === "fixed") && (
                <ActionButton label="Post reply" variant={deciding && picked.length > 0 ? "outline" : "primary"} onClick={() => onPost(c)} busy={busy.has("post-" + c.id)} disabled={!body.trim()} />
              )}
              {(c.status === "pending" || c.status === "failed" || deciding) && (
                <ActionButton label={c.status === "pending" ? "Analyse now" : "Analyse again"} variant="outline" onClick={() => onAnalyze(c)} busy={busy.has("analyze-" + c.plannedTicketId)} />
              )}
              {(c.status === "running" || c.status === "fixing") && (
                <ActionButton label="Watch" variant="outline" onClick={() => onWatch(c.ticketId)} />
              )}
              {c.status !== "running" && c.status !== "fixing" && (
                <ActionButton label="Dismiss" variant="ghost" onClick={() => onDismiss(c)} busy={busy.has("dismiss-" + c.id)} />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
