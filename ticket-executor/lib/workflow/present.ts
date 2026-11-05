import { classifyFailure, retryNodeFor, type FailureClass } from "../dagent/retryPolicy";
import type { Layout, LayoutKind, LayoutNode } from "./layout";
import {
  IC,
  KIND_META,
  LANE_TITLE,
  PHASES,
  PHASE_LABEL,
  REFUSAL_SOURCE,
  STATUS,
  TERMS,
  clock,
  dur,
  hhmm,
  ktok,
  mmss,
  plural,
  usd,
} from "./meta";
import type {
  Cell,
  FlowNodeDef,
  GateResult,
  ListItem,
  LogLine,
  NodeOutput,
  NodeStatus,
  Refusal,
  Run,
  Section,
  SkillUse,
  Step,
  TicketDigest,
  Tone,
} from "./types";

export type NodeChip = { text: string; icon?: string; tone: Tone; /** What the chip means, for its tooltip. */ title?: string };

// How a step dealt with a skill, as a chip. A running step has not finished reading, so its unread skills are not yet a warning.
function skillChip(u: SkillUse, running: boolean): NodeChip {
  if (u.state === "picked") return { text: u.name, icon: IC.flag, tone: "accent", title: "Picked for this ticket — every later role is told to follow it" };
  if (u.state === "read") return { text: u.name, icon: IC.check, tone: "success", title: "Assigned, and the step read its SKILL.md" };
  if (u.state === "opened") return { text: u.name, icon: IC.search, tone: "info", title: "Not assigned — the step opened it on its own" };
  return running
    ? { text: u.name, tone: "muted", title: "Assigned — not read yet" }
    : { text: u.name, icon: IC.alert, tone: "warning", title: "Assigned, but the step never read its SKILL.md" };
}

// One chip for the canvas card: how many skills the node's last attempt used, amber when one assigned was ignored.
function skillSummaryChip(list: SkillUse[] | undefined, running: boolean): NodeChip | null {
  const used = (list ?? []).filter((u) => u.state !== "opened");
  if (!used.length) return null;
  const unread = running ? 0 : used.filter((u) => u.state === "unread").length;
  const title = used.map((u) => `${u.name}: ${u.state}`).join(" · ");
  if (unread) return { text: `skills ${used.length - unread}/${used.length} read`, icon: IC.alert, tone: "warning", title };
  return { text: plural(used.length, "skill"), icon: IC.book, tone: used.some((u) => u.state === "picked") ? "accent" : "success", title };
}

export type NodeFrame = "default" | "pending" | "running" | "danger" | "warning";

export type NodeView = {
  id: string;
  kind: LayoutKind;
  label: string;
  status: NodeStatus;
  kindIcon: string;
  kindTone: Tone;
  chips: NodeChip[];
  exits: NodeChip[];
  dots: string;
  dotsAria: string;
  timer: string;
  timerColor: string;
  outcome: string;
  outcomeColor: string;
  frame: NodeFrame;
  topBar: boolean;
  struck: boolean;
  opacity: number;
  aria: string;
};

export type EdgeView = {
  key: string;
  from: string;
  to: string;
  d: string;
  lx: number;
  ly: number;
  color: string;
  marker: string;
  width: number;
  dashed: boolean;
  animated: boolean;
  traversed: boolean;
  count: number;
  showPill: boolean;
  lock: boolean;
  reasons: { seq: number; at: string; reason: string }[];
};

export type LaneView = {
  id: string;
  title: string;
  status: NodeStatus;
  meta: string;
  active: boolean;
  ring: { text: string; fraction: number } | null;
};

export type BannerAction = { label: string; kind: "copy-questions" | "open-node" | "open-run"; nodeId?: string };

export type Banner = {
  tone: Tone;
  icon: string;
  title: string;
  text: string;
  countdown?: string;
  action?: BannerAction;
};

export type Hud = {
  stateText: string;
  tone: Tone;
  icon: string;
  node: string;
  flow: string;
  elapsed: string;
  cost: string;
  tokens: string;
  fix: string;
  fixColor: string;
  bar: { phase: (typeof PHASES)[number]; pct: number }[];
  barAria: string;
};

export type Inspector = {
  label: string;
  sub: string;
  kindIcon: string;
  kindTone: Tone;
  status: NodeStatus;
  chips: NodeChip[];
  /** The selected attempt's skills, one chip each, toned by how the step dealt with it. */
  skills: NodeChip[];
  note: { text: string; tone: Tone | "neutral" } | null;
  attempts: { n: number; status: NodeStatus }[];
  attemptIndex: number;
  metrics: { k: string; v: string }[];
  /** Token accounting and timestamps — debug detail, folded under the metrics. */
  metricsMore: { k: string; v: string }[];
  error: string;
  sections: Section[];
  /** What the agent was told when the selected attempt started; "" when none was kept. */
  brief: string;
  /** The brief of the attempt before the selected one, to show what a retry was told differently; "" when none. */
  briefPrev: string;
  briefPrevAttempt: number;
  json: string;
  transitions: { seq: number; incoming: boolean; other: string; reason: string }[];
};

export type TimelineRow = {
  nodeId: string;
  label: string;
  attempt: number;
  status: NodeStatus;
  left: number;
  width: number;
  title: string;
  running: boolean;
};

export type Timeline = { rows: TimelineRow[]; ticks: string[]; total: string };

const isLive = (run: Run | null): boolean => !!run && (run.state === "running" || run.state === "preparing");

const refusalCount = (n: number) => plural(n, "refusal");

export function oneLine(out: NodeOutput | null): string {
  if (!out) return "";
  switch (out.node) {
    case "setup":
      return `${plural(out.repos.length, "repo")}${out.warnings.length ? ` · ${plural(out.warnings.length, "warning")}` : ""}`;
    case "readiness":
      if (!out.ready) return `${out.questions.length} questions for PO`;
      return out.delivery?.status === "done" ? "Already delivered" : out.delivery?.status === "partial" ? `Ready · ${out.delivery.evidence.length} AC delivered` : "Ready";
    case "plan": {
      const files = new Set<string>();
      out.acMap.forEach((a) => (a.change === "none" ? null : a.files.forEach((f) => files.add(f))));
      return `${out.acMap.length} AC → ${files.size} files${out.decisions.length ? ` · ${plural(out.decisions.length, "decision")}` : ""}`;
    }
    case "planCheck":
    case "prePublish":
      return out.passed ? "OK" : plural(out.issues.length, "issue");
    case "implement":
      return `${out.filesChanged} files · tests ${out.verification.tests}`;
    case "fix":
      return `fixed ${refusalCount((out.addressed ?? []).length)} · ${out.filesChanged} files`;
    case "syncBase":
      return out.conflicts.length ? `${plural(out.conflicts.length, "conflict")} → fix` : out.rebased ? `rebased · was ${out.behindBy} behind` : "up to date";
    case "testGate": {
      const t = out.results.reduce((n, r) => n + r.tests.length, 0);
      const bad = out.results.filter((r) => !r.passed).length;
      return `${plural(out.results.length, "repo")} · ${plural(t, "test file")}${bad ? ` · ${bad} refused` : ""}`;
    }
    case "diffGuard":
      if (out.passed) return "OK";
      return out.violations.some((v) => v.hard) ? `${plural(out.violations.filter((v) => v.hard).length, "blocker")} → fix` : plural(out.violations.length, "warning");
    case "evaluate":
      return `${out.verdict === "pass" ? "pass" : plural(out.blockers.length, "blocker")}${out.reviewNotes.length ? " · unproven" : ""}`;
    case "reflect":
      return out.recorded ? "Lesson recorded" : "No lesson";
    case "publish":
      return out.prs.map((p) => `${p.repo} #${p.number}`).join(" · ");
    case "verifyPublish":
      return `${out.checks.filter((c) => c.ok).length}/${out.checks.length} checks`;
    case "reviewTriage": {
      const fix = out.threads.filter((t) => t.decision === "fix").length;
      return `${fix} to fix · ${plural(out.threads.length - fix, "answer-only thread")}`;
    }
    case "qaTriage":
      return out.outcome === "no-fix-needed" ? "No defect · reply drafted" : plural(out.findings.filter((f) => f.defect).length, "defect");
    case "respond":
      return `${plural(out.threadsReplied, "thread")} answered${out.pushed ? " · pushed" : ""}`;
  }
}

export function refusalSections(list: Refusal[], prefix = ""): Section[] {
  const groups: Record<string, Refusal[]> = {};
  list.forEach((r) => {
    (groups[r.source] ??= []).push(r);
  });
  return Object.keys(groups).map((src): Section => {
    const m = REFUSAL_SOURCE[src] ?? { title: src, icon: IC.alert, tone: "muted" as Tone };
    // Reviewer blockers carry their proof and the expected result: a table, so both read beside the issue.
    if (groups[src].some((r) => r.evidence || r.expected)) {
      return {
        kind: "table",
        title: `${prefix}${m.title} · ${groups[src].length}`,
        icon: m.icon,
        tone: m.tone,
        cols: ["Blocker", "File", "Evidence", "Expected"],
        rows: groups[src].map((r): Cell[] => [{ t: r.issue }, { t: r.file ?? "", mono: true }, { t: r.evidence ?? "" }, { t: r.expected ?? "" }]),
        expandable: true,
      };
    }
    return {
      kind: "list",
      title: `${prefix}${m.title} · ${groups[src].length}`,
      icon: m.icon,
      tone: m.tone,
      items: groups[src].map((r) => ({ mark: "•", text: r.issue, sub: r.file })),
    };
  });
}

const kv = (title: string | undefined, rows: [string, string | number, Tone?, boolean?][], icon?: string, tone?: Tone): Section => ({
  kind: "kv",
  title,
  icon,
  tone,
  rows: rows.map(([k, v, t, mono]) => ({ k, v: String(v), tone: t, mono })),
});

const verdictTone = (ok: boolean): Tone => (ok ? "success" : "danger");

const items = (list: string[], icon: string, tone: Tone): ListItem[] => list.map((text) => ({ icon, tone, text }));

// What every later role was given instead of the work item — shown on the role that wrote it, folded: a developer
// opens it only to see why a later role misread the ticket.
const digestSections = (d: TicketDigest | undefined): Section[] =>
  d
    ? [{ kind: "md", folded: true, title: "Ticket summary for later roles", icon: IC.file, tone: "indigo", text: [d.summary, d.details.map((x) => `- ${x}`).join("\n")].filter(Boolean).join("\n\n") }]
    : [];

const DELIVERY_TEXT = { none: "Nothing on the base yet", partial: "Partly on the base", done: "Already on the base — nothing to build" } as const;

export function outSections(out: NodeOutput | null): Section[] {
  if (!out) return [];
  switch (out.node) {
    case "setup":
      return [
        ...(out.warnings.length ? [{ kind: "list" as const, title: `Warnings · ${out.warnings.length}`, icon: IC.alert, tone: "warning" as Tone, items: items(out.warnings, IC.alert, "warning") }] : []),
        kv("Workspace", [["Branch", out.branch || "— named by the plan", undefined, !!out.branch], ["Base", out.baseSha, undefined, true]], IC.gear, "muted"),
        {
          kind: "list",
          title: "Repos",
          icon: IC.git,
          tone: "muted",
          items: out.repos.map((r) => ({
            icon: IC.git,
            tone: (r.from.includes("last fetched") || r.from === "local HEAD" ? "warning" : "muted") as Tone,
            text: r.name,
            sub: [[r.base, r.from].filter(Boolean).join(" · "), r.branch && `on ${r.branch}`, r.path].filter(Boolean).join(" — "),
          })),
        },
      ];
    case "readiness": {
      // What the node decided, in the order a developer checks it: the verdict, the spec it wrote, what it assumed or
      // asks, what is already done. The ticket summary for later roles is debug detail, folded.
      const status = out.delivery?.status ?? "none";
      const delivered = new Set((out.delivery?.evidence ?? []).map((e) => e.ac.trim()));
      const verdict: [string, string, Tone?, boolean?][] = [["Ready", out.ready ? "Yes" : "No — run parked for the PO", out.ready ? "success" : "warning"]];
      if (out.ready) verdict.push(["Delivery", DELIVERY_TEXT[status], status === "none" ? undefined : "success"]);
      if (out.skills.length) verdict.push(["Skills", out.skills.map((s) => s.name).join(", ")]);
      if (out.baseBranch) verdict.push(["Base branch", out.baseBranch, undefined, true]);
      const S: Section[] = [kv("Verdict", verdict, IC.flag, out.ready ? "success" : "warning")];
      if (out.acceptanceCriteria.length) {
        S.push({
          kind: "list",
          title: "Acceptance criteria",
          icon: IC.list,
          tone: "accent",
          // A criterion the ticket already numbered ("1.a …") keeps its own number instead of a second one.
          items: out.acceptanceCriteria.map((ac, i) => {
            const mark = /^\s*\d+(\.\w+)?[.)]?\s/.test(ac) ? "•" : `${i + 1}.`;
            return delivered.has(ac.trim()) ? { mark, tone: "success" as Tone, text: ac, sub: "already on the base — no change planned", subPlain: true } : { mark, text: ac };
          }),
        });
      }
      if (out.missing.length) S.push({ kind: "list", title: "Missing", icon: IC.search, tone: "warning", items: items(out.missing, IC.alert, "warning") });
      // When ready, each entry is a choice the analyst made instead of asking — the planner builds to it, so it is
      // what a developer most needs to overrule in time.
      if (out.ambiguities.length) {
        S.push({ kind: "list", title: out.ready ? "Assumptions made" : "Ambiguities", icon: IC.alert, tone: "warning", items: items(out.ambiguities, IC.alert, "warning") });
      }
      if (out.questions.length) {
        S.push({
          kind: "list",
          title: "Draft questions for the PO",
          icon: IC.chat,
          tone: "warning",
          items: out.questions.map((text, i) => ({ mark: `${i + 1}.`, tone: "warning" as Tone, text })),
        });
        S.push({ kind: "copy", questions: out.questions });
      }
      if (out.skills.length) {
        S.push({ kind: "list", folded: true, title: "Why these skills", icon: IC.book, tone: "muted", items: out.skills.map((s) => ({ icon: IC.book, tone: "muted" as Tone, text: s.name, sub: s.reason, subPlain: true })) });
      }
      if (out.codeLeads.length) {
        S.push({
          kind: "list",
          folded: true,
          title: "Code leads for the planner",
          icon: IC.file,
          tone: "muted",
          items: out.codeLeads.map((l) => ({ icon: IC.file, tone: "muted" as Tone, text: l.at, mono: true, sub: l.what, subPlain: true })),
        });
      }
      if (out.delivery?.evidence.length) {
        S.push({
          kind: "table",
          title: out.delivery.status === "done" ? "Proof already delivered — nothing to implement" : "Proof already delivered",
          icon: IC.check,
          tone: "success",
          cols: ["Acceptance criterion", "Repo", "Proof"],
          rows: out.delivery.evidence.map((e): Cell[] => [{ t: e.ac }, { t: e.repo, mono: true }, { t: e.proof, mono: true }]),
          expandable: true,
        });
      }
      S.push(...digestSections(out.digest));
      return S;
    }
    case "plan":
      return [
        {
          kind: "table",
          title: "AC → files → test",
          icon: IC.target,
          tone: "accent",
          cols: ["Acceptance criterion", "Files", "Test"],
          rows: out.acMap.map((a): Cell[] => [
            a.ac,
            a.change === "none" ? { t: "no change", tone: "muted" } : { t: a.files.map((f) => f.split("/").pop()).join(", "), mono: true },
            { t: a.test, tone: "info" },
          ]),
        },
        ...(out.decisions.length
          ? [
              {
                kind: "list",
                title: "Decisions",
                icon: IC.flag,
                tone: "accent",
                items: out.decisions.map((d): ListItem => ({ icon: IC.check, tone: "accent", text: `${d.point} → ${d.decision}`, sub: d.why, subPlain: true })),
              } satisfies Section,
            ]
          : []),
        { kind: "list", title: "Risks", icon: IC.alert, tone: "warning", items: items(out.risks, IC.alert, "warning") },
        // The planner's prose only (goal, data assumptions, steps, standards): the AC map, decisions and risks are above.
        ...(out.planMd ? [{ kind: "md", title: "Plan steps", icon: IC.book, tone: "indigo", text: out.planMd } satisfies Section] : []),
      ];
    case "planCheck":
    case "prePublish": {
      const k = out.checked;
      const S: Section[] = [
        kv(
          "Verdict",
          [
            ["Passed", out.passed ? "Yes" : "No", verdictTone(out.passed)],
            ...(k
              ? ([
                  ["Criteria mapped", `${k.mapped} / ${k.criteria}`, k.mapped >= k.criteria ? "success" : "danger"],
                  ["Change", `${k.code} code · ${k.none} no change`],
                  ["Planned files", k.files],
                  ["Repos", k.repos.join(", ") || "—"],
                ] satisfies [string, string | number, Tone?][])
              : []),
          ],
          IC.shield,
          verdictTone(out.passed),
        ),
      ];
      if (out.issues.length) S.push({ kind: "list", title: "Issues", icon: IC.x, tone: "danger", items: items(out.issues, IC.x, "danger") });
      return S;
    }
    case "implement":
    case "fix": {
      const v = out.verification;
      const S: Section[] = [
        kv("Result", [
          ["Commit", out.commitSha, undefined, true],
          ["Files changed", out.filesChanged],
          ["Tests", v.tests, v.tests === "passed" ? "success" : "warning"],
          ["Build", v.build, v.build === "passed" ? "success" : "warning"],
          ["Acceptance", v.acceptanceCriteria, v.acceptanceCriteria === "met" ? "success" : "warning"],
        ], IC.commit, "success"),
        { kind: "md", title: "Summary", icon: IC.book, tone: "indigo", text: out.summary },
      ];
      if (out.deviations.length) {
        S.push({
          kind: "table",
          title: "Deviations from the plan",
          icon: IC.alert,
          tone: "warning",
          cols: ["What", "Why"],
          rows: out.deviations.map((d): Cell[] => [{ t: d.what, tone: "warning" }, d.why]),
          expandable: true,
        });
      }
      if (out.manualChecks.length) {
        S.push({
          kind: "list",
          title: "Manual checks after deploy",
          icon: IC.check,
          tone: "info",
          items: out.manualChecks.map((m): ListItem => ({ mark: `AC ${m.n}`, tone: "info", text: m.check })),
        });
      }
      if (out.addressed?.length) S.push(...refusalSections(out.addressed, "Asked to fix · "));
      return S;
    }
    case "syncBase": {
      const S: Section[] = [
        kv("Sync", [
          ["Rebased", out.rebased ? "yes" : "no"],
          ["Behind base by", `${out.behindBy} commits`],
          ["Conflicts", out.conflicts.length || "none", out.conflicts.length ? "danger" : "success"],
        ], IC.git, out.conflicts.length ? "danger" : "info"),
      ];
      if (out.repos.length) {
        const tone: Record<string, Tone> = { "up to date": "success", rebased: "info", conflict: "danger", "not synced": "warning" };
        S.push({
          kind: "table",
          title: "Repositories",
          icon: IC.git,
          tone: "info",
          cols: ["Repo", "Upstream", "Behind", "Result", "Base"],
          rows: out.repos.map((r): Cell[] => [
            { t: r.name, mono: true },
            { t: r.upstream, mono: true },
            String(r.behind),
            { t: r.status === "conflict" ? "conflict → fix" : r.status, tone: tone[r.status] ?? "muted" },
            { t: r.base, mono: true },
          ]),
        });
      }
      if (out.conflicts.length) S.push({ kind: "list", title: "Conflicts · handed to the fixer", icon: IC.x, tone: "danger", items: items(out.conflicts, IC.x, "danger") });
      return S;
    }
    case "testGate":
      return [
        {
          kind: "table",
          title: "Committed diff vs base",
          icon: IC.beaker,
          tone: "info",
          cols: ["Repo", "Files", "Test files", "Result"],
          rows: out.results.map((r): Cell[] => [
            { t: r.repo, mono: true },
            String(r.files),
            { t: r.tests.map((f) => f.split("/").pop()).join(", ") || "—", mono: true, tone: r.tests.length ? "info" : "muted" },
            { t: r.passed ? "✓ pass" : r.issue, tone: r.passed ? "success" : "danger" },
          ]),
        },
      ];
    case "diffGuard": {
      const hard = out.violations.filter((v) => v.hard).length;
      const s = out.summary;
      const S: Section[] = [
        kv(
          "Verdict",
          [
            ["Violations", out.violations.length ? `${hard} blocking · ${out.violations.length - hard} warning` : "none", hard ? "danger" : out.violations.length ? "warning" : "success"],
            ...(s
              ? ([
                  ["Changed files", s.changed],
                  ["Planned files", s.planned],
                  ["Outside the plan", s.unplanned.length, s.unplanned.length ? "warning" : "success"],
                ] satisfies [string, string | number, Tone?][])
              : []),
          ],
          IC.shield,
          hard ? "danger" : out.violations.length ? "warning" : "success",
        ),
      ];
      if (out.violations.length) {
        S.push({
          kind: "table",
          title: "Violations",
          icon: IC.diff,
          tone: hard ? "danger" : "warning",
          cols: ["Rule", "File", "Effect"],
          rows: out.violations.map((v): Cell[] => [
            { t: v.rule, tone: v.hard ? "danger" : "warning", mono: true },
            { t: v.file, mono: true },
            { t: v.hard ? "blocks → fix" : "warning → reviewer", tone: v.hard ? "danger" : "warning" },
          ]),
        });
      }
      // Informational: tests and helpers the plan did not name land here too — the reviewer judges them.
      if (s?.unplanned.length) {
        S.push({ kind: "list", folded: true, title: "Changed outside the plan", icon: IC.file, tone: "muted", items: s.unplanned.map((f): ListItem => ({ icon: IC.file, tone: "muted", text: f, mono: true })) });
      }
      return S;
    }
    case "evaluate": {
      const ok = out.verdict === "pass";
      const unproven = out.reviewNotes.length > 0;
      const counts = (r: string) => out.checked.filter((x) => x.result === r).length;
      const S: Section[] = [
        kv(
          "Verdict",
          [
            ["Verdict", unproven ? `${out.verdict} · unproven` : out.verdict, unproven ? "warning" : verdictTone(ok)],
            ["Reviewed", out.reviewedDelta ? "delta since last review" : "full diff"],
            ...(out.checked.length
              ? ([["Checked", `${counts("ok")} ok · ${counts("issue")} issue · ${counts("unverified")} unverified`, counts("issue") ? "danger" : counts("unverified") ? "warning" : "success"]] satisfies [string, string, Tone][])
              : []),
          ],
          IC.sparkle,
          unproven ? "warning" : verdictTone(ok),
        ),
      ];
      if (unproven) S.push({ kind: "list", title: "Harness check of this review", icon: IC.alert, tone: "warning", items: items(out.reviewNotes, IC.alert, "warning") });
      S.push(...refusalSections(out.blockers, "Blockers · "));
      if (out.checked.length) {
        const tone: Record<string, Tone> = { ok: "success", issue: "danger", unverified: "warning" };
        S.push({
          kind: "table",
          title: "What was checked",
          icon: IC.check,
          tone: "info",
          cols: ["Subject", "How", "Evidence", "Result"],
          rows: out.checked.map((x): Cell[] => [x.subject, x.how, { t: x.evidence, mono: true }, { t: x.result, tone: tone[x.result] ?? "muted" }]),
          expandable: true,
        });
      }
      if (out.assumptions.length) S.push({ kind: "list", title: "Not verified", icon: IC.alert, tone: "warning", items: items(out.assumptions, IC.alert, "warning") });
      return S;
    }
    case "reflect": {
      const S: Section[] = [kv("Lesson", [["Recorded", out.recorded ? "yes · KNOWLEDGE.md" : "no"]], IC.bulb, "warning")];
      if (out.lesson) S.push({ kind: "md", title: "Lesson", icon: IC.bulb, tone: "warning", text: out.lesson });
      return S;
    }
    case "publish":
      return [
        {
          kind: "prs",
          title: "Pull requests",
          icon: IC.pr,
          tone: "success",
          prs: out.prs.map((p) => ({ repo: p.repo, num: p.number, url: p.url, meta: p.reusedExisting ? "Reused existing PR" : "Opened by this run", draft: p.draft })),
        },
      ];
    case "verifyPublish":
      return [
        {
          kind: "list",
          title: "Read-back checks",
          icon: IC.shield,
          tone: verdictTone(out.passed),
          items: out.checks.map((c) => ({ icon: c.ok ? IC.check : IC.x, tone: (c.ok ? "success" : "danger") as Tone, text: c.name, textTone: c.ok ? undefined : ("danger" as Tone) })),
        },
      ];
    case "reviewTriage":
      return [
        {
          kind: "table",
          title: "Thread decisions",
          icon: IC.chat,
          tone: "indigo",
          cols: ["Thread", "Decision", "Why"],
          rows: out.threads.map((t): Cell[] => [{ t: t.file || t.comment, mono: !!t.file }, { t: t.decision, tone: t.decision === "fix" ? "warning" : "muted" }, t.reason]),
        },
        { kind: "md", title: "Plan", icon: IC.book, tone: "indigo", text: out.planMd },
        ...digestSections(out.digest),
      ];
    case "qaTriage": {
      const S: Section[] = [
        {
          kind: "table",
          title: "QA findings",
          icon: IC.search,
          tone: "info",
          cols: ["Finding", "Verdict", "Why"],
          rows: out.findings.map((f): Cell[] => [f.finding, { t: f.kind || (f.defect ? "defect" : "not-defect"), tone: f.defect ? "danger" : "success" }, f.reason]),
        },
      ];
      if (out.qaReply) S.push({ kind: "md", title: "Reply to QA", icon: IC.chat, tone: "indigo", text: out.qaReply });
      if (out.planMd) S.push({ kind: "md", title: "Plan", icon: IC.book, tone: "indigo", text: out.planMd });
      S.push(...digestSections(out.digest));
      return S;
    }
    case "respond":
      return [kv("Result", [["Pushed", out.pushed ? "yes" : "no"], ["Threads answered", out.threadsReplied, out.threadsReplied ? "success" : "danger"], ["Resolved", "never — the reviewer decides"]], IC.chat, "indigo")];
  }
}

type NodeLike = Pick<LayoutNode, "id" | "kind" | "def">;

const stepsOf = (run: Run | null, id: string): Step[] => (run ? run.steps.filter((s) => s.nodeId === id) : []);

export function nodeStatus(run: Run | null, gates: GateResult[], n: NodeLike): NodeStatus {
  if (n.kind === "gate") return gates.find((g) => g.gate === n.id)?.status ?? "pending";
  if (n.kind === "terminal") {
    if (!run?.transitions.some((t) => t.toNode === n.id)) return "pending";
    if (n.id === "END") return "reached";
    // A run that ended on NEEDS_REVIEW stops there — it is where the run finished, not a park.
    if (n.id === "NEEDS_REVIEW" && run.state === "succeeded" && run.transitions[run.transitions.length - 1]?.toNode === n.id) return "reached";
    if (n.id === "FAIL") return "failed";
    // A park the run has since left (accepted, or rechecked) is behind it, not where it stands.
    return run.state === "waiting" && run.transitions[run.transitions.length - 1]?.toNode === n.id ? "parked" : "passed";
  }
  const ss = stepsOf(run, n.id);
  if (!ss.length || !run) return "pending";
  const last = ss[ss.length - 1];
  if (run.state === "cancelled" && last.status === "running") return "abandoned";
  if (run.state === "waiting" && last.status === "running") return "parked";
  const max = n.def.maxVisits;
  if (last.status === "skipped" && max && ss.filter((s) => s.status !== "skipped").length >= max) return "exhausted";
  return last.status;
}

const EXIT_TEXT: Record<string, string> = { END: "end", FAIL: "fail", NEEDS_INPUT: "input", NEEDS_REVIEW: "review" };

// Side exits (to a terminal, or a loop back) are chips on the card instead of long lines:
// a taken exit in its tone, the rest only on the selected node and muted, so a possible
// exit never reads as a status.
function exitsOf(run: Run | null, layout: Layout, id: string, selected: boolean): NodeChip[] {
  const taken = (to: string) => !!run?.transitions.some((t) => t.fromNode === id && t.toNode === to);
  return layout.edges
    .filter((e) => e.from === id && (e.cls === "park" || e.cls === "loop") && (selected || taken(e.to)))
    .map((e) => {
      const text = e.cls === "park" ? `→ ${EXIT_TEXT[e.to] ?? e.to}` : `↺ ${layout.nodes.find((n) => n.id === e.to)?.def.label ?? e.to}`;
      if (!taken(e.to)) return { text, tone: "muted" };
      return e.cls === "park" ? { text, icon: TERMS[e.to]?.icon ?? IC.flag, tone: TERMS[e.to]?.tone ?? "muted" } : { text, tone: "accent" };
    });
}

export function nodeView(run: Run | null, gates: GateResult[], n: LayoutNode, now: number, layout: Layout, selectedId: string): NodeView {
  const d: FlowNodeDef = n.def;
  const isTerm = n.kind === "terminal";
  const isGate = n.kind === "gate";
  const status = nodeStatus(run, gates, n);
  const sm = STATUS[status];
  const ss = stepsOf(run, n.id);
  const ran = ss.filter((s) => s.status !== "skipped");
  const lastOut = ran.length ? ran[ran.length - 1].output : null;
  const isRun = status === "running";
  const km = isTerm
    ? { icon: TERMS[n.id]?.icon ?? IC.flag, tone: TERMS[n.id]?.tone ?? ("muted" as Tone) }
    : KIND_META[d.kind];

  let frame: NodeFrame = "default";
  let topBar = false;
  let struck = false;
  let opacity = 1;
  if (status === "pending") {
    frame = "pending";
    opacity = 0.45;
  } else if (isRun) frame = "running";
  else if (status === "succeeded" || status === "passed" || status === "reached") topBar = true;
  else if (status === "failed" || status === "refused" || status === "exhausted") frame = "danger";
  else if (status === "parked" || status === "abandoned") frame = "warning";
  else if (status === "skipped") {
    struck = true;
    opacity = 0.7;
  }
  if (!run && !isGate) opacity = 0.3;

  const chips: NodeChip[] = [];
  if (!isTerm && !isGate) {
    if (d.effects === "external") chips.push({ text: "external", icon: IC.out, tone: "warning" });
    else chips.push({ text: d.effects, tone: d.effects === "local" ? "info" : "muted" });
    if (d.kind === "agent") {
      chips.push({ text: d.context, tone: "indigo" });
      const cost = ss.reduce((a, s) => a + s.costUsd, 0);
      chips.push({ text: cost ? usd(cost) : "$—", tone: "muted" });
    } else chips.push({ text: "0 tokens", tone: "muted" });
    if (d.effects === "external") chips.push({ text: ran.length ? "ran once" : "one-way", icon: ran.length ? IC.lock : undefined, tone: "warning" });
    const sk = skillSummaryChip(ss[ss.length - 1]?.skills, isRun);
    if (sk) chips.push(sk);
  }

  let dots = "";
  let dotsAria = "";
  if (!isTerm && !isGate) {
    const mv = d.maxVisits;
    const nA = ran.length;
    if (mv && mv <= 5) {
      dots = Array.from({ length: mv }, (_, i) => (i < nA ? "●" : "○")).join(" ");
      dotsAria = `${nA} of ${mv} attempts used`;
    } else if (nA > 5 || (mv && mv > 5)) {
      dots = `● ×${nA}`;
      dotsAria = `${nA} attempts`;
    } else if (nA > 1) {
      dots = Array.from({ length: nA }, () => "●").join(" ");
      dotsAria = `${nA} attempts`;
    } else {
      dots = nA ? "●" : "○";
      dotsAria = `${nA} attempt`;
    }
  }

  const lastS = ss[ss.length - 1];
  let timer = "";
  let timerColor = "var(--te-text-muted)";
  if (isRun && lastS) {
    timer = `⏱ ${mmss((now - lastS.startedAt) / 1000)}`;
    timerColor = "var(--te-accent)";
  } else if (status === "parked" && lastS && run?.waitReason === "rate-limited" && run.resumeAt) {
    timer = `⏸ ${mmss((run.resumeAt - now) / 1000)}`;
    timerColor = "var(--te-warning)";
  } else if (lastS?.endedAt) timer = dur((lastS.endedAt - lastS.startedAt) / 1000);

  let outcome = "";
  let outcomeColor = "var(--te-text-soft)";
  if (isGate) {
    const g = gates.find((x) => x.gate === n.id);
    outcome = g?.reason ?? "";
    outcomeColor = status === "refused" ? "var(--te-danger)" : "var(--te-text-dim)";
  } else if (isTerm) {
    outcome = (status === "passed" ? TERMS[n.id]?.left : undefined) ?? TERMS[n.id]?.sub ?? "";
    outcomeColor = "var(--te-text-dim)";
  } else if (isRun || status === "parked" || status === "abandoned") {
    const inp = lastS?.input;
    outcome =
      n.id === "fix" && inp
        ? `fixing ${refusalCount(inp.length)}`
        : status === "parked"
          ? run?.waitReason === "rate-limited"
            ? "paused · quota"
            : "parked"
          : status === "abandoned"
            ? "stopped by user"
            : "working…";
    outcomeColor = isRun ? "var(--te-accent)" : "var(--te-warning)";
  } else if (status === "exhausted") {
    outcome = `budget exhausted · ${ran.length}/${d.maxVisits}`;
    outcomeColor = "var(--te-danger)";
  } else if (lastOut) {
    outcome = oneLine(lastOut);
    if (status === "refused") outcomeColor = "var(--te-danger)";
    if (lastOut.node === "readiness" && !lastOut.ready) outcomeColor = "var(--te-warning)";
  } else if (status === "pending") {
    // A run that succeeded early (e.g. already delivered) never needed the rest.
    outcome = run?.state === "succeeded" ? "not needed" : "not reached";
    outcomeColor = "var(--te-text-muted)";
  }

  const label = isTerm ? n.id : d.label;
  return {
    id: n.id,
    kind: n.kind,
    label,
    status,
    kindIcon: km.icon,
    kindTone: km.tone,
    chips,
    exits: isTerm ? [] : exitsOf(run, layout, n.id, n.id === selectedId),
    dots,
    dotsAria,
    timer,
    timerColor,
    outcome,
    outcomeColor,
    frame,
    topBar,
    struck,
    opacity,
    aria: `${label}, ${isGate ? "gate" : isTerm ? "terminal" : `${d.kind}, ${d.effects}`}, ${sm.text}${outcome ? `, ${outcome}` : ""}`,
  };
}

export function edgeViews(run: Run | null, layout: Layout, focusId: string, allPaths: boolean): EdgeView[] {
  const trans = run?.transitions ?? [];
  const byKey: Record<string, typeof trans> = {};
  trans.forEach((t) => {
    (byKey[`${t.fromNode}>${t.toNode}`] ??= []).push(t);
  });
  const runningStep = run?.steps.find((s) => s.status === "running");
  const into = runningStep && isLive(run) ? trans.filter((t) => t.toNode === runningStep.nodeId).pop() : null;
  const publishRan = !!run?.steps.some((s) => s.nodeId === "publish" && s.status === "succeeded");
  const out: EdgeView[] = [];
  layout.edges.forEach((e) => {
    const ts = byKey[e.key] ?? [];
    const traversed = ts.length > 0;
    if (e.implicit && !traversed) return;
    const side = e.cls === "park" || e.cls === "loop";
    if (side && !traversed && !allPaths && e.from !== focusId && e.to !== focusId) return;
    let tone: Tone | "faint" = "faint";
    if (traversed) {
      tone = e.to === "FAIL" ? "danger" : e.to === "END" ? "success" : e.to === "NEEDS_INPUT" || e.to === "NEEDS_REVIEW" ? "warning" : "accent";
    }
    out.push({
      key: e.key,
      from: e.from,
      to: e.to,
      d: e.d,
      lx: e.lx,
      ly: e.ly,
      color: tone === "faint" ? "var(--te-edge-faint)" : `var(--te-${tone})`,
      marker: `te-wf-m-${tone}`,
      width: traversed ? 2 : 1.5,
      dashed: e.cls === "loop" && !traversed,
      animated: !!into && into.fromNode === e.from && into.toNode === e.to,
      traversed,
      count: ts.length,
      showPill: ts.length > 1 || (ts.length === 1 && e.cls !== "forward" && e.cls !== "down"),
      lock: e.from === "prePublish" && e.to === "publish" && publishRan,
      reasons: ts.map((t) => ({ seq: t.seq, at: hhmm(t.at), reason: t.reason })),
    });
  });
  // Exits share rails, so a taken path is painted over the faint ones on the same rail.
  return out.sort((x, y) => Number(x.traversed) - Number(y.traversed));
}

export function laneViews(run: Run | null, gates: GateResult[], layout: Layout, now: number): LaneView[] {
  const steps = run?.steps ?? [];
  const trans = run?.transitions ?? [];
  const runningStep = steps.find((s) => s.status === "running");
  return layout.lanes.map((l) => {
    const ln = layout.nodes.filter((n) => n.lane === l.id);
    const ss = steps.filter((s) => ln.some((n) => n.id === s.nodeId));
    let status: NodeStatus = "pending";
    if (l.id === "pre-run") status = gates.some((g) => g.status === "refused") ? "refused" : "passed";
    else if (l.id === "terminal") {
      status = trans.some((t) => t.toNode === "END") ? "reached" : trans.some((t) => TERMS[t.toNode]) ? "passed" : "pending";
      if (trans.some((t) => t.toNode === "FAIL")) status = "failed";
      if (run?.state === "waiting" && TERMS[trans[trans.length - 1]?.toNode]?.left) status = "parked";
    } else if (ss.some((s) => s.status === "running")) {
      status = run?.state === "waiting" ? "parked" : run?.state === "cancelled" ? "abandoned" : "running";
    } else if (ss.length && run) {
      const last = ss[ss.length - 1];
      status =
        ((last.status === "refused" || last.status === "failed") && run.state === "failed") ||
        ln.some((n) => nodeStatus(run, gates, n) === "exhausted")
          ? "failed"
          : "succeeded";
    }
    let meta = "";
    if (ss.length) {
      const t0 = ss[0].startedAt;
      const t1 = ss[ss.length - 1].endedAt ?? now;
      meta = `${dur((t1 - t0) / 1000)} · ${usd(ss.reduce((a, s) => a + s.costUsd, 0))}`;
    }
    const inVerify = l.id === "verify" && !!runningStep && ln.some((n) => n.id === runningStep.nodeId);
    const max = run?.maxFixAttempts ?? 5;
    const ring = inVerify && run && run.fixAttempts > 0 ? { text: `Fix round ${Math.max(1, run.fixAttempts)} / ${max}`, fraction: Math.max(1, run.fixAttempts) / max } : null;
    return { id: l.id, title: LANE_TITLE[l.id] ?? l.id, status, meta, active: status === "running", ring };
  });
}

export function bannerOf(run: Run | null, now: number, retried: string | null): Banner | null {
  if (!run) return null;
  const b = (tone: Tone, icon: string, title: string, text: string, extra: Partial<Banner> = {}): Banner => ({ tone, icon, title, text, ...extra });
  if (retried) return b("info", IC.running, "Retry queued.", `A new run will start from ${retried} once admission passes.`);
  if (run.state === "cancelled") return b("muted", IC.pause, "Cancelled.", `You stopped this run at ${hhmm(now)}. Nothing was published; the worktree is kept for inspection.`);
  if (run.state === "preparing") return b("info", IC.running, "Preparing workspace.", `Admitted at ${hhmm(run.startedAt)} · creating isolated worktrees — no tokens spent yet.`);
  if (run.state === "waiting" && run.waitReason === "needs-input") {
    const rd = [...run.steps].reverse().find((s) => s.output?.node === "readiness");
    const n = rd?.output?.node === "readiness" ? rd.output.questions.length : 0;
    return b("warning", IC.pause, "Waiting for the PO.", `The ticket is not ready: ${plural(n, "question")} drafted. Post them from Flow Runner (Ask the PO) — the run rechecks readiness by itself when someone replies.`, { action: { label: "Copy questions", kind: "copy-questions" } });
  }
  if (run.state === "waiting" && run.waitReason === "rate-limited" && run.resumeAt)
    return b("info", IC.clock, "Account quota reached.", `Implement is paused mid-turn and resumes automatically at ${hhmm(run.resumeAt)}.`, { countdown: mmss((run.resumeAt - now) / 1000) });
  if (run.state === "waiting" && run.waitReason === "needs-review" && run.currentNodeId === "implement")
    return b("warning", IC.alert, "No code change needed?", "Implement changed nothing — it found the base already does what the ticket asks. Read its summary, then accept it or retry.", { action: { label: "Open implement", kind: "open-node", nodeId: "implement" } });
  if (run.state === "waiting" && run.waitReason === "needs-review")
    return b("warning", IC.alert, "Publish needs a human.", "The PR read-back did not match — check the branch and the tracker before anything else runs.", { action: { label: "Open read-back", kind: "open-node", nodeId: "verifyPublish" } });
  if (run.state === "failed")
    return b("danger", IC.x, "Failed.", `${run.failure ? run.failure.reason.split(". ")[0] : "Reached FAIL"}.${run.failure?.lesson ? " Lesson recorded to KNOWLEDGE.md." : ""}`,);
  if (run.state === "succeeded") {
    const review = run.transitions[run.transitions.length - 1]?.toNode === "NEEDS_REVIEW" ? run.transitions[run.transitions.length - 1].reason : "";
    if (review && run.currentNodeId === "implement")
      return b("warning", IC.alert, "No change needed · review it.", `Implement changed nothing — the base already does what the ticket asks. The run ended for your review; nothing was committed or published · ${usd(run.costUsd)} total.`, { action: { label: "Open implement", kind: "open-node", nodeId: "implement" } });
    if (review)
      return b("warning", IC.alert, "Published · needs review.", `The PR read-back did not match (${review.replace(/^read-back mismatch: /, "")}) — check the branch and the tracker · ${usd(run.costUsd)} total.`, { action: { label: "Open read-back", kind: "open-node", nodeId: "verifyPublish" } });
    // An END reached before publish means nothing was pushed — say why instead of claiming PRs.
    if (run.currentNodeId === "readiness")
      return b("success", IC.check, "Already delivered.", `Every acceptance criterion is already on the base — nothing was implemented or published · ${usd(run.costUsd)} total.`);
    if (run.currentNodeId === "implement")
      return b("success", IC.check, "No change needed.", `A person confirmed the base already does what the ticket asks — nothing was committed or published · ${usd(run.costUsd)} total.`);
    if (run.currentNodeId === "qaTriage") {
      // A QA follow-up analysis also ends here — whatever it found waits for the developer's decision on Flow Runner.
      const out = stepsOf(run, "qaTriage").pop()?.output;
      const defects = out?.node === "qaTriage" ? out.findings.filter((f) => f.defect).length : 0;
      return defects
        ? b("warning", IC.alert, `${plural(defects, "defect")} found.`, `Analysis only — nothing was changed or pushed. Approve the fix or reply to QC on Flow Runner · ${usd(run.costUsd)} total.`)
        : b("success", IC.check, "No defect found.", `The reply to QA is drafted — nothing was changed or pushed · ${usd(run.costUsd)} total.`);
    }
    return b("success", IC.check, "Succeeded.", run.flow === "implement" ? `Draft PRs are open and verified · ${usd(run.costUsd)} total.` : `Fix pushed to the existing PRs and verified · ${usd(run.costUsd)}.`);
  }
  return null;
}

export function hudOf(run: Run | null, now: number): Hud {
  if (!run) {
    return { stateText: "Refused", tone: "danger", icon: IC.ban, node: "Admission said no — no run exists", flow: "implement", elapsed: "$0.00 · 0 tokens", cost: "$0.00", tokens: "0 / 0", fix: "—", fixColor: "var(--te-text-muted)", bar: [], barAria: "No cost — gates run without tokens" };
  }
  const map: Record<string, [string, Tone, string]> = {
    preparing: ["Preparing", "info", IC.running],
    running: ["Running", "accent", IC.running],
    succeeded: ["Succeeded", "success", IC.check],
    failed: ["Failed", "danger", IC.x],
    cancelled: ["Cancelled", "muted", IC.pause],
  };
  let s = map[run.state];
  if (run.state === "waiting") {
    const rate = run.waitReason === "rate-limited";
    s = [`Waiting · ${run.waitReason}`, rate ? "info" : "warning", rate ? IC.clock : IC.pause];
  }
  const end = run.endedAt ?? now;
  const def = run.defs.find((d) => d.id === run.currentNodeId);
  const total = run.costUsd || 1;
  return {
    stateText: s[0],
    tone: s[1],
    icon: s[2],
    node: `${run.state === "succeeded" ? "Reached END · " : run.state === "failed" ? "Reached FAIL after " : ""}${def ? def.label : run.currentNodeId}`,
    flow: run.flow,
    elapsed: `${dur((end - run.startedAt) / 1000)}${run.endedAt ? " total" : " elapsed"}`,
    cost: usd(run.costUsd),
    tokens: `${ktok(run.inputTokens)} / ${ktok(run.outputTokens)}`,
    fix: `${run.fixAttempts} / ${run.maxFixAttempts}`,
    fixColor: run.fixAttempts >= run.maxFixAttempts ? "var(--te-danger)" : run.fixAttempts ? "var(--te-warning)" : "var(--te-text)",
    bar: PHASES.map((p) => ({ phase: p, pct: (run.costByPhase[p] / total) * 100 })),
    barAria: PHASES.map((p) => `${PHASE_LABEL[p]} ${usd(run.costByPhase[p])}`).join(" · "),
  };
}

export function logLinesOf(run: Run | null, now: number, gates: GateResult[] = []): LogLine[] {
  if (!run) {
    return gates.map((g) => ({ ts: 0, lvl: g.status === "refused" ? "ERROR" : "INFO", node: g.gate, text: g.status === "refused" ? `refused: ${g.reason}` : g.reason, attempt: 1 }));
  }
  if (run.logs) return run.logs;
  const L: LogLine[] = [];
  const add = (ts: number, lvl: LogLine["lvl"], node: string, text: string, attempt: number) => L.push({ ts, lvl, node, text, attempt });
  run.steps.forEach((s) => {
    const a = s.startedAt;
    const def = run.defs.find((d) => d.id === s.nodeId);
    add(a, "INFO", s.nodeId, `▶ start #${s.attempt}${def?.kind === "agent" ? ` · context ${def.context}` : " · 0 tokens"}`, s.attempt);
    if (s.input) add(a + 800, "INFO", s.nodeId, `input bundle: ${s.input.map((r) => r.source).join(", ")}`, s.attempt);
    if (def?.kind === "agent" && s.numTurns) add(a + 2000, "INFO", s.nodeId, `${s.numTurns} turns · ${ktok(s.inputTokens)} in / ${ktok(s.outputTokens)} out`, s.attempt);
    if (s.status === "running") {
      add(now - 3000, "INFO", s.nodeId, run.state === "waiting" ? `paused: ${run.waitReason}` : "working…", s.attempt);
      return;
    }
    if (s.status === "skipped") {
      add(a, "WARN", s.nodeId, "skipped: fix budget exhausted (5/5)", s.attempt);
      return;
    }
    const e = s.endedAt ?? a;
    if (s.output) add(e - 500, s.status === "refused" ? "WARN" : "INFO", s.nodeId, oneLine(s.output), s.attempt);
    add(e, s.status === "failed" ? "ERROR" : s.status === "refused" ? "WARN" : "INFO", s.nodeId, `${s.status === "succeeded" ? "✓ done" : `✗ ${s.status}`} in ${dur((e - a) / 1000)}${s.costUsd ? ` · ${usd(s.costUsd)}` : ""}`, s.attempt);
  });
  run.transitions.forEach((t) => {
    if (TERMS[t.toNode]) add(t.at, t.toNode === "FAIL" ? "ERROR" : t.toNode === "END" ? "INFO" : "WARN", t.fromNode, `→ ${t.toNode}: ${t.reason}`, 0);
  });
  return L.sort((x, y) => x.ts - y.ts);
}

export function timelineOf(run: Run | null, now: number): Timeline {
  if (!run) return { rows: [], ticks: ["0s"], total: "0s" };
  const t0 = run.startedAt;
  const t1 = run.endedAt ?? now;
  const span = Math.max(1, t1 - t0);
  const rows = run.steps.map((s): TimelineRow => {
    const a = s.startedAt;
    const b = s.endedAt ?? now;
    const status: NodeStatus = s.status;
    const def = run.defs.find((d) => d.id === s.nodeId);
    const label = def?.label ?? s.nodeId;
    return {
      nodeId: s.nodeId,
      label,
      attempt: s.attempt,
      status,
      left: ((a - t0) / span) * 100,
      width: Math.max(0.3, ((b - a) / span) * 100),
      title: `${label} #${s.attempt} · ${STATUS[status].text} · ${dur((b - a) / 1000)}`,
      running: s.status === "running",
    };
  });
  return { rows, ticks: [0, 0.25, 0.5, 0.75, 1].map((f) => dur((span * f) / 1000)), total: dur(span / 1000) };
}

/** Share of the prompt served from the prompt cache ("—" before any token is counted). The CLI reports fresh input
 *  and cache reads apart, so the prompt is their sum. */
export function cacheHit(inputTokens: number, cacheReadTokens: number): string {
  const total = inputTokens + cacheReadTokens;
  return total > 0 ? `${Math.round((cacheReadTokens / total) * 100)}%` : "—";
}

/** A rough token count for a brief (≈ 4 characters a token) — enough to see which brief is heavy. */
export const briefTokens = (text: string): number => Math.ceil(text.length / 4);

/** The `## ` sections of a brief, in order, with the line each starts on — the brief's table of contents. */
export function briefOutline(text: string): { title: string; line: number }[] {
  return text.split("\n").flatMap((l, line) => (/^## \S/.test(l) ? [{ title: l.slice(3).trim(), line }] : []));
}

export type DiffLine = { op: "same" | "add" | "del"; text: string };

/** Line diff of two briefs (longest common subsequence) — what a retry was told that the attempt before was not. */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  const n = a.length;
  const m = b.length;
  const L: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ op: "same", text: a[i] });
      i++;
      j++;
    } else if (L[i + 1][j] >= L[i][j + 1]) out.push({ op: "del", text: a[i++] });
    else out.push({ op: "add", text: b[j++] });
  }
  while (i < n) out.push({ op: "del", text: a[i++] });
  while (j < m) out.push({ op: "add", text: b[j++] });
  return out;
}

export function inspectNode(run: Run | null, gates: GateResult[], n: LayoutNode, attempt: number | null, now: number): Inspector {
  const d = n.def;
  const isGate = n.kind === "gate";
  const isTerm = n.kind === "terminal";
  const status = nodeStatus(run, gates, n);
  const km = isTerm ? { icon: TERMS[n.id]?.icon ?? IC.flag, tone: TERMS[n.id]?.tone ?? ("muted" as Tone) } : KIND_META[d.kind];
  const ss = stepsOf(run, n.id);
  const ai = attempt !== null && ss[attempt] ? attempt : ss.length - 1;
  const step: Step | undefined = ss[ai];
  const chips: NodeChip[] = [];
  // Only what tells this node apart: effects/context are the same on every node of a kind (the canvas card carries
  // them), so only a one-way external step keeps its chip.
  if (!isTerm && !isGate) {
    chips.push({ text: d.kind, icon: km.icon, tone: km.tone });
    if (d.effects === "external") chips.push({ text: "effects: external", icon: IC.out, tone: "warning" });
    if (d.maxVisits) chips.push({ text: `max ${d.maxVisits} visits`, tone: "muted" });
    if (step?.model) chips.push({ text: `model: ${step.model}`, tone: "accent" });
    if (step?.effort) chips.push({ text: `effort: ${step.effort}`, tone: "accent" });
  }

  let note: Inspector["note"] = null;
  if (isGate) {
    const g = gates.find((x) => x.gate === n.id);
    if (g) note = { text: g.reason + (g.howTo ? ` — ${g.howTo}` : ""), tone: g.status === "refused" ? "danger" : "success" };
  } else if (d.effects === "external")
    note = { text: "One-way step: it pushes and opens PRs outside this machine. It runs at most once per run, and nothing after it may loop back before it.", tone: "warning" };
  else if (isTerm)
    note = { text: n.id === "END" ? "The run completed successfully." : n.id === "FAIL" ? "The run stopped. See the Run tab for the failure panel." : "The run is parked here until a human acts.", tone: "neutral" };
  else if (step?.input && step.status === "running")
    note = { text: `Working on a merged refusal bundle of ${step.input.length}. See the bundle panel.`, tone: "warning" };

  const out = step?.output ?? null;
  let sections = outSections(out);
  if (step && !out) {
    sections =
      step.status === "skipped"
        ? [kv("Skipped", [["Reason", `Fix budget exhausted (${d.maxVisits ?? 5}/${d.maxVisits ?? 5}) — routed to reflect`, "danger"]])]
        : step.input
          ? refusalSections(step.input, "Input bundle · ")
          : [kv("Output", [["Status", "Not available until the step ends"]])];
  }
  if (isGate) sections = [];

  // The three numbers a developer reads; token accounting and timestamps are kept one tap away.
  const end = step ? step.endedAt ?? now : now;
  const isAgent = d.kind === "agent";
  const pairs = (list: [string, string][]) => list.map(([k, v]) => ({ k, v }));
  const metrics = step
    ? pairs([["Duration", dur((end - step.startedAt) / 1000)], ...(isAgent ? ([["Cost", usd(step.costUsd)], ["Turns", String(step.numTurns || "—")]] as [string, string][]) : [])])
    : [];
  const metricsMore = step
    ? pairs([
        ...(isAgent
          ? ([
              ["Tokens in", ktok(step.inputTokens)],
              ["Tokens out", ktok(step.outputTokens)],
              ["Cache read", ktok(step.cacheReadTokens)],
              ["Cache hit", cacheHit(step.inputTokens, step.cacheReadTokens)],
              ...(step.brief ? ([["Brief", `~${ktok(briefTokens(step.brief))} tokens`]] as [string, string][]) : []),
            ] as [string, string][])
          : []),
        ["Started", clock(step.startedAt)],
        ["Ended", step.endedAt ? clock(step.endedAt) : "—"],
        ["Log lines", `${step.logFrom}–${step.logTo}`],
      ])
    : [];

  const transitions = run
    ? run.transitions
        .filter((t) => t.toNode === n.id || t.fromNode === n.id)
        .map((t) => ({ seq: t.seq, incoming: t.toNode === n.id, other: t.toNode === n.id ? t.fromNode : t.toNode, reason: t.reason }))
    : [];

  // The brief has its own panel; leaving it out keeps the JSON view to the step's result.
  const obj = isGate ? gates.find((x) => x.gate === n.id) : step ? { ...step, brief: undefined } : { nodeId: n.id, status: "pending" };

  return {
    label: isTerm ? n.id : d.label,
    sub: `${n.id}${isGate ? " · pre-run gate" : isTerm ? " · terminal" : ` · ${PHASE_LABEL[d.phase as keyof typeof PHASE_LABEL] ?? d.phase}`}`,
    kindIcon: km.icon,
    kindTone: km.tone,
    status,
    chips,
    skills: (step?.skills ?? []).map((u) => skillChip(u, step?.status === "running")),
    note,
    attempts: ss.map((s) => ({ n: s.attempt, status: s.status })),
    attemptIndex: ai,
    metrics,
    metricsMore,
    error: step?.errorMessage ?? "",
    sections,
    brief: step?.brief ?? "",
    briefPrev: ai > 0 ? ss[ai - 1]?.brief ?? "" : "",
    briefPrevAttempt: ai > 0 ? ss[ai - 1]?.attempt ?? 0 : 0,
    json: JSON.stringify(obj, null, 2),
    transitions,
  };
}

// Every skill of the run against the steps that picked, read, ignored or opened it — the run's skill audit at a glance.
export function skillsSections(run: Run): Section[] {
  const rows = new Map<string, Record<SkillUse["state"], string[]>>();
  for (const s of run.steps) {
    const label = `${run.defs.find((d) => d.id === s.nodeId)?.label ?? s.nodeId}${s.attempt > 1 ? ` #${s.attempt}` : ""}`;
    for (const u of s.skills ?? []) {
      const r = rows.get(u.name) ?? { picked: [], read: [], unread: [], opened: [] };
      // A step still running has not had its chance to read the skill yet.
      if (!(u.state === "unread" && s.status === "running")) r[u.state].push(label);
      rows.set(u.name, r);
    }
  }
  if (!rows.size) return [];
  const cell = (list: string[], tone: Tone): Cell => (list.length ? { t: list.join(", "), tone } : { t: "—" });
  return [
    {
      kind: "table",
      title: "Skills",
      icon: IC.book,
      tone: [...rows.values()].some((r) => r.unread.length) ? "warning" : "accent",
      cols: ["Skill", "Picked by", "Read by", "Never read by", "Opened unasked by"],
      rows: [...rows.entries()].map(([name, r]): Cell[] => [{ t: name, mono: true }, cell(r.picked, "accent"), cell(r.read, "success"), cell(r.unread, "warning"), cell(r.opened, "info")]),
      expandable: true,
    },
  ];
}

export function runSections(run: Run | null, gates: GateResult[], now: number): Section[] {
  if (!run) {
    const g = gates.find((x) => x.status === "refused");
    return [
      kv("No run", [["State", "refused", "danger"], ["Gate", "admission"], ["Reason", g?.reason ?? ""], ["Spent", "$0.00 · 0 tokens"]], IC.ban, "danger"),
      { kind: "md", title: "What happens next", icon: IC.route, tone: "accent", text: g?.howTo ?? "" },
    ];
  }
  const S: Section[] = [];
  const end = run.endedAt ?? now;
  const stateTone: Tone = run.state === "failed" ? "danger" : run.state === "succeeded" ? "success" : run.state === "waiting" ? "warning" : "accent";
  S.push(
    kv("Run", [
      ["Id", run.id, undefined, true],
      ["Flow", run.flow, undefined, true],
      ["State", run.state + (run.waitReason ? ` · ${run.waitReason}` : ""), stateTone],
      ["Started", clock(run.startedAt)],
      ["Elapsed", dur((end - run.startedAt) / 1000)],
      ["Steps", run.steps.length],
      ["Fix rounds", `${run.fixAttempts} / ${run.maxFixAttempts}`],
    ], IC.terminal, stateTone),
  );
  if (run.failure) {
    const f = run.failure;
    S.push({ kind: "md", title: "Failure", icon: IC.x, tone: "danger", text: f.reason });
    S.push(...refusalSections(f.refusals, "Standing · "));
    S.push({ kind: "md", title: "Lesson recorded by reflect", icon: IC.bulb, tone: "warning", text: f.lesson });
    if (run.knowledge)
      S.push({
        kind: "list",
        title: "KNOWLEDGE.md diff",
        icon: IC.diff,
        tone: "muted",
        items: [
          ...run.knowledge.added.map((text): ListItem => ({ mark: "+", tone: "success", text, textTone: "success", mono: true })),
          ...run.knowledge.removed.map((text): ListItem => ({ mark: "−", tone: "danger", text, textTone: "danger", mono: true })),
        ],
      });
    const advice = retryAdviceOf(run)!;
    const options = run.defs
      .filter((d) => d.kind !== "gate")
      .slice(0, 15)
      .map((d) => ({ id: d.id, label: d.label, external: d.effects === "external", enabled: d.effects !== "external" && f.retryableFrom.includes(d.id) }));
    if (canStartFresh(run)) options.unshift({ id: FRESH_START, label: "Fresh start", external: false, enabled: true });
    S.push({ kind: "retry", title: "Retry", icon: IC.running, options, defaultId: advice.defaultId, suggestedId: advice.suggestedId, advice: { title: advice.title, text: advice.text, tone: advice.tone } });
  }
  if (run.bundle && run.state === "running") {
    S.push({ kind: "md", title: run.bundle.title, icon: IC.alert, tone: "warning", text: run.bundle.sub });
    S.push(...refusalSections(run.bundle.items));
  }
  const pub = [...run.steps].reverse().find((s) => s.nodeId === "publish" && s.output);
  if (pub) S.push(...outSections(pub.output).slice(0, 1));
  const rd = run.steps.find((s) => s.output?.node === "readiness" && !s.output.ready);
  if (rd) S.push(...outSections(rd.output).filter((s) => s.kind === "copy" || (s.kind === "list" && ["Missing", "Ambiguities", "Draft questions for the PO"].includes(s.title ?? ""))));
  S.push(...skillsSections(run));
  const tot = run.costUsd || 1;
  S.push({ kind: "bar", title: "Cost by phase", icon: IC.clock, tone: "accent", bars: PHASES.map((p) => ({ k: PHASE_LABEL[p], v: usd(run.costByPhase[p]), w: (run.costByPhase[p] / tot) * 100, phase: p })) });
  return S;
}

export function statusTone(status: NodeStatus): Tone {
  return STATUS[status].tone;
}

/** The retry option that starts a new run from the top instead of restarting this one from a node. */
export const FRESH_START = "fresh";

// Only an implement run can be started over from here: a review or QA fix needs its pull request or QC case.
const canStartFresh = (run: Run) => run.flow === "implement";

const ADVICE: Record<FailureClass, { title: string; text: string; tone: Tone }> = {
  transient: { title: "Transient failure", text: "Likely passes on retry.", tone: "info" },
  env: { title: "Setup failure", text: "Fix the setup first (repo, credential or tool) — retrying will fail again.", tone: "danger" },
  agent: { title: "The agent stopped", text: "Read the blockers and the lesson before retrying; consider retrying from plan.", tone: "warning" },
};

export type RetryAdvice = { cls: FailureClass; suggestedId: string | null; defaultId: string; title: string; text: string; tone: Tone };

/** How a failed run is best retried: `retryNodeFor()` preselected (null = start fresh), and what its failure class means. */
export function retryAdviceOf(run: Run | null): RetryAdvice | null {
  const f = run?.failure;
  if (!run || !f) return null;
  const cls = classifyFailure(f.reason);
  const suggestedId = retryNodeFor(run.currentNodeId, f.retryableFrom);
  const fresh = canStartFresh(run);
  const a = ADVICE[cls];
  const text = suggestedId ? a.text : `${a.text} It failed before anything worth keeping — a fresh start is suggested${fresh ? "." : "; start it again from Flow Runner."}`;
  return { cls, suggestedId, defaultId: suggestedId ?? (fresh ? FRESH_START : (f.retryableFrom[0] ?? "")), title: a.title, text, tone: a.tone };
}

export type RunEnd = { state: string; tone: Tone; reason: string; cost: string };

export type RunDiff = {
  prev: RunEnd;
  cur: RunEnd;
  /** same | changed | new (the previous run had none) | none (this run has no plan yet). */
  plan: "same" | "changed" | "new" | "none";
  /** Review blockers by text; null when neither run reached a review. `pending`: this run has not been reviewed yet. */
  blockers: { resolved: string[]; standing: string[]; added: string[]; pending: boolean } | null;
  delta: string;
};

type DiffSide = { run: Run; planMd: string };

const STATE_TONE: Record<string, Tone> = { failed: "danger", succeeded: "success", waiting: "warning", cancelled: "muted", running: "accent", preparing: "info" };

function endOf(run: Run): RunEnd {
  const node = run.defs.find((d) => d.id === run.currentNodeId)?.label ?? run.currentNodeId;
  const lastT = run.transitions[run.transitions.length - 1];
  const reason =
    run.state === "failed"
      ? (run.failure?.reason ?? "Reached FAIL")
      : run.state === "waiting"
        ? `Parked · ${run.waitReason ?? ""}`
        : run.state === "succeeded" || run.state === "cancelled"
          ? (lastT?.reason ?? "")
          : "In progress";
  return { state: `${run.state} · ${node}`, tone: STATE_TONE[run.state] ?? "muted", reason, cost: usd(run.costUsd) };
}

const blockerKey = (r: Refusal) => r.issue.trim().toLowerCase().replace(/\s+/g, " ");
const blockerText = (r: Refusal) => (r.file ? `${r.file}: ${r.issue}` : r.issue);

function lastBlockers(run: Run): Refusal[] | null {
  const out = [...run.steps].reverse().find((s) => s.output?.node === "evaluate")?.output;
  return out?.node === "evaluate" ? out.blockers : null;
}

/** What changed between a retry and the run it retried: end state, plan, review blockers by text, and cost. */
export function compareRuns(prev: DiffSide, cur: DiffSide): RunDiff {
  const p = prev.planMd.trim();
  const c = cur.planMd.trim();
  const plan = !c ? "none" : !p ? "new" : p === c ? "same" : "changed";
  const pb = lastBlockers(prev.run);
  const cb = lastBlockers(cur.run);
  let blockers: RunDiff["blockers"] = null;
  if (pb && !cb) blockers = { resolved: [], standing: [], added: [], pending: true };
  else if (cb) {
    const before = new Set((pb ?? []).map(blockerKey));
    const now = new Set(cb.map(blockerKey));
    blockers = {
      resolved: (pb ?? []).filter((r) => !now.has(blockerKey(r))).map(blockerText),
      standing: cb.filter((r) => before.has(blockerKey(r))).map(blockerText),
      added: cb.filter((r) => !before.has(blockerKey(r))).map(blockerText),
      pending: false,
    };
  }
  const d = cur.run.costUsd - prev.run.costUsd;
  return { prev: endOf(prev.run), cur: endOf(cur.run), plan, blockers, delta: `${d < 0 ? "−" : "+"}${usd(Math.abs(d))}` };
}
