import { readFileSync } from "fs";
import type { KnowledgeChange } from "../../types";
import { knowledgeFile } from "./prompts";

export function readKnowledge(rootRepo: string): string {
  try {
    return readFileSync(knowledgeFile(rootRepo), "utf8");
  } catch {
    return "";
  }
}

function contentLines(text: string): string[] {
  return text.split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.trim());
}

export function knowledgeChange(file: string, before: string, after: string): KnowledgeChange | null {
  if (before === after) return null;
  const was = contentLines(before);
  const now = contentLines(after);
  const pending = new Map<string, number>();
  for (const l of was) pending.set(l, (pending.get(l) ?? 0) + 1);
  const added: string[] = [];
  for (const l of now) {
    const n = pending.get(l) ?? 0;
    if (n > 0) pending.set(l, n - 1);
    else added.push(l);
  }
  const removed: string[] = [];
  for (const l of was) {
    const n = pending.get(l) ?? 0;
    if (n > 0) {
      removed.push(l);
      pending.set(l, n - 1);
    }
  }
  return { file, added, removed, lines: now.length };
}
