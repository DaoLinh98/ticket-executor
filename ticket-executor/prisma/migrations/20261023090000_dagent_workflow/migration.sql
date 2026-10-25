-- CreateTable
CREATE TABLE "DagentRun" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "ticketUrl" TEXT NOT NULL DEFAULT '',
    "ticketTitle" TEXT NOT NULL DEFAULT '',
    "provider" TEXT NOT NULL DEFAULT '',
    "org" TEXT NOT NULL DEFAULT '',
    "project" TEXT NOT NULL DEFAULT '',
    "rootRepo" TEXT NOT NULL,
    "worktreePath" TEXT NOT NULL DEFAULT '',
    "graphId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'running',
    "waitReason" TEXT NOT NULL DEFAULT '',
    "currentNodeId" TEXT NOT NULL DEFAULT '',
    "errorMessage" TEXT NOT NULL DEFAULT '',
    "gates" JSONB NOT NULL DEFAULT '[]',
    "channels" JSONB NOT NULL DEFAULT '{}',
    "visits" JSONB NOT NULL DEFAULT '{}',
    "hops" INTEGER NOT NULL DEFAULT 0,
    "model" TEXT NOT NULL DEFAULT '',
    "effort" TEXT NOT NULL DEFAULT '',
    "baseSha" TEXT NOT NULL DEFAULT '',
    "companions" JSONB NOT NULL DEFAULT '[]',
    "branch" TEXT NOT NULL DEFAULT '',
    "prUrl" TEXT NOT NULL DEFAULT '',
    "retryOfId" TEXT NOT NULL DEFAULT '',
    "entryNode" TEXT NOT NULL DEFAULT '',
    "knowledgeAtStart" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "DagentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DagentStep" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "agent" TEXT NOT NULL DEFAULT '',
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'running',
    "input" JSONB,
    "output" JSONB,
    "errorMessage" TEXT NOT NULL DEFAULT '',
    "logLines" JSONB NOT NULL DEFAULT '[]',
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheReadTokens" INTEGER NOT NULL DEFAULT 0,
    "numTurns" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "DagentStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DagentTransition" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "fromNode" TEXT NOT NULL,
    "toNode" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DagentTransition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DagentArtifact" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DagentArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DagentRun_ticketId_idx" ON "DagentRun"("ticketId");

-- CreateIndex
CREATE INDEX "DagentRun_startedAt_idx" ON "DagentRun"("startedAt");

-- CreateIndex
CREATE INDEX "DagentStep_runId_idx" ON "DagentStep"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "DagentStep_runId_nodeId_attempt_key" ON "DagentStep"("runId", "nodeId", "attempt");

-- CreateIndex
CREATE INDEX "DagentTransition_runId_seq_idx" ON "DagentTransition"("runId", "seq");

-- CreateIndex
CREATE INDEX "DagentArtifact_runId_kind_idx" ON "DagentArtifact"("runId", "kind");

-- AddForeignKey
ALTER TABLE "DagentStep" ADD CONSTRAINT "DagentStep_runId_fkey" FOREIGN KEY ("runId") REFERENCES "DagentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DagentTransition" ADD CONSTRAINT "DagentTransition_runId_fkey" FOREIGN KEY ("runId") REFERENCES "DagentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DagentArtifact" ADD CONSTRAINT "DagentArtifact_runId_fkey" FOREIGN KEY ("runId") REFERENCES "DagentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

