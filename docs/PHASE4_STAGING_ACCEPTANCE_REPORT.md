# MailWizz List Hygiene Manager — Phase 4 Staging Acceptance & Canary Validation Report

- **Date (UTC):** `2026-11-16T15:54:00Z`
- **Branch:** `feature/phase-4-multi-customer-api` (not merged or pushed)
- **Validated Head Commit:** `6fc8a4f4ea514ea12383af7bbe33ea702a8ea1e4` (`6fc8a4f`)
- **Intermediate Hardening Commit:** `801fc27d26680fb29bc83adee376456f0487d346` (`801fc27`, safe archive & `ON DELETE RESTRICT`)
- **Source Tarball SHA-256 (`mw-hygiene-p4-6fc8a4f.tar.gz`):** `e5a2d4a511011ae3d326f3ff3eb811f5c3c8fd84b42fffe0d62ad953bd161847` (verified on Windows and `cloud-vps` before extraction)
- **Canary Host & Project:** `cloud-vps` (`100.95.86.56`), `/srv/mw-hygiene-p4-canary`, Compose project `mw-hygiene-p4-canary`, private localhost bind `127.0.0.1:13001`
- **Existing Deployment Untouched:** `/srv/mw-hygiene-p35-isolated` (`mw-hygiene-p35-isolated`, `127.0.0.1:13000`, `Up 37 hours (healthy)`) and all CapRover services remained completely untouched
- **Final Release Verdict:** **CONDITIONAL GO** for upgrading `mw-hygiene-p35-isolated` application & database schema (**NO-GO** for real subscriber ingestion or setting `ENABLE_MAILWIZZ_MUTATIONS=true` until independent off-disk recovery-key storage and MailWizz `/api/` availability are satisfied).

---

## 1. Actual Linux Docker Results (`mw-hygiene-p4-canary`)

All four services built and ran cleanly in isolated Linux containers under `mw-hygiene-p4-canary` (`docker-compose.yml` + `docker-compose.isolated.yml` with isolated credentials, Docker network `mw-hygiene-p4-canary_default`, and volumes `mw-hygiene-p4-canary_postgres_data` / `mw-hygiene-p4-canary_backups_data`):

| Service | Container | Status | Binding | Verified Resource Usage |
|---|---|---|---|---|
| PostgreSQL 16 | `mw-hygiene-p4-canary-postgres-1` | `Up (healthy)` | Internal `5432/tcp` | `98.22 MiB / 512 MiB (19.18%)`, `0.05%` CPU, `17` PIDs |
| Prisma Migrate | `mw-hygiene-p4-canary-migrate-1` | `Exited (0)` | One-shot init | Applied all 6 migrations cleanly |
| Next.js Web | `mw-hygiene-p4-canary-web-1` | `Up (healthy)` | `127.0.0.1:13001->3000/tcp` | `67.62 MiB / 768 MiB (8.81%)`, `0.01%` CPU, `14` PIDs |
| Worker Daemon | `mw-hygiene-p4-canary-worker-1` | `Up (healthy)` | No inbound ports | `85.64 MiB / 512 MiB (16.73%)`, `0.27%` CPU, `33` PIDs |

- **Live HTTP `/api/health` on `127.0.0.1:13001`:** `200 OK` -> `{"status":"ok","database":"connected","worker":"healthy","phase":"phase-3-deliverability-ready","mailwizzMutationsEnabled":false,...}`.
- **Host Headroom Verified:** Total RAM `7.8 GiB`, `4.9 GiB` available, Disk `100G / 145G` (`45G` available). No CapRover or `mw-hygiene-p35-isolated` container health was disrupted.
- **Restart Persistence Verified:** Executed `docker compose restart web worker`; waited for healthy `/api/health`, re-authenticated via `/api/auth/login`, and confirmed all 3 customer connections and Alpha's rotated `v2 ****9999` credential survived restart.

---

## 2. Database Migration & Rollback Test Results (Disposable Linux DBs)

Tested against 3 disposable databases inside `mw-hygiene-p4-canary-postgres-1` (`p4_val_empty`, `p4_val_pre_single`, `p4_val_pre_ambig`), all dropped cleanly after verification:

1. **Empty Database (`p4_val_empty`):** Applied all 6 migrations (`20261114164734_init` -> `20261114170053_phase2_hygiene_engine` -> `20261114171713_phase3_deliverability_diagnostics` -> `20261114190323_mailwizz_multi_version_compat` -> `20261116000000_phase4_multi_customer_connections` -> `20261116120000_phase4_safe_archive_restrict_fk`) -> `Database schema is up to date!`.
2. **Populated Pre-Phase-4 Single-Account Database (`p4_val_pre_single`):**
   - Seeded legacy `AppConfig` (`https://legacy-single.example.com/api/index.php/`), `2` mailing lists, `2` campaigns, `4` subscribers (including duplicate `alice@shared.example` across two lists and unknown status `experimental_v4`), `2` engagement events, `1` cleanup operation + `1` `CleanupOperationRecord` snapshot, and `1` `AuditLog` entry.
   - Upgraded cleanly: `conn-primary-default` created (`CONNECTED`, `isPrimary=t`, `isQuarantine=f`); **100% of records retained** (`lists_primary=2`, `camps_primary=2`, `subs_primary=4`, `events_primary=2`, `ops_primary=1`, `snaps_primary=1`, `audit_preserved=1`, `rawStatus='experimental_v4'`).
   - Executed documented **Rollback SQL** in a single `BEGIN ... COMMIT` transaction: verified all Phase 4 tables/enums/columns removed, single-tenant unique constraints restored, and `lists_after_rb=2`, `subs_after_rb=4`, `snaps_after_rb=1` preserved cleanly.
   - Re-applied Phase 4 migrations cleanly (`Database schema is up to date!`).
3. **Ambiguous Pre-Phase-4 Database (`p4_val_pre_ambig`, `AppConfig.mailwizzApiUrl = NULL`):**
   - Upgraded cleanly and verified automatic quarantine under `conn-legacy-quarantine` (`status='LEGACY_QUARANTINE'`, `isEnabled=f`, `isQuarantine=t`, `ConnectionSyncState.isPaused=t`, `quarantined_lists=1`, `quarantined_subs=1`).

---

## 3. Multi-Customer Functionality & Bug Found/Fixed During Canary

Created and exercised 3 synthetic customer accounts (`Canary Alpha Customer`, `Canary Beta Customer`, `Canary Gamma Customer`) sharing one MailWizz URL (`https://canary-shared-mw.example.invalid/api/index.php` -> mock MailWizz 3.0.5 server keyed by `X-Api-Key`):
- **Independent List Discovery & Validation:** Alpha and Beta validated (`CONNECTED`) and synced independently; Gamma returned HTTP `401 Unauthorized`, transitioning Gamma alone to `AUTH_FAILED` while Alpha and Beta remained healthy and synced normally.
- **Masked Credentials & Zero Plaintext Leakage:** `GET /api/connections` returned `****1111`, `****2222`, `****3333` (and `****9999` after rotation); plaintext keys were absent from all HTTP JSON payloads.
- **API Key Rotation (`v1 -> v2 -> v3`):** Verified version increment, immediate rejection of stale credential versions (`expectedCredentialVersion: 2`), and automatic cancellation of queued `SyncJob`s stamped with older credential versions.
- **Disable / Re-Enable Bug Found & Fixed (`6fc8a4f`):** Live canary HTTP testing discovered that disabling a connection (`SET_ENABLED: false`) set `ConnectionSyncState.isPaused=true` (`pauseReason='Connection disabled by administrator'`), which stayed paused after re-enabling (`SET_ENABLED: true`). Fixed `updateCustomerConnection()` in [src/services/mailwizz/connections.ts](file:///E:/MyCodes/MailWizz%20List%20Hygiene%20Manager/src/services/mailwizz/connections.ts) to clear only the automatic admin-disable pause upon re-enable (preserving manual pauses), rebuilt canary images, and verified `SET_ENABLED false -> true` cleared the auto-pause cleanly over live HTTP `127.0.0.1:13001`.
- **Live Worker Daemon Job Execution:** Enqueued `ANALYZE_HYGIENE` for Beta; running container `mw-hygiene-p4-canary-worker-1` autonomously claimed and completed job `cmwjfz21o0019qo01760b2z7o` (locked by `worker-1-...`).
- **Dashboards & Filters:** Verified Global Overview (`scope='GLOBAL'`, 3 accounts), per-customer `/compatibility?customerConnectionId=...`, SSR routes (`/`, `/connections`, `/compatibility`, `/reports`, `/settings`), and search filtering.

---

## 4. Tenant-Isolation Verification

Adversarial cross-account verification inside the canary runtime confirmed:
- Identical remote `shared_list_uid`, `shared_camp_uid`, and subscriber email `alice@shared.example` (`CONFIRMED` in Alpha vs `UNSUBSCRIBED` in Beta) stay cleanly separated across sync, lookup, and reporting.
- Passing Beta's `mailingListId` with Alpha's `customerConnectionId` to `previewCleanupOperation` rejected fail-closed (`Customer connection scoping violation`).
- Calling `/api/reports/hygiene?format=csv` or `generateReportCsv` without `customerConnectionId` while 3 accounts exist rejected fail-closed (`required`), while scoped export returned `200 OK`.
- Webhook signature (`x-hygiene-webhook-signature`) signed with Alpha's secret returned `401` on Beta's endpoint and `200` on Alpha's endpoint, writing `EngagementEvent` exclusively to Alpha (`beta=0`, `alpha=1`).
- Unrecognized subscriber status `experimental_v4_hold` remained `status='UNKNOWN'`, `rawStatus='experimental_v4_hold'`, and was excluded from `INACTIVE_CANDIDATE`.

---

## 5. Credential & Endpoint Security

- Unauthenticated `GET /api/connections` -> `401`; wrong login password -> `401`; missing CSRF on `POST /api/connections` -> `403`.
- Blocked non-HTTPS and SSRF URLs (`http://...`, `169.254.169.254`, `192.168.1.20`, `10.0.0.5`) with HTTP `400`.
- Customer API keys, webhook secrets, and reporting DB URIs encrypted at rest with AES-256-GCM (`APP_ENCRYPTION_KEY`); `age` private recovery identity never uploaded to `cloud-vps`.

---

## 6. Cleanup Safety & Safe Archive Hardening (`801fc27`)

- Verified `ENABLE_MAILWIZZ_MUTATIONS=false` in container env, `/api/health`, `/api/compatibility`, and `assertCompatibilityPermitsRemoteMutations` (`ENABLE_MAILWIZZ_MUTATIONS` gate error). Zero real MailWizz writes permitted or performed.
- **Unsafe Cascade Finding & Fix:** Initial code review identified that `deleteCustomerConnection` triggered PostgreSQL `ON DELETE CASCADE` on `MailingList`, `Subscriber`, `EngagementEvent`, `CleanupOperation`, `CleanupOperationRecord`, and `ReengagementPlan`, risking loss of consent history and cleanup recovery snapshots.
- Implemented two layers of protection in commit `801fc27`:
  1. **PostgreSQL FK Hardening ([20261116120000_phase4_safe_archive_restrict_fk/migration.sql](file:///E:/MyCodes/MailWizz%20List%20Hygiene%20Manager/prisma/migrations/20261116120000_phase4_safe_archive_restrict_fk/migration.sql)):** Altered foreign keys on `MailingList`, `ListSegment`, `Subscriber`, `Campaign`, `EngagementEvent`, `CleanupOperation`, `CleanupOperationRecord`, and `ReengagementPlan` to `ON DELETE RESTRICT ON UPDATE CASCADE`.
  2. **Safe Disable & Archive Workflow:** Added `archiveCustomerConnection()` + `PATCH /api/connections/[id]` (`ARCHIVE_CONNECTION`) + UI archive modal ([ConnectionsView.tsx](file:///E:/MyCodes/MailWizz%20List%20Hygiene%20Manager/src/components/ConnectionsView.tsx)), revoking all API keys and clearing webhook/DB secrets while **100% preserving** subscriber consent states, engagement events, cleanup snapshots, and audit logs. Hard `deleteCustomerConnection` refuses (`409 Conflict` + `DELETE_CUSTOMER_CONNECTION_BLOCKED` audit) whenever any historical/recovery records exist, allowing deletion only on empty zero-record connections.
- Verified locally (`83/83` Vitest, `3/3` Playwright E2E) and inside the Linux canary (`alpha` delete refused, `archiveCustomerConnection` preserved `2` subscribers, `1` engagement event, and `1` cleanup snapshot with `hasActiveCredential=false`).

---

## 7. Container Health & Local Automated Suite Summary

- **Local Pre-Transfer Full Suite (Commit `6fc8a4f` / `801fc27` logic verified):**
  - `npm run typecheck`: Exit 0
  - `npm run lint`: Exit 0 (0 errors, 0 warnings)
  - `npm test`: **17/17 files, 83/83 tests passed**
  - `npm run build`: Exit 0 (27/27 routes built)
  - `npx playwright test --reporter=list`: **3/3 E2E specs passed** (`dashboard.spec.ts`, `phase4-multi-customer.spec.ts`, `remediation-security.spec.ts`)
- **Cloud VPS Health:** All `mw-hygiene-p4-canary` (`web`, `worker`, `postgres`), `mw-hygiene-p35-isolated` (`web`, `worker`, `postgres`), and existing CapRover services healthy.

---

## 8. Database Backup & Off-VPS Restore Verification

- Executed `./scripts/backup-postgres.sh` in `/srv/mw-hygiene-p4-canary` using dedicated public recipient `age1dyv52hxs3gqz5j0ytd9phrz00qq4tm9p38v7zvt9ajcgpc7a0elqhum3cv`:
  - Output: `./backups/hygiene_db_20261116T155131Z.dump.age` (`107,368` bytes, SHA-256 `92301e1d42072bd7fb85756ad9551613751cd025817e0f04b5f1a784171ed4e7`).
- Copied encrypted `.dump.age` locally to Windows, verified SHA-256 match, decrypted using off-VPS key `C:\Users\Administrator\.mw-hygiene-keys\backup-recovery.key`, and streamed `pg_restore` into disposable DB `p4_canary_restore_verify`:
  - Verified restored counts: `conns=3, subs=4, events=1, snaps=1, audits=31`.
  - Dropped `p4_canary_restore_verify` and deleted temporary local dump cleanly.
- Verified existing `/srv/mw-hygiene-p35-isolated/backups/` files (`hygiene_db_20261115T030608Z.dump.enc` and `hygiene_db_20261115T033016Z.dump.age` + `.sha256` checksums) remain completely intact.
- **Recovery Key Off-Disk Status:** Primary key `C:\Users\Administrator\.mw-hygiene-keys\backup-recovery.key` exists on Windows (`DeviceId: 0`, single `Virtual HD`, `OneDrive` unset); independent off-disk recovery-key copy remains **outstanding**.

---

## 9. Remaining Security Advisories

- `npm audit --omit=dev`: **3 high-severity transitive findings** (`deepmerge-ts <8.0.0`, GHSA-ggr8-5vv4-36mx via `prisma` -> `@prisma/config`; suggested fix requires breaking major upgrade to `prisma@7.10.1`). Next.js application runtime dependencies (`next`, `react`, `zod`, `mysql2`, `csv-parse`, `@prisma/client`) report zero advisories.

---

## 10. Exact Controlled Upgrade Procedure for `/srv/mw-hygiene-p35-isolated` (DO NOT RUN WITHOUT AUTHORIZATION)

Expected downtime: **~3–5 minutes** (web/worker container swap + Prisma migrations). Zero existing `.env` secrets or encrypted backups are modified.

1. **Pre-Upgrade Backups & Recovery Verification:**
   - Run `/srv/mw-hygiene-p35-isolated/scripts/backup-postgres.sh`, copy the newly created `.dump.age` + `.sha256` off-VPS, verify SHA-256, and confirm recovery key availability from the **independent off-disk copy** before modifying `p35`.
   - Snapshot `/srv/mw-hygiene-p35-isolated/.env` (keep `ENABLE_MAILWIZZ_MUTATIONS="false"`, `ALLOW_INSECURE_MAILWIZZ_HTTP="false"`, existing `POSTGRES_*`, `APP_ENCRYPTION_KEY`, `APP_SESSION_SECRET`, `APP_PORT=13000`, `BACKUP_AGE_RECIPIENT`).
2. **Transfer & Verify Release Archive:**
   - Export exact tested commit `6fc8a4f` (`SHA-256: e5a2d4a511011ae3d326f3ff3eb811f5c3c8fd84b42fffe0d62ad953bd161847`), transfer to `cloud-vps`, and verify `sha256sum -c` passes before extraction.
3. **Graceful Stop (No Volume Deletion):**
   - In `/srv/mw-hygiene-p35-isolated`: `docker compose -f docker-compose.yml -f docker-compose.isolated.yml stop web worker`.
4. **Extract Updated Code (Preserve `.env`, `docker-compose.isolated.yml`, `backups/`):**
   - `tar -xzf /tmp/mw-hygiene-p4-6fc8a4f.tar.gz -C /srv/mw-hygiene-p35-isolated`
5. **Run Migrations First & Build/Start Containers:**
   - `docker compose -f docker-compose.yml -f docker-compose.isolated.yml run --rm migrate` (or `--build` via `up -d --build`: `migrate` runs `npx prisma migrate deploy` BEFORE `web` and `worker` start).
   - Verify `docker compose exec -T worker npx prisma migrate status` reports `Database schema is up to date!`.
6. **Post-Upgrade Health & Data Reconciliation:**
   - Verify `curl -fsS http://127.0.0.1:13000/api/health` -> `status: "ok"`, `database: "connected"`, `worker: "healthy"`, `mailwizzMutationsEnabled: false`.
   - Open `http://127.0.0.1:13000` over SSH tunnel -> `/connections`: confirm either `conn-primary-default` or empty/quarantine state; verify existing `AppConfig` & `DomainAuthCheck` rows remain intact.
7. **Rollback Procedure (If Needed):**
   - Stop `web` & `worker` -> restore pre-upgrade `.dump.age` via `/srv/mw-hygiene-p35-isolated/scripts/restore-postgres.sh <pre_upgrade.dump.age> <off_vps_key>` (OR run transaction-guarded rollback SQL if single-customer UIDs only) -> extract prior verified `p35` release commit -> rebuild/restart `web` & `worker`.

---

## 11. Remaining Blockers & Verdict

- **Blockers Prior to Live Customer Subscriber Sync on `p35`:**
  1. Designate and verify an **independent off-disk copy** of `C:\Users\Administrator\.mw-hygiene-keys\backup-recovery.key` (not on Windows `DeviceId: 0` and not on `cloud-vps`).
  2. Restore MailWizz `/api/` endpoint availability on `https://app.nohitchweb.com/` (returned `503` in Phase 3.5) and obtain per-customer read-only MailWizz API keys.
- **Explicit Verdict:** **CONDITIONAL GO**
  - **GO** for Phase 4 architecture, multi-customer API isolation, connection lifecycle/archival safety, migration/rollback readiness, and isolated Docker runtime acceptance.
  - **CONDITIONAL / HOLD** on live `p35` upgrade & live customer subscriber import until explicit upgrade authorization, off-disk recovery-key verification, and MailWizz `/api/` availability are confirmed.
