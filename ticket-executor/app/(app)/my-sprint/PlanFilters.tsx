"use client";

import SelectMenu from "../../SelectMenu";
import { COLORS, FONT, tabStyle } from "@/lib/ui";
import { FILTER_LABEL, SORT_LABEL, type PlanFilter, type PlanSort } from "./model";

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
      <div role="group" aria-label="Filter the plan" className="te-tabs-scroll" style={{ display: "flex", alignItems: "center", gap: "4px" }}>
        {(Object.keys(FILTER_LABEL) as PlanFilter[]).map((f) => (
          <button key={f} className="te-action-btn" aria-pressed={filter === f} onClick={() => onFilter(f)} style={tabStyle({ active: filter === f })}>
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
      <div role="group" aria-label="Sort the plan" style={{ display: "flex", alignItems: "center", gap: "4px" }}>
        <span aria-hidden style={{ fontSize: FONT.sm, color: COLORS.textDim }}>Sort</span>
        {(Object.keys(SORT_LABEL) as PlanSort[]).map((k) => (
          <button key={k} className="te-action-btn" aria-pressed={sort === k} onClick={() => onSort(k)} style={tabStyle({ active: sort === k })}>{SORT_LABEL[k]}</button>
        ))}
      </div>
    </div>
  );
}
