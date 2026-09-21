-- Read state for the notification bell, moved off localStorage so it is the
-- same answer on every browser and device. No backfill: the rows it replaces
-- were per-browser and unreachable from here, so the first load after this
-- migration shows the current notification set as unread once.
CREATE TABLE "NotificationRead" (
    "key" TEXT NOT NULL,
    "seen" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationRead_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "NotificationRead_readAt_idx" ON "NotificationRead"("readAt");
