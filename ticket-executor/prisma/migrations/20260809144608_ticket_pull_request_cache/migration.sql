-- CreateTable
CREATE TABLE "TicketPullRequest" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "prUrl" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TicketPullRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TicketPullRequest_provider_ticketId_key" ON "TicketPullRequest"("provider", "ticketId");
