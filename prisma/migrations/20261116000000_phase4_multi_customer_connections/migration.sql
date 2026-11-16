-- Phase 4: Multi-Customer API Connections & Strict Account Isolation Migration
-- Idempotent migration supporting empty databases AND unambiguous / ambiguous pre-Phase-4 databases.

-- 1. Create Phase 4 Enums
DO $$ BEGIN
  CREATE TYPE "ConnectionStatus" AS ENUM ('PENDING', 'CONNECTED', 'AUTH_FAILED', 'DISABLED', 'LEGACY_QUARANTINE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "CredentialStatus" AS ENUM ('ACTIVE', 'ROTATED', 'REVOKED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 2. Create Phase 4 Multi-Customer Tables
CREATE TABLE IF NOT EXISTS "MailWizzInstallation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "detectedVersion" TEXT,
    "approvedVersion" TEXT,
    "maxRequestsPerSecond" INTEGER NOT NULL DEFAULT 5,
    "maxConcurrentJobs" INTEGER NOT NULL DEFAULT 2,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailWizzInstallation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "MailWizzCustomerConnection" (
    "id" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerSlug" TEXT NOT NULL,
    "mailwizzCustomerUid" TEXT,
    "authMode" TEXT NOT NULL DEFAULT 'auto',
    "webhookSecretEnc" TEXT,
    "webhookSecretLast4" TEXT,
    "reportingDbUrlEnc" TEXT,
    "reportingDbPrefix" TEXT NOT NULL DEFAULT 'mw_',
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "isQuarantine" BOOLEAN NOT NULL DEFAULT false,
    "isDemoData" BOOLEAN NOT NULL DEFAULT false,
    "status" "ConnectionStatus" NOT NULL DEFAULT 'PENDING',
    "detectedVersion" TEXT,
    "approvedVersion" TEXT,
    "maxRequestsPerSecond" INTEGER NOT NULL DEFAULT 5,
    "syncScheduleCron" TEXT NOT NULL DEFAULT '0 2 * * *',
    "syncScheduleEnabled" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailWizzCustomerConnection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "MailWizzConnectionCredential" (
    "id" TEXT NOT NULL,
    "customerConnectionId" TEXT NOT NULL,
    "apiKeyEnc" TEXT NOT NULL,
    "apiKeyLast4" TEXT NOT NULL,
    "apiKeyFingerprint" TEXT NOT NULL,
    "status" "CredentialStatus" NOT NULL DEFAULT 'ACTIVE',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "rotatedFromId" TEXT,
    "revokedReason" TEXT,
    "createdByEmail" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rotatedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "MailWizzConnectionCredential_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "MailWizzConnectionHealth" (
    "id" TEXT NOT NULL,
    "customerConnectionId" TEXT NOT NULL,
    "lastCheckedAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "lastStatusCode" INTEGER,
    "lastLatencyMs" INTEGER,
    "lastEndpointTested" TEXT,
    "lastErrorSafe" TEXT,
    "detectedVersion" TEXT,
    "verifiedAuthMode" TEXT,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "totalRequestsCount" INTEGER NOT NULL DEFAULT 0,
    "totalErrorsCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailWizzConnectionHealth_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ConnectionSyncState" (
    "id" TEXT NOT NULL,
    "customerConnectionId" TEXT NOT NULL,
    "isPaused" BOOLEAN NOT NULL DEFAULT false,
    "pauseReason" TEXT,
    "pausedByEmail" TEXT,
    "pausedAt" TIMESTAMP(3),
    "lastFullSyncStartedAt" TIMESTAMP(3),
    "lastFullSyncCompletedAt" TIMESTAMP(3),
    "lastSyncJobId" TEXT,
    "lastSyncStatus" TEXT,
    "lastSyncErrorSafe" TEXT,
    "totalListsSynced" INTEGER NOT NULL DEFAULT 0,
    "totalSubscribersSynced" INTEGER NOT NULL DEFAULT 0,
    "totalCampaignsSynced" INTEGER NOT NULL DEFAULT 0,
    "activeWorkerCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConnectionSyncState_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ConnectionCapabilityReport" (
    "id" TEXT NOT NULL,
    "customerConnectionId" TEXT NOT NULL,
    "detectedVersion" TEXT,
    "adapterMode" TEXT NOT NULL,
    "overallStatus" TEXT NOT NULL,
    "readOnlySafe" BOOLEAN NOT NULL DEFAULT true,
    "autoCleanupAllowed" BOOLEAN NOT NULL DEFAULT false,
    "mutationSafetyAllowed" BOOLEAN NOT NULL DEFAULT false,
    "mutationLockReason" TEXT,
    "approvedVersion" TEXT,
    "approvedByEmail" TEXT,
    "approvedAt" TIMESTAMP(3),
    "warningsJson" JSONB NOT NULL DEFAULT '[]',
    "reportJson" JSONB NOT NULL DEFAULT '{}',
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConnectionCapabilityReport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MailWizzInstallation_baseUrl_key" ON "MailWizzInstallation"("baseUrl");
CREATE UNIQUE INDEX IF NOT EXISTS "MailWizzCustomerConnection_customerSlug_key" ON "MailWizzCustomerConnection"("customerSlug");
CREATE UNIQUE INDEX IF NOT EXISTS "MailWizzConnectionCredential_one_active_per_conn" ON "MailWizzConnectionCredential"("customerConnectionId") WHERE "isActive" = true;
CREATE UNIQUE INDEX IF NOT EXISTS "MailWizzConnectionHealth_customerConnectionId_key" ON "MailWizzConnectionHealth"("customerConnectionId");
CREATE UNIQUE INDEX IF NOT EXISTS "ConnectionSyncState_customerConnectionId_key" ON "ConnectionSyncState"("customerConnectionId");

-- 3. Add nullable customerConnectionId columns prior to backfill
ALTER TABLE "MailingList" ADD COLUMN IF NOT EXISTS "customerConnectionId" TEXT;
ALTER TABLE "ListSegment" ADD COLUMN IF NOT EXISTS "customerConnectionId" TEXT;
ALTER TABLE "Subscriber" ADD COLUMN IF NOT EXISTS "customerConnectionId" TEXT;
ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "customerConnectionId" TEXT;
ALTER TABLE "EngagementEvent" ADD COLUMN IF NOT EXISTS "customerConnectionId" TEXT;
ALTER TABLE "SyncJob" ADD COLUMN IF NOT EXISTS "customerConnectionId" TEXT;
ALTER TABLE "SyncJob" ADD COLUMN IF NOT EXISTS "credentialVersion" INTEGER;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "customerConnectionId" TEXT;
ALTER TABLE "ApiCapabilityCheck" ADD COLUMN IF NOT EXISTS "customerConnectionId" TEXT;
ALTER TABLE "CleanupOperation" ADD COLUMN IF NOT EXISTS "customerConnectionId" TEXT;
ALTER TABLE "CleanupOperationRecord" ADD COLUMN IF NOT EXISTS "customerConnectionId" TEXT;
ALTER TABLE "ReengagementPlan" ADD COLUMN IF NOT EXISTS "customerConnectionId" TEXT;

-- 4. Migrate existing single-tenant AppConfig + existing data safely (unambiguous vs quarantined)
DO $$
DECLARE
  cfg RECORD;
  v_has_app_url BOOLEAN := false;
  v_norm_url TEXT;
  v_host TEXT;
  v_existing_data_count INTEGER := 0;
  v_primary_conn_id TEXT := 'conn-primary-default';
  v_primary_inst_id TEXT := 'inst-primary-default';
  v_quarantine_conn_id TEXT := 'conn-legacy-quarantine';
  v_quarantine_inst_id TEXT := 'inst-legacy-quarantine';
  v_target_conn_id TEXT;
BEGIN
  SELECT * INTO cfg FROM "AppConfig" WHERE "id" = 'default' LIMIT 1;
  IF FOUND AND cfg."mailwizzApiUrl" IS NOT NULL AND btrim(cfg."mailwizzApiUrl") <> '' THEN
    v_has_app_url := true;
    v_norm_url := regexp_replace(btrim(cfg."mailwizzApiUrl"), '/+$', '');
    v_host := split_part(regexp_replace(v_norm_url, '^https?://', ''), '/', 1);
  END IF;

  SELECT
    (SELECT COUNT(*) FROM "MailingList") +
    (SELECT COUNT(*) FROM "Subscriber") +
    (SELECT COUNT(*) FROM "Campaign") +
    (SELECT COUNT(*) FROM "EngagementEvent") +
    (SELECT COUNT(*) FROM "ApiCapabilityCheck") +
    (SELECT COUNT(*) FROM "CleanupOperation") +
    (SELECT COUNT(*) FROM "ReengagementPlan")
  INTO v_existing_data_count;

  -- If AppConfig has an explicit MailWizz URL, create unambiguous primary installation + customer connection
  IF v_has_app_url THEN
    INSERT INTO "MailWizzInstallation" (
      "id", "name", "baseUrl", "hostname", "detectedVersion", "maxRequestsPerSecond", "isActive", "updatedAt"
    )
    VALUES (
      v_primary_inst_id,
      COALESCE(NULLIF(v_host, ''), 'Primary MailWizz Installation'),
      v_norm_url,
      COALESCE(NULLIF(v_host, ''), 'localhost'),
      cfg."mailwizzDetectedVersion",
      GREATEST(1, COALESCE(cfg."maxApiRequestsPerSecond", 5)),
      true,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT ("baseUrl") DO UPDATE SET
      "detectedVersion" = COALESCE("MailWizzInstallation"."detectedVersion", EXCLUDED."detectedVersion"),
      "updatedAt" = CURRENT_TIMESTAMP
    RETURNING "id" INTO v_primary_inst_id;

    INSERT INTO "MailWizzCustomerConnection" (
      "id", "installationId", "customerName", "customerSlug", "authMode",
      "webhookSecretEnc", "reportingDbUrlEnc", "reportingDbPrefix",
      "isEnabled", "isPrimary", "isQuarantine", "isDemoData", "status",
      "detectedVersion", "maxRequestsPerSecond", "syncScheduleCron", "syncScheduleEnabled",
      "notes", "updatedAt"
    )
    VALUES (
      v_primary_conn_id,
      v_primary_inst_id,
      'Primary MailWizz Account',
      'primary-account',
      COALESCE(cfg."mailwizzAuthMode", 'auto'),
      cfg."webhookSecretEnc",
      cfg."reportingDbUrlEnc",
      COALESCE(cfg."reportingDbPrefix", 'mw_'),
      true,
      true,
      false,
      COALESCE(cfg."isDemoMode", false),
      CASE
        WHEN cfg."mailwizzApiKeyEnc" IS NOT NULL AND cfg."lastValidationStatus" = 'OK' THEN 'CONNECTED'::"ConnectionStatus"
        WHEN cfg."mailwizzApiKeyEnc" IS NOT NULL AND cfg."lastValidationStatus" = 'ERROR' THEN 'AUTH_FAILED'::"ConnectionStatus"
        ELSE 'PENDING'::"ConnectionStatus"
      END,
      cfg."mailwizzDetectedVersion",
      GREATEST(1, COALESCE(cfg."maxApiRequestsPerSecond", 5)),
      COALESCE(cfg."syncScheduleCron", '0 2 * * *'),
      COALESCE(cfg."syncScheduleEnabled", false),
      'Migrated automatically from single-tenant AppConfig during Phase 4 upgrade.',
      CURRENT_TIMESTAMP
    )
    ON CONFLICT ("id") DO NOTHING;

    IF cfg."mailwizzApiKeyEnc" IS NOT NULL AND btrim(cfg."mailwizzApiKeyEnc") <> '' THEN
      INSERT INTO "MailWizzConnectionCredential" (
        "id", "customerConnectionId", "apiKeyEnc", "apiKeyLast4", "apiKeyFingerprint",
        "status", "isActive", "version", "createdByEmail"
      )
      VALUES (
        'cred-primary-v1',
        v_primary_conn_id,
        cfg."mailwizzApiKeyEnc",
        COALESCE(cfg."mailwizzApiKeyLast4", '****'),
        'migrated-md5-' || md5(cfg."mailwizzApiKeyEnc"),
        'ACTIVE'::"CredentialStatus",
        true,
        1,
        'migration@system.local'
      )
      ON CONFLICT DO NOTHING;
    END IF;

    INSERT INTO "MailWizzConnectionHealth" (
      "id", "customerConnectionId", "lastCheckedAt", "lastErrorSafe", "detectedVersion", "updatedAt"
    )
    VALUES (
      'health-primary-default',
      v_primary_conn_id,
      cfg."lastValidatedAt",
      CASE WHEN cfg."lastValidationStatus" = 'ERROR' THEN left(cfg."lastValidationMessage", 300) ELSE NULL END,
      cfg."mailwizzDetectedVersion",
      CURRENT_TIMESTAMP
    )
    ON CONFLICT ("customerConnectionId") DO NOTHING;

    INSERT INTO "ConnectionSyncState" (
      "id", "customerConnectionId", "isPaused", "updatedAt"
    )
    VALUES (
      'syncstate-primary-default',
      v_primary_conn_id,
      false,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT ("customerConnectionId") DO NOTHING;

    -- Assign existing unambiguous rows to primary connection
    UPDATE "MailingList" SET "customerConnectionId" = v_primary_conn_id WHERE "customerConnectionId" IS NULL;
    UPDATE "ListSegment" SET "customerConnectionId" = COALESCE((SELECT ml."customerConnectionId" FROM "MailingList" ml WHERE ml."id" = "ListSegment"."mailingListId"), v_primary_conn_id) WHERE "customerConnectionId" IS NULL;
    UPDATE "Subscriber" SET "customerConnectionId" = COALESCE((SELECT ml."customerConnectionId" FROM "MailingList" ml WHERE ml."id" = "Subscriber"."mailingListId"), v_primary_conn_id) WHERE "customerConnectionId" IS NULL;
    UPDATE "Campaign" SET "customerConnectionId" = COALESCE((SELECT ml."customerConnectionId" FROM "MailingList" ml WHERE ml."id" = "Campaign"."mailingListId"), v_primary_conn_id) WHERE "customerConnectionId" IS NULL;
    UPDATE "EngagementEvent" SET "customerConnectionId" = COALESCE((SELECT ml."customerConnectionId" FROM "MailingList" ml WHERE ml."id" = "EngagementEvent"."mailingListId"), v_primary_conn_id) WHERE "customerConnectionId" IS NULL;
    UPDATE "ApiCapabilityCheck" SET "customerConnectionId" = v_primary_conn_id WHERE "customerConnectionId" IS NULL;
    UPDATE "CleanupOperation" SET "customerConnectionId" = COALESCE((SELECT ml."customerConnectionId" FROM "MailingList" ml WHERE ml."id" = "CleanupOperation"."mailingListId"), v_primary_conn_id) WHERE "customerConnectionId" IS NULL;
    UPDATE "CleanupOperationRecord" SET "customerConnectionId" = COALESCE((SELECT co."customerConnectionId" FROM "CleanupOperation" co WHERE co."id" = "CleanupOperationRecord"."operationId"), v_primary_conn_id) WHERE "customerConnectionId" IS NULL;
    UPDATE "ReengagementPlan" SET "customerConnectionId" = COALESCE((SELECT ml."customerConnectionId" FROM "MailingList" ml WHERE ml."id" = "ReengagementPlan"."mailingListId"), v_primary_conn_id) WHERE "customerConnectionId" IS NULL;
    UPDATE "SyncJob" SET "customerConnectionId" = v_primary_conn_id WHERE "customerConnectionId" IS NULL AND "type" IN ('FULL_SYNC', 'LIST_SYNC', 'HYGIENE_EXECUTION', 'SUPPRESSION_RESTORE', 'REENGAGEMENT_EVALUATION');
  END IF;

  -- Quarantine any remaining orphaned / ambiguous records that lack a configured unambiguous customer connection
  SELECT
    (SELECT COUNT(*) FROM "MailingList" WHERE "customerConnectionId" IS NULL) +
    (SELECT COUNT(*) FROM "ListSegment" WHERE "customerConnectionId" IS NULL) +
    (SELECT COUNT(*) FROM "Subscriber" WHERE "customerConnectionId" IS NULL) +
    (SELECT COUNT(*) FROM "Campaign" WHERE "customerConnectionId" IS NULL) +
    (SELECT COUNT(*) FROM "EngagementEvent" WHERE "customerConnectionId" IS NULL) +
    (SELECT COUNT(*) FROM "ApiCapabilityCheck" WHERE "customerConnectionId" IS NULL) +
    (SELECT COUNT(*) FROM "CleanupOperation" WHERE "customerConnectionId" IS NULL) +
    (SELECT COUNT(*) FROM "CleanupOperationRecord" WHERE "customerConnectionId" IS NULL) +
    (SELECT COUNT(*) FROM "ReengagementPlan" WHERE "customerConnectionId" IS NULL)
  INTO v_existing_data_count;

  IF v_existing_data_count > 0 THEN
    INSERT INTO "MailWizzInstallation" (
      "id", "name", "baseUrl", "hostname", "maxRequestsPerSecond", "isActive", "updatedAt"
    )
    VALUES (
      v_quarantine_inst_id,
      'Unassigned Legacy Installation',
      'https://legacy-quarantine.invalid/api/index.php',
      'legacy-quarantine.invalid',
      1,
      false,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT ("baseUrl") DO NOTHING;

    INSERT INTO "MailWizzCustomerConnection" (
      "id", "installationId", "customerName", "customerSlug", "isEnabled",
      "isPrimary", "isQuarantine", "status", "notes", "updatedAt"
    )
    VALUES (
      v_quarantine_conn_id,
      v_quarantine_inst_id,
      'Unassigned Legacy Import (Review Required)',
      'unassigned-legacy-import',
      false,
      false,
      true,
      'LEGACY_QUARANTINE'::"ConnectionStatus",
      'Quarantined pre-Phase-4 records whose customer API key / URL could not be unambiguously verified during migration.',
      CURRENT_TIMESTAMP
    )
    ON CONFLICT ("id") DO NOTHING;

    INSERT INTO "ConnectionSyncState" (
      "id", "customerConnectionId", "isPaused", "pauseReason", "pausedByEmail", "pausedAt", "updatedAt"
    )
    VALUES (
      'syncstate-legacy-quarantine',
      v_quarantine_conn_id,
      true,
      'Quarantined legacy import pending explicit admin review.',
      'migration@system.local',
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT ("customerConnectionId") DO NOTHING;

    INSERT INTO "MailWizzConnectionHealth" (
      "id", "customerConnectionId", "lastErrorSafe", "updatedAt"
    )
    VALUES (
      'health-legacy-quarantine',
      v_quarantine_conn_id,
      'Quarantined legacy records: no verified API credential assigned.',
      CURRENT_TIMESTAMP
    )
    ON CONFLICT ("customerConnectionId") DO NOTHING;

    UPDATE "MailingList" SET "customerConnectionId" = v_quarantine_conn_id WHERE "customerConnectionId" IS NULL;
    UPDATE "ListSegment" SET "customerConnectionId" = v_quarantine_conn_id WHERE "customerConnectionId" IS NULL;
    UPDATE "Subscriber" SET "customerConnectionId" = v_quarantine_conn_id WHERE "customerConnectionId" IS NULL;
    UPDATE "Campaign" SET "customerConnectionId" = v_quarantine_conn_id WHERE "customerConnectionId" IS NULL;
    UPDATE "EngagementEvent" SET "customerConnectionId" = v_quarantine_conn_id WHERE "customerConnectionId" IS NULL;
    UPDATE "ApiCapabilityCheck" SET "customerConnectionId" = v_quarantine_conn_id WHERE "customerConnectionId" IS NULL;
    UPDATE "CleanupOperation" SET "customerConnectionId" = v_quarantine_conn_id WHERE "customerConnectionId" IS NULL;
    UPDATE "CleanupOperationRecord" SET "customerConnectionId" = v_quarantine_conn_id WHERE "customerConnectionId" IS NULL;
    UPDATE "ReengagementPlan" SET "customerConnectionId" = v_quarantine_conn_id WHERE "customerConnectionId" IS NULL;
  END IF;
END $$;

-- 5. Enforce NOT NULL on tenant-owned models
ALTER TABLE "MailingList" ALTER COLUMN "customerConnectionId" SET NOT NULL;
ALTER TABLE "ListSegment" ALTER COLUMN "customerConnectionId" SET NOT NULL;
ALTER TABLE "Subscriber" ALTER COLUMN "customerConnectionId" SET NOT NULL;
ALTER TABLE "Campaign" ALTER COLUMN "customerConnectionId" SET NOT NULL;
ALTER TABLE "EngagementEvent" ALTER COLUMN "customerConnectionId" SET NOT NULL;
ALTER TABLE "ApiCapabilityCheck" ALTER COLUMN "customerConnectionId" SET NOT NULL;
ALTER TABLE "CleanupOperation" ALTER COLUMN "customerConnectionId" SET NOT NULL;
ALTER TABLE "CleanupOperationRecord" ALTER COLUMN "customerConnectionId" SET NOT NULL;
ALTER TABLE "ReengagementPlan" ALTER COLUMN "customerConnectionId" SET NOT NULL;

-- 6. Drop old single-tenant global unique constraints
DROP INDEX IF EXISTS "MailingList_listUid_key";
DROP INDEX IF EXISTS "Campaign_campaignUid_key";
DROP INDEX IF EXISTS "ApiCapabilityCheck_capabilityKey_key";

-- 7. Create Phase 4 Unique Constraints & Indexes
CREATE UNIQUE INDEX IF NOT EXISTS "MailWizzInstallation_baseUrl_key" ON "MailWizzInstallation"("baseUrl");
CREATE INDEX IF NOT EXISTS "MailWizzInstallation_hostname_idx" ON "MailWizzInstallation"("hostname");

CREATE UNIQUE INDEX IF NOT EXISTS "MailWizzCustomerConnection_customerSlug_key" ON "MailWizzCustomerConnection"("customerSlug");
CREATE INDEX IF NOT EXISTS "MailWizzCustomerConnection_installationId_idx" ON "MailWizzCustomerConnection"("installationId");
CREATE INDEX IF NOT EXISTS "MailWizzCustomerConnection_status_isEnabled_idx" ON "MailWizzCustomerConnection"("status", "isEnabled");

CREATE UNIQUE INDEX IF NOT EXISTS "MailWizzConnectionCredential_one_active_per_conn" ON "MailWizzConnectionCredential"("customerConnectionId") WHERE "isActive" = true;
CREATE INDEX IF NOT EXISTS "MailWizzConnectionCredential_customerConnectionId_isActive_status_idx" ON "MailWizzConnectionCredential"("customerConnectionId", "isActive", "status");
CREATE INDEX IF NOT EXISTS "MailWizzConnectionCredential_apiKeyFingerprint_idx" ON "MailWizzConnectionCredential"("apiKeyFingerprint");

CREATE UNIQUE INDEX IF NOT EXISTS "MailWizzConnectionHealth_customerConnectionId_key" ON "MailWizzConnectionHealth"("customerConnectionId");
CREATE UNIQUE INDEX IF NOT EXISTS "ConnectionSyncState_customerConnectionId_key" ON "ConnectionSyncState"("customerConnectionId");
CREATE INDEX IF NOT EXISTS "ConnectionCapabilityReport_customerConnectionId_checkedAt_idx" ON "ConnectionCapabilityReport"("customerConnectionId", "checkedAt");

CREATE UNIQUE INDEX IF NOT EXISTS "MailingList_customerConnectionId_listUid_key" ON "MailingList"("customerConnectionId", "listUid");
CREATE INDEX IF NOT EXISTS "MailingList_customerConnectionId_idx" ON "MailingList"("customerConnectionId");

CREATE INDEX IF NOT EXISTS "ListSegment_customerConnectionId_mailingListId_idx" ON "ListSegment"("customerConnectionId", "mailingListId");

CREATE UNIQUE INDEX IF NOT EXISTS "Subscriber_customerConnectionId_mailingListId_subscriberUid_key" ON "Subscriber"("customerConnectionId", "mailingListId", "subscriberUid");
CREATE INDEX IF NOT EXISTS "Subscriber_customerConnectionId_hygieneStatus_idx" ON "Subscriber"("customerConnectionId", "hygieneStatus");
CREATE INDEX IF NOT EXISTS "Subscriber_customerConnectionId_emailHash_idx" ON "Subscriber"("customerConnectionId", "emailHash");

CREATE UNIQUE INDEX IF NOT EXISTS "Campaign_customerConnectionId_campaignUid_key" ON "Campaign"("customerConnectionId", "campaignUid");
CREATE INDEX IF NOT EXISTS "Campaign_customerConnectionId_sendAt_idx" ON "Campaign"("customerConnectionId", "sendAt");

CREATE INDEX IF NOT EXISTS "EngagementEvent_customerConnectionId_subscriberId_occurredAt_idx" ON "EngagementEvent"("customerConnectionId", "subscriberId", "occurredAt");
CREATE INDEX IF NOT EXISTS "SyncJob_customerConnectionId_status_runAt_idx" ON "SyncJob"("customerConnectionId", "status", "runAt");
CREATE INDEX IF NOT EXISTS "AuditLog_customerConnectionId_createdAt_idx" ON "AuditLog"("customerConnectionId", "createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "ApiCapabilityCheck_customerConnectionId_capabilityKey_key" ON "ApiCapabilityCheck"("customerConnectionId", "capabilityKey");
CREATE INDEX IF NOT EXISTS "ApiCapabilityCheck_customerConnectionId_category_idx" ON "ApiCapabilityCheck"("customerConnectionId", "category");

CREATE INDEX IF NOT EXISTS "CleanupOperation_customerConnectionId_status_createdAt_idx" ON "CleanupOperation"("customerConnectionId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "CleanupOperationRecord_customerConnectionId_subscriberId_idx" ON "CleanupOperationRecord"("customerConnectionId", "subscriberId");
CREATE INDEX IF NOT EXISTS "ReengagementPlan_customerConnectionId_mailingListId_status_idx" ON "ReengagementPlan"("customerConnectionId", "mailingListId", "status");

-- 8. Add Foreign Key Constraints safely (idempotent)
DO $$ BEGIN
  ALTER TABLE "MailWizzCustomerConnection" ADD CONSTRAINT "MailWizzCustomerConnection_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "MailWizzInstallation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "MailWizzConnectionCredential" ADD CONSTRAINT "MailWizzConnectionCredential_customerConnectionId_fkey" FOREIGN KEY ("customerConnectionId") REFERENCES "MailWizzCustomerConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "MailWizzConnectionHealth" ADD CONSTRAINT "MailWizzConnectionHealth_customerConnectionId_fkey" FOREIGN KEY ("customerConnectionId") REFERENCES "MailWizzCustomerConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ConnectionSyncState" ADD CONSTRAINT "ConnectionSyncState_customerConnectionId_fkey" FOREIGN KEY ("customerConnectionId") REFERENCES "MailWizzCustomerConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ConnectionCapabilityReport" ADD CONSTRAINT "ConnectionCapabilityReport_customerConnectionId_fkey" FOREIGN KEY ("customerConnectionId") REFERENCES "MailWizzCustomerConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "MailingList" ADD CONSTRAINT "MailingList_customerConnectionId_fkey" FOREIGN KEY ("customerConnectionId") REFERENCES "MailWizzCustomerConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ListSegment" ADD CONSTRAINT "ListSegment_customerConnectionId_fkey" FOREIGN KEY ("customerConnectionId") REFERENCES "MailWizzCustomerConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Subscriber" ADD CONSTRAINT "Subscriber_customerConnectionId_fkey" FOREIGN KEY ("customerConnectionId") REFERENCES "MailWizzCustomerConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_customerConnectionId_fkey" FOREIGN KEY ("customerConnectionId") REFERENCES "MailWizzCustomerConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "EngagementEvent" ADD CONSTRAINT "EngagementEvent_customerConnectionId_fkey" FOREIGN KEY ("customerConnectionId") REFERENCES "MailWizzCustomerConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "SyncJob" ADD CONSTRAINT "SyncJob_customerConnectionId_fkey" FOREIGN KEY ("customerConnectionId") REFERENCES "MailWizzCustomerConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_customerConnectionId_fkey" FOREIGN KEY ("customerConnectionId") REFERENCES "MailWizzCustomerConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ApiCapabilityCheck" ADD CONSTRAINT "ApiCapabilityCheck_customerConnectionId_fkey" FOREIGN KEY ("customerConnectionId") REFERENCES "MailWizzCustomerConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "CleanupOperation" ADD CONSTRAINT "CleanupOperation_customerConnectionId_fkey" FOREIGN KEY ("customerConnectionId") REFERENCES "MailWizzCustomerConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "CleanupOperationRecord" ADD CONSTRAINT "CleanupOperationRecord_customerConnectionId_fkey" FOREIGN KEY ("customerConnectionId") REFERENCES "MailWizzCustomerConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ReengagementPlan" ADD CONSTRAINT "ReengagementPlan_customerConnectionId_fkey" FOREIGN KEY ("customerConnectionId") REFERENCES "MailWizzCustomerConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
