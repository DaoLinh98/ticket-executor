import path from "path";
import { bundleOf, deliveryOf, lastDelivery, LOCAL_INSTRUCTIONS, scopeOf, warningsOf } from "./rules";
import type { Ctx, Refusal } from "./types";

export const PLAN_FILE = path.join(".te", "plan.md");

const rootName = (c: Ctx) => path.basename(c.rootRepo);

function header(c: Ctx): string {
  const lines = [
    `Ticket: ${c.ticketUrl || c.ticketId} (id ${c.ticketId}, provider ${c.provider}, project ${c.project})`,
    `Working tree (repository "${rootName(c)}"): ${c.cwd}${c.baseSha ? ` — base commit ${c.baseSha}` : ""}`,
  ];
  lines.push(...repoMap(c));
  if (c.knowledgeFile) lines.push(`Project knowledge: ${c.knowledgeFile} (absolute path; may not exist yet)`);
  return lines.join("\n");
}

function repoMap(c: Ctx): string[] {
  if (!c.companions.length) return [];
  const scope = scopeOf(c).map((s) => s.toLowerCase());
  const at = (m: Ctx["companions"][number]) => `${m.cwd} — base commit ${m.baseSha}${m.note ? ` — ${m.note}` : ""}`;
  if (!scope.length) {
    return [
      "Related repositories — open one only when the ticket needs it. Before reading its code, read its instructions:",
      ...c.companions.map((m) => `- "${m.name}": ${at(m)} (instructions: ${path.join(m.cwd, "CLAUDE.md")}, ${path.join(m.path, LOCAL_INSTRUCTIONS)})`),
    ];
  }
  const inScope = c.companions.filter((m) => scope.includes(m.name.toLowerCase()));
  const out = c.companions.filter((m) => !scope.includes(m.name.toLowerCase()));
  return [
    ...inScope.map((m) => `Other repository "${m.name}" (in scope, its instructions are loaded): ${at(m)}`),
    ...(out.length ? [`Out of scope for this ticket — do not read or change: ${out.map((m) => m.name).join(", ")}`] : []),
  ];
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : []);

function acceptance(c: Ctx): string {
  const acs = strings(c.channels.readiness?.acceptanceCriteria);
  return acs.length ? `Acceptance criteria:\n${acs.map((a, i) => `${i + 1}. ${a}`).join("\n")}` : "";
}

export function branchOf(c: Ctx): string {
  return String(lastDelivery(c).branch ?? c.channels.plan?.branch ?? "").trim();
}

const numbered = (list: Refusal[]) =>
  list.map((r, i) => `${i + 1}. [${r.source}]${r.file ? ` ${r.file} —` : ""} ${r.issue}`).join("\n");

export function readinessPrompt(c: Ctx): string {
  return (
    `${header(c)}\n\nRead this work item and decide whether it is ready to implement.\n` +
    `Then check every acceptance criterion against the base commits above — they are the latest origin default branch — ` +
    `and report in \`delivery\` whether it is already delivered by an earlier merged pull request or commit.`
  );
}

function delivered(c: Ctx): string {
  const d = deliveryOf(c);
  if (d.status !== "partial" || !d.evidence.length) return "";
  return (
    `\n\nAlready delivered on the base — map these to where they live and plan no change for them:\n` +
    d.evidence.map((e, i) => `${i + 1}. ${e.ac} — ${e.repo}: ${e.proof}`).join("\n")
  );
}

export function planPrompt(c: Ctx): string {
  const prev = c.channels.planCheck;
  const issues = prev && prev.passed === false ? strings(prev.issues) : [];
  const retry = issues.length ? `\n\nThe previous plan was refused by the plan check:\n${issues.map((x, i) => `${i + 1}. ${x}`).join("\n")}\nFix exactly these.` : "";
  return `${header(c)}\n\n${acceptance(c)}${delivered(c)}\n\nReturn the implementation plan in \`planMd\`; the harness writes it to \`${PLAN_FILE}\`. Do not write files.${retry}`;
}

export function implementPrompt(c: Ctx): string {
  const branch = String(c.channels.plan?.branch ?? "").trim();
  return (
    `${header(c)}\n\n${acceptance(c)}\n\n` +
    `Implement \`${PLAN_FILE}\` on branch \`${branch}\` in every repository you change — create it where it does not exist yet, ` +
    `and when the working tree is already on it, build on the commits it carries. Commit locally. Do not push.`
  );
}

export function evaluatePrompt(c: Ctx): string {
  const again = (c.visits.evaluate ?? 0) > 1;
  const prev = again ? bundleOfPreviousFix(c) : [];
  const note = again
    ? `\n\nThis is a re-review after a fix round.${prev.length ? ` The fix was asked to resolve:\n${numbered(prev)}` : ""}`
    : "";
  const warnings = warningsOf(c);
  const warned = warnings.length
    ? `\n\nThe harness raised these warnings. They are not blockers by themselves — raise one only when it is a real defect of this change:\n${numbered(warnings)}`
    : "";
  return (
    `${header(c)}\n\n${acceptance(c)}\n\nBranch: ${branchOf(c)}. The plan is \`${PLAN_FILE}\`.\n` +
    `Review the committed change: \`git diff <base commit>..HEAD\` in each repository listed above.${warned}${note}`
  );
}

function bundleOfPreviousFix(c: Ctx): Refusal[] {
  const input = c.channels.fix?.input;
  return Array.isArray(input) ? (input as Refusal[]) : [];
}

export function fixInput(c: Ctx): Refusal[] {
  return bundleOf(c);
}

export function fixPrompt(c: Ctx): string {
  return (
    `${header(c)}\n\n${acceptance(c)}\n\nBranch: ${branchOf(c)}. The plan is \`${PLAN_FILE}\`.\n\n` +
    `Review blockers — fix exactly these, then commit locally on the same branch. Do not push.\n${numbered(fixInput(c))}`
  );
}

export function reflectPrompt(c: Ctx): string {
  const blocked = (lastDelivery(c).blocked ?? {}) as { is?: boolean; reason?: string };
  const why = blocked.is ? `the fixer is blocked: ${blocked.reason ?? ""}` : `${c.visits.fix ?? 0} fix attempt(s)`;
  return (
    `${header(c)}\n\nThe run is stopping after ${why}. These review blockers still stand:\n` +
    `${numbered(bundleOf(c))}\n\nLast fix summary: ${String(lastDelivery(c).summary ?? "")}\n\n` +
    `Decide whether this teaches a reusable lesson and, if so, record it in ${c.knowledgeFile || "KNOWLEDGE.md"}.`
  );
}

export type PublishTarget = { repo: string; cwd: string; branch: string };

export function publishTargets(c: Ctx): PublishTarget[] {
  const rows = Array.isArray(c.channels.diffGuard?.changed) ? (c.channels.diffGuard.changed as { repo: string; branch: string }[]) : [];
  const cwdOf = (name: string) => (name === rootName(c) ? c.cwd : c.companions.find((m) => m.name === name)?.cwd ?? "");
  return rows.map((r) => ({ repo: r.repo, cwd: cwdOf(r.repo), branch: r.branch })).filter((t) => t.cwd && t.branch);
}

export function publishPrompt(c: Ctx): string {
  const list = publishTargets(c)
    .map((t) => `- ${t.repo}: working tree \`${t.cwd}\`, branch \`${t.branch}\``)
    .join("\n");
  return `${header(c)}\n\nPublish these repositories (and only these):\n${list}\n\nReport one \`prs\` entry per repository above.`;
}
