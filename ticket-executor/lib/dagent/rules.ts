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
];

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

export function violationWarnings(v: Violation[]): Refusal[] {
  const why: Record<string, string> = {
    "no-agent-files": "Agent/run files must never be committed — remove it from the commits",
    "no-secret-files": "Secret or environment file committed — remove it from the commits",
    "no-unplanned-config": "Configuration file changed but not in the plan — revert it or justify it in the plan",
    "no-secrets-in-diff": "An added line looks like a credential — remove it from the commits",
  };
  return v.map((x) => ({ source: "diffGuard", file: x.file, issue: `${why[x.rule] ?? x.rule} (rule: ${x.rule})` }));
}

export type PlanData = { branch?: unknown; acMap?: unknown; repos?: unknown };

export function planIssues(acceptanceCriteria: string[], plan: PlanData, repoNames: string[], planFileExists: boolean): string[] {
  const issues: string[] = [];
  const acMap = Array.isArray(plan.acMap) ? (plan.acMap as { ac?: string; files?: string[]; test?: string }[]) : [];
  if (!planFileExists) issues.push("`.te/plan.md` was not written.");
  if (!String(plan.branch ?? "").trim()) issues.push("No branch name was proposed.");
  if (!acMap.length) issues.push("The plan maps no acceptance criterion to any file.");
  if (acMap.length < acceptanceCriteria.length) {
    issues.push(`The ticket has ${acceptanceCriteria.length} acceptance criteria but the plan maps only ${acMap.length}.`);
  }
  acMap.forEach((a, i) => {
    if (!a.files?.length) issues.push(`Acceptance criterion ${i + 1} ("${a.ac ?? ""}") names no file.`);
    if (!String(a.test ?? "").trim()) issues.push(`Acceptance criterion ${i + 1} ("${a.ac ?? ""}") names no test.`);
  });
  const known = new Set(repoNames.map(norm));
  const repos = Array.isArray(plan.repos) ? (plan.repos as string[]) : [];
  for (const r of repos) if (!known.has(norm(r))) issues.push(`Repository "${r}" is not one this run was given (${repoNames.join(", ")}).`);
  return issues;
}

export function lastDelivery(c: Pick<Ctx, "channels">): Record<string, unknown> {
  return c.channels.fix ?? c.channels.implement ?? {};
}

function deliveryWarnings(d: Record<string, unknown>): Refusal[] {
  const v = (d.verification ?? {}) as { tests?: string; build?: string; acceptanceCriteria?: string };
  const out: Refusal[] = [];
  if (v.tests === "failed") out.push({ source: "verification", file: "", issue: "The implementer reported the tests it ran as failing." });
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
    ? (blockers as { file?: string; issue?: string }[]).map((b) => ({ source: "evaluate", file: b.file ?? "", issue: b.issue ?? "" }))
    : [];
}

export function warningsOf(c: Pick<Ctx, "channels">): Refusal[] {
  const ch = c.channels;
  return [...listOf(ch.syncBase?.warnings), ...listOf(ch.diffGuard?.warnings), ...deliveryWarnings(lastDelivery(c))];
}

export function scopeOf(c: Pick<Ctx, "channels">): string[] {
  const repos = c.channels.plan?.repos ?? c.channels.qaTriage?.repos;
  return Array.isArray(repos) ? (repos as string[]) : [];
}

export type Thread = { threadId: string; file: string; comment: string; decision: "fix" | "reject" | "informational"; reason: string };

export function threadsOf(c: Pick<Ctx, "channels">): Thread[] {
  const t = c.channels.reviewTriage?.threads;
  return Array.isArray(t) ? (t as Thread[]) : [];
}

export type QaFinding = { finding: string; defect: boolean; reason: string; files: string[] };

export function findingsOf(c: Pick<Ctx, "channels">): QaFinding[] {
  const f = c.channels.qaTriage?.findings;
  return Array.isArray(f) ? (f as QaFinding[]) : [];
}

/** Files a run declared it would change: the plan's AC map, the QA fixes, or the review threads it fixes. */
export function plannedFiles(c: Pick<Ctx, "channels">): string[] {
  const acMap = Array.isArray(c.channels.plan?.acMap) ? (c.channels.plan.acMap as { files?: string[] }[]) : [];
  return [
    ...acMap.flatMap((a) => a.files ?? []),
    ...findingsOf(c).flatMap((f) => (f.defect ? f.files : [])),
    ...threadsOf(c).filter((t) => t.decision === "fix" && t.file).map((t) => t.file.replace(/:\d+.*$/, "")),
  ];
}

export type Delivery = { status: "none" | "partial" | "done"; evidence: { ac: string; repo: string; proof: string }[] };

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
