-- AlterTable
ALTER TABLE "Execution" ADD COLUMN     "phase" TEXT NOT NULL DEFAULT 'implement',
ADD COLUMN     "planMarkdown" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "planStatus" TEXT NOT NULL DEFAULT 'none',
ADD COLUMN     "sessionId" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "worktreePath" TEXT NOT NULL DEFAULT '';
