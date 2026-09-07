-- Who the developer is inside each organization. Nothing to backfill: no such
-- value existed before, and an empty identity means "do not filter", which is
-- exactly how every existing connection behaved.
ALTER TABLE "ProviderCredential" ADD COLUMN "identityEmail" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ProviderCredential" ADD COLUMN "identityName" TEXT NOT NULL DEFAULT '';
