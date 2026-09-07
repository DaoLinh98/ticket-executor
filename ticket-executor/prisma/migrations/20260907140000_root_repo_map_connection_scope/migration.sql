-- Scope the project -> root repo memory to the connection it was learned from.
--
-- Project names are unique inside one organization, not across them. With the
-- old bare `project` key, two connections that both have a project called "Web"
-- overwrote each other, and the scheduler would then hand `startRun()` the wrong
-- clone with no way to notice.

ALTER TABLE "RootRepoProjectMap" ADD COLUMN "provider" TEXT NOT NULL DEFAULT '';
ALTER TABLE "RootRepoProjectMap" ADD COLUMN "org" TEXT NOT NULL DEFAULT '';

-- Existing rows were learned before connections were distinguishable, so the
-- only honest owner is whichever connection is active now. Rows left at '' when
-- there is no active connection simply stop matching, and the next run (or the
-- Root repo field on My Sprint) records them again under a real key.
UPDATE "RootRepoProjectMap" AS m
SET "provider" = c."provider", "org" = c."org"
FROM (
  SELECT "provider", "org"
  FROM "ProviderCredential"
  WHERE "isActive" = true
  ORDER BY "updatedAt" DESC
  LIMIT 1
) AS c
WHERE m."provider" = '';

DROP INDEX "RootRepoProjectMap_project_key";
CREATE UNIQUE INDEX "RootRepoProjectMap_provider_org_project_key"
  ON "RootRepoProjectMap"("provider", "org", "project");
