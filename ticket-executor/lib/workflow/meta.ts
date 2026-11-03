import type { NodeKind, NodeStatus, PhaseKey, Tone } from "./types";

export const IC = {
  sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z M19 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z",
  shield: "M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z M9 12l2 2 4-4",
  gear: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z M19.4 13a7.5 7.5 0 0 0 0-2l2-1.5-2-3.4-2.3 1a7.5 7.5 0 0 0-1.7-1L15 3.5h-4l-.4 2.6a7.5 7.5 0 0 0-1.7 1l-2.3-1-2 3.4 2 1.5a7.5 7.5 0 0 0 0 2l-2 1.5 2 3.4 2.3-1a7.5 7.5 0 0 0 1.7 1l.4 2.6h4l.4-2.6a7.5 7.5 0 0 0 1.7-1l2.3 1 2-3.4z",
  barrier: "M3 8h18v5H3z M6 8l3 5 M12 8l3 5 M18 8l3 5 M5 13v7 M19 13v7",
  check: "M5 12.5l4.5 4.5L19 7",
  x: "M6 6l12 12M18 6L6 18",
  ban: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M5.6 5.6l12.8 12.8",
  pause: "M8 5v14 M16 5v14",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 7v5l3 2",
  running: "M12 3a9 9 0 1 0 9 9",
  pending: "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z",
  skip: "M5 12h14 M13 6l6 6-6 6",
  lock: "M6 11h12v9H6z M8.5 11V8a3.5 3.5 0 0 1 7 0v3",
  out: "M7 17L17 7 M9 7h8v8",
  flag: "M5 21V4 M5 4h11l-2 4 2 4H5",
  alert: "M12 4l9 16H3z M12 10v4 M12 17.5v.5",
  copy: "M8 8h11v12H8z M5 16V4h11",
  down: "M6 9l6 6 6-6",
  up: "M6 15l6-6 6 6",
  fit: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
  target: "M12 2v4M12 18v4M2 12h4M18 12h4 M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
  diff: "M5 3h14v18H5z M12 7v6 M9 10h6 M9 17h6",
  list: "M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01",
  git: "M6 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM6 8v8M6 16a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM18 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM18 12c0 4-12 2-12 4",
  chat: "M4 5h16v11H9l-5 4z",
  book: "M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z M5 17a3 3 0 0 1 3-3h11",
  pr: "M6 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4z M6 7v10 M6 17a2 2 0 1 0 0 4 2 2 0 0 0 0-4z M18 17a2 2 0 1 0 0 4 2 2 0 0 0 0-4z M18 17V9a3 3 0 0 0-3-3h-4 M13 3.5L10.5 6 13 8.5",
  file: "M6 3h8l4 4v14H6z M14 3v4h4",
  beaker: "M9 3h6 M10 3v6L5 19a1.5 1.5 0 0 0 1.3 2h11.4a1.5 1.5 0 0 0 1.3-2L14 9V3 M7.5 15h9",
  bulb: "M9 18h6 M10 21h4 M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z M20 20l-4-4",
  route: "M6 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4z M18 16a2 2 0 1 0 0 4 2 2 0 0 0 0-4z M8 6h7a3 3 0 0 1 0 6H9a3 3 0 0 0 0 6h7",
  terminal: "M4 5h16v14H4z M7 9l3 3-3 3 M12 15h5",
  commit: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z M3 12h6 M15 12h6",
} as const;

/** Icon + tone for a heading an agent wrote in its markdown (`## Goal`, `## Steps`…), matched by keyword. */
const HEADING_META: [RegExp, string, Tone][] = [
  [/goal|objective|summary|overview|context/i, IC.target, "accent"],
  [/acceptance|criteria|\bac\b/i, IC.check, "success"],
  [/finding|analysis|investigat|root cause|cause/i, IC.search, "info"],
  [/step|approach|implementation|change/i, IC.route, "indigo"],
  [/test|verif|validat/i, IC.beaker, "info"],
  [/risk|caveat|warning|concern|issue|blocker/i, IC.alert, "warning"],
  [/file|scope|repo/i, IC.file, "muted"],
  [/question|reply|answer|comment|thread/i, IC.chat, "indigo"],
  [/decision|verdict|outcome|result/i, IC.flag, "success"],
  [/lesson|note|knowledge/i, IC.bulb, "warning"],
  [/command|run|build/i, IC.terminal, "muted"],
];

export function headingMeta(text: string): { icon: string; tone: Tone } {
  const hit = HEADING_META.find(([re]) => re.test(text));
  return hit ? { icon: hit[1], tone: hit[2] } : { icon: IC.list, tone: "muted" };
}

export const TONE: Record<Tone, { c: string; bg: string }> = {
  accent: { c: "var(--te-accent)", bg: "var(--te-accent-soft)" },
  success: { c: "var(--te-success)", bg: "var(--te-success-soft)" },
  danger: { c: "var(--te-danger)", bg: "var(--te-danger-soft)" },
  warning: { c: "var(--te-warning)", bg: "var(--te-warning-soft)" },
  info: { c: "var(--te-info)", bg: "var(--te-info-soft)" },
  indigo: { c: "var(--te-indigo)", bg: "var(--te-indigo-soft)" },
  muted: { c: "var(--te-text-muted)", bg: "var(--te-border-subtle)" },
};

export const STATUS: Record<NodeStatus, { text: string; tone: Tone; icon: string }> = {
  pending: { text: "Pending", tone: "muted", icon: IC.pending },
  running: { text: "Running", tone: "accent", icon: IC.running },
  succeeded: { text: "Done", tone: "success", icon: IC.check },
  failed: { text: "Failed", tone: "danger", icon: IC.x },
  refused: { text: "Refused", tone: "danger", icon: IC.ban },
  skipped: { text: "Skipped", tone: "muted", icon: IC.skip },
  abandoned: { text: "Stopped", tone: "warning", icon: IC.pause },
  parked: { text: "Parked", tone: "warning", icon: IC.pause },
  exhausted: { text: "Exhausted", tone: "danger", icon: IC.x },
  passed: { text: "Passed", tone: "success", icon: IC.check },
  reached: { text: "Reached", tone: "success", icon: IC.check },
};

export const KIND_META: Record<NodeKind, { icon: string; tone: Tone }> = {
  agent: { icon: IC.sparkle, tone: "indigo" },
  check: { icon: IC.shield, tone: "info" },
  harness: { icon: IC.gear, tone: "warning" },
  gate: { icon: IC.barrier, tone: "muted" },
  terminal: { icon: IC.flag, tone: "muted" },
};

export const PHASES: PhaseKey[] = ["prepare", "understand", "build", "verify", "publish"];

export const PHASE_LABEL: Record<PhaseKey, string> = {
  prepare: "Prepare",
  understand: "Understand",
  build: "Build",
  verify: "Verify",
  publish: "Publish",
};

export const LANE_TITLE: Record<string, string> = {
  "pre-run": "Pre-run gates",
  prepare: "0 · Prepare",
  understand: "1 · Understand",
  build: "2 · Build",
  verify: "3 · Verify",
  publish: "4 · Publish",
  unknown: "Other",
  terminal: "Outcome",
};

// `left` is the line a park shows once the run has moved past it.
export const TERMS: Record<string, { sub: string; tone: Tone; icon: string; left?: string }> = {
  END: { sub: "Success", tone: "success", icon: IC.flag },
  NEEDS_REVIEW: { sub: "Ended · needs review", tone: "warning", icon: IC.flag, left: "Accepted · human check" },
  NEEDS_INPUT: { sub: "Parked · PO answers", tone: "warning", icon: IC.pause, left: "Rechecked · PO answered" },
  FAIL: { sub: "Failed", tone: "danger", icon: IC.x },
};

export const TERM_ORDER = ["END", "NEEDS_REVIEW", "NEEDS_INPUT", "FAIL"];

export const REFUSAL_SOURCE: Record<string, { title: string; icon: string; tone: Tone }> = {
  testGate: { title: "Test gate", icon: IC.shield, tone: "info" },
  diffGuard: { title: "Diff guard", icon: IC.diff, tone: "warning" },
  evaluate: { title: "Independent review", icon: IC.sparkle, tone: "indigo" },
  acceptance: { title: "Acceptance criteria", icon: IC.list, tone: "accent" },
  syncBase: { title: "Sync with base", icon: IC.git, tone: "muted" },
  ci: { title: "CI pipeline", icon: IC.gear, tone: "danger" },
  "review-thread": { title: "Review threads", icon: IC.chat, tone: "indigo" },
  qa: { title: "QA findings", icon: IC.list, tone: "accent" },
};

export const STAGES: [string, string][] = [
  ["readiness", "Readiness"],
  ["implement", "Implement"],
  ["pr", "Draft PR"],
  ["ci", "CI"],
  ["release", "Release"],
  ["review", "Code review"],
  ["merged", "Merged"],
  ["qa", "QA"],
  ["closed", "Close-out"],
];

export const STAGE_STATUS: Record<string, { tone: Tone; icon: string; text: string }> = {
  done: { tone: "success", icon: IC.check, text: "Done" },
  active: { tone: "accent", icon: IC.running, text: "Active" },
  blocked: { tone: "danger", icon: IC.alert, text: "Blocked" },
  todo: { tone: "muted", icon: IC.pending, text: "To do" },
  skipped: { tone: "muted", icon: IC.skip, text: "Skipped" },
};

export const dur = (sec: number): string => {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const x = s % 60;
  if (h) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m) return `${m}m ${String(x).padStart(2, "0")}s`;
  return `${x}s`;
};

export const mmss = (sec: number): string => {
  const s = Math.max(0, Math.round(sec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

export const usd = (v: number): string => `$${(v || 0).toFixed(2)}`;

export const ktok = (n: number): string =>
  n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n || 0);

export const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

const two = (n: number): string => String(n).padStart(2, "0");

export const clock = (ms: number): string => {
  const d = new Date(ms);
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
};

export const hhmm = (ms: number): string => clock(ms).slice(0, 5);
