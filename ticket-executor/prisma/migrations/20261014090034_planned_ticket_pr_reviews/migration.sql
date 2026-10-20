-- CreateTable
CREATE TABLE "PlannedTicketPr" (
    "id" TEXT NOT NULL,
    "plannedTicketId" TEXT NOT NULL,
    "prUrl" TEXT NOT NULL,
    "openComments" INTEGER NOT NULL DEFAULT 0,
    "lastCommentAt" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlannedTicketPr_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlannedTicketPr_plannedTicketId_prUrl_key" ON "PlannedTicketPr"("plannedTicketId", "prUrl");

-- AddForeignKey
ALTER TABLE "PlannedTicketPr" ADD CONSTRAINT "PlannedTicketPr_plannedTicketId_fkey" FOREIGN KEY ("plannedTicketId") REFERENCES "PlannedTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
