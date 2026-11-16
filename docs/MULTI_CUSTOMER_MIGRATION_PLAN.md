# Multi-Customer Upgrade, Migration & Rollback Plan (Phase 4)

## 1. Purpose & Safety Principles

Upgrading from Phase 3 (single-tenant `AppConfig` singleton) to Phase 4 (multi-customer `MailWizzCustomerConnection`) touches shared tables (`MailingList`, `ListSegment`, `Subscriber`, `Campaign`, `EngagementEvent`, `SyncJob`, `AuditLog`, `ApiCapabilityCheck`, `CleanupOperation`, `CleanupOperationRecord`, `ReengagementPlan`).

Migration [`20261116000000_phase4_multi_customer_connections/migration.sql`](file:///E:/MyCodes/MailWizz%20List%20Hygiene%20Manager/prisma/migrations/20261116000000_phase4_multi_customer_connections/migration.sql) enforces:
1. **Zero silent data loss or deletion** of existing subscriber/campaign history.
2. **Quarantine-by-default for ambiguous legacy data**: historical rows lacking an unambiguous configured `AppConfig.mailwizzApiUrl` are isolated under `conn-legacy-quarantine` (`LEGACY_QUARANTINE`, `isEnabled = false`, `isQuarantine = true`, `ConnectionSyncState.isPaused = true`) rather than blindly attributed to any live customer.
3. **Mutation safety preservation**: `ENABLE_MAILWIZZ_MUTATIONS=false` and quarantined/unapproved connections remain read-only/blocked throughout and after upgrade.

---

## 2. Upgrade Flow Executed by Migration SQL

1. **Create Phase 4 enums & tables**: `ConnectionStatus`, `CredentialStatus`, `MailWizzInstallation`, `MailWizzCustomerConnection`, `MailWizzConnectionCredential`, `MailWizzConnectionHealth`, `ConnectionSyncState`, `ConnectionCapabilityReport`.
2. **Add nullable columns** (`customerConnectionId`, `SyncJob.credentialVersion`) on existing tenant-scoped tables.
3. **Unambiguous backfill (`conn-primary-default`)**: If `AppConfig` (`id = 'default'`) defines a non-empty `mailwizzApiUrl`, creates/upserts `MailWizzInstallation`, creates `MailWizzCustomerConnection` (`conn-primary-default`, `customerSlug = 'primary-account'`, `isPrimary = true`), migrates `mailwizzApiKeyEnc` / `mailwizzApiKeyLast4` into `MailWizzConnectionCredential` (`v1`), migrates health & sync state, and assigns existing `MailingList`, `ListSegment`, `Subscriber`, `Campaign`, `EngagementEvent`, `ApiCapabilityCheck`, `CleanupOperation`, `CleanupOperationRecord`, `ReengagementPlan`, and tenant `SyncJob` rows to `conn-primary-default`.
4. **Ambiguous legacy quarantine (`conn-legacy-quarantine`)**: If any tenant-scoped rows remain with `customerConnectionId IS NULL` (for example pre-Phase-4 rows without an explicit `AppConfig.mailwizzApiUrl`), creates disabled `https://legacy-quarantine.invalid/api/index.php` + `conn-legacy-quarantine` (`status = 'LEGACY_QUARANTINE'`, `isQuarantine = true`, `isEnabled = false`, sync paused) and binds all unassigned rows to it.
5. **Enforce constraints & swap unique indexes**: Sets `customerConnectionId SET NOT NULL` on all 9 core tenant-owned tables, drops legacy global unique indexes (`MailingList_listUid_key`, `Campaign_campaignUid_key`, `ApiCapabilityCheck_capabilityKey_key`), creates composite tenant-scoped unique indexes and foreign keys.

---

## 3. Production Deployment Runbook (Non-Destructive)

Before upgrading any staging/production instance (NOT executed automatically on remote VPS):

1. **Pre-flight backup**: Take an encrypted PostgreSQL `pg_dump` backup (`age` / KMS-encrypted, stored off-host) and verify recovery key availability.
2. **Verify application lock**: Keep `ENABLE_MAILWIZZ_MUTATIONS=false` in `.env` during upgrade and worker restart.
3. **Stop worker gracefully** before running schema migrations so no in-flight Phase 3 `SyncJob` runs mid-DDL.
4. **Run Prisma migration**:
   ```bash
   npx prisma migrate deploy
   npx prisma migrate status
   ```
5. **Inspect migrated connections**:
   - Sign in to the UI and open `/connections`.
   - Confirm primary customer connection (`conn-primary-default`) appears as `CONNECTED` or `PENDING` and run **Validate** + **Sample (<=10)**.
   - If `conn-legacy-quarantine` (`Unassigned Legacy Import (Review Required)`) was created, follow Section 4 before re-enabling sync.
6. **Start app & worker containers**, then verify `/api/health` and scheduled worker polling.

---

## 4. Quarantined Legacy Record Review & Reassignment Procedure

If `conn-legacy-quarantine` exists after migration:
1. Quarantined records are **visible for inspection** but blocked from API calls, sync scheduling, cleanup execution, compatibility approval, and webhook auto-attribution.
2. To verify provenance: inspect `MailingList.listUid`, `Campaign.campaignUid`, and `Subscriber` email domains via Dashboard filter (`Unassigned Legacy Import (Review Required)`).
3. If the quarantined records belong to a specific verified customer connection (`<target_conn_id>`), reassign explicitly in a single PostgreSQL transaction after verifying no `(customerConnectionId, listUid)` / `(customerConnectionId, campaignUid)` collision exists, or delete the quarantine connection via `/connections` using typed confirmation (`unassigned-legacy-import`) if the data was stale demo/test state before re-syncing cleanly from the customer's verified API key.

---

## 5. Verified Rollback Procedure & SQL

> [!WARNING]
> Rolling back from multi-customer to single-tenant **blocks fail-closed** if duplicate `listUid`, `campaignUid`, or `capabilityKey` values exist across multiple customer connections. Secondary customer data must be archived/exported and removed before executing rollback SQL.

The rollback script below was **executed and verified end-to-end** against an ephemeral PostgreSQL database (`mw_hygiene_p4_rollback_check`) on 2026-11-16 (`psql -v ON_ERROR_STOP=1` -> exit 0, surviving single-customer rows preserved cleanly, followed by clean forward re-upgrade with `npx prisma migrate deploy`):

```sql
BEGIN;

-- 1. Fail closed if multi-customer UID collisions prevent restoring global uniqueness
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "MailingList" GROUP BY "listUid" HAVING COUNT(*) > 1) THEN
    RAISE EXCEPTION 'Rollback blocked: duplicate listUid values exist across multiple customer connections.';
  END IF;
  IF EXISTS (SELECT 1 FROM "Campaign" GROUP BY "campaignUid" HAVING COUNT(*) > 1) THEN
    RAISE EXCEPTION 'Rollback blocked: duplicate campaignUid values exist across multiple customer connections.';
  END IF;
  IF EXISTS (SELECT 1 FROM "ApiCapabilityCheck" GROUP BY "capabilityKey" HAVING COUNT(*) > 1) THEN
    RAISE EXCEPTION 'Rollback blocked: duplicate capabilityKey values exist across multiple customer connections.';
  END IF;
END $$;

-- 2. Drop Phase 4 foreign keys on shared tables
ALTER TABLE "MailingList" DROP CONSTRAINT IF EXISTS "MailingList_customerConnectionId_fkey";
ALTER TABLE "ListSegment" DROP CONSTRAINT IF EXISTS "ListSegment_customerConnectionId_fkey";
ALTER TABLE "Subscriber" DROP CONSTRAINT IF EXISTS "Subscriber_customerConnectionId_fkey";
ALTER TABLE "Campaign" DROP CONSTRAINT IF EXISTS "Campaign_customerConnectionId_fkey";
ALTER TABLE "EngagementEvent" DROP CONSTRAINT IF EXISTS "EngagementEvent_customerConnectionId_fkey";
ALTER TABLE "SyncJob" DROP CONSTRAINT IF EXISTS "SyncJob_customerConnectionId_fkey";
ALTER TABLE "AuditLog" DROP CONSTRAINT IF EXISTS "AuditLog_customerConnectionId_fkey";
ALTER TABLE "ApiCapabilityCheck" DROP CONSTRAINT IF EXISTS "ApiCapabilityCheck_customerConnectionId_fkey";
ALTER TABLE "CleanupOperation" DROP CONSTRAINT IF EXISTS "CleanupOperation_customerConnectionId_fkey";
ALTER TABLE "CleanupOperationRecord" DROP CONSTRAINT IF EXISTS "CleanupOperationRecord_customerConnectionId_fkey";
ALTER TABLE "ReengagementPlan" DROP CONSTRAINT IF EXISTS "ReengagementPlan_customerConnectionId_fkey";

-- 3. Drop Phase 4 scoped indexes on shared tables
DROP INDEX IF EXISTS "MailingList_customerConnectionId_listUid_key";
DROP INDEX IF EXISTS "MailingList_customerConnectionId_idx";
DROP INDEX IF EXISTS "ListSegment_customerConnectionId_mailingListId_idx";
DROP INDEX IF EXISTS "Subscriber_customerConnectionId_mailingListId_subscriberUid_key";
DROP INDEX IF EXISTS "Subscriber_customerConnectionId_hygieneStatus_idx";
DROP INDEX IF EXISTS "Subscriber_customerConnectionId_emailHash_idx";
DROP INDEX IF EXISTS "Campaign_customerConnectionId_campaignUid_key";
DROP INDEX IF EXISTS "Campaign_customerConnectionId_sendAt_idx";
DROP INDEX IF EXISTS "EngagementEvent_customerConnectionId_subscriberId_occurredAt_idx";
DROP INDEX IF EXISTS "SyncJob_customerConnectionId_status_runAt_idx";
DROP INDEX IF EXISTS "AuditLog_customerConnectionId_createdAt_idx";
DROP INDEX IF EXISTS "ApiCapabilityCheck_customerConnectionId_capabilityKey_key";
DROP INDEX IF EXISTS "ApiCapabilityCheck_customerConnectionId_category_idx";
DROP INDEX IF EXISTS "CleanupOperation_customerConnectionId_status_createdAt_idx";
DROP INDEX IF EXISTS "CleanupOperationRecord_customerConnectionId_subscriberId_idx";
DROP INDEX IF EXISTS "ReengagementPlan_customerConnectionId_mailingListId_status_idx";

-- 4. Drop Phase 4 tenant columns on shared tables
ALTER TABLE "MailingList" DROP COLUMN IF EXISTS "customerConnectionId";
ALTER TABLE "ListSegment" DROP COLUMN IF EXISTS "customerConnectionId";
ALTER TABLE "Subscriber" DROP COLUMN IF EXISTS "customerConnectionId";
ALTER TABLE "Campaign" DROP COLUMN IF EXISTS "customerConnectionId";
ALTER TABLE "EngagementEvent" DROP COLUMN IF EXISTS "customerConnectionId";
ALTER TABLE "SyncJob" DROP COLUMN IF EXISTS "customerConnectionId";
ALTER TABLE "SyncJob" DROP COLUMN IF EXISTS "credentialVersion";
ALTER TABLE "AuditLog" DROP COLUMN IF EXISTS "customerConnectionId";
ALTER TABLE "ApiCapabilityCheck" DROP COLUMN IF EXISTS "customerConnectionId";
ALTER TABLE "CleanupOperation" DROP COLUMN IF EXISTS "customerConnectionId";
ALTER TABLE "CleanupOperationRecord" DROP COLUMN IF EXISTS "customerConnectionId";
ALTER TABLE "ReengagementPlan" DROP COLUMN IF EXISTS "customerConnectionId";

-- 5. Restore pre-Phase-4 single-tenant unique indexes
CREATE UNIQUE INDEX IF NOT EXISTS "MailingList_listUid_key" ON "MailingList"("listUid");
CREATE UNIQUE INDEX IF NOT EXISTS "Campaign_campaignUid_key" ON "Campaign"("campaignUid");
CREATE UNIQUE INDEX IF NOT EXISTS "ApiCapabilityCheck_capabilityKey_key" ON "ApiCapabilityCheck"("capabilityKey");

-- 6. Drop Phase 4 multi-customer tables & enums
DROP TABLE IF EXISTS "ConnectionCapabilityReport";
DROP TABLE IF EXISTS "ConnectionSyncState";
DROP TABLE IF EXISTS "MailWizzConnectionHealth";
DROP TABLE IF EXISTS "MailWizzConnectionCredential";
DROP TABLE IF EXISTS "MailWizzCustomerConnection";
DROP TABLE IF EXISTS "MailWizzInstallation";
DROP TYPE IF EXISTS "CredentialStatus";
DROP TYPE IF EXISTS "ConnectionStatus";

-- 7. Remove Phase 4 entry from Prisma migration ledger
DELETE FROM "_prisma_migrations"
WHERE "migration_name" = '20261116000000_phase4_multi_customer_connections';

COMMIT;
```

### Code Rollback Pairing
After running the database rollback SQL above, check out the pre-Phase-4 release commit/branch (`validation/phase-3.4-docker-acceptance`), run `npx prisma generate`, rebuild, and restart web/worker processes.
