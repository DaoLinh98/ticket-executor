-- AlterTable
ALTER TABLE "PlannedTicket" ADD COLUMN     "companionPrUrls" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "Run" ADD COLUMN     "companionPrUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "companions" JSONB NOT NULL DEFAULT '[]';

