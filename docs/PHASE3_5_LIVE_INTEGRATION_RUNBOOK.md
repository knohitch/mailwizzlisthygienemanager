# Phase 3.5 — Read-Only Live Integration Runbook (MailWizz 3.0.5 & Alibaba DirectMail)

> **STRICT AUTHORIZATION & SAFETY RULE:**
> Do **not** execute any step against a live MailWizz 3.0.5 instance, MailWizz MySQL database, or Alibaba DirectMail account without explicit operator authorization.
> Throughout Phase 3.5 initial live integration, **`ENABLE_MAILWIZZ_MUTATIONS="false"` MUST remain set**. No remote subscriber unsubscribe, suppression, list creation, segment creation, copy, or move operation may be unlocked or executed during read-only onboarding.

---

## 1. Pre-Flight Checklist & Isolated Host Prerequisites

Before entering any live credentials:
1. Run on the **isolated Linux Docker host** (never the MailWizz production web/SMTP server):
   ```sh
   chmod 600 .env
   sh ./scripts/docker-smoke.sh
   ```
2. Confirm `/api/health` returns:
   - `"status": "ok"`
   - `"database": "connected"`
   - `"worker": "healthy"`
   - `"mailwizzMutationsEnabled": false`
3. Confirm demo data isolation:
   - Verify no synthetic 2,190-subscriber fixture exists (`GET /api/overview` or click **Clear Demo Data** in `/settings` if upgrading from a local dev dump).
   - Ensure `NODE_ENV="production"` (enforced automatically by `docker-compose.yml`) so `SEED_DEMO_DATA` returns HTTP `403`.
4. Take a baseline pre-integration PostgreSQL dump + checksum:
   ```sh
   ./scripts/backup-postgres.sh
   ```

---

## 2. Secure Credential Configuration

### 2.1 MailWizz 3.0.5 REST API Credentials
1. Log into the isolated MailWizz List Hygiene Manager web UI over HTTPS + VPN/office IP allowlist (`ALLOWED_ADMIN_IPS` / `ALLOWED_ADMIN_CIDRS`).
2. Create a **dedicated API user/key** in MailWizz 3.0.5 (or scoped customer API credentials) for the target customer/lists.
3. Open **Settings & Sources** (`/settings`):
   - **MailWizz API URL:** Use `https://<mailwizz-host>/api/index.php` (`ALLOW_INSECURE_MAILWIZZ_HTTP` remains `false` in production; internal SSRF targets and loopback/metadata IPs are rejected automatically).
   - **MailWizz API Key / Auth Mode:** Provide the API key (`public:private` if using HMAC signature auth, or API key). Keep **Auth Mode = `auto`** unless your server strictly requires `x-api-key` or `signature`.
   - Save settings (`POST /api/settings`) — secrets are encrypted at rest with `APP_ENCRYPTION_KEY` (AES-256-GCM) and never echoed back by `GET /api/settings`, logs, or `/api/compatibility`. Any change to MailWizz URL/key/auth mode automatically emits `MAILWIZZ_COMPATIBILITY_RESET`, clearing stale compatibility caches.

### 2.2 Priority C: Read-Only MailWizz Reporting DB (Optional / Recommended for Historical Opens & Clicks)
Because stock MailWizz 3.0.5 REST APIs do not expose full per-subscriber historical open/click logs:
1. Create a **dedicated `SELECT`-only MySQL user** restricted to the Hygiene Manager host IP with privileges **only** on MailWizz reporting tables (`mw_campaign`, `mw_campaign_delivery_log`, `mw_campaign_track_open`, `mw_campaign_track_url`, `mw_url`, `mw_campaign_bounce_log`, `mw_list_subscriber`, `mw_list`).
2. Configure `MAILWIZZ_REPORTING_DB_URL` or enter the read-only MySQL DSN in **Settings & Sources** (`/settings`). The Hygiene Manager enforces read-only connection checks and rejects write statements.

### 2.3 Alibaba Cloud DirectMail Credentials / Exports (Isolated from SMTP)
- **Never** grant SMTP submission credentials or modify active MailWizz delivery server SMTP accounts.
- For deliverability reporting on `/deliverability`, configure **only** read-only DirectMail statistics CSV exports or read-only API statistics credentials, keeping DirectMail metrics logically separate from MailWizz engagement classification.

---

## 3. Connection Validation

1. In `/settings`, click **Validate Connection** (`POST /api/settings/validate`).
2. Confirm HTTP `200` and review the returned status:
   - TLS certificate validates cleanly.
   - Read-only `GET /lists?page=1&per_page=10` authenticates without `401`/`403` and passes SSRF DNS checks.
   - Observed server headers/metadata confirm `3.0.5` (or another `3.0.x` patch release).
3. If an unexpected version (e.g., `4.x`) or custom endpoint header appears, the adapter immediately falls back to `RESTRICTED_SAFE_MODE` (`mutationSafetyAllowed: false`) — stop and inspect before syncing.

---

## 4. Capability Checks (`/compatibility`)

1. Run **Run Compatibility Check** (`POST /api/compatibility` -> `runReadOnlyCompatibilityCheck()`).
2. Confirm the sanitized capability report in `/compatibility` verifies every read-only contract without calling `/tracking` pixel/click endpoints:
   - `list_discovery` (`VERIFIED`)
   - `subscriber_retrieval` (`VERIFIED`)
   - `subscriber_pagination` (`VERIFIED`)
   - `subscriber_status_retrieval` (`VERIFIED`)
   - `campaign_discovery` (`VERIFIED`)
   - `campaign_statistics` (`VERIFIED`)
   - `bounce_reporting` (`VERIFIED` or documented status)
   - `segment_discovery` (`VERIFIED` or `UNSUPPORTED` if segments API absent)
   - `historical_engagement_retrieval` (reflects API endpoints + Priority B CSV exports + Priority C read-only MySQL Reporting DB)
3. Verify **all remote write capabilities** (`subscriber_unsubscribe`, `subscriber_copying`, `list_creation`, `segment_creation`) remain `BLOCKED` (because `ENABLE_MAILWIZZ_MUTATIONS="false"`). Even if approved later, writes stay `AVAILABLE_BUT_UNTESTED` until verified per-operation against an explicit non-demo disposable test list.
4. Export and retain a copy of the sanitized compatibility JSON report for Phase 3.5 sign-off.

---

## 5. List and Subscriber Synchronization (Read-Only)

1. Navigate to `/lists` (or `/settings`) and trigger an initial read-only sync (`POST /api/sync` -> enqueues `FULL_SYNC` or `LIST_SYNC` for the background worker).
2. Monitor progress via `/jobs` (and `docker compose logs -f --tail=100 worker`):
   - Confirm rate limiting respects `MAILWIZZ_API_RATE_LIMIT` without triggering HTTP `429` bursts.
   - Confirm pagination iterates all pages cleanly (`total_pages` / `next_page`) without duplicate or truncated subscriber batches.
   - Inspect status mapping warnings: any non-standard MailWizz subscriber status preserves consent ambiguity instead of being coerced to `CONFIRMED` or `UNSUBSCRIBED`.

---

## 6. Campaign & Historical Engagement Retrieval

1. **Priority A (API):** Campaign metadata, aggregate statistics, and bounce logs sync read-only during `FULL_SYNC`.
2. **Priority B (Exports):** If historical open/click APIs return `404`/`UNSUPPORTED` on 3.0.5, upload verified MailWizz campaign open/click/delivery CSV exports on `/settings` (`csv-sanitized`, `VERIFIED_EXPORT` source, preserves historical `EngagementEvent` rows across future syncs).
3. **Priority C (MySQL Read-Only DB):** Run Reporting DB sync (`REPORTING_DB`) to hydrate per-subscriber `DELIVERED`, `OPEN`, `CLICK`, `HARD_BOUNCE`, and `SOFT_BOUNCE` history without writing to MailWizz.
4. Trigger hygiene classification (`ANALYZE_HYGIENE`) and verify:
   - Subscribers lacking `VERIFIED_FULL` history remain classified `INSUFFICIENT_DATA` (`historyCoverage !== 'VERIFIED_FULL'`).
   - Missing historical engagement never promotes any subscriber into an eligible auto-unsubscribe batch.

---

## 7. Deliverability Reporting (Alibaba DirectMail + DNS + Postmaster)

1. Navigate to `/deliverability`:
   - Run **DNS Check** for sending domain(s): verify live SPF, DKIM selector(s), DMARC policy, and MX records.
   - Import **Alibaba DirectMail** daily CSV delivery report (`requests`, `delivered`, `failed`, `invalid_address`, `complaints`) — confirm CSV formula injection sanitization is active and metrics render independently of subscriber engagement scores.
   - Optionally import manual or OAuth **Google Postmaster** domain reputation/spam-rate stats and log **Seed Inbox Placement** probes (`GMAIL` / `OUTLOOK` / `YAHOO` etc.).

---

## 8. Reconciliation of Subscriber Counts

After sync completes, reconcile counts between MailWizz 3.0.5 and the isolated PostgreSQL database (read-only):
1. Compare per-list totals in MailWizz admin UI vs `/lists`:
   - Total subscribers per `listUid`
   - Confirmed count (`status = 'CONFIRMED'`)
   - Unsubscribed / Unconfirmed / Blacklisted / Moved counts
2. Compare aggregate campaign sent/bounce counts in MailWizz vs `/campaigns` & `/deliverability`.
3. Confirm `SELECT COUNT(*) FROM "Subscriber" WHERE "isDemoData" = true;` equals `0`.
4. Confirm any discrepancy > 0 is investigated (e.g., mid-sync list changes or unknown custom statuses) before closing Phase 3.5 read-only acceptance.

---

## 9. Error Handling, Alerts, & Rollback

### 9.1 Read-Only Error Handling
- **HTTP `401` / `403` / TLS failure:** Sync aborts cleanly, logs redacted audit entry, never modifies MailWizz state.
- **HTTP `429` / `5xx` transient errors:** Exponential backoff retries up to `maxAttempts`; if exhausted, `SyncJob` transitions to `FAILED` with operator-visible message on `/jobs`.
- **Container restart mid-sync:** Worker resumes safely on restart; `recoverStaleJobs()` re-queues interrupted `RUNNING` jobs once heartbeat expires.
- **Schema drift / unrecognized fields:** Zod contract normalization records additive fields and warnings without crashing; renamed required campaign/subscriber fields fail safely instead of writing corrupted zeros.

### 9.2 Rollback Procedures
Because Phase 3.5 is **strictly read-only** (`ENABLE_MAILWIZZ_MUTATIONS="false"`), MailWizz production data is untouched. Local Hygiene Manager rollback steps:
1. Keep `ENABLE_MAILWIZZ_MUTATIONS="false"`.
2. In `/settings`, clear MailWizz / Reporting DB credentials (emits `MAILWIZZ_COMPATIBILITY_RESET`) or stop containers:
   ```sh
   docker compose stop web worker
   ```
3. Restore pre-integration PostgreSQL backup and encrypted application config snapshot:
   ```sh
   ./scripts/restore-postgres.sh ./backups/hygiene_db_<UTC>.dump
   docker compose up -d web worker
   ```
4. Export and verify an encrypted logical app backup (`exportEncryptedAppBackup` / `/api/backup`) after successful reconciliation.

---

## 10. Exit Criteria Before Any Phase 4 Mutation Authorization

Phase 3.5 read-only integration is complete only when:
- [ ] Connected live MailWizz 3.0.5 read-only checks pass (`CONNECTED`, `list_discovery` + `subscriber_retrieval` + `subscriber_pagination` + `subscriber_status_retrieval` + `campaign_discovery` + `campaign_statistics` = `VERIFIED`).
- [ ] Subscriber & list counts reconcile cleanly with zero `isDemoData: true` rows in production DB.
- [ ] Verified historical engagement coverage reaches `VERIFIED_FULL` via Priority B exports or Priority C read-only DB for target cohorts.
- [ ] `ENABLE_MAILWIZZ_MUTATIONS` remains `"false"` until an authorized **disposable test list** validates `subscriber_unsubscribe` (`VERIFY_WRITE_CAPABILITY`) and operator sign-off is explicitly granted.
