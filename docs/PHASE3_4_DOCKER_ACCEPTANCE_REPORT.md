# Phase 3.4 — Docker Runtime Validation & Final Pre-Integration Acceptance Report

- **Branch:** `validation/phase-3.4-docker-acceptance` (created from `validation/phase-3.3-isolated-deployment` at `2d78db2`)
- **Decision:** **CONDITIONAL GO**
  - **CONDITIONAL GO** to transfer/deploy to an authorized isolated Linux Docker host, execute `./scripts/docker-smoke.sh`, and (once explicitly authorized) proceed into **Phase 3.5 Read-Only Live Integration** (`ENABLE_MAILWIZZ_MUTATIONS="false"`) per [`docs/PHASE3_5_LIVE_INTEGRATION_RUNBOOK.md`](./PHASE3_5_LIVE_INTEGRATION_RUNBOOK.md).
  - **NO-GO** for live MailWizz mutations or unattended production cutover until Docker runtime smoke checks, container backup/restore, and live MailWizz 3.0.5 read-only capability verification pass on the target Docker host.

---

## 1. Docker Environment Used

- **Host Inspection Result (Windows Host):**
  - `Get-Command docker, docker-compose, podman` returned no installed container runtimes.
  - `$env:DOCKER_HOST` is unset.
  - `wsl --list --quiet` reported no configured WSL Linux distributions.
- **Constraint Compliance:** In accordance with Phase 3.4 rules, Docker Desktop, WSL distributions, and host system packages were **not** installed, and no existing staging/production stacks were probed or modified.
- **Honest Status:** Live Docker daemon execution (`docker compose build`, `docker compose up`, `scripts/docker-smoke.sh`, container `pg_dump`/`pg_restore`) remains **BLOCKED** pending execution on an authorized Linux Docker host. No Docker container runtime pass is claimed here.

---

## 2. Actual Image Build & Compose Configuration Results

- **Docker Image Builds:** Not executed (blocked by missing Docker Engine).
- **Local Production Next.js Standalone Build (`npm run build`):** **PASSED** after final edits (`next build`, Turbopack compile 5.5s, TypeScript 10.6s, `26/26` static pages, `.next/standalone/server.js` generated cleanly).
- **Audited Docker Configuration (`Dockerfile`, `Dockerfile.worker`, `docker-compose.yml`, `.dockerignore`, `scripts/docker-smoke.sh`):**
  - `docker-compose.yml` isolates host port exposure strictly to `${APP_BIND_HOST:-127.0.0.1}:${APP_PORT:-3000}:3000` (`postgres` and `worker` expose zero host ports), mounts persistent `postgres_data` and `backups_data:/app/backups`, enforces `NODE_ENV: "production"` and `ENABLE_MAILWIZZ_MUTATIONS: "${ENABLE_MAILWIZZ_MUTATIONS:-false}"`, sets memory limits (`postgres: 512m`, `web: 768m`, `worker: 512m`), and sequences `postgres` health -> `migrate` (`restart: "no"`) -> `web` + `worker` (`restart: unless-stopped`, `init: true`).
  - `scripts/docker-smoke.sh` uses an isolated project (`mw-hygiene-p33-isolated`) and contains **no** `docker compose down -v`, volume removal, or broad Docker pruning commands.

---

## 3. Container & Service Health Results

- **Docker Container Healthchecks:** Not executed (blocked by missing Docker Engine).
- **Local Runtime Health & Startup Smoke Tests (PostgreSQL 16 `localhost:5432`, after final edits):**
  - `npx prisma migrate status`: **4 migrations** present and schema up to date (`20261114164734_init`, `20261114170053_phase2_hygiene_engine`, `20261114171713_phase3_deliverability_diagnostics`, `20261114190323_mailwizz_multi_version_compat`).
  - Direct Worker Startup (`node ./node_modules/tsx/dist/cli.mjs worker/index.ts`): Stayed running cleanly (`alive=True` at 3s), logged structured JSON `{"msg":"Background worker started","meta":{"pollIntervalMs":3000}}`, and produced empty `stderr`.
  - Interrupted Worker Recovery (`recoverStaleJobs()`): Verified in [`tests/integration/phase34-acceptance.test.ts`](../tests/integration/phase34-acceptance.test.ts) — stale `RUNNING` jobs with expired heartbeats transition back to `PENDING` with lock released (`lockedBy: null`).
  - Application Health & Full Browser Flows (`npm run test:e2e`): Verified against compiled standalone-mode Next.js app + PostgreSQL (`GET /api/health`, `/login`, `/`, `/settings`, `/cleanup`, `/reengagement`, `/deliverability`).

---

## 4. Security Findings (Dependencies, Images, Privileges, Secrets & Permissions)

### 4.1 Dependency Advisory Audit Across All Container Graphs
- **`npm audit --omit=dev --json`:** `high: 3`, `total: 3` (`prisma@6.19.3` -> `@prisma/config@6.19.3` -> `deepmerge-ts@7.1.5` [`GHSA-ggr8-5vv4-36mx`]).
- **Full dependency graph (`npm audit --json`):** `moderate: 7` (dev-only ESLint / `@typescript-eslint` `minimatch` chain), `high: 3`, `total: 10`.
- **Container-by-Container Runtime Exposure:**
  - **`web` (`Dockerfile`):** Copies only `.next/standalone`. Verified `.next/standalone/node_modules/deepmerge-ts`, `.next/standalone/node_modules/@prisma/config`, and `.next/standalone/node_modules/prisma` are all **`False`** (absent from runtime image). **Zero runtime exposure.**
  - **`migrate` (`Dockerfile.worker`):** Copies full `npm ci` `node_modules` (containing `@prisma/config` and `deepmerge-ts`) to run one-shot `npx prisma migrate deploy` over trusted local `prisma/schema.prisma` + `prisma/migrations/`. Untrusted user/API input never reaches `@prisma/config`.
  - **`worker` (`Dockerfile.worker`):** Copies full `npm ci` `node_modules`, so `deepmerge-ts@7.1.5` exists on disk inside the image layer, **not imported** by `worker/` or `src/`. Upgrading `prisma` to `7.10.1` (`isSemVerMajor: true`) remains intentionally deferred until tested against a live Docker build pipeline.

### 4.2 Container Privileges, Secrets & File Permissions
- Both `Dockerfile` and `Dockerfile.worker` run as non-root `USER appuser` (`appgroup`).
- `.dockerignore` excludes `.git/`, `.env`, `.env.*` (keeping `.env.example`), `node_modules/`, `.next/`, `backups/`, and logs.
- Local `.env` inspected safely: `ENABLE_MAILWIZZ_MUTATIONS="false"`, and all live MailWizz (`MAILWIZZ_API_URL`, `MAILWIZZ_API_KEY`, `MAILWIZZ_REPORTING_DB_URL`, `MAILWIZZ_WEBHOOK_SECRET`) values remain empty/unconfigured.
- Hardened [`scripts/backup-postgres.sh`](../scripts/backup-postgres.sh) with `umask 077` so generated PostgreSQL `.dump` and `.sha256` files are readable only by owner (`0600`).

---

## 5. Mutation Safety Hardening & Verification

Audited and remediated a **critical fail-closed gap** discovered during Phase 3.4 testing:
1. **`AVAILABLE_BUT_UNTESTED` Blocked (`src/services/mutations/gate.ts`):**
   - `assertOperationCapabilitiesInReport()` previously rejected only `UNSUPPORTED`, `UNKNOWN`, and `BLOCKED`. It now rejects **any capability whose status is not strictly `'VERIFIED'`** for both `requiredVerifiedReads` and `requiredVerifiedWrites`.
2. **Global Lock & Connected Verified Report Required by Default (`src/services/mutations/gate.ts`):**
   - `assertCompatibilityPermitsRemoteMutations()` now re-checks `isMailWizzMutationsEnabled()` globally at entry (throwing `MutationGateLockedError`) and defaults `requireConnectedReport` to `true`, blocking remote mutations fail-closed whenever no active `CONNECTED` report exists or after compatibility reset (previously falling through `if (detectedOrConfigured)` and silently resolving).
3. **Cache Invalidation on Settings Changes (`src/app/api/settings/route.ts`, `src/services/mailwizz/capability-registry.ts`):**
   - Updating MailWizz URL, key, or auth mode now calls `invalidateCachedCompatibility()` (`MAILWIZZ_COMPATIBILITY_RESET`), clearing prior compatibility approvals, reports, and verified write capabilities.
4. **Authorized Disposable Write Verification (`src/services/mailwizz/capability-registry.ts`, `src/services/mailwizz/compatibility-validator.ts`, `src/app/api/compatibility/route.ts`):**
   - Write capabilities (`subscriber_unsubscribe`, `subscriber_copying`, `list_creation`, `segment_creation`) remain `BLOCKED` or `AVAILABLE_BUT_UNTESTED` until explicitly recorded via `VERIFY_WRITE_CAPABILITY` (`recordDisposableWriteVerification`) against a non-demo disposable test list with `ENABLE_MAILWIZZ_MUTATIONS=true`. Synthetic `demo-*` / `isDemoData: true` lists are rejected.
5. **Pre-Change Snapshot & Confirmation Metadata Check (`src/services/cleanup/executor.ts`):**
   - `executeCleanupOperation()` now verifies `confirmedByEmail`, `confirmedAt`, `confirmedListName`, and validates SHA-256 of decrypted `snapshotEnc` against `snapshotSha256` before mutating any record.
6. **Additional Verified Protections (`tests/integration/phase34-acceptance.test.ts`):**
   - Missing/incomplete engagement history (`INSUFFICIENT_DATA`, `historyCoverage: 'NONE'`) is blocked from automatic `UNSUBSCRIBE`.
   - Unknown future MailWizz version (`4.2.0`) falls back fail-closed to `RESTRICTED_SAFE_MODE` with `mutationSafetyAllowed: false`.

---

## 6. Test Execution Results (Post-Final Edit)

| Check / Suite | Command | Status | Observed Output / Scope |
| --- | --- | --- | --- |
| TypeScript | `npm run typecheck` | **PASSED** | `tsc --noEmit` exited `0` |
| ESLint | `npm run lint` | **PASSED** | `eslint .` exited `0` |
| Unit / Contract / Integration | `npm test` | **PASSED** | **15 test files passed, 77 tests passed** (`0` failed, `0` skipped, duration `32.29s`) |
| Production Next.js Build | `npm run build` | **PASSED** | Turbopack compile `5.5s`, TypeScript `10.6s`, `26/26` static pages |
| Browser E2E | `npm run test:e2e` | **PASSED** | **2/2 Playwright specs passed** (`remediation-security.spec.ts`, `dashboard.spec.ts`, `13.9s`) |
| Migrations | `npx prisma migrate status` | **PASSED** | `4 migrations found in prisma/migrations`, `Database schema is up to date!` |
| Worker Smoke | `worker/index.ts` (3s local run) | **PASSED** | Process alive (`alive=True`), connected to PostgreSQL, empty `stderr` |
| Docker Builds / Runtime Smoke | `docker compose build` / `scripts/docker-smoke.sh` | **NOT EXECUTED** | Blocked — no Docker Engine / WSL on Windows host |
| Docker `pg_dump` / `pg_restore` | `scripts/backup-postgres.sh` / `restore-postgres.sh` | **NOT EXECUTED** | Blocked — requires running `postgres` Docker service; `umask 077` verified by code inspection |

---

## 7. Backup & Restore Verification

- **Application Encrypted Backup/Restore (`src/services/security/backup.ts`):** Verified end-to-end in `tests/integration/phase3-deliverability-and-backup.test.ts` (`exportEncryptedAppBackup` -> tamper rejection -> clean `restoreEncryptedAppBackup`).
- **PostgreSQL Container Dump/Restore Scripts:** [`scripts/backup-postgres.sh`](../scripts/backup-postgres.sh) hardened with `umask 077` alongside SHA-256 verification and non-destructive `docker compose exec -T postgres pg_dump`. Live execution inside Docker remains to be run during isolated Linux host cutover.

---

## 8. Remaining Blockers

1. **Docker Daemon Execution on Target Linux Host:** `docker compose config`, image builds (`web`, `worker`, `migrate`), `scripts/docker-smoke.sh`, restart recovery, and container `pg_dump`/`pg_restore` must be run on the isolated Linux Docker host before live use.
2. **Prisma Major Upgrade (`@prisma/config` / `deepmerge-ts`):** Present only in CLI/worker dev-inclusive `node_modules` (unused by `src/` or `worker/` runtime); deferred until validated inside Docker CI/staging.
3. **Authorized Live MailWizz 3.0.5 Connectivity & History Source:** Real HTTPS API credentials and Priority B exports / Priority C `SELECT`-only MySQL reporting DB remain unconfigured until explicit operator authorization.

---

## 9. Deployment Readiness

- **Application Code, Schema, Worker & Security Gates:** Ready for isolated Docker staging validation.
- **Demo Data Isolation:** Verified intact (`NODE_ENV=production` enforced in Compose blocks `SEED_DEMO_DATA`, and zero real credentials exist in source control or `.env`).

---

## 10. Exact Phase 3.5 Integration Requirements

Execute strictly per [`docs/PHASE3_5_LIVE_INTEGRATION_RUNBOOK.md`](./PHASE3_5_LIVE_INTEGRATION_RUNBOOK.md):
1. Deploy on an isolated Linux Docker host with `ENABLE_MAILWIZZ_MUTATIONS="false"` and run `sh ./scripts/docker-smoke.sh` plus `./scripts/backup-postgres.sh`.
2. Obtain explicit operator authorization before entering live MailWizz 3.0.5 API and Priority C MySQL read-only credentials in `/settings`.
3. Validate connection, run read-only `/compatibility` check, run read-only sync, hydrate Priority B/C historical engagement, import Alibaba DirectMail delivery CSVs on `/deliverability`, and reconcile all list/subscriber counts (`isDemoData = false`).
4. Keep remote mutations locked (`ENABLE_MAILWIZZ_MUTATIONS="false"`) until a dedicated **non-demo disposable list** explicitly verifies per-operation write capabilities under operator sign-off.
