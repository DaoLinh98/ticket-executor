"use client";

import { AnimatePresence } from "motion/react";
import { MenuPanel } from "../MenuPanel";
import { useEffect, useRef, useState } from "react";
import { useClaudeUsage } from "../queries";
import { pctText, type QuotaWindow } from "@/lib/claudeQuota";
import { COLORS, FONT, SURFACE, dropdownPanelStyle, ringBorder, sectionCaption } from "@/lib/ui";

const MONO = "var(--font-mono), monospace";

/** Green until the window is mostly spent, then amber, then red — the colour answers "can I start another run?". */
const toneOf = (pct: number) => (pct >= 90 ? COLORS.danger : pct >= 70 ? COLORS.warning : COLORS.success);

function resetText(iso: string | null, now = Date.now()): string {
  if (!iso) return "";
  const ms = Date.parse(iso) - now;
  if (!(ms > 0)) return "resets now";
  const m = Math.round(ms / 60_000);
  if (m < 60) return `resets in ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `resets in ${h}h ${m % 60}m`;
  return `resets ${new Date(iso).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}`;
}

function Bar({ pct }: { pct: number }) {
  return (
    <span role="img" aria-label={`${pctText(pct)} used`} style={{ display: "block", height: 6, background: COLORS.borderSubtle, borderRadius: 3, overflow: "hidden" }}>
      <span style={{ display: "block", height: 6, width: `${Math.max(pct, pct > 0 ? 2 : 0)}%`, background: toneOf(pct) }} />
    </span>
  );
}

function Row({ label, w }: { label: string; w: QuotaWindow }) {
  return (
    <div style={{ padding: "8px 10px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 5 }}>
        <span style={{ fontSize: FONT.sm, fontWeight: 600, color: COLORS.text }}>{label}</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: MONO, fontSize: FONT.sm, fontWeight: 700, color: toneOf(w.pct) }}>{pctText(w.pct)}</span>
      </div>
      <Bar pct={w.pct} />
      {w.resetsAt ? <div style={{ fontSize: FONT.xs, color: COLORS.textMuted, marginTop: 4 }}>{resetText(w.resetsAt)}</div> : null}
    </div>
  );
}

/**
 * The Claude account's usage, in every page's header: the 5-hour session at a glance, the weekly total (and a
 * per-model weekly one where the plan has it) in the panel. The account is the one the next turn would run as.
 */
export default function UsageMeter() {
  const { data, isError, refetch, isFetching } = useClaudeUsage();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const q = data?.quota ?? null;
  const main = q?.session ?? q?.week ?? null;
  const unreadable = !q && !isError && data !== undefined;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title={main ? `Claude usage — ${q?.session ? "5-hour session" : "weekly"} ${pctText(main.pct)} used` : "Claude usage — not available"}
        style={{ display: "flex", alignItems: "center", gap: 7, height: 30, padding: "0 10px", color: COLORS.textDim, cursor: "pointer", ...ringBorder({ fill: SURFACE.modal, duration: 3.4, cornerPx: 7 }) }}
      >
        <span style={{ width: 34 }}>{main ? <Bar pct={main.pct} /> : <span style={{ display: "block", height: 6, background: COLORS.borderSubtle, borderRadius: 3 }} />}</span>
        <span style={{ fontFamily: MONO, fontSize: FONT.sm, fontWeight: 700, color: main ? toneOf(main.pct) : COLORS.faint }}>{main ? pctText(main.pct) : "—"}</span>
      </button>
      <AnimatePresence>
      {open && (
        <MenuPanel className="te-scroll te-notif-panel" style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, zIndex: 40, width: "300px", ...dropdownPanelStyle({ maxHeight: "420px" }) }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px 8px", borderBottom: `1px solid ${COLORS.borderSubtle}` }}>
            <span style={sectionCaption()}>Claude usage</span>
            <span style={{ flex: 1 }} />
            <button type="button" onClick={() => refetch()} disabled={isFetching} style={{ minHeight: 40, padding: "0 6px", border: "none", background: "transparent", fontSize: FONT.xs, fontWeight: 600, color: COLORS.textDim, cursor: "pointer" }}>
              {isFetching ? "Refreshing…" : "Refresh"}
            </button>
          </div>
          {q ? (
            <>
              {q.session ? <Row label="Session · 5 hours" w={q.session} /> : null}
              {q.week ? <Row label="Weekly · all models" w={q.week} /> : null}
              {q.weekSonnet ? <Row label="Weekly · Sonnet" w={q.weekSonnet} /> : null}
              {q.weekOpus ? <Row label="Weekly · Opus" w={q.weekOpus} /> : null}
              {data?.account ? <div style={{ fontSize: FONT.xs, color: COLORS.faint, padding: "6px 10px 8px" }}>Account: {data.account}</div> : null}
            </>
          ) : (
            <div style={{ padding: "14px 12px", fontSize: FONT.sm, color: COLORS.textMuted, lineHeight: 1.5 }}>
              {unreadable || isError
                ? "Usage could not be read for the account runs use — its token may be missing the usage scope, or Anthropic did not answer."
                : "Reading usage…"}
            </div>
          )}
        </MenuPanel>
      )}
      </AnimatePresence>
    </div>
  );
}
