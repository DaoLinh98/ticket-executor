-- `Setting.hubEnabled` gains a companion: whether anybody has ruled on it.
--
-- Existing rows are marked as *unchosen* (the column default), which is the
-- honest answer — hub mode had one possible value on this install and nobody was
-- asked. `lib/settings.ts` then applies the deployment default to those rows
-- once, and only where `DAGENT_HUB_URL` says the deployment has a hub at all.
ALTER TABLE "Setting" ADD COLUMN "hubModeChosen" BOOLEAN NOT NULL DEFAULT false;

-- An install whose Settings page was already saved with the hub *on* has plainly
-- ruled on it; nothing here should be able to move that.
UPDATE "Setting" SET "hubModeChosen" = true WHERE "hubEnabled" = true;
