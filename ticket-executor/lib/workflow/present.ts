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
  Step,
  Tone,
} from "./types";

export type NodeChip = { text: string; icon?: string; tone: Tone };

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
  note: { text: string; tone: Tone | "neutral" } | null;
  attempts: { n: number; status: NodeStatus }[];
  attemptIndex: number;
  metrics: { k: string; v: string }[];
  error: string;
  sections: Section[];
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
      return `${out.mode} · ${plural(out.repos.length, "repo")}`;
    case "readiness":
      if (!out.ready) return `${out.questions.length} questions for PO`;
      return out.delivery?.status === "done" ? "Already delivered" : out.delivery?.status === "partial" ? `Ready · ${out.delivery.evidence.length} AC delivered` : "Ready";
    case "plan": {
      const files = new Set<string>();
      out.acMap.forEach((a) => a.files.forEach((f) => files.add(f)));
      return `${out.acMap.length} AC → ${files.size} files`;
    }
    case "planCheck":
    case "prePublish":
      return out.passed ? "OK" : plural(out.issues.length, "issue");
    case "implement":
      return `${out.filesChanged} files · tests ${out.verification.tests}`;
    case "fix":
      return `fixed ${refusalCount((out.addressed ?? []).length)} · ${out.filesChanged} files`;
    case "syncBase":
      return out.conflicts.length ? plural(out.conflicts.length, "conflict") : out.rebased ? `rebased · was ${out.behindBy} behind` : "up to date";
    case "testGate": {
      const t = out.results.reduce((n, r) => n + r.tests.length, 0);
      const bad = out.results.filter((r) => !r.passed).length;
      return `${plural(out.results.length, "repo")} · ${plural(t, "test file")}${bad ? ` · ${bad} refused` : ""}`;
    }
    case "diffGuard":
      return out.passed ? "OK" : plural(out.violations.length, "violation");
    case "evaluate":
      return out.verdict === "pass" ? "pass" : plural(out.blockers.length, "blocker");
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
  return Object.keys(groups).map((src) => {
    const m = REFUSAL_SOURCE[src] ?? { title: src, icon: IC.alert, tone: "muted" as Tone };
    return {
      kind: "list",
      title: `${prefix}${m.title} · ${groups[src].length}`,
      icon: m.icon,
      tone: m.tone,
      items: groups[src].map((r) => ({ mark: "•", text: r.issue, sub: r.file })),
    };
  });
}

const kv = (title: string | undefined, rows: [string, string | number, Tone?, boolean?][]): Section => ({
  kind: "kv",
  title,
  rows: rows.map(([k, v, tone, mono]) => ({ k, v: String(v), tone, mono })),
});

const items = (list: string[], icon: string, tone: Tone): ListItem[] => list.map((text) => ({ icon, tone, text }));

export function outSections(out: NodeOutput | null): Section[] {
  if (!out) return [];
  switch (out.node) {
    case "setup":
      return [
        kv("Workspace", [["Mode", out.mode], ["Branch", out.branch, undefined, true], ["Base", out.baseSha, undefined, true]]),
        { kind: "list", title: "Repos", items: out.repos.map((r) => ({ icon: IC.git, tone: "muted" as Tone, text: r.name, sub: r.path })) },
      ];
    case "readiness": {
      const S: Section[] = [kv("Verdict", [["Ready", out.ready ? "Yes" : "No — run parked", out.ready ? "success" : "warning"]])];
      if (out.missing.length) S.push({ kind: "list", title: "Missing", items: items(out.missing, IC.alert, "warning") });
      if (out.ambiguities.length) S.push({ kind: "list", title: "Ambiguities", items: items(out.ambiguities, IC.alert, "warning") });
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
      if (out.delivery?.evidence.length) {
        S.push({
          kind: "table",
          title: out.delivery.status === "done" ? "Already delivered — nothing to implement" : "Already delivered",
          cols: ["Acceptance criterion", "Repo", "Proof"],
          rows: out.delivery.evidence.map((e): Cell[] => [{ t: e.ac }, { t: e.repo, mono: true }, { t: e.proof, mono: true }]),
        });
      }
      return S;
    }
    case "plan":
      return [
        {
          kind: "table",
          title: "AC → files → test",
          cols: ["Acceptance criterion", "Files", "Test"],
          rows: out.acMap.map((a): Cell[] => [a.ac, { t: a.files.map((f) => f.split("/").pop()).join(", "), mono: true }, { t: a.test, mono: true, tone: "info" }]),
        },
        { kind: "list", title: "Risks", items: items(out.risks, IC.alert, "warning") },
        { kind: "md", title: "Plan", text: out.planMd },
      ];
    case "planCheck":
    case "prePublish": {
      const S: Section[] = [kv("Verdict", [["Passed", out.passed ? "Yes" : "No", out.passed ? "success" : "danger"]])];
      if (out.issues.length) S.push({ kind: "list", title: "Issues", items: items(out.issues, IC.x, "danger") });
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
          ["Test exemption", out.testExemption || "none"],
        ]),
        { kind: "md", title: "Summary", text: out.summary },
      ];
      if (out.addressed?.length) S.push(...refusalSections(out.addressed, "Asked to fix · "));
      return S;
    }
    case "syncBase": {
      const S: Section[] = [
        kv("Sync", [
          ["Rebased", out.rebased ? "yes" : "no"],
          ["Behind base by", `${out.behindBy} commits`],
          ["Conflicts", out.conflicts.length || "none", out.conflicts.length ? "danger" : "success"],
        ]),
      ];
      if (out.conflicts.length) S.push({ kind: "list", title: "Conflicts", items: items(out.conflicts, IC.x, "danger") });
      return S;
    }
    case "testGate":
      return [
        {
          kind: "table",
          title: "Committed diff vs base",
          cols: ["Repo", "Files", "Test files", "Result"],
          rows: out.results.map((r): Cell[] => [
            { t: r.repo, mono: true },
            String(r.files),
            { t: r.tests.map((f) => f.split("/").pop()).join(", ") || "—", mono: true, tone: r.tests.length ? "info" : "muted" },
            { t: r.passed ? "✓ pass" : r.issue, tone: r.passed ? "success" : "danger" },
          ]),
        },
      ];
    case "diffGuard":
      return out.violations.length
        ? [{ kind: "table", title: "Warnings · for the reviewer", cols: ["Rule", "File"], rows: out.violations.map((v): Cell[] => [{ t: v.rule, tone: "warning", mono: true }, { t: v.file, mono: true }]) }]
        : [kv("Verdict", [["Violations", "none", "success"]])];
    case "evaluate":
      return [
        kv("Verdict", [["Verdict", out.verdict, out.verdict === "pass" ? "success" : "danger"], ["Reviewed", out.reviewedDelta ? "delta since last review" : "full diff"]]),
        ...refusalSections(out.blockers, "Blockers · "),
      ];
    case "reflect": {
      const S: Section[] = [kv("Lesson", [["Recorded", out.recorded ? "yes · KNOWLEDGE.md" : "no"]])];
      if (out.lesson) S.push({ kind: "md", title: "Lesson", text: out.lesson });
      return S;
    }
    case "publish":
      return [
        {
          kind: "prs",
          title: "Pull requests",
          prs: out.prs.map((p) => ({ repo: p.repo, num: p.number, url: p.url, meta: p.reusedExisting ? "Reused existing PR" : "Opened by this run", draft: p.draft })),
        },
      ];
    case "verifyPublish":
      return [
        {
          kind: "list",
          title: "Read-back checks",
          items: out.checks.map((c) => ({ icon: c.ok ? IC.check : IC.x, tone: (c.ok ? "success" : "danger") as Tone, text: c.name, textTone: c.ok ? undefined : ("danger" as Tone) })),
        },
      ];
    case "reviewTriage":
      return [
        {
          kind: "table",
          title: "Thread decisions",
          cols: ["Thread", "Decision", "Why"],
          rows: out.threads.map((t): Cell[] => [{ t: t.file || t.comment, mono: !!t.file }, { t: t.decision, tone: t.decision === "fix" ? "warning" : "muted" }, t.reason]),
        },
        { kind: "md", title: "Plan", text: out.planMd },
      ];
    case "qaTriage": {
      const S: Section[] = [
        {
          kind: "table",
          title: "QA findings",
          cols: ["Finding", "Defect", "Why"],
          rows: out.findings.map((f): Cell[] => [f.finding, { t: f.defect ? "yes" : "no", tone: f.defect ? "danger" : "success" }, { t: f.reason, mono: true }]),
        },
      ];
      if (out.qaReply) S.push({ kind: "md", title: "Reply to QA", text: out.qaReply });
      if (out.planMd) S.push({ kind: "md", title: "Plan", text: out.planMd });
      return S;
    }
    case "respond":
      return [kv("Result", [["Pushed", out.pushed ? "yes" : "no"], ["Threads answered", out.threadsReplied, out.threadsReplied ? "success" : "danger"], ["Resolved", "never — the reviewer decides"]])];
  }
}

type NodeLike = Pick<LayoutNode, "id" | "kind" | "def">;

const stepsOf = (run: Run | null, id: string): Step[] => (run ? run.steps.filter((s) => s.nodeId === id) : []);

export function nodeStatus(run: Run | null, gates: GateResult[], n: NodeLike): NodeStatus {
  if (n.kind === "gate") return gates.find((g) => g.gate === n.id)?.status ?? "pending";
  if (n.kind === "terminal") {
    if (!run?.transitions.some((t) => t.toNode === n.id)) return "pending";
    return n.id === "END" ? "reached" : n.id === "FAIL" ? "failed" : "parked";
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
    outcome = TERMS[n.id]?.sub ?? "";
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
      status = trans.some((t) => TERMS[t.toNode]) ? "reached" : "pending";
      if (trans.some((t) => t.toNode === "FAIL")) status = "failed";
      if (trans.some((t) => t.toNode === "NEEDS_INPUT" || t.toNode === "NEEDS_REVIEW")) status = "parked";
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
    return b("warning", IC.pause, "Waiting for the PO.", `The ticket is not ready: ${plural(n, "question")} drafted. The run resumes at readiness once the ticket is updated.`, { action: { label: "Copy questions", kind: "copy-questions" } });
  }
  if (run.state === "waiting" && run.waitReason === "rate-limited" && run.resumeAt)
    return b("info", IC.clock, "Account quota reached.", `Implement is paused mid-turn and resumes automatically at ${hhmm(run.resumeAt)}.`, { countdown: mmss((run.resumeAt - now) / 1000) });
  if (run.state === "waiting" && run.waitReason === "needs-review")
    return b("warning", IC.alert, "Publish needs a human.", "The PR read-back did not match — check the branch and the tracker before anything else runs.", { action: { label: "Open read-back", kind: "open-node", nodeId: "verifyPublish" } });
  if (run.state === "failed")
    return b("danger", IC.x, "Failed.", `${run.failure ? run.failure.reason.split(". ")[0] : "Reached FAIL"}.${run.failure?.lesson ? " Lesson recorded to KNOWLEDGE.md." : ""}`, { action: { label: "Retry from…", kind: "open-run" } });
  if (run.state === "succeeded")
    return b("success", IC.check, "Succeeded.", run.flow === "implement" ? `Draft PRs are open and verified · ${usd(run.costUsd)} total.` : `Fix pushed to the existing PRs and verified · ${usd(run.costUsd)}.`);
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
  if (!isTerm && !isGate) {
    chips.push({ text: d.kind, icon: km.icon, tone: km.tone });
    chips.push({ text: `effects: ${d.effects}`, icon: d.effects === "external" ? IC.out : undefined, tone: d.effects === "external" ? "warning" : "muted" });
    if (d.context) chips.push({ text: `context: ${d.context}`, tone: "indigo" });
    if (d.maxVisits) chips.push({ text: `max ${d.maxVisits} visits`, tone: "muted" });
    if (d.kind !== "agent") chips.push({ text: "0 tokens", tone: "muted" });
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

  const end = step ? step.endedAt ?? now : now;
  const metrics = step
    ? ([
        ["Duration", dur((end - step.startedAt) / 1000)],
        ["Cost", usd(step.costUsd)],
        ["Turns", String(step.numTurns || "—")],
        ["Tokens in", ktok(step.inputTokens)],
        ["Tokens out", ktok(step.outputTokens)],
        ["Cache read", ktok(step.cacheReadTokens)],
        ["Started", clock(step.startedAt)],
        ["Ended", step.endedAt ? clock(step.endedAt) : "—"],
        ["Log lines", `${step.logFrom}–${step.logTo}`],
      ] as [string, string][]).map(([k, v]) => ({ k, v }))
    : [];

  const transitions = run
    ? run.transitions
        .filter((t) => t.toNode === n.id || t.fromNode === n.id)
        .map((t) => ({ seq: t.seq, incoming: t.toNode === n.id, other: t.toNode === n.id ? t.fromNode : t.toNode, reason: t.reason }))
    : [];

  const obj = isGate ? gates.find((x) => x.gate === n.id) : (step ?? { nodeId: n.id, status: "pending" });

  return {
    label: isTerm ? n.id : d.label,
    sub: `${n.id}${isGate ? " · pre-run gate" : isTerm ? " · terminal" : ` · ${PHASE_LABEL[d.phase as keyof typeof PHASE_LABEL] ?? d.phase}`}`,
    kindIcon: km.icon,
    kindTone: km.tone,
    status,
    chips,
    note,
    attempts: ss.map((s) => ({ n: s.attempt, status: s.status })),
    attemptIndex: ai,
    metrics,
    error: step?.errorMessage ?? "",
    sections,
    json: JSON.stringify(obj, null, 2),
    transitions,
  };
}

export function runSections(run: Run | null, gates: GateResult[], now: number): Section[] {
  if (!run) {
    const g = gates.find((x) => x.status === "refused");
    return [
      kv("No run", [["State", "refused", "danger"], ["Gate", "admission"], ["Reason", g?.reason ?? ""], ["Spent", "$0.00 · 0 tokens"]]),
      { kind: "md", title: "What happens next", text: g?.howTo ?? "" },
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
    ]),
  );
  if (run.failure) {
    const f = run.failure;
    S.push({ kind: "md", title: "Failure", icon: IC.x, tone: "danger", text: f.reason });
    S.push(...refusalSections(f.refusals, "Standing · "));
    S.push({ kind: "md", title: "Lesson recorded by reflect", icon: IC.book, text: f.lesson });
    if (run.knowledge)
      S.push({
        kind: "list",
        title: "KNOWLEDGE.md diff",
        items: [
          ...run.knowledge.added.map((text): ListItem => ({ mark: "+", tone: "success", text, textTone: "success", mono: true })),
          ...run.knowledge.removed.map((text): ListItem => ({ mark: "−", tone: "danger", text, textTone: "danger", mono: true })),
        ],
      });
    const options = run.defs
      .filter((d) => d.kind !== "gate")
      .slice(0, 15)
      .map((d) => ({ id: d.id, label: d.label, external: d.effects === "external", enabled: d.effects !== "external" && f.retryableFrom.includes(d.id) }));
    S.push({ kind: "retry", title: "Retry from…", icon: IC.running, options, defaultId: f.retryableFrom[0] });
  }
  if (run.bundle && run.state === "running") {
    S.push({ kind: "md", title: run.bundle.title, icon: IC.alert, tone: "warning", text: run.bundle.sub });
    S.push(...refusalSections(run.bundle.items));
  }
  const pub = [...run.steps].reverse().find((s) => s.nodeId === "publish" && s.output);
  if (pub) S.push(...outSections(pub.output).slice(0, 1));
  const rd = run.steps.find((s) => s.output?.node === "readiness" && !s.output.ready);
  if (rd) S.push(...outSections(rd.output).slice(1));
  const tot = run.costUsd || 1;
  S.push({ kind: "bar", title: "Cost by phase", bars: PHASES.map((p) => ({ k: PHASE_LABEL[p], v: usd(run.costByPhase[p]), w: (run.costByPhase[p] / tot) * 100, phase: p })) });
  return S;
}

export function statusTone(status: NodeStatus): Tone {
  return STATUS[status].tone;
}
