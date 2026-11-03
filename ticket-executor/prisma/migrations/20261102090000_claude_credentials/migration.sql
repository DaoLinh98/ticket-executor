-- Claude accounts the CLI may run as instead of the machine's own login (Settings → Claude).
CREATE TABLE "ClaudeCredential" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "token" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3),
    "limitedUntil" TIMESTAMP(3),
    "invalidAt" TIMESTAMP(3),
    "lastError" TEXT NOT NULL DEFAULT '',
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClaudeCredential_pkey" PRIMARY KEY ("id")
);
