-- AlterTable
ALTER TABLE "Execution" ADD COLUMN     "rootRepo" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Setting" ADD COLUMN     "multiTicketMode" BOOLEAN NOT NULL DEFAULT true;
