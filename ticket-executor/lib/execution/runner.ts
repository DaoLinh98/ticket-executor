import { execSync } from "child_process";
import { existsSync } from "fs";
import path from "path";
import { prisma } from "../prisma";
import type { ExecStatus } from "../types";
import { STEPS } from "../ui";
import { commonArgs, runTurn } from "./claudeCli";
import { cleanPath, fmtDuration } from "./format";
import { collectFileChanges } from "./git";
import { store } from "./store";
import type { Entry } from "./types";

export function cancelExecution(id: string): boolean {
  const e = store.get(id);
  if (!e || e.status !== "running") return false;
  e.cancelled = true;
  const pid = e.child?.pid;
  try {
    if (pid && process.platform === "win32") execSync(`taskkill /pid ${pid} /T /F`, { stdio: "ignore" });
    else e.child?.kill("SIGTERM");
  } catch {
    /* already gone */
  }
  return true;
}

export async function startExecution(params: {
  ticketId: string;
  skill: string;
  project: string;
  rootRepo: string;
  prUrl?: string;
  provider?: string;
  model?: string;
  effort?: string;
}): Promise<string> {
  const ticketId = cleanPath(params.ticketId);
  const skill = cleanPath(params.skill);
  const project = cleanPath(params.project);
  const rootRepo = cleanPath(params.rootRepo);
  const prUrl = params.prUrl ? cleanPath(params.prUrl) : "";
  const provider = cleanPath(params.provider || "azure-devops");
  const model = params.model ? cleanPath(params.model) : "";
  const effort = params.effort ? cleanPath(params.effort) : "";
  const prompt = prUrl
    ? `/${skill} Provider: ${provider} - PR: ${prUrl} - Ticket ID: ${ticketId} - Project name: ${project}`
    : `/${skill} Provider: ${provider} - ID: ${ticketId} - Project name: ${project}`;
  const modelArgs = [...(model ? ["--model", model] : []), ...(effort ? ["--effort", effort] : [])];
  const command = `cd ${rootRepo} && claude -p "${prompt}"${model ? ` --model ${model}` : ""}${effort ? ` --effort ${effort}` : ""}`;

  const row = await prisma.execution.create({
    data: { adoTicketId: ticketId, projectName: project, skillName: skill, model, effort, status: "running", command },
  });
  const id = row.id;

  const entry: Entry = {
    id, ticketId, project, skill, model, effort, command,
    status: "running", logLines: [], resultText: "", error: "", prUrl: "", branch: "",
    currentStep: 0, cwd: rootRepo, baseSha: "", filesChanged: [], startedAt: Date.now(), completedAt: null,
    child: null, cancelled: false,
  };
  store.set(id, entry);
  entry.logLines.push({ text: command, kind: "cmd" });

  const finish = async (status: ExecStatus, error: string) => {
    entry.status = status;
    entry.error = error;
    entry.completedAt = Date.now();
    if (status === "completed") entry.currentStep = STEPS.length;
    if (status === "completed" && entry.baseSha) entry.filesChanged = collectFileChanges(entry.cwd, entry.baseSha);
    entry.logLines.push({
      text: status === "completed" ? `✔ Completed in ${fmtDuration(entry.completedAt - entry.startedAt)}` : `✖ ${error || "Execution failed"}`,
      kind: status === "completed" ? "done" : "fail",
    });
    try {
      await prisma.execution.update({
        where: { id },
        data: {
          status,
          resultText: entry.resultText,
          errorMessage: error,
          logLines: JSON.stringify(entry.logLines),
          currentStep: entry.currentStep,
          prUrl: entry.prUrl,
          branch: entry.branch,
          filesChanged: JSON.stringify(entry.filesChanged),
          completedAt: new Date(entry.completedAt),
        },
      });
    } catch {
      /* ignore */
    }
  };

  if (!existsSync(rootRepo)) {
    await finish("failed", `Project folder not found: ${rootRepo}. Set the correct Root repo / Project on the Overview tab.`);
    return id;
  }

  // Always isolate the run in a fresh git worktree so concurrent executions against the same
  // rootRepo/project never share one working tree, git index, or HEAD (which previously let one
  // execution's uncommitted changes leak into another's commit). Checked out detached (no branch
  // of its own) — the skill's own "create a branch" step creates the one real branch, from inside
  // this worktree.
  try {
    const wt = path.join(rootRepo, `.te-worktrees`, `${project}-${id}`);
    entry.baseSha = execSync(`git -C "${rootRepo}" rev-parse HEAD`).toString().trim();
    execSync(`git -C "${rootRepo}" worktree add --detach "${wt}" HEAD`, { stdio: "ignore" });
    entry.cwd = wt;
    entry.logLines.push({ text: `● Isolated worktree ${wt}`, kind: "step" });
  } catch (e) {
    await finish("failed", `Failed to set up isolated git worktree: ${e instanceof Error ? e.message : e}. Concurrent executions require worktree isolation to avoid commit leakage between tickets.`);
    return id;
  }

  // Fire-and-forget single turn (Tier 2). The route returns immediately.
  // The skill itself now owns branch/commit/push/PR — no forced directive, no auto-continue.
  void (async () => {
    const ts = await runTurn(entry, ["-p", prompt, ...modelArgs, ...commonArgs()]);
    if (ts.resultText) entry.resultText = ts.resultText;

    if (entry.cancelled) await finish("failed", "Cancelled by user");
    else if (ts.isError)
      await finish("failed", ts.resultText || ts.errorDetail || "Claude CLI reported an error");
    else await finish("completed", "");
  })();

  return id;
}
