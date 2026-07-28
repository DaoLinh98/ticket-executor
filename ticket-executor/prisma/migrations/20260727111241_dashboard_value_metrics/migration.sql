-- AlterTable
ALTER TABLE "Execution" ADD COLUMN     "endReason" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "filesTouched" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "humanWaitMs" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "linesAdded" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "linesDeleted" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "parkedAt" TIMESTAMP(3),
ADD COLUMN     "planRevisions" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "resumedAfterRestart" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "BlockedAttempt" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT '',
    "projectName" TEXT NOT NULL DEFAULT '',
    "reason" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BlockedAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BlockedAttempt_createdAt_idx" ON "BlockedAttempt"("createdAt");
