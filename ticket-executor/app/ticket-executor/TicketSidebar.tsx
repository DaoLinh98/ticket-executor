"use client";

import type { CSSProperties, Dispatch, MouseEvent, SetStateAction } from "react";
import SelectMenu from "../SelectMenu";
import type { Ticket, UiRunState } from "@/lib/types";
import { COLORS, FONT, RUN_COLOR, avatar, card, ctaButtonStyle, initials, pill, ringBorder, runDot, statusPill, tintedCard, typeBadge } from "@/lib/ui";
import { SCOPE_LABEL, type TicketScope } from "@/lib/ticketScope";
import { ACCENT } from "./constants";
import LoadingRing from "./LoadingRing";
import { useBoltsContext } from "../BoltsContext";

/** The board view's rows, grouped under their kanban column.
 *
 * Grouped by `boardColumn` and not by `status`: a board maps several states
 * onto one column, so grouping by state draws more columns than the provider
 * does and splits one column's cards across two headings. Items whose type is
 * not on a board carry no column, and fall back to their state — the closest
 * true answer, rather than an "Other" bucket that says nothing.
 *
 * Column order is first-seen, which is the id-descending order the provider
 * answered in. Left to right is a board's own ordering and it is not in this
 * payload, so imposing one here would be an invention.
 */
function byBoardColumn(tickets: Ticket[]): Array<[string, Ticket[]]> {
  const groups = new Map<string, Ticket[]>();
  for (const t of tickets) {
    const key = t.boardColumn?.trim() || t.status || "Uncategorised";
    const bucket = groups.get(key);
    if (bucket) bucket.push(t);
    else groups.set(key, [t]);
  }
  return [...groups];
}

type Props = {
  tickets: Ticket[];
  filtered: Ticket[];
  /** Which view these came from — names the list, and switches the board view's
   *  rows into groups under their kanban column. */
  scope: TicketScope;
  loading: boolean;
  loadError: string;
  ticketsNotice: string;
  search: string;
  setSearch: Dispatch<SetStateAction<string>>;
  filtersOpen: boolean;
  setFiltersOpen: Dispatch<SetStateAction<boolean>>;
  activeFilters: number;
  clearFilters: () => void;
  fStatus: string;
  setFStatus: Dispatch<SetStateAction<string>>;
  fType: string;
  setFType: Dispatch<SetStateAction<string>>;
  fAssignee: string;
  setFAssignee: Dispatch<SetStateAction<string>>;
  statusOptions: string[];
  typeOptions: string[];
  assigneeOptions: string[];
  multiTicketMode: boolean;
  selectMode: boolean;
  onToggleSelectMode: () => void;
  onCancelSelect: () => void;
  selectedIds: Set<string>;
  onToggleTicketSelected: (id: string) => void;
  queuedIds: Set<string>;
  onRunSelected: () => void;
  selectedId: string;
  execStatusOf: (id: string) => UiRunState;
  getStatus: (t: Ticket) => string;
  onSelectTicket: (id: string, e?: MouseEvent) => void;
};

// Left rail: search, filters, multi-select batch controls and the ticket rows.
export default function TicketSidebar({
  tickets, filtered, scope, loading, loadError, ticketsNotice,
  search, setSearch, filtersOpen, setFiltersOpen, activeFilters, clearFilters,
  fStatus, setFStatus, fType, setFType, fAssignee, setFAssignee,
  statusOptions, typeOptions, assigneeOptions,
  multiTicketMode, selectMode, onToggleSelectMode, onCancelSelect, selectedIds, onToggleTicketSelected,
  queuedIds, onRunSelected, selectedId, execStatusOf, getStatus, onSelectTicket,
}: Props) {
  const { fireBoltFromEvent } = useBoltsContext();
  const q = search.trim().toLowerCase();

  // One ticket row. Extracted so the board view can render the same row inside
  // its column groups — the row is identical in every view; only what wraps it
  // changes.
  const renderRow = (tk: Ticket, i: number) => {
    const sel = tk.id === selectedId;
    const est = execStatusOf(tk.id);
    const checked = selectedIds.has(tk.id);
    const queued = queuedIds.has(tk.id);
    const highlighted = selectMode ? checked : sel;
    const rowStyle: CSSProperties = {
      position: "relative", overflow: "hidden", flexShrink: 0, display: "flex", flexDirection: "column",
      gap: "6px", padding: "12px 13px 12px 15px", borderRadius: "11px", cursor: "pointer", textAlign: "left",
      transition: "transform .22s cubic-bezier(.2,.8,.2,1), border-color .2s, background .2s, box-shadow .22s",
      animation: "fadeUp .45s both", animationDelay: i * 45 + "ms",
      border: highlighted ? "1px solid " + ACCENT : "1px solid #1A1E25",
      background: highlighted ? "rgba(251,114,80,.07)" : "#111419",
      boxShadow: highlighted ? "0 10px 34px -18px " + ACCENT : "none",
    };
    const railStyle: CSSProperties = {
      position: "absolute", left: "0", top: "9px", bottom: "9px", width: "3px", borderRadius: "0 3px 3px 0",
      background: ACCENT, boxShadow: sel ? "0 0 12px " + ACCENT : "none",
      transform: sel ? "scaleY(1)" : "scaleY(0)", transformOrigin: "center",
      transition: "transform .3s cubic-bezier(.2,.8,.2,1)",
    };
    return (
      <button
        key={tk.id}
        onClick={(e) => {
          if (selectMode) {
            fireBoltFromEvent(e);
            onToggleTicketSelected(tk.id);
          } else {
            onSelectTicket(tk.id, e);
          }
        }}
        style={rowStyle}
      >
        <span style={railStyle} />
        {highlighted && <span style={{ position: "absolute", inset: 0, borderRadius: "11px", padding: "1.6px", background: "conic-gradient(from var(--angle),transparent 0deg,var(--accent) 55deg,#ffd2c2 92deg,var(--accent) 128deg,transparent 185deg,transparent 360deg)", WebkitMask: "linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0)", WebkitMaskComposite: "xor", maskComposite: "exclude", animation: "spinAngle 2.8s linear infinite", pointerEvents: "none", zIndex: 2 }} />}
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {selectMode && (
            <span style={{ width: "16px", height: "16px", borderRadius: "4px", flex: "0 0 auto", display: "flex", alignItems: "center", justifyContent: "center", border: checked ? "none" : "1.5px solid #3A4150", background: checked ? "var(--accent)" : "transparent" }}>
              {checked && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#0B0C10" strokeWidth="3.2"><path d="M5 13l4 4L19 7" /></svg>}
            </span>
          )}
          <span style={{ fontFamily: "var(--font-mono), monospace", fontSize: FONT.sm, fontWeight: 600, color: "var(--accent)" }}>#{tk.id}</span>
          <span style={typeBadge(tk.type)}>{tk.type}</span>
          <div style={{ flex: 1 }} />
          {queued ? (
            <span style={pill({ color: COLORS.warning, background: "rgba(245,179,65,.1)", border: `color-mix(in srgb, ${COLORS.warning} 33%, transparent)`, size: "xs", weight: 700 })}>Queued</span>
          ) : est === "running" ? (
            <span
              title="Running"
              style={{
                width: "12px", height: "12px", borderRadius: "50%", flex: "0 0 auto",
                border: `1.6px solid ${RUN_COLOR.running}33`, borderTopColor: RUN_COLOR.running,
                animation: "spin .8s linear infinite",
              }}
            />
          ) : (
            <span style={{ ...runDot(est) }} />
          )}
        </div>
        <div style={{ fontSize: FONT.md, fontWeight: 600, color: "#E4E7EE", lineHeight: 1.35, textAlign: "left" }}>{tk.title}</div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "1px" }}>
          <span style={statusPill(getStatus(tk))}>{getStatus(tk)}</span>
          <div style={{ flex: 1 }} />
          <span style={avatar(tk.assignee)}>{initials(tk.assignee)}</span>
          <span style={{ fontSize: FONT.sm, color: "#6B7283" }}>{tk.assignee}</span>
        </div>
      </button>
    );
  };

  return (
    <aside style={{ width: "388px", flex: "0 0 388px", display: "flex", flexDirection: "column", borderRight: "1px solid rgba(255,255,255,.05)", background: "rgba(12,15,20,.74)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", minHeight: 0 }}>
      <div style={{ padding: "18px 18px 12px", display: "flex", flexDirection: "column", gap: "12px", flex: "0 0 auto" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <h2 style={{ margin: 0, fontFamily: "var(--font-space), sans-serif", fontSize: FONT.md, fontWeight: 700, letterSpacing: ".01em", color: "#ECEEF3" }}>{SCOPE_LABEL[scope]}</h2>
          <span style={{ fontFamily: "var(--font-mono), monospace", fontSize: FONT.sm, fontWeight: 600, background: "linear-gradient(90deg,#5B6273 0%,#5B6273 30%,#FFD9BE 45%,var(--accent) 52%,#5B6273 65%,#5B6273 100%)", backgroundSize: "220% 100%", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent", animation: "subtitleFlow 3.2s linear infinite" }}>{(activeFilters > 0 || q) ? `${filtered.length}/${tickets.length}` : tickets.length} tickets</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {selectMode ? (
            <>
              <div style={{ flex: 1, display: "flex", alignItems: "center", height: "36px", padding: "0 13px", fontSize: FONT.base, fontWeight: 600, color: "#C7CCD8", ...ringBorder({ fill: "#14171D", duration: 4.2 }) }}>
                {selectedIds.size} selected
              </div>
              <button onClick={(e) => { fireBoltFromEvent(e); onCancelSelect(); }} style={{ ...ctaButtonStyle("outline"), height: "36px" }}>Cancel</button>
              <button
                onClick={(e) => { fireBoltFromEvent(e, { big: true }); onRunSelected(); }}
                disabled={selectedIds.size === 0}
                style={{ ...ctaButtonStyle("primary"), height: "36px", opacity: selectedIds.size === 0 ? 0.5 : 1, cursor: selectedIds.size === 0 ? "not-allowed" : "pointer" }}
              >
                Run selected
              </button>
            </>
          ) : (
            <>
              <div style={{ flex: 1, display: "flex", alignItems: "center", gap: "9px", height: "36px", padding: "0 12px", ...ringBorder({ fill: "#14171D", duration: 4.2 }) }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#5B6273" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tickets, people…" style={{ flex: 1, border: "none", outline: "none", background: "transparent", color: "#ECEEF3", fontSize: FONT.base }} />
              </div>
              <button onClick={(e) => { fireBoltFromEvent(e); setFiltersOpen((o) => !o); }} title="Filters" style={{ position: "relative", flex: "0 0 auto", display: "flex", alignItems: "center", justifyContent: "center", width: "36px", height: "36px", color: (filtersOpen || activeFilters > 0) ? "var(--accent)" : "#8A90A0", cursor: "pointer", ...ringBorder({ fill: (filtersOpen || activeFilters > 0) ? "rgba(251,114,80,.14)" : "#14171D", duration: 4.2 }) }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 6h16M7 12h10M10 18h4" /></svg>
                {activeFilters > 0 && <span style={{ position: "absolute", top: "-4px", right: "-4px", minWidth: "15px", height: "15px", padding: "0 3px", borderRadius: "999px", background: "var(--accent)", color: "#0B0C10", fontSize: FONT.xs, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{activeFilters}</span>}
              </button>
            </>
          )}
          {multiTicketMode && (
            <button
              onClick={(e) => { fireBoltFromEvent(e); onToggleSelectMode(); }}
              title="Select multiple tickets"
              style={{ flex: "0 0 auto", display: "flex", alignItems: "center", justifyContent: "center", width: "36px", height: "36px", color: selectMode ? "var(--accent)" : "#8A90A0", cursor: "pointer", ...ringBorder({ fill: selectMode ? "rgba(251,114,80,.14)" : "#14171D", duration: 4.2 }) }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M8 12.5l2.4 2.4L16 9.5" /></svg>
            </button>
          )}
        </div>
        {!selectMode && filtersOpen && (
          <div style={{ position: "relative", zIndex: 20, display: "flex", alignItems: "center", gap: "7px", animation: "fadeUp .18s ease-out both", ...card({ padding: "7px", background: COLORS.panelBgDark }) }}>
            {([
              { v: fStatus, set: setFStatus, label: "Status", opts: statusOptions },
              { v: fType, set: setFType, label: "Type", opts: typeOptions },
              { v: fAssignee, set: setFAssignee, label: "Assignee", opts: assigneeOptions },
            ] as const).map((f) => (
              <div key={f.label} style={{ position: "relative", flex: 1, minWidth: 0 }}>
                <SelectMenu
                  value={f.v}
                  onChange={f.set}
                  options={f.opts}
                  allLabel={`${f.label}: All`}
                  ariaLabel={f.label}
                  variant="filter"
                />
              </div>
            ))}
            {activeFilters > 0 && (
              <button onClick={(e) => { fireBoltFromEvent(e); clearFilters(); }} title="Clear filters" style={{ flex: "0 0 auto", width: "32px", height: "32px", display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid #262B36", borderRadius: "9px", background: "transparent", color: "#8A90A0", cursor: "pointer" }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
            )}
          </div>
        )}
      </div>
      <div className="te-scroll te-scroll--smooth" style={{ flex: 1, overflowY: "auto", padding: "2px 12px 16px", display: "flex", flexDirection: "column", gap: "7px", minHeight: 0 }}>
        {loading && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "20px", padding: "58px 6px 46px" }}>
            <LoadingRing size={78} />
          </div>
        )}
        {!loading && loadError && <div style={{ color: "#FF8F8F", fontSize: FONT.base, lineHeight: 1.5, ...tintedCard("danger", { padding: "14px", radius: "10px" }) }}>{loadError}</div>}
        {!loading && !loadError && ticketsNotice && <div style={{ color: "#C7A98A", fontSize: FONT.base, lineHeight: 1.5, ...tintedCard("warning", { padding: "14px", radius: "10px" }) }}>{ticketsNotice}</div>}
        {!loading && !loadError && !ticketsNotice && filtered.length === 0 && <div style={{ color: "#5B6273", fontSize: FONT.base, padding: "18px 6px" }}>No tickets match.</div>}
        {!loading && scope !== "board" && filtered.map(renderRow)}
        {!loading && scope === "board" && byBoardColumn(filtered).map(([column, rows]) => (
          <div key={column} style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "10px 4px 2px" }}>
              <span style={{ fontFamily: "var(--font-space), sans-serif", fontSize: FONT.sm, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: COLORS.textDim }}>{column}</span>
              <span style={{ fontFamily: "var(--font-mono), monospace", fontSize: FONT.xs, color: COLORS.textMuted }}>{rows.length}</span>
              <div style={{ flex: 1, height: "1px", background: "rgba(255,255,255,.06)" }} />
            </div>
            {rows.map(renderRow)}
          </div>
        ))}
      </div>
    </aside>
  );
}
