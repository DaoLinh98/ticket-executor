import { execSync } from "child_process";
import type { FileChange } from "../types";

const CHANGE_TYPE: Record<string, FileChange["changeType"]> = {
  A: "added", D: "deleted", M: "modified", R: "renamed",
};
const MAX_DIFF_CHARS = 20000; // per-file cap so one huge generated file doesn't bloat the DB row

// Diffs the worktree's current HEAD (after the skill's own commit(s)) against the commit
// the worktree branched from, so the Result tab can show exactly what this run changed.
export function collectFileChanges(cwd: string, baseSha: string): FileChange[] {
  try {
    const nameStatus = execSync(`git -C "${cwd}" diff --name-status "${baseSha}" HEAD`, { encoding: "utf8" });
    const files: FileChange[] = [];
    for (const line of nameStatus.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const parts = line.split("\t");
      const code = parts[0][0];
      const filePath = parts[0].startsWith("R") ? parts[2] : parts[1];
      if (!filePath) continue;
      let diff = "";
      try {
        diff = execSync(`git -C "${cwd}" diff "${baseSha}" HEAD -- "${filePath}"`, { encoding: "utf8", maxBuffer: 1024 * 1024 * 10 });
      } catch {
        diff = "";
      }
      if (diff.length > MAX_DIFF_CHARS) diff = diff.slice(0, MAX_DIFF_CHARS) + "\n… (diff truncated)";
      files.push({ path: filePath, changeType: CHANGE_TYPE[code] ?? "modified", diff });
    }
    return files;
  } catch {
    return [];
  }
}
