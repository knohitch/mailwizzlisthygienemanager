-- CreateEnum
CREATE TYPE "SubscriberStatus" AS ENUM ('CONFIRMED', 'UNCONFIRMED', 'UNSUBSCRIBED', 'BLACKLISTED', 'MOVED', 'UNAPPROVED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "HygieneStatus" AS ENUM ('ENGAGED_STRONG', 'ENGAGED_OPEN_ONLY', 'INACTIVE_CANDIDATE', 'INSUFFICIENT_HISTORY', 'UNKNOWN', 'HARD_BOUNCED', 'COMPLAINED', 'UNSUBSCRIBED', 'UNCONFIRMED', 'BLACKLISTED', 'EXCLUDED');

-- CreateEnum
CREATE TYPE "HistoryCoverage" AS ENUM ('VERIFIED_FULL', 'PARTIAL_EXPORTS_OR_WEBHOOKS', 'BOUNCE_ONLY', 'NONE');

-- CreateEnum
CREATE TYPE "EngagementEventType" AS ENUM ('DELIVERED', 'OPEN', 'CLICK', 'REPLY', 'CONVERSION', 'HARD_BOUNCE', 'SOFT_BOUNCE', 'INTERNAL_BOUNCE', 'COMPLAINT', 'UNSUBSCRIBE');

-- CreateEnum
CREATE TYPE "EventSource" AS ENUM ('API_BOUNCE_LOG', 'NATIVE_SEGMENT', 'VERIFIED_EXPORT', 'READONLY_REPORTING_DB', 'WEBHOOK_LIVE', 'SYNTHETIC_DEMO');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('FULL_SYNC', 'LIST_SYNC', 'ANALYZE_HYGIENE', 'RETENTION_CLEANUP');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CapabilityStatus" AS ENUM ('VERIFIED', 'UNAVAILABLE', 'NOT_YET_TESTED');

-- CreateEnum
CREATE TYPE "ReconciliationStatus" AS ENUM ('MATCHED', 'DISCREPANCY', 'UNVERIFIED');

-- CreateTable
CREATE TABLE "AdminSession" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "csrfSecret" TEXT NOT NULL,
    "adminEmail" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppConfig" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "mailwizzApiUrl" TEXT,
    "mailwizzApiKeyEnc" TEXT,
    "mailwizzApiKeyLast4" TEXT,
    "reportingDbUrlEnc" TEXT,
    "reportingDbPrefix" TEXT NOT NULL DEFAULT 'mw_',
    "webhookSecretEnc" TEXT,
    "lookbackDays" INTEGER NOT NULL DEFAULT 90,
    "minDeliveredCampaigns" INTEGER NOT NULL DEFAULT 5,
    "countOpensAsEngaged" BOOLEAN NOT NULL DEFAULT true,
    "countClicksAsEngaged" BOOLEAN NOT NULL DEFAULT true,
    "countRepliesAsEngaged" BOOLEAN NOT NULL DEFAULT true,
    "countConversionsAsEngaged" BOOLEAN NOT NULL DEFAULT true,
    "excludedDomainsJson" JSONB NOT NULL DEFAULT '[]',
    "excludedSourcesJson" JSONB NOT NULL DEFAULT '[]',
    "excludeRecentSubscribersDays" INTEGER NOT NULL DEFAULT 14,
    "maxApiRequestsPerSecond" INTEGER NOT NULL DEFAULT 5,
    "batchSize" INTEGER NOT NULL DEFAULT 50,
    "syncScheduleCron" TEXT NOT NULL DEFAULT '0 2 * * *',
    "syncScheduleEnabled" BOOLEAN NOT NULL DEFAULT false,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "reportingPeriodDays" INTEGER NOT NULL DEFAULT 90,
    "dataRetentionDays" INTEGER NOT NULL DEFAULT 365,
    "isDemoMode" BOOLEAN NOT NULL DEFAULT false,
    "lastValidatedAt" TIMESTAMP(3),
    "lastValidationStatus" TEXT,
    "lastValidationMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailingList" (
    "id" TEXT NOT NULL,
    "listUid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT,
    "description" TEXT,
    "fromName" TEXT,
    "fromEmail" TEXT,
    "replyTo" TEXT,
    "apiReportedCount" INTEGER,
    "syncedSubscriberCount" INTEGER NOT NULL DEFAULT 0,
    "confirmedCount" INTEGER NOT NULL DEFAULT 0,
    "unconfirmedCount" INTEGER NOT NULL DEFAULT 0,
    "unsubscribedCount" INTEGER NOT NULL DEFAULT 0,
    "blacklistedCount" INTEGER NOT NULL DEFAULT 0,
    "hardBouncedCount" INTEGER NOT NULL DEFAULT 0,
    "complaintCount" INTEGER NOT NULL DEFAULT 0,
    "reconciliationStatus" "ReconciliationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "reconciliationNote" TEXT,
    "isDemoData" BOOLEAN NOT NULL DEFAULT false,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailingList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListSegment" (
    "id" TEXT NOT NULL,
    "mailingListId" TEXT NOT NULL,
    "segmentUid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "operatorMatch" TEXT,
    "apiSubscribersCount" INTEGER,
    "conditionsJson" JSONB NOT NULL DEFAULT '[]',
    "campaignConditionsJson" JSONB NOT NULL DEFAULT '[]',
    "isDemoData" BOOLEAN NOT NULL DEFAULT false,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ListSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SegmentMembership" (
    "id" TEXT NOT NULL,
    "segmentId" TEXT NOT NULL,
    "subscriberId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SegmentMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscriber" (
    "id" TEXT NOT NULL,
    "mailingListId" TEXT NOT NULL,
    "subscriberUid" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailHash" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "status" "SubscriberStatus" NOT NULL DEFAULT 'UNKNOWN',
    "rawStatus" TEXT NOT NULL,
    "source" TEXT,
    "customFieldsJson" JSONB,
    "dateAddedMailwizz" TIMESTAMP(3),
    "isExcluded" BOOLEAN NOT NULL DEFAULT false,
    "exclusionReason" TEXT,
    "hygieneStatus" "HygieneStatus" NOT NULL DEFAULT 'UNKNOWN',
    "hygieneReason" TEXT,
    "historyCoverage" "HistoryCoverage" NOT NULL DEFAULT 'NONE',
    "deliveredCampaignsCount" INTEGER NOT NULL DEFAULT 0,
    "opensCount" INTEGER NOT NULL DEFAULT 0,
    "clicksCount" INTEGER NOT NULL DEFAULT 0,
    "repliesCount" INTEGER NOT NULL DEFAULT 0,
    "conversionsCount" INTEGER NOT NULL DEFAULT 0,
    "hardBouncesCount" INTEGER NOT NULL DEFAULT 0,
    "softBouncesCount" INTEGER NOT NULL DEFAULT 0,
    "complaintsCount" INTEGER NOT NULL DEFAULT 0,
    "lastDeliveredAt" TIMESTAMP(3),
    "lastOpenAt" TIMESTAMP(3),
    "lastClickAt" TIMESTAMP(3),
    "lastStrongEngagementAt" TIMESTAMP(3),
    "lastBounceAt" TIMESTAMP(3),
    "isDemoData" BOOLEAN NOT NULL DEFAULT false,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscriber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "campaignUid" TEXT NOT NULL,
    "campaignIdMailwizz" TEXT,
    "mailingListId" TEXT,
    "listUid" TEXT,
    "segmentUid" TEXT,
    "name" TEXT NOT NULL,
    "subject" TEXT,
    "type" TEXT,
    "status" TEXT NOT NULL,
    "sendAt" TIMESTAMP(3),
    "dateAddedMailwizz" TIMESTAMP(3),
    "subscribersCount" INTEGER NOT NULL DEFAULT 0,
    "processedCount" INTEGER NOT NULL DEFAULT 0,
    "deliverySuccessCount" INTEGER NOT NULL DEFAULT 0,
    "deliverySuccessRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "deliveryErrorCount" INTEGER NOT NULL DEFAULT 0,
    "deliveryErrorRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "opensCount" INTEGER NOT NULL DEFAULT 0,
    "opensRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "uniqueOpensCount" INTEGER NOT NULL DEFAULT 0,
    "uniqueOpensRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "clicksCount" INTEGER NOT NULL DEFAULT 0,
    "clicksRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "uniqueClicksCount" INTEGER NOT NULL DEFAULT 0,
    "uniqueClicksRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unsubscribesCount" INTEGER NOT NULL DEFAULT 0,
    "unsubscribesRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "complaintsCount" INTEGER NOT NULL DEFAULT 0,
    "complaintsRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "bouncesCount" INTEGER NOT NULL DEFAULT 0,
    "bouncesRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "hardBouncesCount" INTEGER NOT NULL DEFAULT 0,
    "hardBouncesRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "softBouncesCount" INTEGER NOT NULL DEFAULT 0,
    "softBouncesRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "internalBouncesCount" INTEGER NOT NULL DEFAULT 0,
    "internalBouncesRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "bounceRecordsSyncedCount" INTEGER NOT NULL DEFAULT 0,
    "reconciliationStatus" "ReconciliationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "reconciliationNote" TEXT,
    "isDemoData" BOOLEAN NOT NULL DEFAULT false,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EngagementEvent" (
    "id" TEXT NOT NULL,
    "subscriberId" TEXT NOT NULL,
    "campaignId" TEXT,
    "mailingListId" TEXT NOT NULL,
    "eventType" "EngagementEventType" NOT NULL,
    "source" "EventSource" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "isHistorical" BOOLEAN NOT NULL DEFAULT true,
    "isDemoData" BOOLEAN NOT NULL DEFAULT false,
    "metadataJson" JSONB,
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EngagementEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncJob" (
    "id" TEXT NOT NULL,
    "type" "JobType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "payloadJson" JSONB NOT NULL DEFAULT '{}',
    "resultJson" JSONB,
    "progressCurrent" INTEGER NOT NULL DEFAULT 0,
    "progressTotal" INTEGER NOT NULL DEFAULT 0,
    "progressMessage" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorEmail" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT,
    "outcome" TEXT NOT NULL,
    "ipAddress" TEXT,
    "detailsJson" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiCapabilityCheck" (
    "id" TEXT NOT NULL,
    "capabilityKey" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "endpointOrFeature" TEXT NOT NULL,
    "status" "CapabilityStatus" NOT NULL,
    "notes" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiCapabilityCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdminSession_tokenHash_key" ON "AdminSession"("tokenHash");

-- CreateIndex
CREATE INDEX "AdminSession_expiresAt_idx" ON "AdminSession"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "MailingList_listUid_key" ON "MailingList"("listUid");

-- CreateIndex
CREATE UNIQUE INDEX "ListSegment_mailingListId_segmentUid_key" ON "ListSegment"("mailingListId", "segmentUid");

-- CreateIndex
CREATE UNIQUE INDEX "SegmentMembership_segmentId_subscriberId_key" ON "SegmentMembership"("segmentId", "subscriberId");

-- CreateIndex
CREATE INDEX "Subscriber_mailingListId_hygieneStatus_idx" ON "Subscriber"("mailingListId", "hygieneStatus");

-- CreateIndex
CREATE INDEX "Subscriber_mailingListId_status_idx" ON "Subscriber"("mailingListId", "status");

-- CreateIndex
CREATE INDEX "Subscriber_email_idx" ON "Subscriber"("email");

-- CreateIndex
CREATE INDEX "Subscriber_emailHash_idx" ON "Subscriber"("emailHash");

-- CreateIndex
CREATE UNIQUE INDEX "Subscriber_mailingListId_subscriberUid_key" ON "Subscriber"("mailingListId", "subscriberUid");

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_campaignUid_key" ON "Campaign"("campaignUid");

-- CreateIndex
CREATE INDEX "Campaign_mailingListId_sendAt_idx" ON "Campaign"("mailingListId", "sendAt");

-- CreateIndex
CREATE INDEX "Campaign_status_idx" ON "Campaign"("status");

-- CreateIndex
CREATE UNIQUE INDEX "EngagementEvent_dedupeKey_key" ON "EngagementEvent"("dedupeKey");

-- CreateIndex
CREATE INDEX "EngagementEvent_subscriberId_eventType_occurredAt_idx" ON "EngagementEvent"("subscriberId", "eventType", "occurredAt");

-- CreateIndex
CREATE INDEX "EngagementEvent_campaignId_eventType_idx" ON "EngagementEvent"("campaignId", "eventType");

-- CreateIndex
CREATE INDEX "EngagementEvent_mailingListId_occurredAt_idx" ON "EngagementEvent"("mailingListId", "occurredAt");

-- CreateIndex
CREATE INDEX "EngagementEvent_source_idx" ON "EngagementEvent"("source");

-- CreateIndex
CREATE INDEX "SyncJob_status_runAt_idx" ON "SyncJob"("status", "runAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE UNIQUE INDEX "ApiCapabilityCheck_capabilityKey_key" ON "ApiCapabilityCheck"("capabilityKey");

-- AddForeignKey
ALTER TABLE "ListSegment" ADD CONSTRAINT "ListSegment_mailingListId_fkey" FOREIGN KEY ("mailingListId") REFERENCES "MailingList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SegmentMembership" ADD CONSTRAINT "SegmentMembership_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "ListSegment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SegmentMembership" ADD CONSTRAINT "SegmentMembership_subscriberId_fkey" FOREIGN KEY ("subscriberId") REFERENCES "Subscriber"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscriber" ADD CONSTRAINT "Subscriber_mailingListId_fkey" FOREIGN KEY ("mailingListId") REFERENCES "MailingList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_mailingListId_fkey" FOREIGN KEY ("mailingListId") REFERENCES "MailingList"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngagementEvent" ADD CONSTRAINT "EngagementEvent_subscriberId_fkey" FOREIGN KEY ("subscriberId") REFERENCES "Subscriber"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngagementEvent" ADD CONSTRAINT "EngagementEvent_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngagementEvent" ADD CONSTRAINT "EngagementEvent_mailingListId_fkey" FOREIGN KEY ("mailingListId") REFERENCES "MailingList"("id") ON DELETE CASCADE ON UPDATE CASCADE;
