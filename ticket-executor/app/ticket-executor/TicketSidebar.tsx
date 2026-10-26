"use client";

import { useCallback, useRef } from "react";
import type { CSSProperties, Dispatch, MouseEvent, SetStateAction } from "react";
import SelectMenu from "../SelectMenu";
import type { Ticket } from "@/lib/types";
import { COLORS, FONT, MOTION, displayText, avatar, card, ctaButtonStyle, initials, pill, ringBorder, statusPill, tintedCard, typeBadge, chipShape } from "@/lib/ui";
import { SCOPE_LABEL, type TicketScope } from "@/lib/ticketScope";
import { ACCENT } from "./constants";
import LoadingRing from "./LoadingRing";
import { useBoltsContext } from "../BoltsContext";
import { motion } from "motion/react";
import { reveal } from "../Motion";

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
  fPlanned: string;
  setFPlanned: Dispatch<SetStateAction<string>>;
  statusOptions: string[];
  typeOptions: string[];
  assigneeOptions: string[];
  plannedOptions: string[];
  /** Queue position per ticket id for the tickets this sprint's plan carries.
   *  Empty outside the sprint view, and for a sprint with no plan. */
  plannedOrder: Record<string, number>;
  selectMode: boolean;
  onToggleSelectMode: () => void;
  onCancelSelect: () => void;
  selectedIds: Set<string>;
  onToggleTicketSelected: (id: string) => void;
  onRunSelected: () => void;
  selectedId: string;
  getStatus: (t: Ticket) => string;
  onSelectTicket: (id: string, e?: MouseEvent) => void;
};

// Left rail: search, filters, multi-select batch controls and the ticket rows.
export default function TicketSidebar({
  tickets, filtered, scope, loading, loadError, ticketsNotice,
  search, setSearch, filtersOpen, setFiltersOpen, activeFilters, clearFilters,
  fStatus, setFStatus, fType, setFType, fAssignee, setFAssignee, fPlanned, setFPlanned,
  statusOptions, typeOptions, assigneeOptions, plannedOptions, plannedOrder,
  selectMode, onToggleSelectMode, onCancelSelect, selectedIds, onToggleTicketSelected,
  onRunSelected, selectedId, getStatus, onSelectTicket,
}: Props) {
  const { fireBoltFromEvent } = useBoltsContext();
  const q = search.trim().toLowerCase();

  // Bring the selected row into view. A callback ref rather than an effect on
  // `selectedId`, because a notification selects its ticket before the board it
  // sits in has loaded — the row mounts after any effect would have run, and
  // the rail was left scrolled to somebody else's ticket.
  const scrolledFor = useRef("");
  const selectedRowRef = useCallback((node: HTMLButtonElement | null) => {
    if (!node || scrolledFor.current === selectedId) return;
    scrolledFor.current = selectedId;
    node.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedId]);

  // One ticket row. Extracted so the board view can render the same row inside
  // its column groups — the row is identical in every view; only what wraps it
  // changes.
  const renderRow = (tk: Ticket, i: number) => {
    const sel = tk.id === selectedId;
    const checked = selectedIds.has(tk.id);
    const highlighted = selectMode ? checked : sel;
    const rowStyle: CSSProperties = {
      position: "relative", overflow: "hidden", flexShrink: 0, display: "flex", flexDirection: "column",
      gap: "6px", padding: "12px 13px 12px 15px", borderRadius: "11px", cursor: "pointer", textAlign: "left",
      transition: "border-color .2s, background .2s, box-shadow .22s",
      border: highlighted ? "1px solid " + ACCENT : "1px solid var(--te-btn-ghost-fill)",
      background: highlighted ? "rgba(251,114,80,.07)" : "var(--te-raised-bg)",
      boxShadow: highlighted ? "0 10px 34px -18px " + ACCENT : "none",
    };
    const railStyle: CSSProperties = {
      position: "absolute", left: "0", top: "9px", bottom: "9px", width: "3px", borderRadius: "0 3px 3px 0",
      background: ACCENT, boxShadow: sel ? "0 0 12px " + ACCENT : "none",
      transform: sel ? "scaleY(1)" : "scaleY(0)", transformOrigin: "center",
      transition: "transform .3s cubic-bezier(.2,.8,.2,1)",
    };
    return (
      <motion.button
        key={tk.id}
        {...reveal({ index: i })}
        whileHover={{ y: -2 }}
        whileTap={MOTION.tap}
        ref={sel ? selectedRowRef : undefined}
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
          {/* Queue position, so "already planned" is visible without opening the
              filter — and so the order the scheduler will work in is readable
              from the same list a human picks a ticket out of. A planned ticket
              with no position (already in review, or handed off) shows the mark
              without a number rather than a misleading "0". */}
          {tk.id in plannedOrder && (
            <span
              title={
                plannedOrder[tk.id]
                  ? `In the sprint plan — queue position ${plannedOrder[tk.id]}`
                  : "In the sprint plan"
              }
              style={pill({ color: COLORS.indigo, size: "xs", weight: 700 })}
            >
              {plannedOrder[tk.id] ? `PLAN ${plannedOrder[tk.id]}` : "PLAN"}
            </span>
          )}
        </div>
        <div style={{ fontSize: FONT.md, fontWeight: 600, color: "var(--te-text)", lineHeight: 1.35, textAlign: "left" }}>{tk.title}</div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "1px" }}>
          <span style={statusPill(getStatus(tk))}>{getStatus(tk)}</span>
          <div style={{ flex: 1 }} />
          <span style={avatar(tk.assignee)}>{initials(tk.assignee)}</span>
          <span style={{ fontSize: FONT.sm, color: "var(--te-text-muted)" }}>{tk.assignee}</span>
        </div>
      </motion.button>
    );
  };

  return (
    <aside className="te-pane-list" style={{ width: "388px", flex: "0 0 388px", display: "flex", flexDirection: "column", borderRight: "1px solid rgba(255,255,255,.05)", background: "var(--te-sidebar-bg)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", minHeight: 0 }}>
      <div style={{ padding: "18px 18px 12px", display: "flex", flexDirection: "column", gap: "12px", flex: "0 0 auto" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <motion.h2 key={scope} initial={{ opacity: 0, x: -24 }} animate={{ opacity: 1, x: 0 }} style={displayText("heading")}>{SCOPE_LABEL[scope]}</motion.h2>
          <span style={{ fontFamily: "var(--font-mono), monospace", fontSize: FONT.sm, fontWeight: 600, background: "linear-gradient(90deg,var(--te-faint) 0%,var(--te-faint) 30%,#FFD9BE 45%,var(--accent) 52%,var(--te-faint) 65%,var(--te-faint) 100%)", backgroundSize: "220% 100%", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent", animation: "subtitleFlow 3.2s linear infinite" }}>{(activeFilters > 0 || q) ? `${filtered.length}/${tickets.length}` : tickets.length} tickets</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {selectMode ? (
            <>
              <div style={{ flex: 1, display: "flex", alignItems: "center", height: "36px", padding: "0 13px", fontSize: FONT.base, fontWeight: 600, color: "var(--te-text-soft)", ...ringBorder({ fill: "var(--te-raised-bg)", duration: 4.2 }) }}>
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
              <div style={{ flex: 1, display: "flex", alignItems: "center", gap: "9px", height: "36px", padding: "0 12px", ...ringBorder({ fill: "var(--te-raised-bg)", duration: 4.2 }) }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#5B6273" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tickets, people…" style={{ flex: 1, border: "none", outline: "none", background: "transparent", color: "var(--te-text)", fontSize: FONT.base }} />
              </div>
              <button onClick={(e) => { fireBoltFromEvent(e); setFiltersOpen((o) => !o); }} title="Filters" style={{ position: "relative", flex: "0 0 auto", display: "flex", alignItems: "center", justifyContent: "center", width: "36px", height: "36px", color: (filtersOpen || activeFilters > 0) ? "var(--accent)" : "var(--te-text-dim)", cursor: "pointer", ...ringBorder({ fill: (filtersOpen || activeFilters > 0) ? "rgba(251,114,80,.14)" : "var(--te-raised-bg)", duration: 4.2 }) }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 6h16M7 12h10M10 18h4" /></svg>
                {activeFilters > 0 && <span style={{ position: "absolute", top: "-4px", right: "-4px", minWidth: "15px", height: "15px", padding: "0 3px", borderRadius: "999px", background: "var(--accent)", color: "var(--te-on-accent)", fontSize: FONT.xs, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{activeFilters}</span>}
              </button>
            </>
          )}
          <button
            onClick={(e) => { fireBoltFromEvent(e); onToggleSelectMode(); }}
            title="Select multiple tickets"
            style={{ flex: "0 0 auto", display: "flex", alignItems: "center", justifyContent: "center", width: "36px", height: "36px", color: selectMode ? "var(--accent)" : "var(--te-text-dim)", cursor: "pointer", ...ringBorder({ fill: selectMode ? "rgba(251,114,80,.14)" : "var(--te-raised-bg)", duration: 4.2 }) }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M8 12.5l2.4 2.4L16 9.5" /></svg>
          </button>
        </div>
        {!selectMode && filtersOpen && (
          /* Four filters no longer fit the rail on one line, so the row wraps
             into pairs rather than squeezing every menu down to a width that
             shows none of its value. The plan filter is offered only where a
             plan exists — see `plannedOrder`. */
          <div style={{ position: "relative", zIndex: 20, display: "flex", alignItems: "center", flexWrap: "wrap", gap: "7px", animation: "fadeUp .18s ease-out both", ...card({ padding: "7px", background: COLORS.panelBgDark }) }}>
            {([
              { v: fStatus, set: setFStatus, label: "Status", opts: statusOptions },
              { v: fType, set: setFType, label: "Type", opts: typeOptions },
              { v: fAssignee, set: setFAssignee, label: "Assignee", opts: assigneeOptions },
              ...(Object.keys(plannedOrder).length
                ? [{ v: fPlanned, set: setFPlanned, label: "Plan", opts: plannedOptions }]
                : []),
            ] as const).map((f) => (
              <div key={f.label} style={{ position: "relative", flex: "1 1 44%", minWidth: 0 }}>
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
              <button onClick={(e) => { fireBoltFromEvent(e); clearFilters(); }} title="Clear filters" style={{ flex: "0 0 auto", width: "32px", height: "32px", display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid var(--te-border)", ...chipShape(6), background: "transparent", color: "var(--te-text-dim)", cursor: "pointer" }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
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
        {!loading && !loadError && !ticketsNotice && filtered.length === 0 && <div style={{ color: "var(--te-faint)", fontSize: FONT.base, padding: "18px 6px" }}>No tickets match.</div>}
        {!loading && scope !== "board" && filtered.map(renderRow)}
        {!loading && scope === "board" && byBoardColumn(filtered).map(([column, rows]) => (
          <div key={column} style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "10px 4px 2px" }}>
              <span style={{ fontFamily: "var(--te-font-display)", fontSize: FONT.sm, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: COLORS.textDim }}>{column}</span>
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
