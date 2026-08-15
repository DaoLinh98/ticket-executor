/**
 * The pure half of the harness's repo memory: what counts as a lesson, when two
 * lessons are the same one, and how a set of them is rendered into a prompt.
 *
 * No Prisma here on purpose — same reason `admission.ts` has none. These are the
 * rules that decide what the next run is told, so they are the part worth
 * testing, and they are testable in a second with no database. The reads and
 * writes live in `knowledgeStore.ts`.
 *
 * Write side: the delivering and reviewing nodes already answer a JSON Schema,
 * and `lessons` is one more field on it (graph/schemas.ts). So learning costs no
 * extra node, no extra turn and no new `graphId` — it rides contracts that
 * already exist, in every graph including the one-shot pair.
 *
 * Nothing here may fail a run. A lesson makes the *next* ticket cheaper; it is
 * not state this run depends on.
 */

/** How many notes may reach a prompt. The cap is the point: an unbounded block
 *  grows without limit, is paid for on every run that reads it, and buries the
 *  useful lines among the stale ones. Ranked by `hits` — a lesson ten runs
 *  independently arrived at outranks one a single run guessed. */
export const MAX_INJECTED = 12;

/** Longer than this is not a rule, it is a paragraph, and it was almost always
 *  a summary of one ticket that slipped past the schema description. */
const MAX_LEN = 240;

/** Shorter than this cannot be a self-contained instruction. */
const MIN_LEN = 12;

/** Both write paths use this, so "the same lesson" means the same thing whether
 *  it is being stored or compared. Case, punctuation and whitespace differences
 *  are how one rule becomes five rows. */
export function fingerprint(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Enforce what the schema's description asks for but cannot check. */
export function normalizeLessons(raw: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    const text = r.replace(/\s+/g, " ").trim();
    if (text.length < MIN_LEN || text.length > MAX_LEN) continue;
    const fp = fingerprint(text);
    if (!fp || seen.has(fp)) continue;
    seen.add(fp);
    out.push(text);
  }
  return out;
}

/** Render notes as the block appended to a run's opening prompt. Empty in, empty
 *  out — a header with nothing under it reads as "there is nothing to know about
 *  this repo", which is a claim an empty table does not support. */
export function formatKnowledge(notes: { text: string }[]): string {
  if (!notes.length) return "";
  return (
    "\n\nWhat earlier runs learned about this repository (from the harness, not from this ticket). " +
    "Treat each line as a strong prior, not as fact: if the repo contradicts one, the repo wins.\n" +
    notes.map((n) => `- ${n.text}`).join("\n")
  );
}
