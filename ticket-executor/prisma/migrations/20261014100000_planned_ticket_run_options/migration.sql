-- AlterTable
ALTER TABLE "PlannedTicket" ADD COLUMN     "effort" TEXT NOT NULL DEFAULT 'medium',
ADD COLUMN     "model" TEXT NOT NULL DEFAULT 'sonnet';
