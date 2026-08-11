-- AlterTable
ALTER TABLE "Setting" ADD COLUMN     "hubConnectionId" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "hubEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "HubConnection" (
    "id" TEXT NOT NULL,
    "hubId" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "orgUrl" TEXT NOT NULL DEFAULT '',
    "project" TEXT NOT NULL DEFAULT '',
    "capabilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "pat" TEXT NOT NULL DEFAULT '',
    "hubUpdatedAt" TIMESTAMP(3) NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HubConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HubConnection_hubId_key" ON "HubConnection"("hubId");

-- CreateIndex
CREATE INDEX "HubConnection_provider_idx" ON "HubConnection"("provider");
