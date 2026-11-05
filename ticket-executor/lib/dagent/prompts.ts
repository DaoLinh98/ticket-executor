import path from "path";
import { acRows, basesOf, bundleOf, codeLeadsOf, deliveryOf, digestOf, findingsOf, fixBlockersOf, lastFixInputOf, stalledFix, followUpOf, lastDelivery, LOCAL_INSTRUCTIONS, manualChecksOf, renderPlan, reviewAssumptionsOf, reviewedHeadsOf, scopeOf, skillsOf, threadsOf, warningsOf } from "./rules";
import { skillCatalog } from "./skills";
import type { Ctx, Refusal } from "./types";

export const PLAN_FILE = path.join(".te", "plan.md");

const rootName = (c: Ctx) => path.basename(c.rootRepo);

// Every brief is the same shape: titled sections — Context, the skills to follow, the inputs this role works from,
// then "Your job" last — so an agent finds what it was given and what it must do without parsing one paragraph.
const section = (title: string, body: string | string[]): string => {
  const text = (Array.isArray(body) ? body.join("\n") : body).trim();
  return text ? `## ${title}\n${text}` : "";
};

const brief = (...sections: string[]): string => sections.filter(Boolean).join("\n\n");

const bullets = (lines: string[]): string => lines.filter(Boolean).map((l) => `- ${l}`).join("\n");

/** Header parts a role can go without. The judging roles write the ticket digest, so they never get one; the roles
 *  that only push and reply have no use for project knowledge. Everything else gets the whole header. */
type HeaderPart = "ticket" | "knowledge";

/** Context every role starts from, the ticket as the judging role read it, and the skills to follow — the opening
 *  sections of every brief. They are the same for every role of a run, so they lead and the role's own sections follow. */
function header(c: Ctx, omit: HeaderPart[] = []): string {
  const lines = [
    `Ticket: ${c.ticketUrl || c.ticketId} (id ${c.ticketId}, provider ${c.provider}, project ${c.project})`,
    `Working tree (repository "${rootName(c)}"): ${c.cwd}${c.baseSha ? ` — base commit ${c.baseSha}` : ""}`,
  ];
  if (c.prUrl && c.flow === "review") lines.push(`Pull request under review: ${c.prUrl}`);
  lines.push(...repoMap(c));
  if (c.knowledgeFile && !omit.includes("knowledge")) lines.push(`Project knowledge: ${c.knowledgeFile} (absolute path; may not exist yet)`);
  return brief(section("Context", lines), omit.includes("ticket") ? "" : ticketDigest(c), section("Skills to follow", skillLines(c)));
}

// The work item as the judging role read it — so no later role spends turns re-reading the ticket.
function ticketDigest(c: Ctx): string {
  const d = digestOf(c);
  if (!d) return "";
  return section("Ticket", [
    "The analyst's reading of the work item. Work from it; open the work item only for what it leaves out.",
    ...(d.title ? [`Title: ${d.title}${d.type ? ` (${d.type})` : ""}`] : []),
    d.summary,
    ...(d.details.length ? ["Details:", bullets(d.details)] : []),
  ]);
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

/** A skill's description cut to what it does (its first sentence) and when to use it (its first "Use when/for…"
 *  sentence, where matching happens), so the menu reads as a list rather than a wall — the agent opens the
 *  SKILL.md of any candidate, so the rest is one read away. Each part is cut on a word at `max`. */
export function skillSummary(description: string, max = 160): string {
  const text = description.replace(/\s+/g, " ").trim();
  const [first = "", ...rest] = text.split(/(?<=[.!?])\s+/);
  const clip = (s: string) => {
    if (s.length <= max) return s;
    const cut = s.slice(0, max);
    return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 1))}…`;
  };
  const when = rest.find((s) => /^use (it |this |only )?(when|for|whenever|before|after|to)\b/i.test(s));
  return [clip(first), ...(when ? [clip(when)] : [])].join(" ");
}

// The installed skills the first judging role chooses from.
function skillMenu(c: Ctx, withBase: boolean): string {
  const catalog = skillCatalog(c.rootRepo, c.skillsOff);
  if (!catalog.length) return section("Skills", `No skill is installed — report \`skills\` empty${withBase ? " and `baseBranch` empty" : ""}.`);
  return section("Skills", [
    `Pick every skill that fits this ticket (none is a valid answer) and report them in \`skills\`. Every later role follows the skills you pick. ` +
      `Each entry below is only a summary: before you decide, open the SKILL.md of every skill that might fit, and judge it on what that file says.`,
    ...(withBase
      ? [
          `If a picked skill requires the work to start from a branch other than the default branch (and the pull request to target it), ` +
            `report that branch in \`baseBranch\` — the harness moves the working tree onto it before the plan. Otherwise leave it empty.`,
        ]
      : []),
    "",
    ...catalog.map((s) => `- ${s.name} — ${skillSummary(s.description)} (${s.file})`),
  ]);
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

/** What this run must deliver: the ticket's acceptance criteria, or the review threads / QA defects it fixes. */
function acceptance(c: Ctx): string {
  if (c.flow === "review") {
    const fix = threadsOf(c).filter((t) => t.decision === "fix");
    return section("Review threads this run fixes", fix.map((t, i) => `${i + 1}. [thread ${t.threadId}]${t.file ? ` ${t.file} —` : ""} ${t.comment} → ${t.reason}`));
  }
  if (c.flow === "qa") {
    const defects = findingsOf(c).filter((f) => f.defect);
    return section("QA defects this run fixes", defects.map((f, i) => `${i + 1}. ${f.finding} — ${f.reason}`));
  }
  return section("Acceptance criteria", strings(c.channels.readiness?.acceptanceCriteria).map((a, i) => `${i + 1}. ${a}`));
}

export function branchOf(c: Ctx): string {
  return String(lastDelivery(c).branch ?? c.channels.plan?.branch ?? c.channels.qaTriage?.branch ?? c.channels.setup?.branch ?? "").trim();
}

// The approved plan as data (channels.plan, already checked by planIssues), so a role never depends on the planner
// having copied it into planMd.
function planContract(c: Ctx): string {
  const p = c.channels.plan;
  if (!p) return "";
  const acMap = acRows(p);
  const repos = strings(p.repos);
  const decided = decisionsOf(c);
  return brief(
    section("Approved plan", [
      ...(acMap.length
        ? [
            "The approved plan maps each acceptance criterion to these files and this test:",
            ...acMap.map((a, i) =>
              a.change === "none"
                ? `${a.n ?? i + 1}. ${a.ac ?? ""}\n   no code change${a.files?.length ? ` (lives in ${a.files.join(", ")})` : ""}\n   verify: ${a.test ?? ""}`
                : `${a.n ?? i + 1}. ${a.ac ?? ""}\n   files: ${(a.files ?? []).join(", ")}\n   test: ${a.test ?? ""}`,
            ),
          ]
        : []),
      ...(repos.length ? [`Repositories in scope: ${repos.join(", ")}`] : []),
    ]),
    section("Risks to guard against", strings(p.risks).map((r) => `- ${r}`)),
    section("Decisions", decided.length ? ["Decisions the plan made where the ticket leaves room — build to these, do not reopen them:", ...decided] : []),
  );
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
  const fixer = !!c.channels.fix;
  return section(fixer ? "Fixer's account" : "Implementer's account", [
    "These are claims to check against the diff, not facts. A claim the diff does not bear out is a blocker only when it hides a real defect.",
    ...(summary ? [`Summary: ${summary}`] : []),
    ...(deviations.length
      ? [
          fixer
            ? "Blockers the fixer did not change, with its evidence — weigh that evidence; raise one again only when it does not hold, and say why:"
            : "Deviations from the plan:",
          ...deviations.map((x, i) => `${i + 1}. ${x.what ?? ""} — ${x.why ?? ""}`),
        ]
      : []),
  ]);
}

// A reviewer blocker carries its proof and the expected result, so the fixer starts from them instead of re-diagnosing.
const numbered = (list: Refusal[]) =>
  list
    .map(
      (r, i) =>
        `${i + 1}. [${r.source}]${r.file ? ` ${r.file} —` : ""} ${r.issue}` +
        (r.evidence ? `\n   evidence: ${r.evidence}` : "") +
        (r.expected ? `\n   expected: ${r.expected}` : ""),
    )
    .join("\n");

// The judging role reads the work item itself and writes the digest every later role works from.
const DIGEST_JOB =
  "Write `digest`: the reading every later role works from instead of the work item — anything you leave out, they must fetch again. " +
  "It holds what the ticket says, not what you found in the code: no file paths, line numbers or function names.";

// A work item read by the harness can run long (pasted logs, long threads): capped so it never crowds the brief.
const MAX_WORK_ITEM = 16000;

function workItemSection(c: Ctx): string {
  const w = c.workItem;
  if (!w) return "";
  const comments = w.comments.map((x) => `[${x.date}] ${x.author}: ${x.text}`);
  const body = [
    `Title: ${w.title} (${w.type}${w.state ? `, ${w.state}` : ""})`,
    "",
    "### Description",
    w.description || "(empty)",
    "",
    "### Acceptance criteria field",
    w.criteria || "(empty — derive criteria from the description, see the analyst rules)",
    "",
    `### Comments (${comments.length}, oldest first)`,
    comments.length ? comments.join("\n\n") : "(none)",
  ].join("\n");
  const cut = body.length > MAX_WORK_ITEM ? `${body.slice(0, MAX_WORK_ITEM)}\n… (cut — open the work item through MCP for the rest)` : body;
  return section("Work item", [
    "Read by the harness just now — this is the ticket. Do not fetch it again; open it through MCP only for what this cannot carry: " +
      "an attachment or image (shown as [image]), or a linked work item it names.",
    "",
    cut,
  ]);
}

// A recheck after the PO was asked: what the last check asked, so this one reads the answers instead of asking again.
function previousCheck(c: Ctx): string {
  const p = c.channels.readiness;
  if (!p || p.ready !== false) return "";
  const asked = strings(p.questions);
  const missing = strings(p.missing);
  return section("Previous readiness check", [
    `An earlier check${typeof p.checkedAt === "string" ? ` (${p.checkedAt})` : ""} found the ticket not ready and the run waited for the PO. ` +
      "The questions were posted as a comment on the work item; the comments after it are the answers. Read those first.",
    ...(asked.length ? ["Asked:", ...asked.map((q, i) => `${i + 1}. ${q}`)] : []),
    ...(missing.length ? ["Was missing:", ...missing.map((m) => `- ${m}`)] : []),
    "Never ask again what a reply answered. Ask again only what is still unanswered and still blocks the work; settle the rest by assumption (in `ambiguities`).",
  ]);
}

export function readinessPrompt(c: Ctx): string {
  return brief(
    header(c, ["ticket"]),
    workItemSection(c),
    previousCheck(c),
    section(
      "Checking delivery",
      bullets([
        "Check against the base commits above (the latest origin default branch). When you report a `baseBranch`, check against " +
          "`origin/<baseBranch>` instead (`git fetch origin <baseBranch>`, `git show origin/<baseBranch>:<file>`).",
        "A criterion is delivered only when an earlier merged pull request or commit already does everything it asks. " +
          "Partly done or unverified is not delivered — the planner plans no change for a delivered criterion.",
        "`evidence`: one entry per delivered criterion, nothing else. `proof` is one line: the commit, pull request or `file:line` that delivers it. " +
          "Never describe criteria that are not delivered there.",
        "`status`: `done` when every criterion is delivered, `partial` when some are, otherwise `none`.",
      ]),
    ),
    section("Your job", [
      c.workItem ? "1. Read the work item above and decide whether it is ready to implement." : "1. Read the work item (through the provider's MCP server) and decide whether it is ready to implement.",
      `2. ${DIGEST_JOB}`,
      "3. Pick the skills that apply (see Skills below).",
      "4. Check every acceptance criterion against the base (see Checking delivery above) and report it in `delivery`.",
      "5. Report in `codeLeads` where the code this ticket touches lives, as you found it — for the planner only, never in the digest.",
    ]),
    skillMenu(c, true),
  );
}

function delivered(c: Ctx): string {
  const d = deliveryOf(c);
  if (d.status !== "partial" || !d.evidence.length) return "";
  return section("Already delivered — plan no change", [
    "These are already on the base. Map each to where it lives and plan no change for it:",
    ...d.evidence.map((e, i) => `${i + 1}. ${e.ac} — ${e.repo}: ${e.proof}`),
  ]);
}

// Max code leads handed on: enough to start from, few enough that the planner still reads the code itself.
const MAX_CODE_LEADS = 8;

function codeLeads(c: Ctx): string {
  const leads = codeLeadsOf(c).slice(0, MAX_CODE_LEADS);
  return section(
    "Code leads",
    leads.length
      ? [
          "Where the analyst found this ticket's code while judging it. Start from these instead of searching the repository again — " +
            "they are leads, not a plan: read each before you rely on it.",
          ...leads.map((l) => `- ${l.at} — ${l.what}`),
        ]
      : [],
  );
}

export function planPrompt(c: Ctx): string {
  const prev = c.channels.planCheck;
  const issues = prev && prev.passed === false ? strings(prev.issues) : [];
  const assumed = strings(c.channels.readiness?.ambiguities);
  return brief(
    header(c),
    acceptance(c),
    delivered(c),
    codeLeads(c),
    section(
      "Settled by assumption",
      assumed.length
        ? ["Readiness settled these open readings by assumption — treat them as decided and record each in `decisions`:", ...assumed.map((x, i) => `${i + 1}. ${x}`)]
        : [],
    ),
    section(
      "Previous plan refused",
      issues.length
        ? [
            "The plan check refused the previous plan. Fix exactly these:",
            ...issues.map((x, i) => `${i + 1}. ${x}`),
            ...(c.channels.plan
              ? [
                  "",
                  "The refused plan is below. Return it again with only what the issues name changed — keep every other row, step and decision as it is, " +
                    "and read code only where an issue needs it.",
                  "",
                  renderPlan(c.channels.plan),
                ]
              : []),
          ]
        : [],
    ),
    section(
      "Your job",
      bullets([
        "Map every acceptance criterion above in `acMap`, once each, by its number `n`. A criterion that needs no file change " +
          "(already delivered, or met outside the code — a branch, a pipeline, a deployment, a manual check) is `change: none`, with how it is verified.",
        `Write the prose in \`planMd\` — Goal, Data assumptions, Steps, Standards that apply. The harness adds the AC map, risks and ` +
          `decisions from your fields and writes it all to \`${PLAN_FILE}\`; do not repeat them.`,
        "Do not write files.",
      ]),
    ),
  );
}

export function implementPrompt(c: Ctx): string {
  const branch = String(c.channels.plan?.branch ?? "").trim();
  const steps = String(c.channels.plan?.planMd ?? "").trim();
  return brief(
    header(c),
    acceptance(c),
    planContract(c),
    // The planner's prose, so the whole plan is in this brief — .te/plan.md holds the same text.
    section("Plan steps", steps),
    section(
      "Your job",
      bullets([
        `Implement the approved plan above on branch \`${branch}\` in every repository you change — create it where it does not exist yet, ` +
          `and when the working tree is already on it, build on the commits it carries.${steps ? ` The same plan is in \`${PLAN_FILE}\`; you need not read it.` : ""}`,
        "A criterion the plan marks no code change that only a person can confirm after publish or deploy goes in `manualChecks` — " +
          "it is not a deviation and does not make the criteria partial.",
        "Commit locally. Do not push.",
      ]),
    ),
  );
}

// A re-review starts from what the fix changed since the last review, then confirms the delta broke nothing.
function reReview(c: Ctx, prev: Refusal[]): string[] {
  const heads = Object.entries(reviewedHeadsOf(c)).filter(([, sha]) => sha);
  return [
    `This is a re-review after a fix round.${prev.length ? " The fix was asked to resolve:" : ""}`,
    ...(prev.length ? [numbered(prev)] : []),
    ...(heads.length
      ? [
          "What changed since the last review — start here:",
          bullets(heads.map(([repo, sha]) => `${repo}: \`git diff ${sha}..HEAD\``)),
          "Check each blocker above is resolved in that delta, then that the delta breaks nothing the last review passed. " +
            "Do not reopen what the last review passed and the delta does not touch. If the branch was rebased since, the delta also carries base changes — judge only this change's files.",
        ]
      : []),
  ];
}

export function evaluatePrompt(c: Ctx): string {
  const again = (c.visits.evaluate ?? 0) > 1;
  const prev = again ? lastFixInputOf(c) : [];
  const warnings = warningsOf(c);
  const manual = manualChecksOf(c);
  return brief(
    header(c),
    acceptance(c),
    planContract(c),
    section(
      "Harness warnings",
      warnings.length ? ["They are not blockers by themselves — raise one only when it is a real defect of this change:", numbered(warnings)] : [],
    ),
    deliveryClaims(c),
    section(
      "Checked by a person after deploy",
      manual.length
        ? [
            "The implementer listed these criteria as manual checks — only a person can confirm them once the change is deployed, and the pull request " +
              "lists them for QA. Do not try to verify them and never block on them; give each one `checked` row with result `unverified`:",
            ...manual.map((m) => `- AC ${m.n}: ${m.check}`),
          ]
        : [],
    ),
    section("Re-review", again ? reReview(c, prev) : []),
    section(
      "Your job",
      bullets([
        `Branch: ${branchOf(c)}. The plan is \`${PLAN_FILE}\`.`,
        "Review the committed change: `git diff <base commit>..HEAD` in each repository listed above.",
        "Work from the Ticket and acceptance criteria above — do not open the work item again. Run only the tests of the modules this change " +
          "touches, once; never the whole suite.",
        decisionsOf(c).length
          ? "The plan's decisions are judgement calls it owns: raise a blocker only when the code does not follow one or one contradicts an " +
            "acceptance criterion — never for preferring another reasonable reading."
          : "",
      ]),
    ),
  );
}

export function fixInput(c: Ctx): Refusal[] {
  return fixBlockersOf(c);
}

// A later fix round starts from what the last one tried, so it does not repeat a fix the review already refused.
function previousFix(c: Ctx): string {
  const p = c.channels.fix;
  if (!p || (c.visits.fix ?? 0) < 2) return "";
  const given = lastFixInputOf(c);
  const deviations = Array.isArray(p.deviations) ? (p.deviations as { what?: string; why?: string }[]) : [];
  return section("Previous fix attempt", [
    "The last fix round was given the blockers below; the review that followed raised the ones above. Do not repeat a change that did not hold — " +
      "find the root cause it missed.",
    ...(given.length ? ["It was given:", numbered(given)] : []),
    ...(String(p.summary ?? "").trim() ? [`It reported: ${String(p.summary).trim()}`] : []),
    ...(deviations.length ? ["It left unchanged:", ...deviations.map((x, i) => `${i + 1}. ${x.what ?? ""} — ${x.why ?? ""}`)] : []),
  ]);
}

export function fixPrompt(c: Ctx): string {
  const items = fixInput(c);
  const harness = items.some((r) => r.source === "syncBase" || r.source === "diffGuard");
  return brief(
    header(c),
    acceptance(c),
    planContract(c),
    section(harness ? "Blockers from the harness checks" : "Review blockers", numbered(items)),
    previousFix(c),
    section(
      "Your job",
      bullets([
        `Branch: ${branchOf(c)}. The plan is \`${PLAN_FILE}\`.`,
        `Fix exactly the ${harness ? "" : "review "}blockers above, then commit locally on the same branch.`,
        harness
          ? "These need git work on this branch's own unpushed commits — a rebase onto the base, or rewriting the commits to drop a file or line. " +
            "Do that and nothing else; never touch the base's commits."
          : "",
        "Do not push.",
      ]),
    ),
  );
}

export function reflectPrompt(c: Ctx): string {
  const last = lastDelivery(c);
  const blocked = (last.blocked ?? {}) as { is?: boolean; reason?: string };
  const rounds = c.visits.fix ?? 0;
  const why = blocked.is
    ? `the fixer is blocked after ${rounds} fix round(s): ${blocked.reason ?? ""}`
    : stalledFix(c)
      ? `${rounds} fix round(s) made no progress — the review raised the same blockers the last fix was given`
      : `${rounds} fix round(s), the whole fix budget`;
  // A blocked fixer stops on what it was given — a harness blocker as often as a review one; otherwise the review's.
  const standing = blocked.is && lastFixInputOf(c).length ? lastFixInputOf(c) : bundleOf(c);
  const deviations = Array.isArray(last.deviations) ? (last.deviations as { what?: string; why?: string }[]) : [];
  return brief(
    header(c),
    section("Why the run is stopping", `The run is stopping after ${why}.`),
    section("Blockers still standing", numbered(standing)),
    section("Last fix summary", String(last.summary ?? "")),
    section("What the last fix left unchanged", deviations.map((x, i) => `${i + 1}. ${x.what ?? ""} — ${x.why ?? ""}`)),
    section("Your job", `Decide whether this teaches a reusable lesson and, if so, record it in ${c.knowledgeFile || "KNOWLEDGE.md"}.`),
  );
}

// The worktree on the pull request's branch — a related repo's when the pull request lives there.
const prTree = (c: Ctx) => c.companions.find((m) => m.name === c.channels.setup?.prRepo)?.cwd ?? c.cwd;

export function reviewTriagePrompt(c: Ctx): string {
  return brief(
    header(c, ["ticket"]),
    section(
      "Your job",
      bullets([
        `The working tree \`${prTree(c)}\` is on the pull request's source branch \`${branchOf(c)}\`.`,
        "Read every open review thread on the pull request above and judge each one against the code and the ticket.",
        `Return one \`threads\` entry per open thread and the Thread Decisions table in \`planMd\`; the harness writes it to \`${PLAN_FILE}\`.`,
        DIGEST_JOB,
        "Do not write files and do not reply to any thread.",
      ]),
    ),
    skillMenu(c, false),
  );
}

export function reviewImplementPrompt(c: Ctx): string {
  return brief(
    header(c),
    acceptance(c),
    section(
      "Your job",
      bullets([
        `The decisions are in \`${PLAN_FILE}\`. Fix exactly these threads on the current branch \`${branchOf(c)}\` of \`${prTree(c)}\`.`,
        "Do not create or switch branches, do not rebase.",
        "Commit locally. Do not push and do not reply to any thread.",
      ]),
    ),
  );
}

export function respondPrompt(c: Ctx): string {
  const changed = Array.isArray(c.channels.diffGuard?.changed) && c.channels.diffGuard.changed.length > 0;
  const answer = threadsOf(c).filter((t) => t.decision !== "informational");
  return brief(
    header(c, ["ticket", "knowledge"]),
    section("Threads to answer", answer.map((t, i) => `${i + 1}. thread ${t.threadId} (${t.decision})${t.file ? ` ${t.file}` : ""} — ${t.reason}`)),
    section(
      "Your job",
      bullets([
        changed ? `Push branch \`${branchOf(c)}\` from \`${prTree(c)}\` to origin (never force-push).` : "Nothing was committed — push nothing.",
        "Answer the threads above on the pull request, one reply each.",
        "Never resolve a thread or change its status.",
        "Skip a thread that already carries your reply — this step may be retried after a crash.",
      ]),
    ),
  );
}

export function qaTriagePrompt(c: Ctx): string {
  const f = followUpOf(c);
  const window = f
    ? [
        `${f.triggers.join(", ") || "comments"} — every comment by someone other than the developer` +
          `${f.since ? ` after ${f.since}` : ""}${f.upTo ? `, up to ${f.upTo}` : ""}. Read earlier comments only for context.`,
        ...(f.developer
          ? [
              `The developer is ${[f.developer.name, f.developer.email && `<${f.developer.email}>`].filter(Boolean).join(" ")} — ` +
                `their own comments are context, never feedback to judge, and the reply is written as them.`,
            ]
          : []),
      ]
    : ["QA sent this ticket back. Judge the QC comments left since the last delivery."];
  return brief(
    header(c, ["ticket"]),
    section("QC feedback to judge", window),
    section(
      "Developer's decision",
      f?.decision
        ? [
            "The developer reviewed the analysis and decided to fix exactly these — binding: mark each a defect, plan its fix, outcome `fix`:",
            ...f.decision.fix.map((x, i) => `${i + 1}. ${x}`),
            ...(f.decision.note ? [`Developer's note: ${f.decision.note}`] : []),
            "Report other findings as you judge them; plan no change for them.",
          ]
        : [],
    ),
    section(
      "Your job",
      bullets([
        "Read the work item through the provider's MCP server and judge every point QC raised against the code on the base commits above.",
        "Return the verdicts in `findings` and the developer's reply to QC in `qaReply`.",
        DIGEST_JOB,
        `When at least one is a real defect, propose \`branch\` and the fix plan in \`planMd\` (the harness writes it to \`${PLAN_FILE}\`).`,
        "Do not write files and do not comment on the ticket.",
      ]),
    ),
    skillMenu(c, true),
  );
}

export function qaImplementPrompt(c: Ctx): string {
  return brief(
    header(c),
    acceptance(c),
    section(
      "Your job",
      bullets([
        `Implement \`${PLAN_FILE}\` on branch \`${branchOf(c)}\` in every repository you change — create it where it does not exist yet.`,
        "Add a regression test for each defect.",
        "Commit locally. Do not push.",
      ]),
    ),
  );
}

export type PublishTarget = { repo: string; cwd: string; branch: string; base: string };

export function publishTargets(c: Ctx): PublishTarget[] {
  const rows = Array.isArray(c.channels.diffGuard?.changed) ? (c.channels.diffGuard.changed as { repo: string; branch: string }[]) : [];
  const cwdOf = (name: string) => (name === rootName(c) ? c.cwd : c.companions.find((m) => m.name === name)?.cwd ?? "");
  const bases = basesOf(c);
  return rows.map((r) => ({ repo: r.repo, cwd: cwdOf(r.repo), branch: r.branch, base: bases[r.repo] ?? "" })).filter((t) => t.cwd && t.branch);
}

const cellOf = (s: unknown) => String(s ?? "").replace(/\s*\n\s*/g, " ").replace(/\|/g, "\\|").trim();

// The plan's "## Goal" paragraph — the one line of intent a PR summary leads with.
function goalOf(c: Ctx): string {
  const md = String(c.channels.plan?.planMd ?? "");
  const m = /^##\s*Goal\s*\n([\s\S]*?)(?=\n##\s|$)/m.exec(md);
  return (m?.[1] ?? "").trim();
}

type Check = { subject?: string; evidence?: string; result?: string };

// The review row for criterion n: the reviewer names it "AC n" / "AC1a…" or quotes its opening words.
function reviewRowFor(rows: Check[], n: number, ac: string): Check | undefined {
  const head = ac.slice(0, 30).toLowerCase();
  return rows.find((r) => new RegExp(`\\bAC\\s*${n}(?![0-9])`, "i").test(r.subject ?? "") || (head.length > 8 && (r.subject ?? "").toLowerCase().includes(head)));
}

/**
 * The pull request description, built by the harness from what the run recorded — so every PR reads the same and its
 * evidence is the run's, not the publisher's reconstruction: summary, AC table with the review's proof, verification,
 * decisions, after-deploy checks and what the review left unverified.
 */
export function prBody(c: Ctx): string {
  const impl = c.channels.implement ?? {};
  const last = lastDelivery(c);
  const v = (last.verification ?? {}) as { tests?: string; build?: string; acceptanceCriteria?: string };
  const checked = Array.isArray(c.channels.evaluate?.checked) ? (c.channels.evaluate.checked as Check[]) : [];
  const count = (r: string) => checked.filter((x) => x.result === r).length;
  const acs = strings(c.channels.readiness?.acceptanceCriteria);
  const rows = acRows(c.channels.plan);
  const decided = decisionsOf(c);
  const manual = manualChecksOf(c);
  const unverified = reviewAssumptionsOf(c);
  const out: string[] = [];
  const summary = [goalOf(c), String(impl.summary ?? "").trim()].filter(Boolean);
  out.push("## Summary", summary.length ? summary.join("\n\n") : `Ticket ${c.ticketId}.`);
  if (rows.length) {
    out.push(
      "",
      "## Acceptance criteria",
      "| # | Acceptance criterion | Change | Proven by |",
      "|---|---|---|---|",
      ...rows.map((a, i) => {
        const n = a.n ?? i + 1;
        const ac = acs[n - 1] ?? a.ac ?? "";
        const row = reviewRowFor(checked, n, ac);
        const proof = row ? `review: ${row.result ?? ""} — ${row.evidence ?? ""}` : a.test ? `planned: ${a.test}` : "—";
        return `| ${n} | ${cellOf(ac)} | ${a.change === "none" ? "no change" : cellOf((a.files ?? []).join(", "))} | ${cellOf(proof)} |`;
      }),
    );
  }
  out.push(
    "",
    "## Verification",
    `- Implementer: tests ${v.tests ?? "not reported"}, build ${v.build ?? "not reported"}, acceptance criteria ${v.acceptanceCriteria ?? "not reported"}.`,
    checked.length
      ? `- Independent review: ${c.channels.evaluate?.verdict ?? ""} — ${count("ok")} checks ok, ${count("issue")} issue, ${count("unverified")} unverified.`
      : "- Independent review: no checks recorded.",
  );
  if (decided.length) out.push("", "## Decisions", ...decided);
  if (manual.length) out.push("", "## Manual checks after deploy", ...manual.map((m) => `- [ ] AC ${m.n}: ${m.check}`));
  if (unverified.length) out.push("", "## Not verified by the automated review", ...unverified.map((a) => `- ${a}`));
  return out.join("\n");
}

export function publishPrompt(c: Ctx): string {
  const targets = publishTargets(c);
  return brief(
    header(c, ["knowledge"]),
    section(
      "Repositories to publish",
      targets.map((t) => `- ${t.repo}: working tree \`${t.cwd}\`, branch \`${t.branch}\` → pull request into ${t.base ? `\`${t.base}\` (required by a skill)` : "the default branch"}`),
    ),
    section("Pull request description", [
      "The harness wrote it from what this run recorded. Use it verbatim as each pull request's description" +
        (targets.length > 1 ? ', adding a "Companion pull requests" list with the links of the others' : "") +
        " — do not rebuild it from the plan or the log:",
      "",
      "~~~markdown",
      prBody(c),
      "~~~",
    ]),
    section("Your job", bullets(["Publish these repositories (and only these).", "Report one `prs` entry per repository above."])),
  );
}
