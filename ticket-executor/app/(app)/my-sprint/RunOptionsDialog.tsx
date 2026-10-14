"use client";

import { useEffect, useState } from "react";
import { COLORS, FONT, displayText, modalOverlayStyle, modalShellStyle, sectionCaption } from "@/lib/ui";
import { CLAUDE_EFFORTS, CLAUDE_MODELS, DEFAULT_PLAN_EFFORT, DEFAULT_PLAN_MODEL, modelIdForLabel, modelLabel, resolveModelId } from "@/lib/claudeOptions";
import { useClaudeModels } from "../../queries";
import SelectMenu from "../../SelectMenu";
import ActionButton from "./ActionButton";

export default function RunOptionsDialog({
  ticketId,
  model,
  effort,
  busy,
  onSave,
  onCancel,
}: {
  ticketId: string;
  model: string;
  effort: string;
  busy: boolean;
  onSave: (model: string, effort: string) => void;
  onCancel: () => void;
}) {
  const models = useClaudeModels().data?.models;
  const options = models?.length ? models : CLAUDE_MODELS;
  const [pickedModel, setPickedModel] = useState(model || DEFAULT_PLAN_MODEL);
  const [pickedEffort, setPickedEffort] = useState(effort || DEFAULT_PLAN_EFFORT);
  const shownModel = resolveModelId(pickedModel, options);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="te-modal-overlay" style={modalOverlayStyle({ zIndex: 60 })} onClick={onCancel}>
      <div
        className="te-modal-shell"
        role="dialog"
        aria-modal="true"
        aria-label={`Run settings for #${ticketId}`}
        onClick={(e) => e.stopPropagation()}
        style={{ ...modalShellStyle(), width: "min(420px, 100%)", maxHeight: "100%", overflowY: "auto", padding: "20px", display: "flex", flexDirection: "column", gap: "14px" }}
      >
        <span style={displayText("heading")}>Run settings · #{ticketId}</span>
        <span style={{ fontSize: FONT.md, color: COLORS.textMuted, lineHeight: 1.6 }}>
          The automatic implement run for this ticket starts with this model and effort.
        </span>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <span style={sectionCaption()}>MODEL</span>
          <SelectMenu
            value={modelLabel(shownModel, options)}
            onChange={(v) => setPickedModel(modelIdForLabel(v, options))}
            options={options.map((m) => m.label)}
            ariaLabel="Claude model"
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <span style={sectionCaption()}>EFFORT</span>
          <SelectMenu value={pickedEffort} onChange={setPickedEffort} options={[...CLAUDE_EFFORTS]} ariaLabel="Claude effort" />
        </div>
        <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", flexWrap: "wrap" }}>
          <ActionButton label="Cancel" variant="ghost" onClick={onCancel} disabled={busy} />
          <ActionButton label="Save" variant="primary" onClick={() => onSave(shownModel, pickedEffort)} busy={busy} />
        </div>
      </div>
    </div>
  );
}
