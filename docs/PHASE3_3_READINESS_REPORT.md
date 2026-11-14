# Phase 3.3 — Isolated Deployment Validation & Live Integration Readiness Report

- **Branch:** `validation/phase-3.3-isolated-deployment` (created from `feature/phase-3.2-future-compatibility` at `ba87b3f`, which includes `105c05e` + pre-push fix commit `ba87b3f`)
- **Mutation Lock State:** `ENABLE_MAILWIZZ_MUTATIONS="false"` verified in `.env`, `/api/health`, `docker-compose.yml`, and server gate code.

---

## 1. Docker Deployment Verification Results

- **Environment Blocker:** Docker Engine / Docker Desktop and WSL Linux distributions are **not installed** on this Windows host (`docker` binary unavailable in `PATH` and `C:\Program Files\Docker\Docker\resources\bin\docker.exe`, `Get-Service *docker*` empty). Therefore, container image builds (`docker compose build`) and container runtime startup could not execute here.
- **Configuration & Image Audit Findings:**
  - `Dockerfile` uses a multi-stage Next.js `output: 'standalone'` build, excludes `.env` / `.env.*` via `.dockerignore` (keeping `.env.example`), sets non-root `appuser`, binds `/app/backups`, and defines a `HEALTHCHECK` calling `http://127.0.0.1:3000/api/health`.
  - **Hardening Applied in Phase 3.3:**
    - Added persistent `backups_data:/app/backups` volume mount to the `web` service in `docker-compose.yml` so local encrypted backups survive container recreation.
    - Enforced `NODE_ENV: "production"` under `environment:` in both `web` and `worker` services in `docker-compose.yml` so a copied `.env` with `NODE_ENV="development"` cannot downgrade containers to development mode.
    - Updated `Dockerfile.worker` `CMD` from `npx tsx worker/index.ts` to `./node_modules/.bin/tsx worker/index.ts` so non-root `appuser` runs the local binary cleanly without `npx` cache writes.
    - Added `scripts/docker-smoke.sh` using an isolated Compose project name (`mw-hygiene-p33-isolated`) to validate `docker compose config`, image build, `postgres` health, one-shot `migrate`, `web` + `worker` startup, `/api/health`, `"mailwizzMutationsEnabled":false`, and container restart recovery.

### Exact Commands to Run on an Isolated Docker Host

```sh
# 1. Prepare isolated .env (replace secrets; keep ENABLE_MAILWIZZ_MUTATIONS="false")
cp .env.example .env
chmod 600 .env

# 2. Run isolated validation stack & automated smoke checks
sh ./scripts/docker-smoke.sh
```

---

## 2. Application & Worker Health (Local Verification)

- `GET /api/health` (`src/app/api/health/route.ts`) verified HTTP `200`, `status: "ok"`, `database: "connected"`, `worker: "healthy"`, `mailwizzMutationsEnabled: false` against PostgreSQL 16 (`localhost:5432`) and in Vitest + Playwright (`npm run start`).
- `worker/index.ts` direct execution (`node ./node_modules/tsx/dist/cli.mjs worker/index.ts`) verified alive at 3s against PostgreSQL with structured JSON startup log (`Background worker started`), empty stderr, and clean process termination.

---

## 3. Database Migration Results

- `npx prisma migrate status` confirmed all **4 migrations** in `prisma/migrations/` are present and up to date:
  1. `20261114164734_init`
  2. `20261114170053_phase2_hygiene_engine`
  3. `20261114171713_phase3_deliverability_diagnostics`
  4. `20261114190323_mailwizz_multi_version_compat`

---

## 4. Security Advisory Findings (Production Graph)

`npm audit --omit=dev --json` reports **3 high** advisories in one transitive CLI chain (`7` additional `moderate` advisories exist only in dev dependencies via `minimatch` / `@typescript-eslint/*`):

| Package | Advisory | Installed | Runtime Exposure & Mitigation |
| --- | --- | --- | --- |
| `deepmerge-ts` | `GHSA-ggr8-5vv4-36mx` (`<8.0.0`) | `7.1.5` | Transitive dependency of `@prisma/config@6.19.3` -> `prisma@6.19.3` (optional peer of `@prisma/client`). **Zero presence** in Next.js standalone web build (`.next/standalone/node_modules/deepmerge-ts` = `False`) and zero direct imports in `src/`, `worker/`, or `prisma/`. |
| `@prisma/config` | `via deepmerge-ts` | `6.19.3` | Used only by Prisma CLI (`prisma migrate deploy` in one-shot `migrate` container reading trusted local schema/migrations; absent from `.next/standalone/node_modules`). |
| `prisma` | `via @prisma/config` | `6.19.3` | Major upgrade (`prisma@7.10.1`, `isSemVerMajor: true`) deferred intentionally to avoid breaking Prisma 6 schema/runtime semantics without live Docker validation. Untrusted HTTP/CSV/webhook inputs never reach `@prisma/config` or `deepmerge-ts`. |

- **Secrets Verification:** `.dockerignore` excludes `.env`, `.env.*`, `.git/`, `backups/`, and test reports. `Dockerfile` and `Dockerfile.worker` embed zero runtime secrets.

---

## 5. Subscriber Mutation-Lock & Per-Operation Guard Verification

- `ENABLE_MAILWIZZ_MUTATIONS="false"` remains enforced in `.env`, `docker-compose.yml` defaults, `isMailWizzMutationsEnabled()`, `confirmAndEnqueueCleanup()`, `createSegmentForReengagementPlan()`, and `MailWizzMutationClient.requestJson()`.
- **Per-Operation Enforcement Added (`src/services/mutations/gate.ts`, `executor.ts`, `planner.ts`, `reengagement/workflow.ts`):**
  - Version-level approval (`MAILWIZZ_VERSION_APPROVED`) **no longer approves all remote operations uniformly**.
  - `assertCompatibilityPermitsRemoteMutations(operation)` enforces per-operation capability requirements in `OPERATION_CAPABILITY_REQUIREMENTS` (`UNSUBSCRIBE`, `COPY_SUBSCRIBERS`, `CREATE_LIST`, `MOVE_SUBSCRIBERS`, `CREATE_SEGMENT`): e.g., `CREATE_SEGMENT` requires `list_discovery` + `segment_discovery` `VERIFIED` and `segment_creation` available (`!== 'UNSUPPORTED' | 'UNKNOWN' | 'BLOCKED'`); `MOVE_SUBSCRIBERS` requires both `subscriber_copying` and `subscriber_unsubscribe` checks plus verified target membership before source unsubscribe.
  - Synthetic demo rows (`isDemoData: true`) are hard-blocked from remote MailWizz mutation paths even if `ENABLE_MAILWIZZ_MUTATIONS` were ever enabled.

---

## 6. Compatibility Dashboard & Demo Data Isolation Verification

- **Compatibility UI & Governance:** Verified `/compatibility` (`src/components/CompatibilityView.tsx`) renders overall verdict banner, API-detected vs admin-configured vs approved versions, 15-capability matrix, and explicit notice that version approval never unlocks unsupported/blocked/unknown per-operation mutations.
- **Demo Data Isolation:**
  - `prisma/seed.ts` and `POST /api/sync` (`SEED_DEMO_DATA`) block seeding the synthetic 2,190-subscriber fixture (`1800 + 240 + 150`) when `NODE_ENV=production` (unless `ALLOW_DEMO_SEED_IN_PROD=true`), and `seedSyntheticDemoData()` refuses whenever real (`isDemoData: false`) lists, subscribers, or MailWizz API configuration already exist.
  - Neither `server.js`, `worker/index.ts`, nor `docker-compose.yml` automatically invokes seeding.
  - `CLEAR_DEMO_DATA` cleans all 8 synthetic demo models (`isDemoData: true`) without touching `isDemoData: false` records.

---

## 7. Remaining Integration Blockers

1. **Docker Daemon Unavailable Here:** Container image builds and `scripts/docker-smoke.sh` must be executed on the target Linux/Docker host before production cutover.
2. **Live MailWizz 3.0.5 Connectivity Unverified:** External MailWizz credentials are intentionally omitted until explicit authorization; live list/subscriber/campaign/pagination contracts remain pending live read-only check.
3. **Priority B/C Historical Engagement Source Required for Classification:** MailWizz 3.0.5 REST API lacks per-subscriber open/click history; Priority B verified exports or Priority C SELECT-only MySQL Reporting DB must be connected before inactive/never-engaged cohorts leave `INSUFFICIENT_DATA`.

---

## 8. Exact Steps for Authorized Read-Only MailWizz 3.0.5 Connection

1. Ensure `ENABLE_MAILWIZZ_MUTATIONS="false"` in `.env` (verify via `GET /api/health` -> `"mailwizzMutationsEnabled":false`).
2. Ensure real database has no unintended demo rows (run **Clear Demo Data** or start with an empty migrated DB).
3. In **Settings & Sources** (`/settings`), enter the live HTTPS `MAILWIZZ_API_URL`, API key (or `public:private` pair), keep Auth Mode on `auto` unless a specific protocol is required, and optionally configure Priority C `SELECT`-only MySQL Reporting DB credentials.
4. Click **Validate Connection** (`/api/settings/validate`) — authenticates via read-only `GET /lists`, detects server version if exposed, and automatically runs `runReadOnlyCompatibilityCheck()`.
5. Review **Compatibility** (`/compatibility`) to verify:
   - Authentication (`CONNECTED`),
   - List metadata (`list_discovery`),
   - Subscriber retrieval, pagination, and status mapping (`subscriber_retrieval`, `subscriber_pagination`, `subscriber_status_retrieval`),
   - Campaign discovery, stats, bounces, and engagement-history availability (`campaign_discovery`, `campaign_statistics`, `bounce_reporting`, `historical_engagement_retrieval`),
   - Per-operation matrix and sanitized compatibility summary without modifying any MailWizz subscribers, lists, campaigns, or delivery settings.
6. Enqueue a read-only **Full Sync** (`POST /api/sync` -> `FULL_SYNC`) and confirm reconciliation status (`MATCHED`) before evaluating reports.
