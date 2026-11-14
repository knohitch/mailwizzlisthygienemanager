# Phase 3 Final Handover Report — MailWizz List Hygiene Manager

**Target Stack:** MailWizz **3.0.5** · Alibaba Cloud DirectMail (SMTP / Read-Only OpenAPI `Dm/2015-11-23`) · Next.js 16.4.6 + TypeScript + PostgreSQL + Prisma ORM + Dedicated Worker + Playwright / Vitest

**Safety Gate Status:** `ENABLE_MAILWIZZ_MUTATIONS="false"` (All live MailWizz write/unsubscribe/list-mutation operations remain locked pending explicit administrator sign-off.)

---

## 1. System Architecture Summary

- **Web Console (`src/app`, `src/components`)**: Authenticated single-administrator Next.js App Router UI protected by `scrypt` password hashing, PostgreSQL-backed `HttpOnly` sessions (`AdminSession`), HMAC-SHA256 CSRF validation (`x-csrf-token`), sliding-window rate limits, and optional `ALLOWED_ADMIN_IPS` / `ALLOWED_ADMIN_CIDRS` IP allowlisting (`src/services/security/ip-allowlist.ts`).
- **Database & Durable Queue (`prisma/schema.prisma`, PostgreSQL)**: Stores mailing lists, subscribers, segments, campaigns, provenance-tagged engagement events (`EventSource`), Phase 2 `CleanupOperation` / `CleanupOperationRecord` / `ReengagementPlan`, Phase 3 diagnostics (`DomainAuthCheck`, `DirectMailDailyMetric`, `InboxPlacementTest`, `PostmasterStat`), and `SyncJob` rows claimed atomically via `FOR UPDATE SKIP LOCKED`.
- **Background Worker (`worker/index.ts`)**: Runs independently of the web process to execute long-running syncs, analysis passes, scheduled syncs, retention cleanup, and checkpointed cleanup batches (`cleanup/executor.ts`) without blocking HTTP requests.
- **MailWizz 3.0.5 Connector (`src/services/mailwizz/`)**: Read-only client (`client.ts`) using `X-Api-Key`, TLS enforcement, token-bucket rate limiting, and retries. Tracking endpoints (`track-opening`, `track-url`, `track-unsubscribe`) are unconditionally blocked.
- **Engagement & List Hygiene Engine (`src/services/analysis/`, `src/services/cleanup/`, `src/services/reengagement/`)**: Multi-window (`30d` / `60d` / `90d` / `180d` / `365d` / custom range) mutually exclusive engagement classifier distinguishing confirmed deliveries, opens, clicks, replies, and conversions, refusing to classify contacts lacking subscriber-level delivery evidence (`INSUFFICIENT_DATA`).
- **Deliverability Diagnostics Module (`src/services/deliverability/`, `/deliverability`)**:
  - `dns-checker.ts`: Read-only `node:dns/promises` inspector for SPF, selector-explicit DKIM, DMARC + visible `From` domain alignment, MX records, and MailWizz tracking CNAME/A resolution.
  - `alibaba-directmail.ts`: Strict whitelist client for read-only Alibaba Cloud DirectMail OpenAPI (`Dm/2015-11-23`) plus manual CSV report importer (`ALIBABA_CSV_IMPORT`).
  - `postmaster.ts`: Controlled seed inbox placement recorder (`Gmail`, `Outlook`, `Yahoo`, `Other`) and Google Postmaster Tools REST API v1 (`trafficStats`) + guided manual entry.
  - `metrics.ts`: Source-separated KPI aggregator, campaign/list history, recipient-domain metrics, and projected before/after suppression metrics.

---

## 2. MailWizz Multi-Version Compatibility & API Capabilities

Verified against MailWizz 1.x legacy HMAC, 2.x, 3.0.5, and future 3.x/4.x REST conventions (`src/services/mailwizz/compat.ts`, reflected in [docs/API_CAPABILITY_MATRIX.md](API_CAPABILITY_MATRIX.md)):
- **Multi-Version Authentication (`mailwizzAuthMode`: `auto`, `x-api-key`, `hmac-v1`, `bearer`)**: Supports `X-Api-Key` (2.x/3.x+), legacy `public:private` HMAC-SHA1 `X-MW-*` headers (1.x/2.x), and `Authorization: Bearer` tokens, with auto-detection in `POST /api/settings/validate` and `mailwizzDetectedVersion` persistence.
- **Response & Schema Normalization**: Coerces PHP associative object-arrays (`{"0": ...}`), alternate top-level/nested envelopes (`data.records`, `records`, `items`, `results`), `next_page` pagination with automatic `per_page` step-down retry on HTTP 400/422, field aliases (`uid`/`list_uid`/`subscriber_uid`, `email`/`EMAIL`, `first_name`/`FNAME`, bounce synonyms), and string/percentage coercion.
- **Supported Read-Only REST Endpoints:** `GET /lists`, `GET /lists/{list_uid}`, `GET /lists/{list_uid}/subscribers`, `GET /lists/{list_uid}/segments`, `GET /lists/{list_uid}/segments/{seg_uid}/subscribers`, `GET /campaigns`, `GET /campaigns/{campaign_uid}/stats`, `GET /campaigns/{campaign_uid}/bounces`, plus safe optional probes for future `/campaigns/{uid}/delivery-logs`, `/opens`, `/clicks`, and `/complaints` (ingested as `EventSource.API_ACTIVITY_LOG`).
- **Blocked Unsafe Endpoints:** `track-opening`, `track-url`, `track-unsubscribe`, and `DELETE` remain unconditionally blocked in software across all versions.
- **Mutation Fallback:** `PUT .../unsubscribe` falls back on HTTP 404/405 to `PUT /lists/{list_uid}/subscribers/{sub_uid}` with `status=unsubscribed` (still gated behind `ENABLE_MAILWIZZ_MUTATIONS="true"`).
- **Historical Data Strategies Implemented:**
  - Optional future REST activity logs (`EventSource.API_ACTIVITY_LOG`).
  - Priority B: Verified CSV/JSON report imports (`POST /api/reports/import`, provenance `VERIFIED_EXPORT`).
  - Priority C: Optional `SELECT`-only MySQL/MariaDB reporting DB connector (`reporting-db.ts`, with MySQL 8+ role privilege fallback via `INFORMATION_SCHEMA.USER_PRIVILEGES`, alternate complaint/abuse table names, and multi-column timestamp resolution).
  - Priority D: Forward-only multi-version webhook ingestion (`POST /api/webhooks/mailwizz`, array or object payloads, `isHistorical: false`).

---

## 3. Alibaba Cloud DirectMail Reporting Capabilities & Limitations

Investigated and implemented in `src/services/deliverability/alibaba-directmail.ts`:
- **Supported Documented Read-Only Actions (`Dm/2015-11-23` signed GET RPC):**
  - `DescAccountSummary` (quota level, daily quota, verified domains/addresses count)
  - `QueryDomainByParam` (configured sending domains & verification status)
  - `SenderStatisticsByTagNameAndBatchID` (daily requests, accepted/delivered counts, failures, unavailable counts)
  - `SenderStatisticsDetailByParam` (granular send log status detail)
  - `QueryInvalidAddressByParam` (invalid address bounce totals)
- **Security Hardening:** `signAlibabaRpcRequest` enforces an explicit read-only action whitelist; send/credential actions such as `SingleSendMail`, `BatchSendMail`, `ModifyMailAddress`, `CreateDomain`, `DeleteDomain`, and `UpdateSmtpPassword` throw a security error.
- **Limitations:**
  - Standard DirectMail OpenAPI does **not** return ISP complaint / FBL counts (`complaintCount` stays `null` on `ALIBABA_API` rows).
  - SMTP/OpenAPI delivery acceptance indicates Alibaba/receiving MTA acceptance only — it does **not** prove Primary vs. Promotions vs. Spam folder placement.
  - Manual CSV import (`POST /api/deliverability/alibaba`, action `IMPORT_CSV`) is provided as a clearly labeled fallback (`ALIBABA_CSV_IMPORT`).

---

## 4. Historical Engagement Strategy Implemented

- Separates event provenance cleanly via `EventSource` (`API_BOUNCE_LOG`, `API_ACTIVITY_LOG`, `NATIVE_SEGMENT`, `VERIFIED_EXPORT`, `READONLY_REPORTING_DB`, `WEBHOOK_LIVE`, `SYNTHETIC_DEMO`).
- Never infers individual subscriber delivery from aggregate campaign delivery totals.
- Requires `minDeliveredCampaigns` (default `5`) confirmed subscriber-level deliveries before classifying a subscriber as `INACTIVE`, `LONG_TERM_INACTIVE`, or `NEVER_ENGAGED`; otherwise marks `INSUFFICIENT_DATA` / `UNKNOWN`.
- Distinguishes Strong Engagement (clicks, replies, conversions) from Open-Only Engagement (subject to Apple MPP / proxy prefetches).

---

## 5. List Segmentation, Suppression & Unsubscribe Architecture

- **Smart Filter Engine (`filter-engine.ts`)**: Combines mailing list, engagement status, days since engagement/signup, delivered campaign count, unique opens/clicks, email domain, subscriber status, signup source, confidence, and VIP protection with AND/OR combinators and exact pre-operation match counts.
- **Dry-Run First & Snapshots (`cleanup/planner.ts`)**: Generates pre-change encrypted AES-256-GCM snapshots (`snapshotEnc` + `snapshotSha256`) and detailed dry-run reports before execution.
- **Execution Modes**: Supports local suppression, clean list/segment creation, consent-checked copy, CSV export, and gated unsubscribe batching with checkpoint resume, per-record idempotency keys, pause/cancel/restore, confirmation typing (list name + exact count), large-batch override gate, and auto-stop on high failure rates (`executor.ts`).

---

## 6. Deliverability Diagnostics & Domain Auth Features

- **Route:** `/deliverability` (`src/app/deliverability/page.tsx`, `src/components/DeliverabilityView.tsx`)
- **API Endpoints:** `GET /api/deliverability`, `POST /api/deliverability/dns`, `POST /api/deliverability/alibaba`, `POST /api/deliverability/seed-tests`, `GET /api/health`
- **Features:**
  - Source-separated pipeline banner distinguishing MailWizz processed -> DirectMail SMTP acceptance -> receiving server delivery -> controlled seed inbox placement.
  - Selectable date ranges (`30d`, `60d`, `90d`, `180d`, `365d`, `ALL`, custom dates).
  - Visual charts & tables: Sending volume vs. open rate & click rate, bounce & complaint rate trends, engagement by mailing list, engagement by recipient domain, before/after list cleaning projection, historical campaign table, and historical list performance table.
  - Read-only DNS diagnostics refusing to guess unknown DKIM selectors (`UNKNOWN` if omitted) and checking DMARC alignment with visible `From` domain.
  - Controlled seed mailbox logging (`Gmail`, `Outlook`, `Yahoo`, `Other`) and Google Postmaster API v1 / manual observation tracking.

---

## 7. Security Controls Implemented

- `scrypt` salted password verification, `HttpOnly` SameSite session cookies backed by PostgreSQL (`AdminSession`), 12-hour TTL.
- Per-session HMAC CSRF tokens required on mutating endpoints.
- IP/CIDR allowlist enforcement via `ALLOWED_ADMIN_IPS` and `ALLOWED_ADMIN_CIDRS` (`src/services/security/ip-allowlist.ts`, enforced in `requireApiAuth` and `/api/auth/login`).
- AES-256-GCM encryption at rest (`crypto.ts`) for stored MailWizz API keys, reporting DB URIs, webhook secrets, Alibaba RAM credentials, Google Postmaster OAuth tokens, and encrypted export/backup envelopes.
- Automatic secret/PII redaction in structured logger (`logger.ts`).
- Application backup/restore service (`src/services/security/backup.ts`) with SHA-256 checksum verification and AES-256-GCM encryption.
- Docker hardening: non-root `appuser`, `init: true`, memory limits (`768m` web / `512m` worker / `512m` postgres), container `healthcheck`s, and localhost-only default bind (`127.0.0.1:3000`) for reverse-proxy TLS termination.

---

## 8. Verification Results (Latest Post-Edit Run)

Executed after all Phase 3 & MailWizz multi-version compatibility edits completed:

| Check | Command | Outcome & Exact Scope |
| --- | --- | --- |
| **TypeScript Typecheck** | `npm run typecheck` | **PASSED** (`TSC=0`, zero errors) |
| **ESLint** | `npm run lint` | **PASSED** (`LINT=0`, zero errors, zero warnings) |
| **Unit & Integration Suite** | `npm test` (`vitest run`) | **PASSED** (**10 test files passed, 46 tests passed, 0 failed**; includes multi-version MailWizz 1.x HMAC/2.x/3.x/future compat unit tests, mocked MailWizz API, Alibaba DirectMail API/guardrails, DNS diagnostics with mock resolver, Postmaster API mocks, IP allowlist, auth/CSRF rejection, Phase 2 execution/auto-stop/restore, and Phase 3 encrypted backup/restore integration) |
| **Demo Seed Fixtures** | `npm run db:seed` | **PASSED** (`listsCreated: 3`, `subscribersCreated: 2190`, `campaignsCreated: 12`, `eventsCreated: 11082`, plus synthetic Phase 3 DirectMail/Seed/Postmaster demo fixtures) |
| **Production Build** | `npm run build` (`next build`) | **PASSED** (`BUILD=0`, Next.js 16.4.6 compiled all 33 routes including `/deliverability` and Phase 3 APIs cleanly) |
| **End-to-End Browser Suite** | `npm run test:e2e` (`playwright test`) | **PASSED** (**1 passed (9.1s)**; full Chromium flow covering `/login`, `/` dashboard, Phase 1 mutation gate block `HTTP 403`, 1,800-subscriber list search, `/settings`, `/cleanup` dry-run preview, `/reengagement`, `/reports`, `/deliverability` date switch + seed placement form + persistence verification) |
| **Dependency Security Audit** | `npm audit --omit=dev` | **5 advisories reported (`EXIT=1`)**: `csv-parse <7.0.2` (moderate, fix requires major upgrade `7.0.3`), `deepmerge-ts <8.0.0` via `@prisma/config` / `prisma` (high, fix requires breaking `prisma@7.10.1`), `zod <4.6.6` (high, fix requires major `zod@4.6.7`). No non-breaking automated fix available without breaking framework upgrades; documented for scheduled dependency maintenance window. |
| **Docker Image Builds** | `docker --version` / `docker build` | **NOT RUN (Blocked by Host Environment)**: `docker` CLI/Engine is not installed on the local Windows build host (`The term 'docker' is not recognized`). `Dockerfile`, `Dockerfile.worker`, and `docker-compose.yml` were inspected and updated (`mkdir -p /app/public`, `init: true`, healthchecks, memory limits, `127.0.0.1` bind default), and require build verification on the target Linux/Docker host. |

---

## 9. Deployment Instructions Summary

Complete deployment, reverse-proxy TLS (Nginx/Caddy), VPN/IP allowlisting, worker supervision, and backup/restore instructions are documented in [docs/DEPLOYMENT_AND_OPERATING_MANUAL.md](DEPLOYMENT_AND_OPERATING_MANUAL.md), paired with `scripts/backup-postgres.sh` and `scripts/restore-postgres.sh`.

Summary startup sequence on the isolated target Linux server:
1. `cp .env.example .env` and populate strong random secrets (`APP_SESSION_SECRET`, `APP_ENCRYPTION_KEY`, `POSTGRES_PASSWORD`, `ADMIN_PASSWORD_HASH`), set `COOKIE_SECURE="true"`, set `ALLOWED_ADMIN_CIDRS`, and keep `ENABLE_MAILWIZZ_MUTATIONS="false"`.
2. Build and launch stack: `docker compose up -d --build`.
3. Verify health endpoint: `curl -fsS http://127.0.0.1:3000/api/health`.

---

## 10. Known Gaps & Limitations (Pending Live Credentials / Docker Host)

1. **Live External Systems (`NOT_YET_TESTED`)**: No live MailWizz 3.0.5 API key, MailWizz MySQL Read-Only Reporting DB credentials, Alibaba Cloud DirectMail RAM credentials, or Google Postmaster OAuth token were provided during offline development; these integrations were tested against deterministic mocks and synthetic data.
2. **Docker Runtime Build**: Needs `docker compose build` execution on a machine with Docker Engine installed to confirm Alpine container builds end-to-end.
3. **Production Major Dependency Upgrades**: `npm audit --omit=dev` flags advisories in `prisma` transitive `deepmerge-ts`, `zod`, and `csv-parse` whose upstream fixes require major-version migrations (`prisma@7`, `zod@4`, `csv-parse@7`).
4. **Live Mutation Execution Locked**: All live writes to MailWizz subscribers/lists remain blocked until you manually review dry-run outputs and flip `ENABLE_MAILWIZZ_MUTATIONS="true"`.

---

## 11. Recommended Next Steps (Waiting for Your Approval)

1. **Deploy Read-Only on Isolated Host:** Deploy on an isolated VM using [docs/DEPLOYMENT_AND_OPERATING_MANUAL.md](DEPLOYMENT_AND_OPERATING_MANUAL.md), keeping `ENABLE_MAILWIZZ_MUTATIONS="false"`.
2. **Connect & Validate Read-Only Data Sources:** Enter your MailWizz 3.0.5 API URL/Key (plus optional `SELECT`-only MySQL reporting DB or verified CSV exports), Alibaba DirectMail RAM read-only key, and check your actual sending domains on `/deliverability`.
3. **Audit Dry-Run Cohorts:** Review `/`, `/cleanup`, `/reengagement`, and `/deliverability` against your real ~1,800-subscriber list and inspect generated Dry-Run snapshots.
4. **Explicit Sign-Off for Live Mutations:** Reply with explicit confirmation when you are ready to enable `ENABLE_MAILWIZZ_MUTATIONS="true"` for controlled batch segmentation/suppression/unsubscribes.
