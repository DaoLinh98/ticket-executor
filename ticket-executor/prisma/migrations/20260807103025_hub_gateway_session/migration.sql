/*
  Warnings:

  - You are about to drop the `HubConnection` table. If the table is not empty, all the data it contains will be lost.

*/
-- AlterTable
ALTER TABLE "Setting" ADD COLUMN     "hubSid" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "hubToken" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "hubTokenExpiresAt" TIMESTAMP(3);

-- DropTable
DROP TABLE "HubConnection";
