// Writing a hub-issued Claude credential where the CLI will find it.
//
// **Hub mode only.** With `Setting.hubEnabled` off nothing here is called: the
// CLI is spawned with the environment it always had and reads the machine's own
// `~/.claude`. This module adds a second, opt-in location; it never replaces the
// first.
//
// The CLI takes its OAuth session from a `.credentials.json` and has no other
// way to be handed one — which is why the hub materialises its own copy the same
// way for knowledge builds (emehub ADR 0007), and why INTEGRATION.md §4 accepts
// the credential leaving the hub at all.
//
// ## Why this is `CLAUDE_SECURESTORAGE_CONFIG_DIR`, not `CLAUDE_CONFIG_DIR`
//
// The CLI resolves the credential file and everything else from two separate
// roots (measured against claude 2.1.226):
//
//   credentials  `CLAUDE_SECURESTORAGE_CONFIG_DIR` ?? `CLAUDE_CONFIG_DIR` ?? ~/.claude
//   everything   `CLAUDE_CONFIG_DIR` ?? ~/.claude
//   else
//
// `CLAUDE_CONFIG_DIR` is therefore the wrong lever: it relocates the credential
// *and* `skills/`, `settings.json`, `projects/` and the rest. Setting it to a
// directory holding only a credential made the run's own skills vanish — a run
// answered `Unknown command: /implement-ticket-v3` and failed at the first node,
// with the slash-command table dropping from 125 entries to 42.
//
// The narrow variable moves the credential and nothing else. A hub run therefore
// reads the same skills, the same settings and the same `projects/` transcripts
// as a hub-off run, and differs from one in exactly one respect: which account
// it spends. That is the whole intended difference.
//
// ## Why the directory is stable rather than per-run
//
// One directory per **account**, reused. Two runs under the same account share
// it rather than minting a second copy of one secret, and nothing has to be
// cleaned up at the end of a run — the file is rewritten at the start of the
// next one anyway (below).
//
// ## Why it is rewritten at the start of every run
//
// Measured, not assumed: when the CLI fails to refresh, it rewrites
// `.credentials.json` in place with every token blanked. Whatever is on disk is
// therefore not evidence of anything, and the hub is the authoritative copy
// (INTEGRATION.md §5 forbids proceeding on a stale one). Overwriting cannot lose
// a rotation either, because a rotated token is posted back to the hub after
// every turn — so the copy being written here is already the newest one there is.

import { chmod, mkdir, readFile, rename, writeFile } from "fs/promises";
import { homedir } from "os";
import path from "path";

/** Which account the hub resolved for this run. `own` and `shared` get separate
 *  directories so a member running under the workspace account shares one
 *  materialised copy of that secret instead of minting a second. */
export type ClaudeAccountSource = "own" | "shared";

/** Where the credential for `source` lives. Beside the user's own `~/.claude`
 *  rather than in the repo or a temp dir: it must not be something a `git clean`
 *  can delete, and it must not sit inside `~/.claude` either — that directory is
 *  the machine's own login, which hub mode must never overwrite. */
export function claudeCredentialDir(source: ClaudeAccountSource): string {
  return path.join(homedir(), ".ticket-executor", "claude-config", source);
}

/**
 * Restrict a path to the owning user. **Best effort, never fatal.**
 *
 * Honest about what this buys on Windows, which is where this app runs: `chmod`
 * is a no-op there, so the file is protected by the user profile's ACL and
 * nothing else. That is the same protection `~/.claude/.credentials.json`
 * already relies on, so this is not a new exposure — but it is not a guarantee
 * either, and pretending otherwise would be worse than saying so.
 */
async function lockDown(target: string, isDir: boolean): Promise<void> {
  try {
    await chmod(target, isDir ? 0o700 : 0o600);
  } catch {
    /* platform-dependent; the containing profile directory is the real boundary */
  }
}

/**
 * Write `raw` where the CLI will read it, and return the directory to point
 * `CLAUDE_SECURESTORAGE_CONFIG_DIR` at.
 *
 * Written to a temp name and renamed, so a reader never sees half a file: two
 * runs starting at once under the same account both write here, with identical
 * content, and a torn read would be an authentication failure that looks like a
 * dead credential.
 */
export async function writeClaudeCredential(
  source: ClaudeAccountSource,
  raw: string,
): Promise<string> {
  const dir = claudeCredentialDir(source);
  await mkdir(dir, { recursive: true });
  await lockDown(dir, true);

  const target = path.join(dir, ".credentials.json");
  const staging = `${target}.tmp${process.pid}`;
  await writeFile(staging, raw, { encoding: "utf8", mode: 0o600 });
  await lockDown(staging, false);
  await rename(staging, target);
  return dir;
}

/**
 * The credential as it stands on disk now, or `""`.
 *
 * Read after a turn to see whether the CLI rotated the token, so it can be
 * handed back to the hub. `""` covers both "no file" and "unreadable"; neither
 * is worth distinguishing, because the only thing done with the result is
 * deciding whether there is something to post.
 */
export async function readClaudeCredential(dir: string): Promise<string> {
  try {
    return await readFile(path.join(dir, ".credentials.json"), "utf8");
  } catch {
    return "";
  }
}
