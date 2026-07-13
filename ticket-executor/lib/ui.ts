import type { CSSProperties } from "react";
import type { ExecStatus } from "./types";

// ---- Ported verbatim from the prototype's renderVals() ----

export const STEPS = [
  "Resolve project root",
  "Read ticket · ADO MCP",
  "Create branch",
  "Implement changes",
  "Run verification",
  "Commit changes",
  "Open pull request",
];

const TYPES: Record<string, { c: string; bg: string }> = {
  Feature: { c: "#9B8CFF", bg: "rgba(155,140,255,.13)" },
  Bug: { c: "#FF6B6B", bg: "rgba(255,107,107,.13)" },
  Task: { c: "#5B9DFF", bg: "rgba(91,157,255,.13)" },
  Story: { c: "#35D6A4", bg: "rgba(53,214,164,.13)" },
  "User Story": { c: "#35D6A4", bg: "rgba(53,214,164,.13)" },
  Issue: { c: "#F5B341", bg: "rgba(245,179,65,.13)" },
  Epic: { c: "#FF9F45", bg: "rgba(255,159,69,.13)" },
};

// Prototype only had New/Active. Extended for real ADO states — same pill,
// only the text colour varies by state.
const STATUS_COLORS: Record<string, string> = {
  New: "#8A90A0",
  "To Do": "#8A90A0",
  Approved: "#8A90A0",
  "Ready for Dev": "#F5B341",
  "Ready for Development": "#F5B341",
  Active: "#F5B341",
  "In Progress": "#F5B341",
  Committed: "#F5B341",
  Doing: "#F5B341",
  "Code Review": "#9B8CFF",
  "In Review": "#9B8CFF",
  "Ready for QA": "#5B9DFF",
  "In QA": "#5B9DFF",
  Testing: "#5B9DFF",
  Resolved: "#35D6A4",
  Done: "#35D6A4",
  Closed: "#35D6A4",
  Completed: "#35D6A4",
  Removed: "#FF6B6B",
};

export function statusColor(status: string): string {
  return STATUS_COLORS[status] ?? "#8A90A0";
}

// A ticket can be implemented only when it is actively in the dev lane:
// "Ready for Dev" / "In Progress" (and the ADO Agile equivalent "Active").
const IMPLEMENTABLE_STATES = new Set([
  "ready for dev",
  "ready for development",
  "in progress",
  "active",
]);

export function canImplement(status: string): boolean {
  return IMPLEMENTABLE_STATES.has((status ?? "").trim().toLowerCase());
}

// A ticket in the review lane can be code-reviewed.
const REVIEWABLE_STATES = new Set(["code review", "in review"]);

export type ActionInfo = { label: string; skill: string };

// Maps the effective ticket status to the runnable action (label + skill).
// Returns null when no action applies for that status (button is gated).
export function actionInfoFor(status: string): ActionInfo | null {
  const s = (status ?? "").trim().toLowerCase();
  if (IMPLEMENTABLE_STATES.has(s)) return { label: "Implement Ticket", skill: "implement-ticket" };
  if (REVIEWABLE_STATES.has(s)) return { label: "Review Code", skill: "senior-code-review" };
  return null;
}

// The status a ticket moves to once a given skill's run completes (simulated ADO sync).
export function nextStatusAfter(skill: string, current: string): string {
  if (skill === "implement-ticket") return "Code Review";
  if (skill === "senior-code-review") return "Ready for QA";
  return current;
}

// Statuses offered in the detail-header status dropdown.
export const STATUS_ALL = [
  "New",
  "Ready for Dev",
  "Active",
  "In Progress",
  "Code Review",
  "Ready for QA",
  "Resolved",
  "Done",
];

export const EXEC_COLOR: Record<ExecStatus, string> = {
  "not started": "#5B6273",
  running: "#F5B341",
  completed: "#35D6A4",
  failed: "#FF6B6B",
};

export const EXEC_LABEL: Record<ExecStatus, string> = {
  "not started": "Not started",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
};

export function typeBadge(type: string): CSSProperties {
  const c = TYPES[type] || TYPES.Task;
  return {
    fontSize: "10.5px",
    fontWeight: 700,
    letterSpacing: ".04em",
    padding: "2px 8px",
    borderRadius: "6px",
    color: c.c,
    background: c.bg,
  };
}

export function statusPill(status: string): CSSProperties {
  return {
    fontSize: "11px",
    fontWeight: 600,
    padding: "2px 9px",
    borderRadius: "999px",
    color: statusColor(status),
    background: "rgba(255,255,255,.04)",
    border: "1px solid #262B36",
  };
}

// Clickable status pill with an LED conic border colored by the status.
export function statusPillActive(status: string): CSSProperties {
  const c = statusColor(status);
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: "5px",
    fontSize: "11px",
    fontWeight: 700,
    padding: "3px 10px",
    borderRadius: "999px",
    color: c,
    cursor: "pointer",
    outline: "none",
    border: "1.5px solid transparent",
    background:
      "linear-gradient(rgba(255,255,255,.04),rgba(255,255,255,.04)) padding-box, conic-gradient(from var(--angle), transparent, " +
      c +
      ", transparent 55%) border-box",
    animation: "spinAngle 3.6s linear infinite",
  };
}

export function hue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

export function avatar(name: string): CSSProperties {
  const h = hue(name);
  return {
    width: "20px",
    height: "20px",
    borderRadius: "50%",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "9.5px",
    fontWeight: 700,
    color: `hsl(${h} 72% 76%)`,
    background: `hsl(${h} 42% 20%)`,
  };
}

export function execDot(st: ExecStatus): CSSProperties {
  const base: CSSProperties = {
    width: "9px",
    height: "9px",
    borderRadius: "50%",
    display: "inline-block",
    flex: "0 0 auto",
  };
  if (st === "not started")
    return { ...base, border: "1.5px solid #3A4150", background: "transparent" };
  const c = EXEC_COLOR[st];
  const o: CSSProperties = { ...base, background: c, boxShadow: "0 0 8px " + c };
  if (st === "running") o.animation = "pulseDot 1.1s ease-in-out infinite";
  return o;
}

export function initials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function slug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 4)
    .join("-");
}

export function branchOf(id: string, title: string): string {
  return "feature/" + id + "-" + slug(title);
}
