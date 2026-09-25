CREATE TABLE "NotificationHistory" (
    "key" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "tab" TEXT NOT NULL,
    "href" TEXT NOT NULL DEFAULT '',
    "fingerprint" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationHistory_pkey" PRIMARY KEY ("scope", "key")
);

CREATE INDEX "NotificationHistory_scope_at_idx" ON "NotificationHistory"("scope", "at");
