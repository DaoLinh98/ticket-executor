import path from "path";
import { basesOf, bundleOf, deliveryOf, findingsOf, followUpOf, lastDelivery, LOCAL_INSTRUCTIONS, scopeOf, skillsOf, threadsOf, warningsOf } from "./rules";
import { skillCatalog } from "./skills";
import type { Ctx, Refusal } from "./types";

export const PLAN_FILE = path.join(".te", "plan.md");

const rootName = (c: Ctx) => path.basename(c.rootRepo);

function header(c: Ctx): string {
  const lines = [
    `Ticket: ${c.ticketUrl || c.ticketId} (id ${c.ticketId}, provider ${c.provider}, project ${c.project})`,
    `Working tree (repository "${rootName(c)}"): ${c.cwd}${c.baseSha ? ` — base commit ${c.baseSha}` : ""}`,
  ];
  if (c.prUrl && c.flow === "review") lines.push(`Pull request under review: ${c.prUrl}`);
  lines.push(...repoMap(c));
  if (c.knowledgeFile) lines.push(`Project knowledge: ${c.knowledgeFile} (absolute path; may not exist yet)`);
  lines.push(...skillLines(c));
  return lines.join("\n");
}

function skillLines(c: Ctx): string[] {
  const skills = skillsOf(c);
  if (!skills.length) return [];
  const bases = Object.entries(basesOf(c));
  return [
    "Skills that apply to this ticket — read each SKILL.md (and the files it links) before you start, and follow its rules. " +
      "Where one conflicts with this brief (branching, committing, pushing, pull requests), this brief wins:",
    ...skills.map((s) => `- ${s.name}: ${s.file} — ${s.reason}`),
    ...(bases.length ? [`The harness already started the work from the base a skill requires: ${bases.map(([r, b]) => `${r} on origin/${b}`).join(", ")}.`] : []),
  ];
}

// The installed skills the first judging role chooses from.
function skillMenu(c: Ctx, withBase: boolean): string {
  const catalog = skillCatalog(c.rootRepo);
  if (!catalog.length) return `\n\nNo skill is installed — report \`skills\` empty${withBase ? " and `baseBranch` empty" : ""}.`;
  return (
    `\n\nInstalled skills — pick every one whose description fits this ticket (none is a valid answer), read its SKILL.md, and report it in \`skills\`. ` +
    `Every later role is told to follow the skills you pick.` +
    (withBase
      ? ` When a picked skill requires the work to start from a branch other than the default branch (and the pull request to target it), ` +
        `report that branch in \`baseBranch\`; otherwise leave it empty. The harness moves the working tree onto it before the plan.`
      : "") +
    `\n${catalog.map((s) => `- ${s.name} (${s.file}): ${s.description}`).join("\n")}`
  );
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
  if (c.flow === "review") {
    const fix = threadsOf(c).filter((t) => t.decision === "fix");
    return `Review threads this run fixes:\n${fix.map((t, i) => `${i + 1}. [thread ${t.threadId}]${t.file ? ` ${t.file} —` : ""} ${t.comment} → ${t.reason}`).join("\n")}`;
  }
  if (c.flow === "qa") {
    const defects = findingsOf(c).filter((f) => f.defect);
    return `QA defects this run fixes:\n${defects.map((f, i) => `${i + 1}. ${f.finding} — ${f.reason}`).join("\n")}`;
  }
  const acs = strings(c.channels.readiness?.acceptanceCriteria);
  return acs.length ? `Acceptance criteria:\n${acs.map((a, i) => `${i + 1}. ${a}`).join("\n")}` : "";
}

export function branchOf(c: Ctx): string {
  return String(lastDelivery(c).branch ?? c.channels.plan?.branch ?? c.channels.qaTriage?.branch ?? c.channels.setup?.branch ?? "").trim();
}

// The approved plan as data (channels.plan, already checked by planIssues), so a role never depends on the planner
// having copied it into planMd.
function planContract(c: Ctx): string {
  const p = c.channels.plan;
  if (!p) return "";
  const acMap = Array.isArray(p.acMap) ? (p.acMap as { ac?: string; files?: string[]; test?: string }[]) : [];
  const risks = strings(p.risks);
  const repos = strings(p.repos);
  const lines: string[] = [];
  if (acMap.length) {
    lines.push(
      "The approved plan maps each acceptance criterion to these files and this test:",
      ...acMap.map((a, i) => `${i + 1}. ${a.ac ?? ""}\n   files: ${(a.files ?? []).join(", ")}\n   test: ${a.test ?? ""}`),
    );
  }
  if (risks.length) lines.push("Risks the planner flagged — guard against each:", ...risks.map((r) => `- ${r}`));
  const decided = decisionsOf(c);
  if (decided.length) lines.push("Decisions the plan made where the ticket leaves room — build to these, do not reopen them:", ...decided);
  if (repos.length) lines.push(`Repositories in scope: ${repos.join(", ")}`);
  return lines.length ? `\n\n${lines.join("\n")}` : "";
}

function decisionsOf(c: Ctx): string[] {
  const list = Array.isArray(c.channels.plan?.decisions) ? (c.channels.plan.decisions as { point?: string; decision?: string; why?: string }[]) : [];
  return list.map((d, i) => `${i + 1}. ${d.point ?? ""} → ${d.decision ?? ""}${d.why ? ` (${d.why})` : ""}`);
}

// What the implementer (or the last fixer) says it did. The reviewer gets it as claims to check, never as evidence.
function deliveryClaims(c: Ctx): string {
  const d = lastDelivery(c);
  const summary = String(d.summary ?? "").trim();
  const deviations = Array.isArray(d.deviations) ? (d.deviations as { what?: string; why?: string }[]) : [];
  if (!summary && !deviations.length) return "";
  return (
    `\n\nThe implementer's own account — claims to check against the diff, not facts. ` +
    `A claim the diff does not bear out is a blocker only when it hides a real defect:` +
    (summary ? `\nSummary: ${summary}` : "") +
    (deviations.length ? `\nDeviations from the plan:\n${deviations.map((x, i) => `${i + 1}. ${x.what ?? ""} — ${x.why ?? ""}`).join("\n")}` : "")
  );
}

const numbered = (list: Refusal[]) =>
  list.map((r, i) => `${i + 1}. [${r.source}]${r.file ? ` ${r.file} —` : ""} ${r.issue}`).join("\n");

export function readinessPrompt(c: Ctx): string {
  return (
    `${header(c)}\n\nRead this work item and decide whether it is ready to implement.\n` +
    `Then check every acceptance criterion against the base commits above — they are the latest origin default branch; ` +
    `when you report a \`baseBranch\`, check against \`origin/<baseBranch>\` instead (\`git fetch origin <baseBranch>\`, \`git show origin/<baseBranch>:<file>\`) — ` +
    `and report in \`delivery\` whether it is already delivered by an earlier merged pull request or commit.${skillMenu(c, true)}`
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
  const assumed = strings(c.channels.readiness?.ambiguities);
  const assumptions = assumed.length
    ? `\n\nReadiness settled these open readings by assumption — treat them as decided and record each in \`decisions\`:\n${assumed.map((x, i) => `${i + 1}. ${x}`).join("\n")}`
    : "";
  return `${header(c)}\n\n${acceptance(c)}${delivered(c)}${assumptions}\n\nReturn the implementation plan in \`planMd\`; the harness writes it to \`${PLAN_FILE}\`. Do not write files.${retry}`;
}

export function implementPrompt(c: Ctx): string {
  const branch = String(c.channels.plan?.branch ?? "").trim();
  return (
    `${header(c)}\n\n${acceptance(c)}${planContract(c)}\n\n` +
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
  const owned = decisionsOf(c).length
    ? `\nThe plan's decisions are judgement calls it owns: raise a blocker only when the code does not follow one or one contradicts an ` +
      `acceptance criterion — never for preferring another reasonable reading.`
    : "";
  const warnings = warningsOf(c);
  const warned = warnings.length
    ? `\n\nThe harness raised these warnings. They are not blockers by themselves — raise one only when it is a real defect of this change:\n${numbered(warnings)}`
    : "";
  return (
    `${header(c)}\n\n${acceptance(c)}${planContract(c)}\n\nBranch: ${branchOf(c)}. The plan is \`${PLAN_FILE}\`.\n` +
    `Review the committed change: \`git diff <base commit>..HEAD\` in each repository listed above.${owned}${warned}${deliveryClaims(c)}${note}`
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
    `${header(c)}\n\n${acceptance(c)}${planContract(c)}\n\nBranch: ${branchOf(c)}. The plan is \`${PLAN_FILE}\`.\n\n` +
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

// The worktree on the pull request's branch — a related repo's when the pull request lives there.
const prTree = (c: Ctx) => c.companions.find((m) => m.name === c.channels.setup?.prRepo)?.cwd ?? c.cwd;

export function reviewTriagePrompt(c: Ctx): string {
  return (
    `${header(c)}\n\nThe working tree \`${prTree(c)}\` is on the pull request's source branch \`${branchOf(c)}\`. ` +
    `Read every open review thread on the pull request above and judge each one against the code and the ticket. ` +
    `Return one \`threads\` entry per open thread and the Thread Decisions table in \`planMd\`; the harness writes it to \`${PLAN_FILE}\`. Do not write files and do not reply to any thread.` +
    skillMenu(c, false)
  );
}

export function reviewImplementPrompt(c: Ctx): string {
  return (
    `${header(c)}\n\n${acceptance(c)}\n\nThe decisions are in \`${PLAN_FILE}\`. Fix exactly these threads on the current branch \`${branchOf(c)}\` of \`${prTree(c)}\` — ` +
    `do not create or switch branches, do not rebase. Commit locally. Do not push and do not reply to any thread.`
  );
}

export function respondPrompt(c: Ctx): string {
  const changed = Array.isArray(c.channels.diffGuard?.changed) && c.channels.diffGuard.changed.length > 0;
  const answer = threadsOf(c).filter((t) => t.decision !== "informational");
  const list = answer.map((t, i) => `${i + 1}. thread ${t.threadId} (${t.decision})${t.file ? ` ${t.file}` : ""} — ${t.reason}`).join("\n");
  return (
    `${header(c)}\n\n` +
    (changed ? `Push branch \`${branchOf(c)}\` from \`${prTree(c)}\` to origin (never force-push). Then answer` : "Nothing was committed — push nothing. Answer") +
    ` these threads on the pull request, one reply each:\n${list}\n\n` +
    `Never resolve a thread or change its status. Skip a thread that already carries your reply — this step may be retried after a crash.`
  );
}

export function qaTriagePrompt(c: Ctx): string {
  const f = followUpOf(c);
  const window = f
    ? `QC feedback to judge: ${f.triggers.join(", ") || "comments"} — every comment by someone other than the developer` +
      `${f.since ? ` after ${f.since}` : ""}${f.upTo ? `, up to ${f.upTo}` : ""}. Read earlier comments only for context.` +
      (f.developer
        ? `\nThe developer is ${[f.developer.name, f.developer.email && `<${f.developer.email}>`].filter(Boolean).join(" ")} — ` +
          `their own comments are context, never feedback to judge, and the reply is written as them.`
        : "")
    : "QA sent this ticket back. Judge the QC comments left since the last delivery.";
  const decision = f?.decision
    ? `\n\nThe developer reviewed the analysis and decided to fix exactly these — binding: mark each a defect, plan its fix, outcome \`fix\`:\n` +
      f.decision.fix.map((x, i) => `${i + 1}. ${x}`).join("\n") +
      (f.decision.note ? `\nDeveloper's note: ${f.decision.note}` : "") +
      `\nReport other findings as you judge them; plan no change for them.`
    : "";
  return (
    `${header(c)}\n\n${window}\nRead the work item through the provider's MCP server and judge every point QC raised against the code on the base commits above. ` +
    `Return the verdicts in \`findings\` and the developer's reply to QC in \`qaReply\`; when at least one is a real defect, propose \`branch\` and the fix plan in \`planMd\` ` +
    `(the harness writes it to \`${PLAN_FILE}\`). Do not write files and do not comment on the ticket.` +
    decision +
    skillMenu(c, true)
  );
}

export function qaImplementPrompt(c: Ctx): string {
  return (
    `${header(c)}\n\n${acceptance(c)}\n\n` +
    `Implement \`${PLAN_FILE}\` on branch \`${branchOf(c)}\` in every repository you change — create it where it does not exist yet. ` +
    `Add a regression test for each defect. Commit locally. Do not push.`
  );
}

export type PublishTarget = { repo: string; cwd: string; branch: string; base: string };

export function publishTargets(c: Ctx): PublishTarget[] {
  const rows = Array.isArray(c.channels.diffGuard?.changed) ? (c.channels.diffGuard.changed as { repo: string; branch: string }[]) : [];
  const cwdOf = (name: string) => (name === rootName(c) ? c.cwd : c.companions.find((m) => m.name === name)?.cwd ?? "");
  const bases = basesOf(c);
  return rows.map((r) => ({ repo: r.repo, cwd: cwdOf(r.repo), branch: r.branch, base: bases[r.repo] ?? "" })).filter((t) => t.cwd && t.branch);
}

export function publishPrompt(c: Ctx): string {
  const list = publishTargets(c)
    .map((t) => `- ${t.repo}: working tree \`${t.cwd}\`, branch \`${t.branch}\` → pull request into ${t.base ? `\`${t.base}\` (required by a skill)` : "the default branch"}`)
    .join("\n");
  const decided = decisionsOf(c);
  const decisions = decided.length
    ? `\n\nList these under a "Decisions" heading in each pull request description, so reviewers and QA see the readings this change was built to:\n${decided.join("\n")}`
    : "";
  return `${header(c)}\n\nPublish these repositories (and only these):\n${list}${decisions}\n\nReport one \`prs\` entry per repository above.`;
}
