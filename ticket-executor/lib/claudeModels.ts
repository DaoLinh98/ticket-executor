import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { CLAUDE_MODELS as ALIAS_MODELS, type ClaudeModel } from "./claudeOptions";

const execFileAsync = promisify(execFile);

/**
 * The dropdown used to be a hand-written list of model ids, so it drifted the
 * moment the CLI shipped a new one — it still offered Opus 4.8 after Opus 5 had
 * been out for weeks. `claude --help` documents no way to enumerate models, but
 * the CLI carries its own catalog (the table behind `/model`) inside its bundle,
 * so the list is read from the installed binary and therefore says exactly what
 * that binary will accept. When the scan finds nothing the page falls back to
 * the family aliases in `claudeOptions.ts`, which the CLI resolves to the latest
 * model itself — the answer is still current, only the version is unnamed.
 */

/** The four families Claude Code offers a developer. Order is the dropdown's order. */
const FAMILIES = ["opus", "sonnet", "haiku", "fable"] as const;

const CATALOG_ENTRY = /\{id:"(claude-[a-z0-9.-]+)",family:"([a-z]+)",display_name:"([^"]+)"/g;

/** Overlap kept between chunks so an entry straddling a read boundary still matches. */
const OVERLAP = 256;
const CHUNK = 1 << 22;

type CacheKey = string;
let cache: { key: CacheKey; models: ClaudeModel[] } | null = null;

/** Absolute path of the `claude` the engine spawns, or null when it isn't on PATH. */
async function claudeBinPath(): Promise<string | null> {
  const bin = process.env.CLAUDE_BIN || "claude";
  if (bin.includes("/") || bin.includes("\\")) return bin;
  const finder = process.platform === "win32" ? "where" : "which";
  try {
    const { stdout } = await execFileAsync(finder, [bin], { timeout: 8000 });
    const first = stdout.split(/\r?\n/).map((l) => l.trim()).find(Boolean);
    return first ?? null;
  } catch {
    return null;
  }
}

/** `"Opus 4.8"` → `[4, 8]`, so the newest of a family wins without a version table. */
function versionOf(displayName: string): number[] {
  const m = displayName.match(/[\d.]+/);
  return m ? m[0].split(".").map(Number) : [0];
}

function newer(a: number[], b: number[]): boolean {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

async function scanCatalog(path: string): Promise<ClaudeModel[]> {
  const best = new Map<string, { id: string; label: string; version: number[] }>();
  await new Promise<void>((resolve, reject) => {
    let tail = "";
    const stream = createReadStream(path, { encoding: "latin1", highWaterMark: CHUNK });
    stream.on("data", (chunk) => {
      const text = tail + (chunk as string);
      CATALOG_ENTRY.lastIndex = 0;
      for (let m = CATALOG_ENTRY.exec(text); m; m = CATALOG_ENTRY.exec(text)) {
        const [, id, family, label] = m;
        if (!(FAMILIES as readonly string[]).includes(family)) continue;
        const version = versionOf(label);
        const current = best.get(family);
        if (!current || newer(version, current.version)) best.set(family, { id, label, version });
      }
      tail = text.slice(-OVERLAP);
    });
    stream.on("end", () => resolve());
    stream.on("error", reject);
  });
  return FAMILIES.flatMap((f) => {
    const hit = best.get(f);
    return hit ? [{ id: hit.id, label: hit.label }] : [];
  });
}

/**
 * The models the installed CLI knows about, newest per family.
 *
 * Cached against the binary's path, size and mtime rather than a clock: the list
 * can only change when the CLI is replaced, and then it must change at once.
 */
export async function listClaudeModels(): Promise<ClaudeModel[]> {
  const path = await claudeBinPath();
  if (!path) return [...ALIAS_MODELS];
  try {
    const { size, mtimeMs } = await stat(path);
    const key = `${path}:${size}:${mtimeMs}`;
    if (cache?.key === key) return cache.models;
    const models = await scanCatalog(path);
    if (!models.length) return [...ALIAS_MODELS];
    cache = { key, models };
    return models;
  } catch {
    return [...ALIAS_MODELS];
  }
}
