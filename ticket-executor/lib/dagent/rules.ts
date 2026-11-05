import type { SkillUse } from "../workflow/types";
import type { Ctx, Refusal } from "./types";

const norm = (p: string) => p.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();

export const isScratch = (p: string) => norm(p).startsWith(".te/");

export const LOCAL_INSTRUCTIONS = "CLAUDE.local.md";

export type ChangedFile = { repo: string; path: string };

export type AddedLine = ChangedFile & { line: string };

export type Violation = { rule: string; file: string };

const AGENT_FILE = /(^|\/)(CLAUDE(\.local)?\.md|KNOWLEDGE\.md)$|^\.te\/|^\.claude\//i;
const SECRET_FILE = /(^|\/)(\.env(\.(?!example$|sample$|template$)[^/]+)?|[^/]+\.(pem|pfx|p12|key)|id_rsa[^/]*)$/i;
const CONFIG_FILE = /(^|\/)(appsettings[^/]*\.json|web\.config|app\.config|docker-compose[^/]*\.ya?ml|azure-pipelines[^/]*\.ya?ml|\.gitlab-ci\.yml)$/i;
const SECRET_TEXT = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bghp_[A-Za-z0-9]{36}\b/,
  /\bglpat-[A-Za-z0-9_-]{20}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  // Azure storage / Service Bus / Event Hub keys in a connection string.
  /\b(AccountKey|SharedAccessKey)=[A-Za-z0-9+/]{30,}={0,2}/,
  // Anthropic / OpenAI-style and Google API keys.
  /\bsk-(ant-)?[A-Za-z0-9_-]{32,}/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  // A password in a connection string to a non-local server, unless it is a placeholder.
  /\b(Server|Data Source|Host)\s*=\s*(?!localhost|\(local|127\.0\.0\.1|\.[;\\])[^;\n]*;[^\n]*\b(Password|Pwd)\s*=\s*(?![*<${]|your|password|changeme|x{3})[^;"'\s]{4,}/i,
];

/** Rules that must never reach a remote: they go straight to the fixer, never past the review to publish. */
export const HARD_RULES = new Set(["no-agent-files", "no-secret-files", "no-secrets-in-diff"]);

export function isPlanned(file: ChangedFile, planned: string[]): boolean {
  const own = norm(file.path);
  const full = norm(`${file.repo}/${file.path}`);
  return planned.some((p) => {
    const q = norm(p);
    return q === own || q === full || full.endsWith(`/${q}`);
  });
}

export function diffViolations(files: ChangedFile[], added: AddedLine[], planned: string[]): Violation[] {
  const out: Violation[] = [];
  const label = (f: ChangedFile) => `${f.repo}/${f.path}`;
  for (const f of files) {
    if (AGENT_FILE.test(f.path)) out.push({ rule: "no-agent-files", file: label(f) });
    else if (SECRET_FILE.test(f.path)) out.push({ rule: "no-secret-files", file: label(f) });
    else if (CONFIG_FILE.test(f.path) && !isPlanned(f, planned)) out.push({ rule: "no-unplanned-config", file: label(f) });
  }
  const seen = new Set<string>();
  for (const a of added) {
    const key = label(a);
    if (seen.has(key) || !SECRET_TEXT.some((r) => r.test(a.line))) continue;
    seen.add(key);
    out.push({ rule: "no-secrets-in-diff", file: key });
  }
  return out;
}

const VIOLATION_WHY: Record<string, string> = {
  "no-agent-files": "Agent/run files must never be committed — remove it from the commits",
  "no-secret-files": "Secret or environment file committed — remove it from the commits",
  "no-unplanned-config": "Configuration file changed but not in the plan — revert it or justify it in the plan",
  "no-secrets-in-diff": "An added line looks like a credential — remove it from the commits",
};

// A later commit that deletes it still pushes it: the commits that added it must be rewritten.
const REWRITE =
  "It is absent from every commit on this branch since the base — rewrite this branch's own unpushed commits to drop it " +
  "(e.g. `git reset --soft <base>` and commit again); a later commit that deletes it still pushes it.";

/** Soft rules become warnings for the reviewer; hard rules become blockers the fixer gets straight away. */
export function violationRefusals(v: Violation[]): { blockers: Refusal[]; warnings: Refusal[] } {
  const as = (x: Violation): Refusal => ({ source: "diffGuard", file: x.file, issue: `${VIOLATION_WHY[x.rule] ?? x.rule} (rule: ${x.rule})` });
  return {
    blockers: v.filter((x) => HARD_RULES.has(x.rule)).map((x) => ({ ...as(x), expected: REWRITE })),
    warnings: v.filter((x) => !HARD_RULES.has(x.rule)).map(as),
  };
}

/**
 * What the fixer works on. The harness checks run after every fix (fix → syncBase → diffGuard → evaluate) and route to
 * the fixer the moment they refuse, so a refusal on the newest check is the current one: a rebase conflict first, then
 * a hard diff violation, otherwise the reviewer's blockers.
 */
export function fixBlockersOf(c: Pick<Ctx, "channels">): Refusal[] {
  const sync = listOf(c.channels.syncBase?.blockers);
  if (sync.length) return sync;
  const guard = listOf(c.channels.diffGuard?.blockers);
  return guard.length ? guard : bundleOf(c);
}

export type PlanData = { branch?: unknown; acMap?: unknown; repos?: unknown; decisions?: unknown; planMd?: unknown };

/** One AC map row. `n` and `change` are absent on plans written before they existed — read those as numbered in
 *  order and as code changes. */
export type AcRow = { n?: number; ac?: string; change?: "code" | "none"; files?: string[]; test?: string };

export const acRows = (plan: Record<string, unknown> | undefined): AcRow[] => (Array.isArray(plan?.acMap) ? (plan.acMap as AcRow[]) : []);

/** `delivered`: the criteria readiness proved already on the base — the plan must change no code for them. */
export function planIssues(acceptanceCriteria: string[], plan: PlanData, repoNames: string[], delivered: string[] = []): string[] {
  const issues: string[] = [];
  const acMap = acRows(plan);
  const total = acceptanceCriteria.length;
  // Matched on the criterion's text as readiness wrote it, the same way checkReadiness() counts its proof.
  const done = new Set(delivered.map((a) => a.trim()));
  if (!String(plan.planMd ?? "").trim()) issues.push("`planMd` is empty — the plan has no goal or steps.");
  if (!String(plan.branch ?? "").trim()) issues.push("No branch name was proposed.");
  if (!acMap.length) issues.push("The plan maps no acceptance criterion.");
  // Matched by number, not by count: a criterion mapped twice must never hide one left out.
  else
    for (let n = 1; n <= total; n++) {
      const k = acMap.filter((a) => a.n === n).length;
      if (k === 0) issues.push(`Acceptance criterion ${n} ("${acceptanceCriteria[n - 1]}") is not mapped.`);
      else if (k > 1) issues.push(`Acceptance criterion ${n} is mapped ${k} times — map it once.`);
    }
  acMap.forEach((a) => {
    const label = `Acceptance criterion ${a.n ?? "?"} ("${a.ac ?? ""}")`;
    if (!Number.isInteger(a.n) || (a.n as number) < 1 || (a.n as number) > total) issues.push(`${label} has no number from 1 to ${total}.`);
    if (a.change !== "none" && !a.files?.length) issues.push(`${label} changes code but names no file — or mark it change=none.`);
    if (!String(a.test ?? "").trim()) issues.push(`${label} names no ${a.change === "none" ? "way to verify it" : "test"}.`);
    const stated = Number.isInteger(a.n) ? acceptanceCriteria[(a.n as number) - 1] : undefined;
    if (a.change !== "none" && stated !== undefined && done.has(stated.trim())) {
      issues.push(`${label} is already delivered on the base (readiness proved it) — map it change=none to where it lives.`);
    }
  });
  const decisions = Array.isArray(plan.decisions) ? (plan.decisions as { point?: string; decision?: string }[]) : [];
  decisions.forEach((d, i) => {
    if (!String(d.point ?? "").trim() || !String(d.decision ?? "").trim()) issues.push(`Decision ${i + 1} does not state both the open point and the reading chosen.`);
  });
  const known = new Set(repoNames.map(norm));
  const repos = Array.isArray(plan.repos) ? (plan.repos as string[]) : [];
  for (const r of repos) if (!known.has(norm(r))) issues.push(`Repository "${r}" is not one this run was given (${repoNames.join(", ")}).`);
  return issues;
}

const cell = (s: unknown) => String(s ?? "").replace(/\s*\n\s*/g, " ").replace(/\|/g, "\\|").trim();

/** `.te/plan.md` as the implementer and reviewer read it: the planner's prose, then the AC map, risks and decisions
 *  rendered from the structured fields — so the planner writes each once and the file can never disagree with them. */
export function renderPlan(plan: Record<string, unknown>): string {
  const rows = acRows(plan);
  const risks = Array.isArray(plan.risks) ? (plan.risks as string[]) : [];
  const decisions = Array.isArray(plan.decisions) ? (plan.decisions as { point?: string; decision?: string; why?: string }[]) : [];
  const parts = [String(plan.planMd ?? "").trim()];
  if (rows.length) {
    parts.push(
      [
        "## Acceptance criteria → files → test",
        "| # | AC | Change | Files | Test / verify by |",
        "|---|----|--------|-------|------------------|",
        ...rows.map((a, i) => `| ${a.n ?? i + 1} | ${cell(a.ac)} | ${a.change === "none" ? "none" : "code"} | ${cell((a.files ?? []).join(", ")) || "—"} | ${cell(a.test)} |`),
      ].join("\n"),
    );
  }
  parts.push(["## Risks", ...(risks.length ? risks.map((r) => `- ${cell(r)}`) : ["none"])].join("\n"));
  parts.push(
    [
      "## Decisions",
      ...(decisions.length
        ? ["| # | Point the ticket leaves open | Decision | Why (evidence) |", "|---|---|---|---|", ...decisions.map((d, i) => `| ${i + 1} | ${cell(d.point)} | ${cell(d.decision)} | ${cell(d.why)} |`)]
        : ["none"]),
    ].join("\n"),
  );
  return parts.filter(Boolean).join("\n\n");
}

export type CodeLead = { at: string; what: string };

/** Where readiness found the code — the planner's starting points. */
export function codeLeadsOf(c: Pick<Ctx, "channels">): CodeLead[] {
  const l = c.channels.readiness?.codeLeads;
  return Array.isArray(l) ? (l as CodeLead[]).filter((x) => x && String(x.at ?? "").trim()) : [];
}

/**
 * The harness's read of a review's own consistency. A pass is only worth something with evidence behind it; these
 * never change the route (another review would cost more than it buys) — they are logged and shown as an unproven pass.
 */
export function checkReview(data: Record<string, unknown>): string[] {
  const checked = Array.isArray(data.checked) ? (data.checked as { result?: string }[]) : [];
  const blockers = Array.isArray(data.blockers) ? data.blockers.length : 0;
  const issues = checked.filter((x) => x.result === "issue").length;
  const notes: string[] = [];
  if (data.verdict === "pass" && !checked.length) notes.push("pass with no checked evidence — nothing shows what was verified");
  if (data.verdict === "pass" && issues && !blockers) notes.push(`pass with ${issues} check(s) marked issue and no blocker`);
  if (data.verdict !== "pass" && !blockers) notes.push("changes-required with no blocker — routed as a pass");
  return notes;
}

const words = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9_]{3,}/g) ?? []);
const fileOf = (r: Refusal) => norm(String(r.file ?? "").replace(/:\d+.*$/, ""));

// Word overlap of two issue texts: a reviewer re-raising a blocker rewords it, so equal text is too strict.
function similar(a: string, b: string): boolean {
  const x = words(a);
  const y = words(b);
  if (!x.size || !y.size) return a.trim() === b.trim();
  const shared = [...x].filter((w) => y.has(w)).length;
  return shared / (x.size + y.size - shared) >= 0.5;
}

/** The blockers the last fix was given, when they came from the review (not from a harness check). */
export function lastFixInputOf(c: Pick<Ctx, "channels">): Refusal[] {
  const input = c.channels.fix?.input;
  return Array.isArray(input) ? (input as Refusal[]) : [];
}

/**
 * A fix round that changed nothing: the review raises as many blockers as the last fix was given, each on the same
 * file and in much the same words. Another round would only repeat it, so the run stops instead of spending the rest
 * of the fix budget.
 */
export function stalledFix(c: Pick<Ctx, "channels" | "visits">): boolean {
  if (!(c.visits.fix ?? 0)) return false;
  const prev = lastFixInputOf(c).filter((r) => r.source === "evaluate");
  const cur = bundleOf(c);
  if (!cur.length || prev.length !== cur.length) return false;
  const left = [...prev];
  return cur.every((b) => {
    const i = left.findIndex((p) => fileOf(p) === fileOf(b) && similar(p.issue, b.issue));
    if (i < 0) return false;
    left.splice(i, 1);
    return true;
  });
}

/** What the last review could not verify — the PR description hands it to the people who review next. */
export function reviewAssumptionsOf(c: Pick<Ctx, "channels">): string[] {
  const a = c.channels.evaluate?.assumptions;
  return Array.isArray(a) ? (a as unknown[]).map(String).filter((x) => x.trim()) : [];
}

export type ManualCheck = { n: number; check: string };

/** Criteria only a person can confirm after publish or deploy, as the implementer listed them — they go to the PR
 *  description. A fix round never changes them, so they are read from implement, not the last delivery. */
export function manualChecksOf(c: Pick<Ctx, "channels">): ManualCheck[] {
  const m = c.channels.implement?.manualChecks;
  return Array.isArray(m) ? (m as ManualCheck[]).filter((x) => x && String(x.check ?? "").trim()) : [];
}

export function lastDelivery(c: Pick<Ctx, "channels">): Record<string, unknown> {
  return c.channels.fix ?? c.channels.implement ?? {};
}

function deliveryWarnings(d: Record<string, unknown>): Refusal[] {
  const v = (d.verification ?? {}) as { tests?: string; build?: string; acceptanceCriteria?: string };
  const out: Refusal[] = [];
  if (v.tests === "failed") out.push({ source: "verification", file: "", issue: "The implementer reported the tests it ran as failing." });
  if (v.tests === "not-run" && Number(d.filesChanged ?? 0) > 0) {
    out.push({ source: "verification", file: "", issue: "The implementer changed code but ran no tests — check whether the change needs one." });
  }
  if (v.build === "failed") out.push({ source: "verification", file: "", issue: "The implementer reported the build as failing." });
  if (v.acceptanceCriteria === "partial") {
    const left = Array.isArray(d.deviations) ? (d.deviations as { what?: string; why?: string }[]) : [];
    if (!left.length) out.push({ source: "acceptance", file: "", issue: "Acceptance criteria reported as partially met." });
    for (const x of left) out.push({ source: "acceptance", file: "", issue: `${x.what ?? ""}${x.why ? ` — ${x.why}` : ""}` });
  }
  return out;
}

const listOf = (v: unknown): Refusal[] => (Array.isArray(v) ? (v as Refusal[]) : []);

export function bundleOf(c: Pick<Ctx, "channels">): Refusal[] {
  const blockers = c.channels.evaluate?.blockers;
  return Array.isArray(blockers)
    ? (blockers as { file?: string; issue?: string; evidence?: string; expected?: string }[]).map((b) => ({
        source: "evaluate",
        file: b.file ?? "",
        issue: b.issue ?? "",
        ...(b.evidence?.trim() ? { evidence: b.evidence.trim() } : {}),
        ...(b.expected?.trim() ? { expected: b.expected.trim() } : {}),
      }))
    : [];
}

export type Digest = { title: string; type: string; summary: string; details: string[] };

/** The first judging role's reading of the work item — what every later brief carries instead of the ticket. Null when none was made. */
export function digestOf(c: Pick<Ctx, "channels">): Digest | null {
  const src = c.channels.readiness ?? c.channels.qaTriage ?? c.channels.reviewTriage;
  const d = (src?.digest ?? {}) as { summary?: unknown; details?: unknown };
  const summary = String(d.summary ?? "").trim();
  const details = Array.isArray(d.details) ? d.details.map((x) => String(x).trim()).filter(Boolean) : [];
  if (!summary && !details.length) return null;
  return { title: String(src?.title ?? "").trim(), type: String(src?.type ?? "").trim(), summary, details };
}

/** Repo name → HEAD the last review judged, so a re-review can start from what changed since. */
export function reviewedHeadsOf(c: Pick<Ctx, "channels">): Record<string, string> {
  const v = c.channels.evaluate?.reviewedHeads;
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, string>) : {};
}

export function warningsOf(c: Pick<Ctx, "channels">): Refusal[] {
  const ch = c.channels;
  return [...listOf(ch.syncBase?.warnings), ...listOf(ch.diffGuard?.warnings), ...deliveryWarnings(lastDelivery(c))];
}

export function scopeOf(c: Pick<Ctx, "channels">): string[] {
  const repos = c.channels.plan?.repos ?? c.channels.qaTriage?.repos ?? c.channels.setup?.scope;
  return Array.isArray(repos) ? (repos as string[]) : [];
}

export type ChosenSkill = { name: string; file: string; reason: string };

/** The skills the first judging role picked for this ticket, resolved by the harness to their SKILL.md. */
export function skillsOf(c: Pick<Ctx, "channels">): ChosenSkill[] {
  const v = c.channels.readiness?.skills ?? c.channels.qaTriage?.skills ?? c.channels.reviewTriage?.skills;
  return Array.isArray(v) ? (v as ChosenSkill[]).filter((s) => s.file) : [];
}

/** Repo name → the base branch a picked skill requires, for every repo the harness seated on it. Others use origin's default. */
export function basesOf(c: Pick<Ctx, "channels">): Record<string, string> {
  const v = c.channels.readiness?.bases ?? c.channels.qaTriage?.bases;
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, string>) : {};
}

const skillDir = (file: string) => file.split(/[\\/]+/).slice(-2, -1)[0] ?? "";

/**
 * Which skills one step used, from what it was told and what it did — so /workflow shows a role that ignored a skill.
 * Assigned = the brief's "Skills to follow" lines (`- name: file — reason`, as `skillLines()` writes them); touched =
 * every SKILL.md the step's log shows it reading, and every Skill tool call. `picked` is the picking role's own choice.
 * `runSkills` stands in for the brief's lines on a step kept before briefs were: the skills the run picked.
 */
export function skillUse(brief: string, logs: string[], picked: string[] = [], runSkills: string[] = []): SkillUse[] {
  const listed = [...brief.matchAll(/^- ([^\s:]+): (.+?SKILL\.md) — /gm)].map((m) => ({ name: m[1], dir: skillDir(m[2]) }));
  const assigned = listed.length || brief ? listed : runSkills.map((name) => ({ name, dir: name }));
  const touched = new Set<string>();
  for (const t of logs) {
    for (const m of t.matchAll(/skills[\\/]+([^\\/\s"'`]+)[\\/]+SKILL\.md/gi)) touched.add(m[1].toLowerCase());
    const call = /^✎ Skill (\S+)/.exec(t);
    if (call) touched.add(call[1].toLowerCase());
  }
  const was = (name: string, dir = name) => touched.has(name.toLowerCase()) || touched.has(dir.toLowerCase());
  const out: SkillUse[] = picked.map((name) => ({ name, state: "picked" }));
  const known = new Set(picked.map((n) => n.toLowerCase()));
  for (const a of assigned) {
    if (known.has(a.name.toLowerCase())) continue;
    known.add(a.name.toLowerCase());
    known.add(a.dir.toLowerCase());
    out.push({ name: a.name, state: was(a.name, a.dir) ? "read" : "unread" });
  }
  for (const t of touched) if (!known.has(t)) out.push({ name: t, state: "opened" });
  return out;
}

/** `name` and `description` from a SKILL.md front matter, folded block scalars included. */
export function skillFrontMatter(text: string): { name: string; description: string } {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const out: Record<string, string> = {};
  let key = "";
  for (const line of m ? m[1].split(/\r?\n/) : []) {
    const kv = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (kv) {
      key = kv[1];
      out[key] = /^[>|][-+]?$/.test(kv[2].trim()) ? "" : kv[2].trim().replace(/^(["'])(.*)\1$/, "$2");
    } else if (key && /^\s+\S/.test(line)) out[key] = `${out[key]} ${line.trim()}`.trim();
  }
  return { name: out.name ?? "", description: out.description ?? "" };
}

export type Thread = { threadId: string; file: string; comment: string; decision: "fix" | "reject" | "informational"; reason: string };

export function threadsOf(c: Pick<Ctx, "channels">): Thread[] {
  const t = c.channels.reviewTriage?.threads;
  return Array.isArray(t) ? (t as Thread[]) : [];
}

export type QaFinding = { finding: string; kind?: string; defect: boolean; reason: string; files: string[] };

/** Flow Runner's QA follow-up input: the comment window to answer and, on a fix run, the developer's decision. */
export type FollowUp = {
  since: string;
  upTo: string;
  triggers: string[];
  /** Who the developer is, as Flow Runner read it from the stored connection — never a literal. */
  developer?: { name: string; email: string };
  decision?: { fix: string[]; note: string };
};

export function followUpOf(c: Pick<Ctx, "channels">): FollowUp | null {
  const f = c.channels.followUp as Partial<FollowUp> | undefined;
  if (!f) return null;
  const d = f.decision;
  const dev = f.developer;
  return {
    since: String(f.since ?? ""),
    upTo: String(f.upTo ?? ""),
    triggers: Array.isArray(f.triggers) ? f.triggers.map(String) : [],
    ...(dev && (dev.name || dev.email) ? { developer: { name: String(dev.name ?? ""), email: String(dev.email ?? "") } } : {}),
    ...(d && Array.isArray(d.fix) ? { decision: { fix: d.fix.map(String), note: String(d.note ?? "") } } : {}),
  };
}

export function findingsOf(c: Pick<Ctx, "channels">): QaFinding[] {
  const f = c.channels.qaTriage?.findings;
  return Array.isArray(f) ? (f as QaFinding[]) : [];
}

/** Files a run declared it would change: the plan's AC map, the QA fixes, or the review threads it fixes. */
export function plannedFiles(c: Pick<Ctx, "channels">): string[] {
  return [
    ...acRows(c.channels.plan).flatMap((a) => (a.change === "none" ? [] : (a.files ?? []))),
    ...findingsOf(c).flatMap((f) => (f.defect ? f.files : [])),
    ...threadsOf(c).filter((t) => t.decision === "fix" && t.file).map((t) => t.file.replace(/:\d+.*$/, "")),
  ];
}

export type Delivery = { status: "none" | "partial" | "done"; evidence: { ac: string; repo: string; proof: string }[] };

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };

/** Provider rich text (sanitized HTML) as plain lines for a brief: block ends become line breaks, list items "- ",
 *  an image a marker the agent can follow up through MCP. */
export function richToText(html: string): string {
  return html
    .replace(/<img\b[^>]*>/gi, " [image] ")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<br\s*\/?>|<\/(p|div|tr|h[1-6]|ul|ol|table)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#39|[a-z]+);/gi, (m, e: string) => ENTITIES[e.toLowerCase()] ?? m)
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n+(?=- )/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const MAX_PO_QUESTIONS = 3;

/**
 * The harness's own check of the analyst's verdict, before it routes on it. A false "done" ends the run having built
 * nothing, so `done` stands only when every criterion has its own proof — otherwise it drops to `partial` (or `none`)
 * and the run plans the rest. The PO gets at most `MAX_PO_QUESTIONS`; the rest stay visible as missing information.
 */
export function checkReadiness(data: Record<string, unknown>): { data: Record<string, unknown>; notes: string[] } {
  const notes: string[] = [];
  const acs = (Array.isArray(data.acceptanceCriteria) ? data.acceptanceCriteria : []).map((a) => String(a).trim());
  const questions = Array.isArray(data.questions) ? data.questions.map(String) : [];
  const out = { ...data };
  if (questions.length > MAX_PO_QUESTIONS) {
    out.questions = questions.slice(0, MAX_PO_QUESTIONS);
    out.missing = [...(Array.isArray(data.missing) ? data.missing : []), ...questions.slice(MAX_PO_QUESTIONS).map((q) => `Not asked (over the ${MAX_PO_QUESTIONS}-question limit): ${q}`)];
    notes.push(`${questions.length} questions for the PO — kept the first ${MAX_PO_QUESTIONS}, the rest listed under missing`);
  }
  const d = deliveryOf({ channels: { readiness: data } });
  const covered = new Set(d.evidence.map((e) => String(e.ac ?? "").trim()).filter((a) => acs.includes(a)));
  const status = !covered.size ? "none" : covered.size >= acs.length ? "done" : "partial";
  const claimed = d.status;
  // Only ever downgraded: an upgrade would trust evidence the analyst itself did not call delivered.
  const rank = { none: 0, partial: 1, done: 2 } as const;
  if (acs.length && rank[status] < rank[claimed]) {
    out.delivery = { status, evidence: d.evidence.filter((e) => covered.has(String(e.ac ?? "").trim())) };
    notes.push(`delivery "${claimed}" not backed by proof for every criterion (${covered.size} of ${acs.length}) — treated as "${status}"`);
  }
  return { data: out, notes };
}

export function deliveryOf(c: Pick<Ctx, "channels">): Delivery {
  const d = (c.channels.readiness?.delivery ?? {}) as Partial<Delivery>;
  const status = d.status === "done" || d.status === "partial" ? d.status : "none";
  return { status, evidence: Array.isArray(d.evidence) ? d.evidence : [] };
}

export function prNumber(url: string): number {
  const m = /(\d+)\/?$/.exec(url.trim());
  return m ? Number(m[1]) : 0;
}

export function knowledgeDiff(before: string, after: string): { added: string[]; removed: string[] } | null {
  if (before === after) return null;
  const lines = (s: string) => s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const a = lines(before);
  const b = lines(after);
  const inA = new Set(a);
  const inB = new Set(b);
  const added = b.filter((l) => !inA.has(l));
  const removed = a.filter((l) => !inB.has(l));
  return added.length || removed.length ? { added, removed } : null;
}
