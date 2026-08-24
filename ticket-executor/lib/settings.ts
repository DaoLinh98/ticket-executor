import { prisma } from "@/lib/prisma";
import { hubUrl, type HubConnectionView } from "@/lib/hub";

/**
 * The settings row, created on first read — and pointed at the hub when the
 * deployment is.
 *
 * **Why the default lives here and not in the schema.** `Setting.hubEnabled`
 * defaults to false in Prisma because a standalone install is the normal case,
 * and that stays true. But an install started by `DAGENT_HUB_URL` is not that
 * install: someone deployed this app *inside* EmeHub, and the first thing they
 * saw was a Settings page insisting they turn the hub on before anything worked
 * — a switch whose only sensible position was already known from the
 * environment. A schema default cannot read the environment; this can.
 *
 * **Why it also fixes rows that already exist.** The interesting case is not a
 * fresh database, it is the one already running with hub mode off from before
 * the hub existed. `hubModeChosen` separates "nobody was asked" from "someone
 * said no", so the default can be applied exactly once to the former and never
 * to the latter: saving the Settings page sets the flag, and after that this
 * function never touches `hubEnabled` again.
 *
 * It never turns hub mode *off*. Removing `DAGENT_HUB_URL` from a hub install
 * makes it unreachable, not standalone, and silently rerouting provider calls at
 * that moment would be a config typo quietly changing which credential a run
 * uses.
 */
export async function getOrCreateSetting() {
  const existing = await prisma.setting.findUnique({ where: { id: "default" } });
  const pointedAtHub = !!hubUrl();

  if (!existing) {
    return prisma.setting.create({
      data: { id: "default", hubEnabled: pointedAtHub },
    });
  }

  if (pointedAtHub && !existing.hubModeChosen && !existing.hubEnabled) {
    return prisma.setting.update({
      where: { id: "default" },
      data: { hubEnabled: true },
    });
  }

  return existing;
}

/**
 * Pick the hub connection when there is nothing to pick *between*.
 *
 * Hub mode routes every provider call through one named connection, so turning
 * it on is only half an answer — and the other half is a dropdown showing a
 * single card the user has no choice about. That is the case this settles, and
 * only that case: two or more candidates is a real decision, and guessing at it
 * is a run against the wrong organization.
 *
 * Candidates are narrowed to the provider this app is set to and to connections
 * the hub actually holds a PAT for; a lone connection for some other provider is
 * not "the obvious one", it is the wrong one.
 *
 * Returns the id to render — the caller's existing selection when it had one, so
 * this can sit in the response path without a second read.
 */
export async function selectSoleHubConnection(
  setting: { hubConnectionId: string; provider: string },
  connections: HubConnectionView[],
): Promise<string> {
  if (setting.hubConnectionId) return setting.hubConnectionId;

  const usable = connections.filter((c) => c.provider === setting.provider && c.hasPat);
  if (usable.length !== 1) return "";

  const chosen = String(usable[0].hubId);
  await prisma.setting.update({
    where: { id: "default" },
    data: { hubConnectionId: chosen },
  });
  return chosen;
}
