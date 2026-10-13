"use client";

import SelectMenu from "../../SelectMenu";
import { COLORS, FONT, tabStyle } from "@/lib/ui";
import { FILTER_LABEL, type PlanFilter, type PlanSort } from "./model";

const ALL_PROJECTS = "All projects";

export default function PlanFilters({
  filter,
  counts,
  sort,
  project,
  projects,
  onFilter,
  onSort,
  onProject,
}: {
  filter: PlanFilter;
  counts: Record<PlanFilter, number>;
  sort: PlanSort;
  project: string;
  projects: string[];
  onFilter: (f: PlanFilter) => void;
  onSort: (s: PlanSort) => void;
  onProject: (p: string) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
      <div className="te-tabs-scroll" style={{ display: "flex", alignItems: "center", gap: "4px" }}>
        {(Object.keys(FILTER_LABEL) as PlanFilter[]).map((f) => (
          <button key={f} className="te-action-btn" onClick={() => onFilter(f)} style={tabStyle({ active: filter === f })}>
            {FILTER_LABEL[f]} {counts[f]}
          </button>
        ))}
      </div>
      <div style={{ flex: 1 }} />
      {projects.length > 1 && (
        <div style={{ minWidth: "clamp(140px, 40vw, 190px)" }}>
          <SelectMenu
            value={project || ALL_PROJECTS}
            onChange={(p) => onProject(p === ALL_PROJECTS ? "" : p)}
            options={[ALL_PROJECTS, ...projects]}
            ariaLabel="Filter the plan by project"
          />
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
        <span style={{ fontSize: FONT.sm, color: COLORS.textDim }}>Sort</span>
        <button className="te-action-btn" onClick={() => onSort("queue")} style={tabStyle({ active: sort === "queue" })}>Queue</button>
        <button className="te-action-btn" onClick={() => onSort("release")} style={tabStyle({ active: sort === "release" })}>Release day</button>
      </div>
    </div>
  );
}
