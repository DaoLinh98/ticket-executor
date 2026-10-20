-- Re-queue ticket #25691 in the sprint plan (PR 11239 abandoned, branch deleted).
BEGIN;

UPDATE "PlannedTicket"
SET "implementState" = 'pending',
    "runId" = '',
    "prUrl" = ''
WHERE "id" = 'cmv7iwxg80002ovl0fzt6nar7'
  AND "ticketId" = '25691';

-- Optional: drop the old run entirely (Step, Artifact, Transition rows cascade).
-- Skip this to keep it on the Dashboard as history.
DELETE FROM "Run" WHERE "id" = 'cmv7k1po90002ovz89ai56332';

COMMIT;
