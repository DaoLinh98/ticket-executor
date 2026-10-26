"use client";

import { COLORS, FONT, chipShape } from "@/lib/ui";
import { IC, STAGE_STATUS, TONE, usd } from "@/lib/workflow/meta";
import type { LifecycleStage, RunChip, Tone } from "@/lib/workflow/types";
import { Ico, MONO } from "./parts";

type Props = {
  stages: LifecycleStage[];
  runKey: string | null;
  open: boolean;
  onToggle: () => void;
  mobileOpen: boolean;
  onMobileToggle: () => void;
  onOpenRun: (key: string) => void;
  onAction: (stage: LifecycleStage) => void;
};

const chipTone = (state: string): Tone =>
  ({ running: "accent", preparing: "accent", waiting: "warning", succeeded: "success", failed: "danger" } as Record<string, Tone>)[state] ?? "muted";

function StageIcon({ stage, size = 22 }: { stage: LifecycleStage; size?: number }) {
  const m = STAGE_STATUS[stage.status];
  return (
    <span style={{ ...chipShape(6), flex: "0 0 auto", width: size, height: size, display: "inline-flex", alignItems: "center", justifyContent: "center", background: TONE[m.tone].bg, color: TONE[m.tone].c }}>
      <Ico d={m.icon} size={13} sw={2.2} />
    </span>
  );
}

function Ticks({ stage, long }: { stage: LifecycleStage; long?: boolean }) {
  if (!stage.ticks) return null;
  return (
    <span style={{ display: "flex", gap: 4, marginTop: 3, flexWrap: "wrap" }}>
      {stage.ticks.map((t) => {
        const tone: Tone = t.ok ? "success" : "muted";
        return (
          <span key={t.short} title={t.t} style={{ ...chipShape(6), display: "inline-flex", alignItems: "center", gap: 2, padding: "1px 4px", fontSize: FONT.xs, background: TONE[tone].bg, color: TONE[tone].c }}>
            <Ico d={t.ok ? IC.check : IC.pending} size={9} sw={3} />
            {long ? t.t : t.short}
          </span>
        );
      })}
    </span>
  );
}

function RunChips({ runs, activeKey, onOpen, mobile }: { runs: RunChip[]; activeKey: string | null; onOpen: (k: string) => void; mobile?: boolean }) {
  if (!runs.length) return null;
  return (
    <span style={{ display: "flex", flexWrap: "wrap", gap: mobile ? 6 : 3, marginTop: mobile ? 6 : 3 }}>
      {runs.map((c) => {
        const tone = chipTone(c.state);
        const on = c.key === activeKey;
        return (
          <button
            key={c.key}
            type="button"
            aria-pressed={on}
            title={`Open ${c.flow} run`}
            className={mobile ? "te-wf-tap" : undefined}
            onClick={() => onOpen(c.key)}
            style={{ ...chipShape(6), height: mobile ? 40 : 22, display: "inline-flex", alignItems: "center", gap: mobile ? 6 : 4, padding: mobile ? "0 10px" : "0 6px", fontSize: mobile ? FONT.sm : FONT.xs, border: 0, cursor: "pointer", background: TONE[tone].bg, color: TONE[tone].c, boxShadow: on ? `inset 0 0 0 1px ${TONE[tone].c}` : "none" }}
          >
            <span aria-hidden="true" style={{ width: 6, height: 6, background: "currentColor" }} />
            <span style={{ fontFamily: MONO }}>{c.flow}</span>
            {mobile ? <span>{c.state}</span> : null}
            <span>{usd(c.cost)}</span>
          </button>
        );
      })}
    </span>
  );
}

export default function TicketLifecycle({ stages, runKey, open, onToggle, mobileOpen, onMobileToggle, onOpenRun, onAction }: Props) {
  const done = stages.filter((s) => s.status === "done").length;
  const live = stages.findIndex((s) => s.status === "active" || s.status === "blocked");
  const ci = live >= 0 ? live : Math.max(0, done - 1);
  const cur = stages[ci];
  const summary = `${done} of ${stages.length} stages done · ${cur.label}: ${cur.detail || "—"}`;
  const header = { borderBottom: `1px solid ${COLORS.border}`, background: COLORS.panelBg } as const;

  return (
    <>
      <section aria-label="Ticket lifecycle" className="te-wf-desk" style={{ flex: "0 0 auto", ...header }}>
        <div style={{ height: 36, display: "flex", alignItems: "center", gap: 10, padding: "0 16px" }}>
          <span style={{ flex: 1, minWidth: 0, fontSize: FONT.sm, color: COLORS.textDim, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{summary}</span>
          <button type="button" aria-expanded={open} onClick={onToggle} title={open ? "Hide the ticket's 9 lifecycle stages" : "Show the ticket's 9 lifecycle stages"} style={{ ...chipShape(6), flex: "0 0 auto", height: 28, display: "flex", alignItems: "center", gap: 6, padding: "0 10px", border: 0, cursor: "pointer", background: COLORS.panelBgDark, fontSize: FONT.sm, fontWeight: 600, color: COLORS.textSoft }}>
            Ticket lifecycle
            <Ico d={open ? IC.up : IC.down} size={14} />
          </button>
        </div>
        {open ? (
          <ol style={{ listStyle: "none", margin: 0, padding: "0 16px 10px", display: "grid", gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))`, minHeight: 108 }}>
            {stages.map((s, i) => {
              const m = STAGE_STATUS[s.status];
              const lineDone = i < stages.length - 1 && s.status === "done";
              return (
                <li key={s.id} style={{ position: "relative", minWidth: 0, paddingRight: 12 }}>
                  <span aria-hidden="true" style={{ position: "absolute", left: 26, right: 0, top: 11, height: 2, background: lineDone ? COLORS.success : COLORS.border }} />
                  <span style={{ position: "relative", display: "flex", alignItems: "center", gap: 6 }}>
                    <StageIcon stage={s} />
                    <span style={{ fontSize: FONT.sm, fontWeight: 600, whiteSpace: "nowrap", background: COLORS.panelBg, paddingRight: 6 }}>{s.label}</span>
                  </span>
                  <span style={{ display: "block", marginTop: 5, fontSize: FONT.xs, color: COLORS.textDim, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {m.text}
                    {s.at ? ` · ${s.at}` : ""}
                  </span>
                  <span title={s.detail} style={{ display: "block", fontSize: FONT.xs, color: s.status === "blocked" ? COLORS.danger : COLORS.textSoft, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {s.detail || "—"}
                  </span>
                  <Ticks stage={s} />
                  {s.action ? (
                    <button type="button" onClick={() => onAction(s)} style={{ ...chipShape(6), marginTop: 3, height: 22, padding: "0 6px", border: 0, fontSize: FONT.xs, fontWeight: 600, cursor: "pointer", maxWidth: "100%", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", background: TONE[m.tone].bg, color: TONE[m.tone].c }}>
                      {s.action} →
                    </button>
                  ) : null}
                  <RunChips runs={s.runs} activeKey={runKey} onOpen={onOpenRun} />
                </li>
              );
            })}
          </ol>
        ) : null}
      </section>

      <div className="te-wf-mob" style={{ position: "relative", zIndex: 8 }}>
        <section aria-label="Ticket lifecycle" style={header}>
          <button type="button" aria-expanded={mobileOpen} onClick={onMobileToggle} style={{ width: "100%", height: 44, border: 0, background: "none", display: "flex", alignItems: "center", gap: 8, padding: "0 12px", textAlign: "left", cursor: "pointer", color: COLORS.text }}>
            <StageIcon stage={cur} />
            <span style={{ flex: 1, minWidth: 0, fontSize: FONT.sm, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              <b>{cur.label}</b> · {cur.detail || "—"}
            </span>
            <span style={{ fontSize: FONT.xs, color: COLORS.textMuted }}>
              {ci + 1}/{stages.length}
            </span>
            <Ico d={mobileOpen ? IC.up : IC.down} size={16} />
          </button>
          {mobileOpen ? (
            <ol className="te-scroll" style={{ position: "absolute", left: 0, right: 0, top: 44, maxHeight: "60vh", overflow: "auto", listStyle: "none", margin: 0, padding: "8px 12px 12px", background: COLORS.panelBg, borderBottom: `1px solid ${COLORS.border}`, boxShadow: "var(--te-node-shadow)" }}>
              {stages.map((s, i) => {
                const m = STAGE_STATUS[s.status];
                return (
                  <li key={s.id} style={{ display: "flex", gap: 10, minHeight: 44 }}>
                    <span style={{ flex: "0 0 auto", display: "flex", flexDirection: "column", alignItems: "center" }}>
                      <StageIcon stage={s} />
                      <span aria-hidden="true" style={{ flex: 1, width: 2, minHeight: 10, background: i < stages.length - 1 && s.status === "done" ? COLORS.success : COLORS.border }} />
                    </span>
                    <span style={{ flex: 1, minWidth: 0, paddingBottom: 10 }}>
                      <span style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                        <b style={{ fontSize: FONT.base }}>{s.label}</b>
                        <span style={{ fontSize: FONT.xs, color: COLORS.textDim }}>
                          {m.text}
                          {s.at ? ` · ${s.at}` : ""}
                        </span>
                      </span>
                      <span style={{ display: "block", fontSize: FONT.sm, color: s.status === "blocked" ? COLORS.danger : COLORS.textSoft }}>{s.detail || "—"}</span>
                      <Ticks stage={s} long />
                      {s.action ? (
                        <button type="button" className="te-wf-tap" onClick={() => onAction(s)} style={{ ...chipShape(6), marginTop: 6, padding: "0 12px", border: 0, fontSize: FONT.sm, fontWeight: 600, cursor: "pointer", background: TONE[m.tone].bg, color: TONE[m.tone].c }}>
                          {s.action} →
                        </button>
                      ) : null}
                      <RunChips runs={s.runs} activeKey={runKey} onOpen={onOpenRun} mobile />
                    </span>
                  </li>
                );
              })}
            </ol>
          ) : null}
        </section>
      </div>
    </>
  );
}
