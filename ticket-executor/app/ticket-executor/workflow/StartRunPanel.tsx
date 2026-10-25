"use client";

import { COLORS, FONT, card, ctaButtonStyle, fieldInput, fieldLabel } from "@/lib/ui";
import LoadingRing from "../LoadingRing";

export type StartForm = { ticketId: string; ticketUrl: string; project: string; rootRepo: string; provider: string };

type Props = {
  form: StartForm;
  busy: boolean;
  onChange: (p: Partial<StartForm>) => void;
  onSubmit: () => void;
  onClose: () => void;
};

const FIELDS: { key: keyof StartForm; label: string; placeholder: string }[] = [
  { key: "ticketId", label: "Ticket id", placeholder: "4182" },
  { key: "ticketUrl", label: "Ticket URL", placeholder: "optional — https://dev.azure.com/…" },
  { key: "project", label: "Project", placeholder: "billing" },
  { key: "rootRepo", label: "Root repo", placeholder: "C:\\src\\billing-api" },
  { key: "provider", label: "Provider", placeholder: "azure-devops" },
];

export default function StartRunPanel({ form, busy, onChange, onSubmit, onClose }: Props) {
  const ready = !!form.ticketId.trim() && !!form.rootRepo.trim() && !!form.project.trim();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (ready && !busy) onSubmit();
      }}
      style={{ ...card({ padding: "14px 16px" }), margin: "10px 16px 0", display: "flex", flexDirection: "column", gap: 12 }}
    >
      <div style={{ fontSize: FONT.base, fontWeight: 600, color: COLORS.text }}>Start a D-Agent run</div>
      <div className="te-grid-3" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
        {FIELDS.map((f) => (
          <label key={f.key} style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
            <span style={{ ...fieldLabel(), fontSize: FONT.sm }}>{f.label}</span>
            <input value={form[f.key]} placeholder={f.placeholder} onChange={(e) => onChange({ [f.key]: e.target.value })} style={{ ...fieldInput(), width: "100%", minWidth: 0 }} />
          </label>
        ))}
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button type="submit" className="te-action-btn" disabled={!ready || busy} style={{ ...ctaButtonStyle("warning", { height: "40px" }), opacity: ready ? 1 : 0.5 }}>
          {busy ? <LoadingRing size={14} /> : null}
          Start run
        </button>
        <button type="button" className="te-action-btn" onClick={onClose} style={ctaButtonStyle("outline", { height: "40px" })}>
          Close
        </button>
      </div>
    </form>
  );
}
