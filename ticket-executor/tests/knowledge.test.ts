// What the harness is willing to remember about a repository, and what it
// refuses to. Zero tokens, no database — the rules live in a Prisma-free module
// for exactly this reason (same split as admission.ts).
//
// The thing these guard is quiet: a knowledge base that accepts anything decays
// into a diary of past tickets, and every future run pays to read it.
import test from "node:test";
import assert from "node:assert/strict";

import { fingerprint, formatKnowledge, normalizeLessons } from "../lib/execution/knowledge";
import { lessonsOf } from "../lib/execution/graph/schemas";

test("lessonsOf reads the contract field, and is empty on contracts without one", () => {
  assert.deepEqual(
    lessonsOf({ lessons: [{ text: "Run npm test from ticket-executor/, not the repo root." }] }),
    ["Run npm test from ticket-executor/, not the repo root."]
  );
  // plan / publish / gate outputs carry no `lessons` — they must yield none
  // rather than throw.
  assert.deepEqual(lessonsOf({ planWritten: true }), []);
  assert.deepEqual(lessonsOf({ lessons: "not an array" }), []);
  assert.deepEqual(lessonsOf({ lessons: [{ text: 42 }, {}] }), []);
});

test("the same lesson worded differently is one fingerprint", () => {
  assert.equal(
    fingerprint("Run `npm test` from ticket-executor/."),
    fingerprint("run npm test from ticket-executor")
  );
  assert.notEqual(fingerprint("Run npm test"), fingerprint("Run npm build"));
});

test("normalizeLessons drops what a rule cannot be", () => {
  const long = "x".repeat(300);
  assert.deepEqual(
    normalizeLessons([
      "  Prisma  client   must be regenerated after schema.prisma changes.  ",
      "too short",
      long,
      "",
    ]),
    ["Prisma client must be regenerated after schema.prisma changes."]
  );
});

test("normalizeLessons dedupes within a single report", () => {
  assert.deepEqual(
    normalizeLessons(["Never edit generated migration SQL.", "never edit generated migration sql"]),
    ["Never edit generated migration SQL."]
  );
});

test("no notes means no block at all", () => {
  // A header over an empty list would tell the agent this repo has nothing worth
  // knowing, which an empty table is no evidence for.
  assert.equal(formatKnowledge([]), "");
});

test("formatKnowledge renders every note and marks them as priors", () => {
  const block = formatKnowledge([{ text: "Alpha rule." }, { text: "Beta rule." }]);
  assert.match(block, /- Alpha rule\./);
  assert.match(block, /- Beta rule\./);
  assert.match(block, /the repo wins/);
});
