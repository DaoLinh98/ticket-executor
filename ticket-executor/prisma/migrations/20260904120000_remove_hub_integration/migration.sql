-- Remove the EmeHub integration: this app talks to its provider directly again.

ALTER TABLE "Setting" DROP COLUMN IF EXISTS "hubEnabled";
ALTER TABLE "Setting" DROP COLUMN IF EXISTS "hubModeChosen";
ALTER TABLE "Setting" DROP COLUMN IF EXISTS "hubConnectionId";
ALTER TABLE "Setting" DROP COLUMN IF EXISTS "hubToken";
ALTER TABLE "Setting" DROP COLUMN IF EXISTS "hubTokenExpiresAt";
ALTER TABLE "Setting" DROP COLUMN IF EXISTS "hubSid";
ALTER TABLE "Setting" DROP COLUMN IF EXISTS "emehubTheme";

ALTER TABLE "Run" DROP COLUMN IF EXISTS "claudeSource";
ALTER TABLE "Run" DROP COLUMN IF EXISTS "claudeGrant";
ALTER TABLE "Run" DROP COLUMN IF EXISTS "claudeGrantExpiresAt";
