"use client";

import type { MouseEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { FileChange } from "@/lib/types";
import { COLORS, FONT, card, pill, ringBorder, sectionCaption, tintedCard } from "@/lib/ui";
import type { ExecView, ResultSection } from "../types";
import { formatCost, formatTokenCount } from "../helpers";
import { useBoltsContext } from "../../BoltsContext";

type Props = {
  exec: ExecView;
  sections: ResultSection[];
  showSectionHeader: boolean;
  onOpenDiff: (file: FileChange) => void;
  onOpenPr: (e: MouseEvent) => void;
};

// ---- reading the run's contract ----
//
// Everything below comes from `exec.channels` — each node's *validated*
// structured output — rather than from the prose summary. That is the whole
// point of the contract: what the agent verified, what it assumed and where it
// left the plan are typed fields, so they can be shown as facts instead of being
// buried in a paragraph the reader has to trust.
//
// The nodes are found by the shape of their output, not by id: the delivering
// node is whichever one reports `committed`, the publishing node whichever
// reports `pushed`. That holds for both graph shapes — v3's implement/publish
// pair and v2's single `deliver` node — with no list of node names to keep in
// sync as graphs change.
type Bag = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const rows = (v: unknown): Bag[] => (Array.isArray(v) ? (v as Bag[]) : []);

/** A verification verdict as a pill: green when it actually passed, red when a
 *  check ran and failed, muted when it never ran. "not-run" is deliberately not
 *  an alarm — plenty of repos have no test command — but it must not read as a
 *  pass either. */
function verdictPill(label: string, value: string) {
  if (!value) return null;
  const good = value === "passed" || value === "met";
  const bad = value === "failed";
  const color = good ? COLORS.success : bad ? COLORS.danger : COLORS.faint;
  return (
    <span key={label} style={pill({ color, border: COLORS.border, size: "sm" })}>
      {label} {value}
    </span>
  );
}

/** A list of {title, detail} pairs — assumptions the agent made, or places it
 *  diverged from the approved plan. Both are things a reviewer needs before
 *  reading the diff, and both used to be reported to nobody. */
function NoteList({ caption, items }: { caption: string; items: { title: string; detail: string }[] }) {
  if (!items.length) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
      <div style={sectionCaption()}>{caption} ({items.length})</div>
      {items.map((it, i) => (
        <div key={i} style={card()}>
          <div style={{ fontSize: FONT.md, color: COLORS.text }}>{it.title}</div>
          {it.detail && (
            <div style={{ fontSize: FONT.sm, color: COLORS.textMuted, marginTop: "3px", lineHeight: 1.55 }}>{it.detail}</div>
          )}
        </div>
      ))}
    </div>
  );
}

// Completion banner (branch / PR chips) plus one markdown block per completed run.
export default function ResultTab({ exec: ex, sections, showSectionHeader, onOpenDiff, onOpenPr }: Props) {
  const { fireBoltFromEvent } = useBoltsContext();
  const totalTokens = (ex.inputTokens ?? 0) + (ex.outputTokens ?? 0);
  // Which account footed the bill. Empty means EmeHub was off and the run used
  // this machine's own `claude` login — the original behaviour, and not something
  // to label, since there is no second account it could have been.
  const accountLabel =
    ex.claudeSource === "shared" ? "EmeHub · shared account"
      : ex.claudeSource === "own" ? "EmeHub · your account"
        : "";
  const hasUsage = (ex.costUsd ?? 0) > 0 || totalTokens > 0 || !!accountLabel;

  const channels: Bag[] = Object.values(ex.channels ?? {});
  const delivered = channels.find((c) => typeof c.committed === "boolean");
  const published = channels.find((c) => typeof c.pushed === "boolean");
  const verification = (delivered?.verification ?? {}) as Bag;
  const verdicts = [
    verdictPill("Tests", str(verification.tests)),
    verdictPill("Build", str(verification.build)),
    verdictPill("Acceptance criteria", str(verification.acceptanceCriteria)),
  ].filter(Boolean);
  const threadsReplied = typeof published?.threadsReplied === "number" ? published.threadsReplied : null;
  const threadsResolved = typeof published?.threadsResolved === "number" ? published.threadsResolved : null;
  const reported =
    verdicts.length > 0 ||
    typeof published?.linked === "boolean" ||
    published?.reusedExisting === true ||
    threadsReplied !== null;
  const deviations = rows(delivered?.deviations).map((d) => ({ title: str(d.what), detail: str(d.why) }));
  const assumptions = channels
    .flatMap((c) => rows(c.assumptions))
    .map((a) => ({ title: str(a.item), detail: str(a.reasoning) }));
  return (
    <div style={{ maxWidth: "800px", display: "flex", flexDirection: "column", gap: "26px", animation: "fadeUp .35s both" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "14px", ...tintedCard("success", { padding: "16px 18px", radius: "13px" }) }}>
        <span style={{ flex: "0 0 auto", width: "40px", height: "40px", borderRadius: "11px", background: "rgba(53,214,164,.14)", border: "1px solid #35D6A4", display: "flex", alignItems: "center", justifyContent: "center" }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#35D6A4" strokeWidth="2.6"><path d="M5 13l4 4L19 7" style={{ strokeDasharray: 26, strokeDashoffset: 26, animation: "draw .6s .2s ease forwards" }} /></svg></span>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: "var(--font-space), sans-serif", fontSize: FONT.lg, fontWeight: 700, color: "#F3F5F9" }}>Implementation complete</div>
          <div style={{ fontSize: FONT.base, color: "#8A90A0", marginTop: "2px" }}>Finished{ex.duration ? <> in <span style={{ color: "#C7CCD8", fontWeight: 600 }}>{ex.duration}</span></> : ""} · Claude Code output below</div>
          {hasUsage && (
            <div style={{ display: "flex", gap: "7px", marginTop: "9px", flexWrap: "wrap" }}>
              {ex.duration && (
                <span style={pill({ color: COLORS.text, background: "rgba(255,255,255,.04)", border: COLORS.border, size: "sm" })}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 3.5" /></svg>
                  {ex.duration}
                </span>
              )}
              {(ex.costUsd ?? 0) > 0 && (
                <span style={pill({ color: COLORS.success, background: "rgba(53,214,164,.09)", border: "#24382F", size: "sm" })}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="12" cy="12" r="9" /><path d="M12 7v10M9.5 9.5c0-1.4 1.2-2 2.5-2s2.5.7 2.5 2-1.2 1.7-2.5 2-2.5.6-2.5 2 1.2 2 2.5 2 2.5-.6 2.5-2" /></svg>
                  {formatCost(ex.costUsd!)}
                </span>
              )}
              {totalTokens > 0 && (
                <span style={pill({ color: COLORS.info, background: "rgba(91,157,255,.09)", border: "#26314A", size: "sm" })}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M12 2 2 7l10 5 10-5-10-5Z" /><path d="M2 17l10 5 10-5M2 12l10 5 10-5" /></svg>
                  {formatTokenCount(totalTokens)} tokens
                </span>
              )}
              {accountLabel && (
                <span style={pill({ color: COLORS.warning, background: "rgba(245,179,65,.09)", border: "#3A3222", size: "sm" })}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="12" cy="8" r="3.6" /><path d="M4.5 20a7.5 7.5 0 0 1 15 0" /></svg>
                  {accountLabel}
                </span>
              )}
            </div>
          )}
        </div>
        {ex.branch && (
          <span
            title="Branch"
            style={{
              fontFamily: "var(--font-mono), monospace",
              maxWidth: "220px",
              overflow: "hidden",
              whiteSpace: "nowrap",
              textOverflow: "ellipsis",
              ...pill({ color: COLORS.indigo, background: "rgba(155,166,232,.08)", border: "#2E3450", size: "md" }),
              gap: "6px",
              padding: "5px 10px",
              fontWeight: 400,
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flex: "0 0 auto" }}><circle cx="6" cy="6" r="2.5" /><circle cx="6" cy="18" r="2.5" /><circle cx="18" cy="8" r="2.5" /><path d="M6 8.5v7M18 10.5c0 3-3 3.5-6 3.5" /></svg>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{ex.branch}</span>
          </span>
        )}
        {ex.prUrl && (
          <a
            href={ex.prUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onOpenPr}
            style={{
              flex: "0 0 auto",
              display: "inline-flex",
              alignItems: "center",
              gap: "7px",
              height: "32px",
              padding: "0 14px",
              textDecoration: "none",
              color: "#5BE8B8",
              fontSize: FONT.sm,
              fontWeight: 700,
              cursor: "pointer",
              // Opaque fill so the spinning conic-gradient stays confined to the
              // border ring, matching the subtle tab/CTA glow instead of bleeding
              // through the translucent fill as a harsh diagonal sweep.
              ...ringBorder({ fill: "#162F2C", ring: COLORS.success, highlight: "#baf5e3", duration: 3 }),
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><path d="M15 3h6v6M10 14L21 3" /></svg>
            Open PR
          </a>
        )}
      </div>
      {reported && (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <div style={sectionCaption()}>What the run reported</div>
          <div style={{ display: "flex", gap: "7px", flexWrap: "wrap" }}>
            {verdicts}
            {typeof published?.linked === "boolean" && (
              <span style={pill({ color: published.linked ? COLORS.success : COLORS.warning, border: COLORS.border, size: "sm" })}>
                {published.linked ? "Ticket linked to PR" : "Ticket not linked"}
              </span>
            )}
            {published?.reusedExisting === true && (
              <span style={pill({ color: COLORS.info, border: COLORS.border, size: "sm" })}>Reused existing PR</span>
            )}
            {threadsReplied !== null && (
              <span style={pill({ color: COLORS.indigo, border: COLORS.border, size: "sm" })}>{threadsReplied} thread{threadsReplied === 1 ? "" : "s"} replied</span>
            )}
            {threadsResolved !== null && (
              <span style={pill({ color: COLORS.indigo, border: COLORS.border, size: "sm" })}>{threadsResolved} resolved</span>
            )}
          </div>
        </div>
      )}
      <NoteList caption="Deviations from the approved plan" items={deviations} />
      <NoteList caption="Assumptions the agent made" items={assumptions} />
      {sections.map((rs) => (
        <div key={rs.key}>
          {showSectionHeader && (
            <h2 style={{ margin: "0 0 10px", fontFamily: "var(--font-space), sans-serif", fontSize: FONT.base, fontWeight: 700, letterSpacing: ".06em", color: "var(--accent)", textTransform: "uppercase" }}>{rs.title}</h2>
          )}
          <div className="md-body">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{rs.markdown}</ReactMarkdown>
          </div>
          {rs.filesChanged.length > 0 && (
            <div style={{ marginTop: "14px", display: "flex", flexDirection: "column", gap: "6px" }}>
              <div style={sectionCaption()}>Files changed ({rs.filesChanged.length})</div>
              {rs.filesChanged.map((fc) => (
                <button
                  key={fc.path}
                  onClick={(e) => { fireBoltFromEvent(e); onOpenDiff(fc); }}
                  style={{ display: "flex", alignItems: "center", gap: "9px", width: "100%", textAlign: "left", padding: "8px 11px", borderRadius: "9px", cursor: "pointer", ...ringBorder({ fill: "#111419", duration: 4.5, cornerPx: 7 }) }}
                >
                  <span style={{
                    fontFamily: "var(--font-mono), monospace", fontSize: FONT.xs, fontWeight: 700, flex: "0 0 auto", width: "16px", textAlign: "center",
                    color: fc.changeType === "added" ? "#35D6A4" : fc.changeType === "deleted" ? "#FF6B6B" : fc.changeType === "renamed" ? "#9BA6E8" : "#F5B341",
                  }}>
                    {fc.changeType === "added" ? "A" : fc.changeType === "deleted" ? "D" : fc.changeType === "renamed" ? "R" : "M"}
                  </span>
                  <span style={{ fontFamily: "var(--font-mono), monospace", fontSize: FONT.base, color: "#C7CCD8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{fc.path}</span>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#5B6273" strokeWidth="2" style={{ flex: "0 0 auto" }}><path d="M9 6l6 6-6 6" /></svg>
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
