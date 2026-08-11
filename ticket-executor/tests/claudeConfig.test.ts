// Where a hub-issued Claude credential is materialised.
//
// Only the path rule is asserted here, and deliberately so: the write itself is
// thin `fs` plumbing, and a test that exercised it would have to write to the
// real directory — the same file a run in flight is authenticating with. A test
// that can break a live run to prove a rename works is a bad trade. The round
// trip is verified against a real run instead.
//
// The rule that *is* worth pinning: `own` and `shared` never resolve to the same
// directory. If they did, a member switching to the workspace account would keep
// executing under whichever credential happened to be written last — silently,
// and under someone else's name in the hub's ledger.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { homedir } from "node:os";

import { claudeCredentialDir } from "../lib/claudeConfig";

test("each account gets its own directory", () => {
  assert.notEqual(claudeCredentialDir("own"), claudeCredentialDir("shared"));
});

test("the credential is never materialised inside the repo", () => {
  // A `git clean`, a worktree teardown or a stray `.gitignore` edit must not be
  // able to reach it.
  const repo = path.resolve(import.meta.dirname, "..");
  for (const source of ["own", "shared"] as const) {
    assert.equal(claudeCredentialDir(source).startsWith(repo), false, source);
  }
});

test("the credential is never materialised in the machine's own ~/.claude", () => {
  // The one directory this must never resolve to. `~/.claude/.credentials.json`
  // is the developer's own login, and hub mode is allowed to run *as* another
  // account — never to overwrite the account they signed in with themselves.
  // Nothing here backs that file up, so a clobber is not recoverable.
  const own = path.resolve(homedir(), ".claude");
  for (const source of ["own", "shared"] as const) {
    const dir = path.resolve(claudeCredentialDir(source));
    assert.notEqual(dir, own, source);
    assert.equal(dir.startsWith(own + path.sep), false, source);
  }
});
