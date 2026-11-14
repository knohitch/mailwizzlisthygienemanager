-- CreateEnum
CREATE TYPE "EngagementClass" AS ENUM ('ACTIVE', 'COOLING', 'INACTIVE', 'LONG_TERM_INACTIVE', 'NEVER_ENGAGED', 'INSUFFICIENT_DATA', 'EXCLUDED');

-- CreateEnum
CREATE TYPE "EngagementConfidence" AS ENUM ('HIGH', 'MEDIUM', 'LOW', 'NONE');

-- CreateEnum
CREATE TYPE "CleanupActionType" AS ENUM ('SUPPRESS', 'UNSUBSCRIBE', 'CREATE_LIST', 'CREATE_SEGMENT', 'COPY_SUBSCRIBERS', 'MOVE_SUBSCRIBERS', 'ARCHIVE', 'RESTORE_SUPPRESSION');

-- CreateEnum
CREATE TYPE "CleanupOperationStatus" AS ENUM ('DRY_RUN_READY', 'CONFIRMED', 'RUNNING', 'PAUSED', 'COMPLETED', 'AUTO_STOPPED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CleanupRecordOutcome" AS ENUM ('PENDING', 'SKIPPED', 'SUCCEEDED', 'FAILED', 'RECONCILED');

-- CreateEnum
CREATE TYPE "ReengagementStatus" AS ENUM ('DRAFT', 'SEGMENT_CREATED', 'AWAITING_RESPONSE', 'EVALUATED', 'COMPLETED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "JobStatus" ADD VALUE 'PAUSED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "JobType" ADD VALUE 'HYGIENE_EXECUTION';
ALTER TYPE "JobType" ADD VALUE 'SUPPRESSION_RESTORE';
ALTER TYPE "JobType" ADD VALUE 'REENGAGEMENT_EVALUATION';

-- AlterTable
ALTER TABLE "AppConfig" ADD COLUMN     "coolingDays" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "customRangeEnd" TIMESTAMP(3),
ADD COLUMN     "customRangeStart" TIMESTAMP(3),
ADD COLUMN     "inactiveDays" INTEGER NOT NULL DEFAULT 90,
ADD COLUMN     "largeChangeThreshold" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN     "longTermInactiveDays" INTEGER NOT NULL DEFAULT 180,
ADD COLUMN     "reengagementWindowDays" INTEGER NOT NULL DEFAULT 14;

-- AlterTable
ALTER TABLE "MailingList" ADD COLUMN     "optIn" TEXT,
ADD COLUMN     "optOut" TEXT;

-- AlterTable
ALTER TABLE "Subscriber" ADD COLUMN     "archiveReason" TEXT,
ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "descriptiveTagsJson" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "engagementConfidence" "EngagementConfidence" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "engagementReason" TEXT,
ADD COLUMN     "engagementStatus" "EngagementClass" NOT NULL DEFAULT 'INSUFFICIENT_DATA',
ADD COLUMN     "hasPaidRelationship" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isArchived" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isSuppressed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isVip" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastConversionAt" TIMESTAMP(3),
ADD COLUMN     "lastPurchaseAt" TIMESTAMP(3),
ADD COLUMN     "lastReplyAt" TIMESTAMP(3),
ADD COLUMN     "protectionNote" TEXT,
ADD COLUMN     "suppressedAt" TIMESTAMP(3),
ADD COLUMN     "suppressionReason" TEXT;

-- AlterTable
ALTER TABLE "SyncJob" ADD COLUMN     "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pauseRequested" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "CleanupOperation" (
    "id" TEXT NOT NULL,
    "operationKey" TEXT NOT NULL,
    "actionType" "CleanupActionType" NOT NULL,
    "mailingListId" TEXT,
    "targetListUid" TEXT,
    "targetListName" TEXT,
    "targetSegmentUid" TEXT,
    "targetSegmentName" TEXT,
    "dryRunOnly" BOOLEAN NOT NULL DEFAULT true,
    "filterSpecJson" JSONB NOT NULL DEFAULT '{}',
    "ruleConfigSnapshotJson" JSONB NOT NULL DEFAULT '{}',
    "matchedCount" INTEGER NOT NULL DEFAULT 0,
    "eligibleCount" INTEGER NOT NULL DEFAULT 0,
    "excludedCount" INTEGER NOT NULL DEFAULT 0,
    "dryRunReportJson" JSONB NOT NULL DEFAULT '{}',
    "snapshotEnc" TEXT,
    "snapshotSha256" TEXT,
    "confirmedByEmail" TEXT,
    "confirmedListName" TEXT,
    "confirmedCount" INTEGER,
    "largeBatchApprovedBy" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "status" "CleanupOperationStatus" NOT NULL DEFAULT 'DRY_RUN_READY',
    "syncJobId" TEXT,
    "batchSize" INTEGER NOT NULL DEFAULT 25,
    "checkpointIndex" INTEGER NOT NULL DEFAULT 0,
    "succeededCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "reconciledCount" INTEGER NOT NULL DEFAULT 0,
    "autoStopReason" TEXT,
    "reconciliationSummaryJson" JSONB,
    "beforeSnapshotJson" JSONB,
    "afterSnapshotJson" JSONB,
    "createdByEmail" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "CleanupOperation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CleanupOperationRecord" (
    "id" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "subscriberId" TEXT,
    "subscriberUid" TEXT NOT NULL,
    "mailingListUid" TEXT NOT NULL,
    "emailHash" TEXT NOT NULL,
    "maskedEmail" TEXT NOT NULL,
    "previousStatus" "SubscriberStatus" NOT NULL,
    "previousSuppressed" BOOLEAN NOT NULL DEFAULT false,
    "previousEngagement" "EngagementClass" NOT NULL,
    "intendedAction" "CleanupActionType" NOT NULL,
    "outcome" "CleanupRecordOutcome" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "remoteStatusBefore" TEXT,
    "remoteStatusAfter" TEXT,
    "reason" TEXT,
    "errorMessage" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CleanupOperationRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReengagementPlan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mailingListId" TEXT NOT NULL,
    "filterSpecJson" JSONB NOT NULL DEFAULT '{}',
    "eligibleCount" INTEGER NOT NULL DEFAULT 0,
    "excludedCount" INTEGER NOT NULL DEFAULT 0,
    "segmentUid" TEXT,
    "suggestedSubject" TEXT NOT NULL,
    "suggestedPreviewText" TEXT,
    "suggestedBodyMarkdown" TEXT NOT NULL,
    "mailwizzCampaignUid" TEXT,
    "manualCampaignApproved" BOOLEAN NOT NULL DEFAULT false,
    "approvedByEmail" TEXT,
    "approvedAt" TIMESTAMP(3),
    "responseWindowDays" INTEGER NOT NULL DEFAULT 14,
    "windowStartedAt" TIMESTAMP(3),
    "windowEndsAt" TIMESTAMP(3),
    "status" "ReengagementStatus" NOT NULL DEFAULT 'DRAFT',
    "recoveredCount" INTEGER NOT NULL DEFAULT 0,
    "persistentlyInactiveCount" INTEGER NOT NULL DEFAULT 0,
    "suppressedOperationId" TEXT,
    "evaluationSummaryJson" JSONB,
    "createdByEmail" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReengagementPlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CleanupOperation_operationKey_key" ON "CleanupOperation"("operationKey");

-- CreateIndex
CREATE INDEX "CleanupOperation_status_createdAt_idx" ON "CleanupOperation"("status", "createdAt");

-- CreateIndex
CREATE INDEX "CleanupOperation_mailingListId_idx" ON "CleanupOperation"("mailingListId");

-- CreateIndex
CREATE UNIQUE INDEX "CleanupOperationRecord_idempotencyKey_key" ON "CleanupOperationRecord"("idempotencyKey");

-- CreateIndex
CREATE INDEX "CleanupOperationRecord_operationId_outcome_idx" ON "CleanupOperationRecord"("operationId", "outcome");

-- CreateIndex
CREATE INDEX "CleanupOperationRecord_subscriberId_idx" ON "CleanupOperationRecord"("subscriberId");

-- CreateIndex
CREATE INDEX "ReengagementPlan_mailingListId_status_idx" ON "ReengagementPlan"("mailingListId", "status");

-- CreateIndex
CREATE INDEX "Subscriber_mailingListId_engagementStatus_idx" ON "Subscriber"("mailingListId", "engagementStatus");

-- CreateIndex
CREATE INDEX "Subscriber_mailingListId_isSuppressed_idx" ON "Subscriber"("mailingListId", "isSuppressed");

-- AddForeignKey
ALTER TABLE "CleanupOperation" ADD CONSTRAINT "CleanupOperation_mailingListId_fkey" FOREIGN KEY ("mailingListId") REFERENCES "MailingList"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CleanupOperationRecord" ADD CONSTRAINT "CleanupOperationRecord_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "CleanupOperation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CleanupOperationRecord" ADD CONSTRAINT "CleanupOperationRecord_subscriberId_fkey" FOREIGN KEY ("subscriberId") REFERENCES "Subscriber"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReengagementPlan" ADD CONSTRAINT "ReengagementPlan_mailingListId_fkey" FOREIGN KEY ("mailingListId") REFERENCES "MailingList"("id") ON DELETE CASCADE ON UPDATE CASCADE;
