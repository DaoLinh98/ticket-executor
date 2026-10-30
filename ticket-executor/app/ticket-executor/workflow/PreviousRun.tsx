"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { COLORS, FONT, card, sectionCaption } from "@/lib/ui";
import { TONE } from "@/lib/workflow/meta";
import type { RunDiff, RunEnd } from "@/lib/workflow/present";
import type { Tone } from "@/lib/workflow/types";
import { MONO } from "./parts";

const PLAN_TEXT: Record<RunDiff["plan"], [string, Tone]> = {
  same: ["Unchanged — the same plan was reused", "muted"],
  changed: ["Changed — re-planned", "info"],
  new: ["New — the previous run never planned", "info"],
  none: ["No plan in this run yet", "muted"],
};

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div style={{ display: "contents" }}>
      <dt style={{ color: COLORS.textMuted }}>{k}</dt>
      <dd style={{ margin: 0, minWidth: 0, wordBreak: "break-word" }}>{children}</dd>
    </div>
  );
}

function End({ label, end }: { label: string; end: RunEnd }) {
  return (
    <span style={{ display: "block" }}>
      <span style={{ color: COLORS.textMuted }}>{label} </span>
      <b style={{ color: TONE[end.tone].c }}>{end.state}</b>
      {end.reason ? <span style={{ color: COLORS.textSoft }}> — {end.reason}</span> : null}
    </span>
  );
}

function Items({ mark, tone, items }: { mark: string; tone: Tone; items: string[] }) {
  return (
    <>
      {items.map((t, i) => (
        <span key={i} style={{ display: "flex", gap: 6, color: COLORS.textSoft }}>
          <span style={{ flex: "0 0 12px", color: TONE[tone].c, fontFamily: MONO }}>{mark}</span>
          <span style={{ minWidth: 0 }}>{t}</span>
        </span>
      ))}
    </>
  );
}

/** "Since the previous run": how a retry compares with the run it retried. */
export default function PreviousRun({ prevId, diff, onOpen }: { prevId: string; diff: RunDiff | null; onOpen: () => void }) {
  const b = diff?.blockers;
  return (
    <section aria-label="Since the previous run" style={{ ...card({ padding: "10px 12px" }), marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <b style={{ ...sectionCaption(), flex: 1, fontSize: FONT.xs }}>Since the previous run</b>
        <Link href={`/workflow?run=${prevId}`} onClick={onOpen} className="te-run-pr te-wf-tap" style={{ display: "inline-flex", alignItems: "center", padding: "2px 8px", borderRadius: 999, fontSize: FONT.xs, color: COLORS.text, textDecoration: "none" }}>
          Previous run →
        </Link>
      </div>
      {!diff ? (
        <p style={{ margin: "8px 0 0", fontSize: FONT.sm, color: COLORS.textMuted }}>Reading the previous run…</p>
      ) : (
        <dl style={{ margin: "8px 0 0", display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", gap: "6px 12px", fontSize: FONT.sm }}>
          <Row k="Ended">
            <End label="Before" end={diff.prev} />
            <End label="Now" end={diff.cur} />
          </Row>
          <Row k="Plan">
            <span style={{ color: TONE[PLAN_TEXT[diff.plan][1]].c }}>{PLAN_TEXT[diff.plan][0]}</span>
          </Row>
          {b ? (
            <Row k="Blockers">
              {b.pending ? (
                <span style={{ color: COLORS.textMuted }}>Not reviewed yet in this run.</span>
              ) : (
                <>
                  <span style={{ display: "block", color: COLORS.textSoft }}>
                    {b.resolved.length} resolved · {b.standing.length} still standing · {b.added.length} new
                  </span>
                  <Items mark="✓" tone="success" items={b.resolved} />
                  <Items mark="•" tone="warning" items={b.standing} />
                  <Items mark="+" tone="danger" items={b.added} />
                </>
              )}
            </Row>
          ) : null}
          <Row k="Cost">
            <span style={{ fontFamily: MONO }}>
              {diff.prev.cost} → {diff.cur.cost} <span style={{ color: COLORS.textMuted }}>({diff.delta})</span>
            </span>
          </Row>
        </dl>
      )}
    </section>
  );
}
