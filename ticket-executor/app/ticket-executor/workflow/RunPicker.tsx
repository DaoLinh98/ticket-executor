"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { COLORS, FONT, dropdownPanelStyle, fieldInput } from "@/lib/ui";
import type { RunListItem } from "@/lib/dagent/view";
import { useBoltsContext } from "../../BoltsContext";
import { MONO } from "./parts";

const ACTIVE = ["running", "preparing", "waiting"];

const stateColor = (state: string) =>
  state === "succeeded" ? COLORS.success : state === "failed" ? COLORS.danger : state === "waiting" ? COLORS.warning : ACTIVE.includes(state) ? COLORS.accent : COLORS.textDim;

type Entry = { run: RunListItem; n: number; total: number; latest: boolean };
type Group = { ticketId: string; title: string; entries: Entry[] };

// Groups every run by ticket, newest run first, numbered oldest = 1; tickets with a run in flight
// lead, then the rest by their latest run.
function groupRuns(runs: RunListItem[], q: string): Group[] {
  const by = new Map<string, RunListItem[]>();
  for (const r of runs) by.set(r.ticketId, [...(by.get(r.ticketId) ?? []), r]);
  const groups = [...by.entries()].map(([ticketId, rs]) => {
    const sorted = [...rs].sort((a, b) => b.startedAt - a.startedAt);
    return {
      ticketId,
      title: sorted[0].title,
      entries: sorted.map((run, i): Entry => ({ run, n: sorted.length - i, total: sorted.length, latest: i === 0 })),
    };
  });
  const rank = (g: Group) => (g.entries.some((e) => ACTIVE.includes(e.run.state)) ? 1 : 0);
  groups.sort((a, b) => rank(b) - rank(a) || b.entries[0].run.startedAt - a.entries[0].run.startedAt);
  const needle = q.trim().toLowerCase();
  return needle ? groups.filter((g) => g.ticketId.toLowerCase().includes(needle) || g.title.toLowerCase().includes(needle)) : groups;
}

const dateOf = (t: number) => new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

// One dropdown over every ticket's runs: pick a run and the page shows that ticket's flow.
export default function RunPicker({ runs, currentId, onPick }: { runs: RunListItem[]; currentId: string | null; onPick: (run: RunListItem, latest: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  const { fireBoltFromEvent } = useBoltsContext();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const groups = useMemo(() => groupRuns(runs, query), [runs, query]);
  const current = useMemo(() => groupRuns(runs, "").flatMap((g) => g.entries).find((e) => e.run.id === currentId), [runs, currentId]);

  return (
    <div ref={wrapRef} style={{ position: "relative", flex: "0 0 auto" }}>
      <button
        type="button"
        className="te-wf-tap"
        aria-label="Show the flow of another run"
        aria-expanded={open}
        onClick={(e) => {
          fireBoltFromEvent(e);
          setOpen((o) => !o);
        }}
        style={{ display: "flex", alignItems: "center", gap: 7, height: 30, padding: "0 9px", border: `1px solid ${COLORS.border}`, borderRadius: 8, background: "var(--te-raised-bg)", color: COLORS.text, fontSize: FONT.sm, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}
      >
        <span aria-hidden style={{ width: 7, height: 7, borderRadius: "50%", background: current ? stateColor(current.run.state) : COLORS.textDim }} />
        {current ? `Run ${current.n} of ${current.total} · ${current.run.state}` : "Runs"}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: COLORS.faint, transform: open ? "rotate(180deg)" : "none", transition: "transform .18s" }}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open ? (
        <div className="te-scroll" style={{ position: "absolute", top: "calc(100% + 8px)", left: 0, zIndex: 30, width: "min(340px, calc(100vw - 32px))", animation: "fadeUp .16s ease-out both", ...dropdownPanelStyle({ maxHeight: "min(420px, 60vh)" }) }}>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search ticket" aria-label="Search runs by ticket" autoFocus style={{ ...fieldInput(), width: "100%", marginBottom: 4 }} />
          {groups.length === 0 ? <div style={{ padding: "8px 9px", fontSize: FONT.sm, color: COLORS.textMuted }}>No ticket matches.</div> : null}
          {groups.map((g) => (
            <div key={g.ticketId}>
              <div style={{ display: "flex", gap: 8, alignItems: "baseline", padding: "8px 9px 3px", minWidth: 0 }}>
                <span style={{ flex: "0 0 auto", fontFamily: MONO, fontSize: FONT.xs, color: COLORS.indigo }}>{g.ticketId}</span>
                <span style={{ flex: 1, minWidth: 0, fontSize: FONT.xs, color: COLORS.textMuted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{g.title}</span>
              </div>
              {g.entries.map((e) => {
                const sel = e.run.id === currentId;
                return (
                  <button
                    key={e.run.id}
                    type="button"
                    className="te-wf-tap"
                    onClick={(ev) => {
                      fireBoltFromEvent(ev);
                      onPick(e.run, e.latest);
                      setOpen(false);
                    }}
                    style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "7px 9px", borderRadius: 7, border: "none", cursor: "pointer", textAlign: "left", background: sel ? "rgba(251,114,80,.12)" : "transparent", color: sel ? "var(--accent)" : COLORS.textSoft, fontSize: FONT.sm, fontWeight: sel ? 700 : 500 }}
                  >
                    <span aria-hidden style={{ flex: "0 0 auto", width: 7, height: 7, borderRadius: "50%", background: stateColor(e.run.state) }} />
                    <span style={{ flex: 1 }}>Run {e.n}</span>
                    {e.latest ? <span style={{ fontSize: FONT.xs, color: COLORS.textDim }}>Latest</span> : null}
                    <span style={{ fontSize: FONT.xs, color: COLORS.textDim }}>{dateOf(e.run.startedAt)}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
