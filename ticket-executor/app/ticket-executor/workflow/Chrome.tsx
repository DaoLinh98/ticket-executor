"use client";

import { COLORS, FONT, chipShape, ctaButtonStyle, tabStyle } from "@/lib/ui";
import { IC, TONE } from "@/lib/workflow/meta";
import type { Banner, BannerAction, Hud } from "@/lib/workflow/present";
import type { GateResult } from "@/lib/workflow/types";
import { Badge, Ico, MONO } from "./parts";

const RETRY_ICON = "M21 12a9 9 0 1 1-3-6.7L21 8 M21 3v5h-5";

export type WorkflowMode = "flow" | "timeline" | "log";

const MODES: [WorkflowMode, string][] = [
  ["flow", "Flow"],
  ["timeline", "Timeline"],
  ["log", "Raw log"],
];

type HudProps = {
  hud: Hud;
  mode: WorkflowMode;
  onMode: (m: WorkflowMode) => void;
  canCancel: boolean;
  canRetry: boolean;
  onCancel: () => void;
  onRetry: () => void;
  mobileOpen: boolean;
  onMobileToggle: () => void;
};

function Metric({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span>
      <span style={{ display: "block", fontSize: FONT.xs, color: COLORS.textMuted }}>{label}</span>
      {children}
    </span>
  );
}

function CostBar({ hud, height = 8 }: { hud: Hud; height?: number }) {
  return (
    <span role="img" aria-label={hud.barAria} title={hud.barAria} style={{ display: "flex", height, background: COLORS.borderSubtle }}>
      {hud.bar.map((b) => (
        <span key={b.phase} style={{ height, width: `${b.pct}%`, background: `var(--te-phase-${b.phase})` }} />
      ))}
    </span>
  );
}

function ViewSwitch({ mode, onMode }: Pick<HudProps, "mode" | "onMode">) {
  return (
    <div role="tablist" aria-label="View" style={{ display: "flex", gap: 4 }}>
      {MODES.map(([k, label]) => (
        <button key={k} type="button" role="tab" aria-selected={mode === k} className="te-wf-tap" onClick={() => onMode(k)} style={tabStyle({ active: mode === k })}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function WorkflowHud(p: HudProps) {
  const { hud } = p;
  const t = TONE[hud.tone];
  return (
    <section aria-label="Run status" style={{ flex: "0 0 auto", borderBottom: `1px solid ${COLORS.border}`, background: COLORS.panelBg, padding: "0 16px" }}>
      <div style={{ minHeight: 56, display: "flex", alignItems: "center", gap: 12 }}>
        <Badge tone={hud.tone} icon={hud.icon}>
          {hud.stateText}
        </Badge>
        <span style={{ flex: "1 1 auto", minWidth: 0, display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: FONT.sm, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: t.c }}>{hud.node}</span>
          <span style={{ fontSize: FONT.xs, color: COLORS.textDim, fontFamily: MONO }}>
            {hud.flow} · {hud.elapsed}
          </span>
        </span>
        <span className="te-wf-desk" style={{ display: "flex", gap: 18, alignItems: "center" }}>
          <Metric label="Run cost">
            <b style={{ fontSize: FONT.base, fontFamily: MONO }}>{hud.cost}</b>
          </Metric>
          <Metric label="Tokens in / out">
            <span style={{ fontSize: FONT.sm, fontFamily: MONO }}>{hud.tokens}</span>
          </Metric>
          <Metric label="Fix round">
            <span style={{ fontSize: FONT.sm, fontFamily: MONO, color: hud.fixColor }}>{hud.fix}</span>
          </Metric>
          <span style={{ width: 170 }}>
            <span style={{ display: "block", fontSize: FONT.xs, color: COLORS.textMuted, marginBottom: 4 }}>Cost by phase</span>
            <CostBar hud={hud} />
          </span>
          <span style={{ width: 1, height: 28, background: COLORS.border }} />
          <ViewSwitch mode={p.mode} onMode={p.onMode} />
          {p.canCancel ? (
            <button type="button" onClick={p.onCancel} style={ctaButtonStyle("outline")}>
              Cancel run
            </button>
          ) : null}
          {p.canRetry ? (
            <button type="button" onClick={p.onRetry} style={{ ...ctaButtonStyle("primary"), display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Ico d={RETRY_ICON} size={14} sw={2.4} />
              Retry
            </button>
          ) : null}
        </span>
        <span className="te-wf-mob">
          <button type="button" aria-expanded={p.mobileOpen} aria-label="Run details" onClick={p.onMobileToggle} className="te-icon-btn" style={{ ...chipShape(6), width: 40, height: 40, border: `1px solid ${COLORS.border}`, background: COLORS.panelBgDark, color: COLORS.text, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <Ico d={p.mobileOpen ? IC.up : IC.down} size={16} />
          </button>
        </span>
      </div>
      {p.mobileOpen ? (
        <div className="te-wf-mob">
          <div className="te-wf-hud-grid" style={{ display: "grid", gap: 8, padding: "2px 0 8px" }}>
            <Metric label="Run cost">
              <b style={{ fontSize: FONT.base, fontFamily: MONO }}>{hud.cost}</b>
            </Metric>
            <Metric label="Tokens in/out">
              <span style={{ fontSize: FONT.sm, fontFamily: MONO }}>{hud.tokens}</span>
            </Metric>
            <Metric label="Fix round">
              <span style={{ fontSize: FONT.sm, fontFamily: MONO, color: hud.fixColor }}>{hud.fix}</span>
            </Metric>
          </div>
          <CostBar hud={hud} />
          <span style={{ display: "block", fontSize: FONT.xs, color: COLORS.textMuted, marginTop: 3 }}>{hud.barAria}</span>
          <div style={{ display: "flex", gap: 6, padding: "8px 0 10px", flexWrap: "wrap" }}>
            <ViewSwitch mode={p.mode} onMode={p.onMode} />
            {p.canCancel ? (
              <button type="button" className="te-action-btn" onClick={p.onCancel} style={ctaButtonStyle("outline", { height: "40px" })}>
                Cancel
              </button>
            ) : null}
            {p.canRetry ? (
              <button type="button" className="te-action-btn" onClick={p.onRetry} style={{ ...ctaButtonStyle("primary", { height: "40px" }), display: "inline-flex", alignItems: "center", gap: 6 }}>
                <Ico d={RETRY_ICON} size={14} sw={2.4} />
                Retry
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

export function StateBanner({ banner, copied, onAction }: { banner: Banner; copied: boolean; onAction: (a: BannerAction) => void }) {
  const t = TONE[banner.tone];
  const action = banner.action;
  return (
    <section role="status" style={{ flex: "0 0 auto", minHeight: 44, display: "flex", alignItems: "center", flexWrap: "wrap", gap: "6px 10px", padding: "6px 16px", background: t.bg, borderBottom: `1px solid ${t.c}` }}>
      <span style={{ color: t.c, display: "inline-flex" }}>
        <Ico d={banner.icon} size={16} />
      </span>
      <span style={{ flex: "1 1 200px", minWidth: 0, fontSize: FONT.sm }}>
        <b style={{ color: t.c }}>{banner.title}</b> <span style={{ color: COLORS.textSoft }}>{banner.text}</span>
      </span>
      {banner.countdown ? (
        <span aria-live="polite" style={{ ...chipShape(6), padding: "3px 8px", fontSize: FONT.base, fontWeight: 500, fontFamily: MONO, background: COLORS.panelBg, color: t.c }}>
          {banner.countdown}
        </span>
      ) : null}
      {action ? (
        <button type="button" className="te-action-btn" onClick={() => onAction(action)} style={ctaButtonStyle(banner.tone === "danger" ? "danger" : "warning")}>
          {action.kind === "copy-questions" && copied ? "Copied ✓" : action.label}
        </button>
      ) : null}
    </section>
  );
}

export function RefusalCard({ gate, open, onToggle, onRecheck }: { gate: GateResult; open: boolean; onToggle: () => void; onRecheck: () => void }) {
  return (
    <section role="alert" style={{ ...chipShape(8), flex: "0 0 auto", margin: "8px 16px", padding: "10px 12px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, background: "var(--te-danger-soft)", border: `1px solid ${COLORS.danger}` }}>
      <span style={{ ...chipShape(6), flex: "0 0 auto", width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", background: COLORS.danger, color: COLORS.panelBg }}>
        <Ico d={IC.barrier} size={16} />
      </span>
      <span style={{ flex: "1 1 220px", minWidth: 0 }}>
        <b style={{ display: "block", fontSize: FONT.base, color: COLORS.danger }}>Run refused at Admission — no run was started, $0 spent</b>
        <span style={{ display: "block", fontSize: FONT.sm, color: COLORS.textSoft }}>{gate.reason}</span>
        {open && gate.howTo ? <span style={{ display: "block", marginTop: 4, fontSize: FONT.sm, color: COLORS.text }}>{gate.howTo}</span> : null}
      </span>
      <span style={{ fontSize: FONT.xs, color: COLORS.textMuted }}>Checked {gate.at} · stays until fixed</span>
      <button type="button" aria-expanded={open} className="te-action-btn" onClick={onToggle} style={ctaButtonStyle("danger")}>
        Fix it
      </button>
      <button type="button" className="te-action-btn" onClick={onRecheck} style={ctaButtonStyle("outline")}>
        Re-check gates
      </button>
    </section>
  );
}
