import path from "path";

export const INSTRUCTION_FILES = ["CLAUDE.md", "AGENTS.md", path.join(".claude", "CLAUDE.md")];

const WINDOWS_PATH = /(?<![\w])[A-Za-z]:[\\/][^\s`'"<>|*?()[\]]*/g;
const POSIX_PATH = /(?<![\w.:/\\~-])\/(?:[\w.-]+\/)*[\w.-]+/g;

export function companionPathsFromInstructions(text: string): string[] {
  const found: string[] = [];
  for (const re of [WINDOWS_PATH, POSIX_PATH]) {
    for (const m of text.matchAll(re)) {
      const p = m[0].replace(/[\\/.,;:]+$/, "");
      if (p.length > 3 && !found.includes(p)) found.push(p);
    }
  }
  return found;
}

export function companionNote(text: string, raw: string): string {
  const line = text.split(/\r?\n/).find((l) => l.includes(raw));
  if (!line) return "";
  return line
    .replace(`\`${raw}\``, " ")
    .replace(raw, " ")
    .replace(/^\s*[-*]\s+/, "")
    .replace(/\s*[—–:-]\s*[—–:-]\s*/g, " — ")
    .replace(/[\s:—–-]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}
