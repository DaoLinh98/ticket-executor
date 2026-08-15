import { prisma } from "../prisma";
import { lessonsOf } from "./graph/schemas";
import { fingerprint, formatKnowledge, MAX_INJECTED, normalizeLessons } from "./knowledge";

/** Reads and writes for `KnowledgeNote`. The rules these enforce live in
 *  `knowledge.ts`, which has no Prisma and is where the tests point. */

/** Store what a node reported. The same lesson from another run bumps `hits`
 *  rather than adding a row, which is also what ranks it for injection later.
 *  Returns how many notes the report actually yielded, for the run log. */
export async function recordLessons(
  rootRepo: string,
  runId: string,
  scope: "implement" | "review",
  data: Record<string, unknown>
): Promise<number> {
  if (!rootRepo) return 0;
  const texts = normalizeLessons(lessonsOf(data));
  for (const text of texts) {
    const fp = fingerprint(text);
    await prisma.knowledgeNote.upsert({
      where: { rootRepo_fingerprint: { rootRepo, fingerprint: fp } },
      // Deliberately does not overwrite `text` or reactivate a retired note: a
      // note switched off is a human saying this lesson is wrong, and a run
      // learning it again is not evidence against that.
      update: { hits: { increment: 1 }, lastRunId: runId },
      create: { rootRepo, scope, text, fingerprint: fp, firstRunId: runId, lastRunId: runId },
    });
  }
  return texts.length;
}

/** The block for a run about to start. Review-scoped notes are withheld from an
 *  implement run: they are about answering threads on a pull request, which that
 *  run has not got. Implement-scoped notes go to both — how the repo builds and
 *  tests is true either way. */
export async function loadKnowledge(rootRepo: string, scope: "implement" | "review"): Promise<string> {
  if (!rootRepo) return "";
  const notes = await prisma.knowledgeNote.findMany({
    where: {
      rootRepo,
      active: true,
      ...(scope === "implement" ? { scope: "implement" } : {}),
    },
    orderBy: [{ hits: "desc" }, { updatedAt: "desc" }],
    take: MAX_INJECTED,
    select: { text: true },
  });
  return formatKnowledge(notes);
}
