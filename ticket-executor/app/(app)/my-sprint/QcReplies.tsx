import LoadingRing from "../../ticket-executor/LoadingRing";
import { COLORS, FONT, card, fieldInput, pill, sectionCaption } from "@/lib/ui";
import ActionButton from "./ActionButton";
import type { QaDraft } from "./model";

export default function QcReplies({
  drafts,
  edits,
  busy,
  onEdit,
  onPost,
  onDismiss,
}: {
  drafts: QaDraft[];
  edits: Record<string, string>;
  busy: ReadonlySet<string>;
  onEdit: (id: string, body: string) => void;
  onPost: (draft: QaDraft) => void;
  onDismiss: (draft: QaDraft) => void;
}) {
  if (drafts.length === 0) return null;
  return (
    <div id="qc-replies" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <span style={sectionCaption()}>QC REPLIES</span>
      {drafts.map((d) => {
        const body = edits[d.id] ?? d.body;
        return (
          <div key={d.id} style={{ ...card({ padding: "14px 16px" }), display: "flex", flexDirection: "column", gap: "10px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              <span style={{ fontSize: FONT.base, color: COLORS.text, fontWeight: 700 }}>#{d.ticketId}</span>
              {d.status === "running" && <LoadingRing size={14} />}
              {d.status === "running" && <span style={{ fontSize: FONT.sm, color: COLORS.textMuted }}>Drafting…</span>}
              {d.fixNeeded && <span style={pill({ color: COLORS.danger, size: "xs", weight: 700 })}>Reports a bug</span>}
              {d.needsHuman && <span style={pill({ color: COLORS.warning, size: "xs", weight: 700 })}>Needs your decision</span>}
            </div>
            {d.summary && <span style={{ fontSize: FONT.sm, color: COLORS.textMuted, lineHeight: 1.6 }}>{d.summary}</span>}
            {d.status === "failed" && (
              <span style={{ fontSize: FONT.sm, color: COLORS.danger }}>{d.errorMessage || "The draft could not be written."}</span>
            )}
            {d.status === "ready" && (
              <textarea
                value={body}
                onChange={(e) => onEdit(d.id, e.target.value)}
                rows={4}
                style={{ ...fieldInput(), minHeight: "96px", resize: "vertical", lineHeight: 1.5 }}
              />
            )}
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              {d.status === "ready" && (
                <ActionButton label="Post reply" variant="primary" onClick={() => onPost(d)} busy={busy.has("post-" + d.id)} disabled={!body.trim()} />
              )}
              {d.status !== "running" && (
                <ActionButton label="Dismiss" variant="ghost" onClick={() => onDismiss(d)} busy={busy.has("dismiss-" + d.id)} />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
