"use client";

import type { MouseEvent } from "react";
import SprintPicker, { type IterationOption } from "../SprintPicker";
import ProviderBadge from "../(app)/ProviderBadge";
import PageHeading from "../(app)/PageHeading";
import type { ProviderMeta } from "@/lib/providers";
import { FONT, ringBorder, tabStyle } from "@/lib/ui";
import { SCOPE_LABEL, TICKET_SCOPES, type TicketScope } from "@/lib/ticketScope";
import NotificationCenter from "../(app)/NotificationCenter";
import PageToolbar from "../(app)/PageToolbar";

type Props = {
  pm: ProviderMeta;
  scope: TicketScope;
  onScopeChange: (scope: TicketScope, e: MouseEvent) => void;
  sprintLabel: string;
  sprintOptions: IterationOption[];
  selectedSprint: string;
  /** The one sprint to badge CURRENT — the provider's team-scoped answer, not
   *  every option whose dates happen to span today. */
  currentSprint: string;
  onSprintChange: (value: string, e: { clientX: number; clientY: number }) => void;
  projectOptions: { id: string; name: string }[];
  selectedProject: string;
  onSelectProject: (value: string, e: { clientX: number; clientY: number }) => void;
  activeCount: number;
};

// Project picker leading icon (a small grid/folder), distinct from the sprint
// picker's green "current" dot.
const projectLeading = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#8A90A0" strokeWidth="2" style={{ flex: "0 0 auto" }}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </svg>
);

// Top bar (Ticket Execution) plus this page's control strip. The header carries
// only what is true on every page — the page's identity, the bell, the connected
// organization; the project, view and sprint pickers and the active-run counter
// are this screen's own and live on the toolbar below it. Cross-page nav /
// Settings / Logout live in the shared Sidebar.
export default function AppHeader({
  pm, scope, onScopeChange, sprintLabel, sprintOptions, selectedSprint, currentSprint, onSprintChange,
  projectOptions, selectedProject, onSelectProject, activeCount,
}: Props) {
  return (
    <>
      <header className="te-page-header" style={{ height: "60px", flex: "0 0 auto", display: "flex", alignItems: "center", gap: "16px", padding: "0 22px", borderBottom: "1px solid rgba(255,255,255,.06)", background: "rgba(14,17,23,.72)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)", position: "relative", zIndex: 30 }}>
        <PageHeading title="Ticket Execution" kicker="D-AGENT · RUNS" icon={<path d="M8 5l8 7-8 7" />} />
        <div style={{ flex: 1 }} />
        <NotificationCenter />
        <ProviderBadge provider={pm.id} />
      </header>

      <PageToolbar>
        <SprintPicker label={selectedProject} options={projectOptions} value={selectedProject} onSelect={onSelectProject} leading={projectLeading} />
        {/* Which view of the project's work. Segmented rather than a fourth
            dropdown: three fixed choices that change what the whole screen is
            showing should be visible at a glance, not one click deep. */}
        <div role="tablist" aria-label="Ticket view" style={{ display: "flex", alignItems: "center", gap: "2px", marginLeft: "8px" }}>
          {TICKET_SCOPES.map((s) => (
            <button
              key={s}
              role="tab"
              aria-selected={s === scope}
              onClick={(e) => onScopeChange(s, e)}
              style={tabStyle({ active: s === scope })}
            >
              {SCOPE_LABEL[s]}
            </button>
          ))}
        </div>
        {/* Only the sprint view is bounded by an iteration. Hidden rather than
            disabled off it: a sprint name beside a backlog is a claim about what
            the list is, and it would be the wrong one. */}
        {scope === "sprint" && (
          <SprintPicker label={sprintLabel} options={sprintOptions} value={selectedSprint} currentName={currentSprint} onSelect={onSprintChange} />
        )}
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", alignItems: "center", gap: "7px", height: "30px", padding: "0 13px", fontSize: FONT.base, color: "#8A90A0", whiteSpace: "nowrap", ...ringBorder({ fill: "#14171D", shape: "pill", duration: 3.4 }) }}>
          <span style={{ fontFamily: "var(--font-mono), monospace", color: "#C7CCD8", fontWeight: 600 }}>{activeCount}</span> active runs
        </div>
      </PageToolbar>
    </>
  );
}
