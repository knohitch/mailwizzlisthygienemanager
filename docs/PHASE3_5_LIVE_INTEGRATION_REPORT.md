# Phase 3.5 — Live MailWizz 3.0.5 Integration & Data Protection Report

- **Date (UTC):** `2026-11-15T03:07:00Z`
- **Repository Branch:** `validation/phase-3.4-docker-acceptance`
- **Base Commit Reconciled:** `3b1e878d9624b6a50f1bef8843505aed2d71bf1a` (`3b1e878`)
- **Isolated Runtime Host:** `cloud-vps` (`100.95.86.56`), Compose project `mw-hygiene-p35-isolated`, directory `/srv/mw-hygiene-p35-isolated`, bound exclusively to `http://127.0.0.1:13000`
- **Decision Verdict:** **NO-GO** for subscriber cleanup review (blocked pending read-only live MailWizz 3.0.5 credentials, historical engagement source, Alibaba DirectMail read-only credentials, and sending domain hostnames)

---

## 1. Deployed Application Identity Verification

Comparison between local branch `validation/phase-3.4-docker-acceptance` (commit `3b1e878`) and `/srv/mw-hygiene-p35-isolated` on `cloud-vps`:

- **Matched prior to script update (SHA-256 verified):**
  - `Dockerfile` (`3ee165ff222e518e594b17d1dabe1a5bb2b15d8b7e77aa9ca991111bf1383cd7`)
  - `docker-compose.yml` (`73d605f841a81a29bcad4354987c174f66fc54e49b6692de6657341edc2173ca`)
  - `scripts/docker-smoke.sh` (`dc7e198f741dd5ebebc5537887bfee6980b3139c4583c5037fb565c4b37ebe09`)
- **Synchronized during this validation pass:**
  - `scripts/backup-postgres.sh` (hardened for mandatory AES-256-CBC PBKDF2 encryption and `shred -u` retention)
  - `scripts/restore-postgres.sh` (hardened to require `.dump.enc` + SHA-256 verification and decrypt into `pg_restore`)
  - `.gitattributes`
  - `docs/PHASE3_5_LINUX_RUNTIME_VALIDATION.md`
  - All transferred shell scripts normalized to LF endings and permissions set to `0755`.
- **Host-only runtime files intentionally kept on `cloud-vps`:**
  - `.env` (`chmod 0600`, isolated credentials, never committed)
  - `docker-compose.isolated.yml` (adds `cpus`, `pids_limit: 256`, and `json-file` log rotation per container)
- **Container & Host Runtime Status:**
  - `mw-hygiene-p35-isolated-web-1`: `Up ... (healthy)` (`127.0.0.1:13000->3000/tcp`)
  - `mw-hygiene-p35-isolated-worker-1`: `Up ... (healthy)`
  - `mw-hygiene-p35-isolated-postgres-1` (`postgres:16-alpine`): `Up ... (healthy)` (`5432/tcp` internal only)
  - Existing CapRover workloads (`captain-nginx`, `captain-captain`, `captain-certbot`, and all app/database containers) remained running without disruption.

---

## 2. Read-Only Connection Results

All live external connections stopped cleanly before querying any external systems because required read-only credentials have not yet been supplied in `.env` or runtime configuration:

| Integration Target | Runtime Env Status | Connection Result |
|---|---|---|
| **MailWizz 3.0.5 API** (`MAILWIZZ_API_URL`, `MAILWIZZ_API_KEY`) | Unset (`hasMailwizzApiUrl=false`, `hasMailwizzApiKey=false`) | **Not Executed** — awaiting base URL + read-only API key |
| **MailWizz Reporting MySQL / Historical CSV** (`MAILWIZZ_REPORTING_DB_URL` or export) | Unset (`hasReportingDbUrl=false`) | **Not Executed** — awaiting Priority C read-only MySQL replica/user or verified CSV campaign engagement exports |
| **Alibaba Cloud DirectMail** (read-only RAM credentials) | Unset | **Not Executed** — awaiting read-only AccessKey pair + region |
| **Sending / Tracking / From Domains** | Unset | **Not Executed** — awaiting exact sending, envelope/from, and tracking domain hostnames |

---

## 3. Compatibility & Safety Lock Verification

Verified directly against `http://127.0.0.1:13000`:

- `GET /api/health` returned HTTP `200`:
  ```json
  {"status":"ok","database":"connected","worker":"healthy","phase":"phase-3-deliverability-ready","mailwizzMutationsEnabled":false,"timestamp":"2026-11-15T03:06:32.166Z"}
  ```
- `GET /api/settings` (authenticated) reported `phase1ReadOnly: true`, `isDemoMode: false`, `hasMailwizzApiKey: false`, `hasReportingDbUrl: false`, `hasWebhookSecret: false`.
- `GET /api/compatibility` & `POST /api/compatibility` (`{"action":"RUN_CHECK"}`) reported:
  - `overallStatus`: `"UNVERIFIED"`
  - `mutationSafetyAllowed`: `false`
  - `phase1ReadOnly`: `true`
  - `capabilityCounts`: `{"VERIFIED":1,"AVAILABLE_BUT_UNTESTED":2,"BLOCKED":4,"UNKNOWN":8}`
- `POST /api/cleanup/execute` with non-existent payload returned HTTP `400` (`{"error":"Cleanup operation not found."}`), and global `ENABLE_MAILWIZZ_MUTATIONS="false"` enforces read-only protection at the mutation gate.

---

## 4. Subscriber Data Protection Verification & Remediation

### 4.1 Critical Gap Remediated — PostgreSQL Dump Encryption & Shredding
- **Finding:** Prior smoke testing had left an unencrypted dump (`backups/hygiene_db_20261115T024110Z.dump`, `78,383` bytes) on disk via `scripts/backup-postgres.sh`.
- **Remediation Applied:**
  1. Permanently destroyed `backups/hygiene_db_20261115T024110Z.dump` and `.sha256` on `cloud-vps` using `shred -u`.
  2. Hardened `scripts/backup-postgres.sh` to load `BACKUP_ENCRYPTION_KEY` or `APP_ENCRYPTION_KEY` (failing closed if `< 32` characters), stream `pg_dump -F c` directly into `openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt` so plaintext dumps never touch disk, apply `umask 077` (`0600`), write `.sha256`, and delete backups older than `BACKUP_RETENTION_DAYS` (default `14`) with `shred -u`.
  3. Hardened `scripts/restore-postgres.sh` to refuse non-`.enc` dump filenames, verify `.sha256`, decrypt via `openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000`, and stream into `pg_restore --clean --if-exists`.
- **Live Test Verification (`cloud-vps`):**
  - `./scripts/backup-postgres.sh` created `./backups/hygiene_db_20261115T030608Z.dump.enc` (`74,016` bytes, mode `-rw-------`, OpenSSL header `Salted__`) and `.dump.enc.sha256` (`-rw-------`).
  - `./scripts/restore-postgres.sh /tmp/test_plain_refuse.dump` failed as required (`Error: Refusing unencrypted dump ... Only *.dump.enc encrypted backups are supported.`).
  - `./scripts/restore-postgres.sh ./backups/hygiene_db_20261115T030608Z.dump.enc` verified `OK` checksum and completed cleanly against `mailwizz_hygiene_p35`.

### 4.2 Access Control, Network Isolation, Logical Backups, & Redaction
- **Authentication & CSRF:** Unauthenticated `GET /api/settings` returned HTTP `401`. Login (`POST /api/auth/login`) returned HTTP `200`, and `GET /api/auth/session` confirmed `authenticated: true` and `hasCsrf: true`.
- **Network Binding:** Web container exposed solely on `127.0.0.1:13000`. PostgreSQL port `5432/tcp` has no host binding (`{"5432/tcp":null}`), is attached only to `mw-hygiene-p35-isolated_default`, and database `mailwizz_hygiene_p35` is owned exclusively by `hygiene_p35_user`.
- **Tunnel-Only HTTP Note (`COOKIE_SECURE` / `ALLOWED_ADMIN_IPS`):** `COOKIE_SECURE="false"` and `ALLOWED_ADMIN_IPS` / `ALLOWED_ADMIN_CIDRS` remain unset for direct `http://127.0.0.1:13000` SSH-tunnel operation (note `src/lib/api-auth.ts` checks `getClientIp(req.headers)`). Before connecting behind any HTTPS reverse proxy, enable `COOKIE_SECURE=true` and configure `ALLOWED_ADMIN_IPS` / `ALLOWED_ADMIN_CIDRS`.
- **Logical Backups & PII Log Safety:** `src/services/security/backup.ts` (`exportEncryptedAppBackup`) encrypts configuration/deliverability JSON bundles with `AES-256-GCM` (`src/services/security/crypto.ts`) without exporting subscriber PII. `src/services/security/logger.ts` (`sanitizeForLog` / `redactEmailString`) redacts credentials, emails, names, and IP fields, and `RETENTION_CLEANUP` (`src/services/jobs/handlers.ts`) purges old `AdminSession`, `EngagementEvent`, and finished `SyncJob` rows per `dataRetentionDays` (default `365`).
- **Pre-Integration Database Cleanliness (`pg_stat_user_tables` after restore):**
  - `MailingList=0`, `Subscriber=0`, `Campaign=0`, `EngagementEvent=0`, `DirectMailDailyMetric=0`, `DomainAuthCheck=0`, `InboxPlacementTest=0`, `PostmasterStat=0`, `ListSegment=0`, `SegmentMembership=0`, `ReengagementPlan=0`, `CleanupOperation=0`, `CleanupOperationRecord=0`.
  - Operational metadata: `AppConfig=1`, `ApiCapabilityCheck=30`, `AdminSession=7`, `AuditLog=16`, `SyncJob=1`, `_prisma_migrations=4`.

---

## 5. Subscriber Reconciliation, Engagement Coverage, & Deliverability Results

The following Steps (5–9 of Phase 3.5) were **not executed** because live read-only credentials and domain names are not yet configured, and no demo or estimated figures were substituted:

- **Subscriber Reconciliation (~1,800-subscriber list & all other lists):** **Not Executed** (pending MailWizz 3.0.5 API credentials).
- **Engagement History Coverage & Tracking Audit (Priority A/B/C):** **Not Executed** (pending MailWizz API + Priority C Reporting MySQL/CSV exports).
- **Alibaba Cloud DirectMail Delivery & Bounce Diagnostics:** **Not Executed** (pending Alibaba DirectMail read-only RAM credentials & region).
- **DNS Authentication Checks (`SPF`, `DKIM`, `DMARC`, `MX`, tracking CNAME):** **Not Executed** (pending sending/from/tracking hostnames).
- **Engaged / Cooling / Inactive Classification Output:** **Not Executed** (0 subscribers ingested).

---

## 6. Required Credentials & Inputs Checklist Before Next Run

To resume Phase 3.5 live read-only integration safely on `mw-hygiene-p35-isolated`, provide (outside source control, injected directly into `/srv/mw-hygiene-p35-isolated/.env` or authenticated Settings UI):

1. **MailWizz 3.0.5 Base URL & API Key:** Read-only (or lowest-privilege API user) key, with `ENABLE_MAILWIZZ_MUTATIONS="false"` retained.
2. **Historical Engagement Source (Priority C):** Read-only MySQL Reporting DB connection (`MAILWIZZ_REPORTING_DB_URL` + table prefix `MAILWIZZ_REPORTING_DB_PREFIX`, e.g., `mw_`), **or** exported per-campaign open/click/bounce/unsubscribe CSV files if MySQL port is inaccessible from `cloud-vps`.
3. **Alibaba Cloud DirectMail Read-Only Credentials:** RAM user with read-only DirectMail statistics/track query permissions + region (`ap-southeast-1`, `cn-hangzhou`, etc.).
4. **Domain Hostnames:** Exact `From:` domain(s), MailWizz custom tracking domain (if configured), and DKIM selector(s) if non-default.

---

## 7. Final Decision

**NO-GO** for proceeding to any subscriber cleanup review or mutation planning.

**Conditions required to revisit decision:**
1. Supply the read-only credentials and domain inputs in Section 6.
2. Run initial read-only sync, compatibility verification against the live MailWizz 3.0.5 endpoint, Priority C/API engagement coverage reconciliation, DirectMail telemetry import, and DNS checks.
3. Produce verified subscriber-level classification counts and confirm no tracking blind spots mask genuine engagement before reviewing any inactive candidates.
