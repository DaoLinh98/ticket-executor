-- CreateTable
CREATE TABLE "KnowledgeNote" (
    "id" TEXT NOT NULL,
    "rootRepo" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "hits" INTEGER NOT NULL DEFAULT 1,
    "firstRunId" TEXT NOT NULL,
    "lastRunId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KnowledgeNote_rootRepo_active_idx" ON "KnowledgeNote"("rootRepo", "active");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeNote_rootRepo_fingerprint_key" ON "KnowledgeNote"("rootRepo", "fingerprint");
