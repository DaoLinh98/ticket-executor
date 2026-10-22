"use client";

import { memo, useEffect, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { LogLine } from "@/lib/types";
import { activityStats, filterActivity, fmtMs, groupActivity, type ActivityFilter, type ActivityItem } from "@/lib/runTrace";
import { COLORS, FONT, SURFACE, card, fieldInput, pill, sectionCaption, tabStyle, toneTint } from "@/lib/ui";
import { MiniIcon } from "./icons";

type Props = {
  lines: LogLine[];
  stepStartedAt: string;
  running: boolean;
  filter: ActivityFilter;
  query: string;
  follow: boolean;
  onFilter: (f: ActivityFilter) => void;
  onQuery: (q: string) => void;
  onFollow: (on: boolean) => void;
};

function offset(t: number | undefined, start: number): string {
  return t && Number.isFinite(start) ? `+${fmtMs(Math.max(0, t - start))}` : "";
}

function Stamp({ text }: { text: string }) {
  return text ? <span style={{ flex: "0 0 auto", fontSize: FONT.xs, color: COLORS.faint, fontFamily: "var(--font-mono), monospace" }}>{text}</span> : null;
}

const KIND_COLOR: Record<string, string> = {
  cmd: COLORS.accent,
  step: COLORS.text,
  ok: COLORS.success,
  muted: COLORS.textMuted,
  file: COLORS.indigo,
  diff: COLORS.textDim,
  err: COLORS.danger,
  fail: COLORS.danger,
  done: COLORS.success,
};

const BOLD_KINDS = new Set(["cmd", "done", "fail"]);

const termLine = { margin: 0, fontFamily: "var(--font-mono), monospace", fontSize: FONT.base, lineHeight: 1.75, whiteSpace: "pre-wrap" as const, wordBreak: "break-word" as const };

function lineStyle(l: LogLine) {
  return { ...termLine, color: KIND_COLOR[l.kind] ?? (l.isError ? COLORS.danger : COLORS.textSoft), fontWeight: BOLD_KINDS.has(l.kind) ? 600 : 400 };
}

function TermLine({ line, start, indent }: { line: LogLine; start: number; indent?: boolean }) {
  return (
    <div style={{ display: "flex", gap: "12px", alignItems: "baseline" }}>
      <span style={{ ...lineStyle(line), flex: 1, minWidth: 0, paddingLeft: indent ? "16px" : 0 }}>{line.text}</span>
      <Stamp text={offset(line.t, start)} />
    </div>
  );
}

function Row({ item, start }: { item: ActivityItem; start: number; running: boolean }) {
  if (item.type === "tool") {
    const { line, result } = item;
    const out = result ? result.detail || result.text : "";
    return (
      <div>
        <TermLine line={line} start={start} />
        {out ? <pre style={{ ...termLine, paddingLeft: "16px", color: result?.isError ? COLORS.danger : COLORS.textDim }}>{out}</pre> : null}
      </div>
    );
  }
  if (item.type === "message") {
    return (
      <div>
        {item.lines.map((l, i) => (
          <TermLine key={i} line={l} start={start} />
        ))}
      </div>
    );
  }
  if (item.type === "thinking") {
    return <pre style={{ ...termLine, color: COLORS.textMuted, fontStyle: "italic" }}>{item.line.detail || item.line.text}</pre>;
  }
  return <TermLine line={item.line} start={start} />;
}

const FILTERS: { id: ActivityFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "tools", label: "Tools" },
  { id: "messages", label: "Messages" },
  { id: "errors", label: "Errors" },
];

function ActivityFeed({ lines, stepStartedAt, running, filter, query, follow, onFilter, onQuery, onFollow }: Props) {
  const items = useMemo(() => groupActivity(lines), [lines]);
  const visible = useMemo(() => filterActivity(items, filter, query), [items, filter, query]);
  const stats = useMemo(() => activityStats(items), [items]);
  const start = Date.parse(stepStartedAt);
  const parentRef = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({
    count: visible.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 24,
    overscan: 10,
    getItemKey: (i) => visible[i]?.key ?? i,
  });

  useEffect(() => {
    if (follow && visible.length) virtual.scrollToIndex(visible.length - 1, { align: "end" });
  }, [follow, visible.length, virtual]);

  const counts: Record<ActivityFilter, number> = { all: items.length, tools: stats.tools, messages: stats.messages, errors: stats.errors };

  return (
    <div style={{ ...card({ padding: "12px" }), display: "flex", flexDirection: "column", gap: "10px", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
        <span style={{ ...sectionCaption(), marginRight: "4px" }}>Activity</span>
        {FILTERS.map((f) => (
          <button key={f.id} type="button" onClick={() => onFilter(f.id)} className="te-action-btn" style={{ ...tabStyle({ active: filter === f.id }), display: "inline-flex", alignItems: "center", gap: "6px", marginBottom: 0 }}>
            {f.label}
            <span style={{ fontSize: FONT.xs, color: f.id === "errors" && counts.errors ? COLORS.danger : COLORS.textMuted, fontFamily: "var(--font-mono), monospace" }}>{counts[f.id]}</span>
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <span style={{ display: "inline-flex", gap: "10px", fontSize: FONT.xs, color: COLORS.textMuted, fontFamily: "var(--font-mono), monospace" }} className="te-mobile-hide">
          <span>{stats.commands} cmd</span>
          <span>{stats.edits} edits</span>
        </span>
        <button
          type="button"
          onClick={() => onFollow(!follow)}
          className="te-action-btn"
          style={{ ...pill({ color: follow ? COLORS.success : COLORS.textMuted, background: follow ? toneTint(COLORS.success, 12) : "transparent", border: follow ? toneTint(COLORS.success, 45) : COLORS.border, size: "md", weight: 700 }), cursor: "pointer", height: "30px" }}
        >
          <MiniIcon name="follow" size={12} color={follow ? COLORS.success : COLORS.textMuted} />
          {follow ? (running ? "Following live" : "Pinned to end") : "Follow"}
        </button>
      </div>
      <div style={{ position: "relative" }}>
        <span style={{ position: "absolute", left: "11px", top: "50%", transform: "translateY(-50%)", display: "inline-flex", pointerEvents: "none" }}>
          <MiniIcon name="search" size={14} color={COLORS.faint} />
        </span>
        <input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search commands, files, output…"
          style={{ ...fieldInput({ height: "36px" }), width: "100%", paddingLeft: "32px" }}
        />
      </div>
      <div
        ref={parentRef}
        className="te-scroll te-activity"
        onScroll={(e) => {
          const el = e.currentTarget;
          const away = el.scrollHeight - el.scrollTop - el.clientHeight;
          if (follow && away > 120) onFollow(false);
        }}
        style={{ height: "520px", overflowY: "auto", borderRadius: "10px", background: SURFACE.inset, padding: "8px", contain: "strict" }}
      >
        {visible.length === 0 ? (
          <div style={{ padding: "30px 10px", textAlign: "center", fontSize: FONT.sm, color: COLORS.faint }}>
            {items.length ? "Nothing matches this filter." : running ? "Waiting for the first event…" : "This step logged nothing."}
          </div>
        ) : (
          <div style={{ height: virtual.getTotalSize(), position: "relative", width: "100%" }}>
            {virtual.getVirtualItems().map((vi) => {
              const item = visible[vi.index];
              return (
                <div key={vi.key} data-index={vi.index} ref={virtual.measureElement} style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${vi.start}px)`, paddingBottom: 0 }}>
                  <Row item={item} start={start} running={running && vi.index === visible.length - 1} />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(ActivityFeed);
