// Translating one work-item comment into Vietnamese: a single Claude turn, on
// the cheapest model, that reads text and returns text.
//
// **Why this is not a graph, and not even a triage.** It writes nothing, reads
// nothing outside its own prompt, and is over in one turn — there is no branch,
// no worktree, no admission rule it could violate, and nothing worth persisting
// because the answer is a re-translation of text the provider still holds. It
// keeps the one thing every turn in this app keeps: a declared JSON Schema, so
// the route gets data instead of prose it would have to scrape.
//
// **Why the turn is stripped down to nothing.** Measured on this machine, one
// sentence translated with the same flags a *run* uses cost 12.7s and $0.055,
// because a run's turn ships the whole agent harness whether or not it is used:
//
//   default flags + --json-schema ...... 12.7s  $0.0549  23,869 cache-creation tokens
//   + --system-prompt .................. 12.0s  $0.0471  20,358
//   + --tools "" ........................ 7.3s  $0.0057       0
//
// Almost all of it was tool definitions — 20k tokens of Bash/Edit/Read/WebFetch
// contracts re-sent on every translation, since each one is a new session and
// caches nothing. A custom `--system-prompt` (which also keeps the machine's 34
// installed skills out of the prompt) and `--tools ""` remove both, and the
// translation needs neither: it reads its input from the prompt and writes its
// answer to stdout.
//
// `--json-schema` is kept even though it costs a second turn, because *dropping*
// it measured worse, not better: with nothing to anchor the answer the model
// spent 2,780 thinking tokens on one sentence and took 29s, against 435 and 7.3s
// with the schema. The contract is the cheap option here as well as the correct
// one.
//
// Two more deliberate choices:
//
// - **The model is the `haiku` family alias**, not a pinned version. The CLI
//   documents a family alias as "an alias for the latest model", which is the
//   same reasoning `CLAUDE_MODELS` in lib/claudeOptions.ts already relies on —
//   the cheapest model stays the cheapest *current* model without this file
//   having to be edited every release. It is not the user's `--model` override:
//   which model implements a translation is not a per-ticket decision.
// - **The answer is plain text, never HTML.** The source is sanitized provider
//   HTML, but a model's output is not, and `RichText` deliberately does not
//   sanitize again (it trusts `sanitizeHtml()` at the producer). Asking for
//   plain text means there is no second producer to trust, and the block below
//   the comment renders as text.

import { randomUUID } from "crypto";
import { mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { commonArgs, runTurn, turnLive } from "./claudeCli";

/** The cheapest model the CLI offers. See the note above on why it is an alias. */
export const TRANSLATE_MODEL = "haiku";

/** Replaces the default system prompt outright, rather than appending to it:
 *  appending would keep the agent preamble and every skill installed on the
 *  machine, which is most of what this turn was paying for. */
const TRANSLATE_SYSTEM = "You translate text into Vietnamese. Return only the translation.";

/** Longer than any comment worth translating in one press, and a ceiling on
 *  what one button can spend. */
const MAX_INPUT = 20000;

const TRANSLATE_OUTPUT = {
  type: "object",
  additionalProperties: false,
  required: ["vietnamese"],
  properties: {
    vietnamese: {
      type: "string",
      description: "The comment translated into Vietnamese, as plain text.",
    },
  },
} as const;

function prompt(text: string): string {
  return [
    "Translate the work-item comment below into Vietnamese.",
    "",
    "Rules:",
    "- Return plain text only. No HTML, no Markdown fences.",
    "- Keep code, identifiers, file paths, branch names, URLs and @mentions exactly as they are.",
    "- Keep the original line breaks and list structure.",
    "- Translate only. Do not summarise, answer, or add commentary.",
    "- Text that is already Vietnamese stays as it is.",
    "",
    "COMMENT:",
    text,
  ].join("\n");
}

/** A turn that must reach no MCP server at all. An empty config plus
 *  `--strict-mcp-config` (added by commonArgs) is what says so; leaving the path
 *  empty would instead inherit whatever servers the machine has configured, and
 *  start every one of them to translate a paragraph. */
function emptyMcpConfig(id: string): string {
  try {
    const dir = path.join(tmpdir(), "te-translate");
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${id}.json`);
    writeFileSync(file, JSON.stringify({ mcpServers: {} }), { encoding: "utf8", mode: 0o600 });
    return file;
  } catch {
    return "";
  }
}

function scratchCwd(id: string): string {
  const dir = path.join(tmpdir(), "te-translate", id);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export type TranslateResult = { vietnamese: string } | { error: string };

/** Translate one comment. Text in, text out — nothing is stored. */
export async function translateToVietnamese(text: string): Promise<TranslateResult> {
  const source = text.trim();
  if (!source) return { error: "There is nothing to translate." };
  if (source.length > MAX_INPUT) {
    return { error: `This comment is too long to translate (${source.length} characters, limit ${MAX_INPUT}).` };
  }

  const id = randomUUID().replace(/[^\w-]/g, "");
  const cwd = scratchCwd(id);
  const turn = await runTurn(turnLive(cwd), [
    "-p",
    prompt(source),
    "--session-id",
    randomUUID(),
    "--model",
    TRANSLATE_MODEL,
    "--effort",
    "low",
    // A translation reads its input from the prompt and writes its answer to
    // stdout. It needs no file access, no shell and no web — and the definitions
    // of those tools were the bulk of what every translation was paying for.
    "--tools",
    "",
    "--system-prompt",
    TRANSLATE_SYSTEM,
    ...commonArgs({
      mcpConfigPath: emptyMcpConfig(id),
      cwd,
      outputSchema: TRANSLATE_OUTPUT as unknown as Record<string, unknown>,
    }),
  ]);

  if (!turn.ok || !turn.structured) {
    return {
      error:
        turn.error ||
        "the translation turn finished without returning its structured output",
    };
  }
  const out = turn.structured.vietnamese;
  if (typeof out !== "string" || !out.trim()) {
    return { error: "the translation turn returned an empty translation" };
  }
  return { vietnamese: out };
}
