-- AlterTable
ALTER TABLE "SprintPlan" ADD COLUMN     "engine" TEXT NOT NULL DEFAULT 'classic';

-- AlterTable
ALTER TABLE "PlannedTicket" ADD COLUMN     "runEngine" TEXT NOT NULL DEFAULT 'classic',
ADD COLUMN     "reviewEngine" TEXT NOT NULL DEFAULT 'classic';
