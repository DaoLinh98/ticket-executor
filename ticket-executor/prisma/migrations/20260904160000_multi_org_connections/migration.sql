-- ProviderCredential: one row per provider → many rows per provider, one active.
ALTER TABLE "ProviderCredential" ADD COLUMN "id" TEXT;
ALTER TABLE "ProviderCredential" ADD COLUMN "label" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ProviderCredential" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ProviderCredential" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Every existing row is that provider's only connection, so it is its active one.
UPDATE "ProviderCredential" SET "id" = "provider", "isActive" = true;

ALTER TABLE "ProviderCredential" DROP CONSTRAINT "ProviderCredential_pkey";
ALTER TABLE "ProviderCredential" ALTER COLUMN "id" SET NOT NULL;
ALTER TABLE "ProviderCredential" ADD CONSTRAINT "ProviderCredential_pkey" PRIMARY KEY ("id");
CREATE UNIQUE INDEX "ProviderCredential_provider_org_key" ON "ProviderCredential"("provider", "org");
CREATE INDEX "ProviderCredential_provider_idx" ON "ProviderCredential"("provider");

-- Runs and refusals are attributed to the organization they targeted.
ALTER TABLE "Run" ADD COLUMN "org" TEXT NOT NULL DEFAULT '';
ALTER TABLE "BlockedAttempt" ADD COLUMN "org" TEXT NOT NULL DEFAULT '';

-- Backfill: until now a provider had exactly one organization, so that is the
-- one every past run and refusal targeted.
UPDATE "Run" r SET "org" = c."org" FROM "ProviderCredential" c WHERE c."provider" = r."provider";
UPDATE "BlockedAttempt" b SET "org" = c."org" FROM "ProviderCredential" c WHERE c."provider" = b."provider";
