-- AlterTable
ALTER TABLE "Run" ADD COLUMN     "claudeGrant" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "claudeGrantExpiresAt" TIMESTAMP(3),
ADD COLUMN     "claudeSource" TEXT NOT NULL DEFAULT '';
