-- CreateTable
CREATE TABLE "Setting" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "provider" TEXT NOT NULL DEFAULT 'azure-devops',
    "animatedBackground" BOOLEAN NOT NULL DEFAULT true,
    "scope" TEXT NOT NULL DEFAULT 'team',
    "personalAccount" TEXT NOT NULL DEFAULT '',
    "concurrentRuns" INTEGER NOT NULL DEFAULT 2,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderCredential" (
    "provider" TEXT NOT NULL,
    "org" TEXT NOT NULL DEFAULT '',
    "pat" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderCredential_pkey" PRIMARY KEY ("provider")
);

-- CreateTable
CREATE TABLE "Execution" (
    "id" TEXT NOT NULL,
    "adoTicketId" TEXT NOT NULL,
    "projectName" TEXT NOT NULL,
    "skillName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "command" TEXT NOT NULL,
    "resultText" TEXT NOT NULL DEFAULT '',
    "errorMessage" TEXT NOT NULL DEFAULT '',
    "logLines" TEXT NOT NULL DEFAULT '[]',
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "prUrl" TEXT NOT NULL DEFAULT '',
    "branch" TEXT NOT NULL DEFAULT '',
    "model" TEXT NOT NULL DEFAULT '',
    "effort" TEXT NOT NULL DEFAULT '',
    "filesChanged" TEXT NOT NULL DEFAULT '[]',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Execution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedOption" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RootRepoProjectMap" (
    "id" TEXT NOT NULL,
    "project" TEXT NOT NULL,
    "rootRepo" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RootRepoProjectMap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Execution_adoTicketId_idx" ON "Execution"("adoTicketId");

-- CreateIndex
CREATE UNIQUE INDEX "SavedOption_kind_value_key" ON "SavedOption"("kind", "value");

-- CreateIndex
CREATE UNIQUE INDEX "RootRepoProjectMap_project_key" ON "RootRepoProjectMap"("project");
