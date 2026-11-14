# Phase 3.1 — Security Remediation, Independent Verification & Release Gate Report

**Date:** 2026-11-14  
**Repository:** MailWizz List Hygiene Manager (`mailwizz-list-hygiene-manager@1.0.0`)  
**Git Branch:** `remediation/phase-3.1-security-verification` (branched from baseline commit `5672256`)  
**Release Gate Decision:** **CONDITIONAL GO** *(Read-Only Isolated Self-Hosted Linux Docker Deployment Only — `ENABLE_MAILWIZZ_MUTATIONS="false"`)*

---

## 1. Executive Decision & Preconditions

| Scope | Decision | Rationale |
|---|---|---|
| Isolated Linux Docker deployment (`ENABLE_MAILWIZZ_MUTATIONS="false"`) | **CONDITIONAL GO** | All remediated security boundaries, CSV/SSRF/webhook/CSRF/redaction controls, subscriber-safety pre-mutation guards, and all automated unit/integration/E2E suites pass locally. Blocked only on target Linux Docker host build/smoke test (Docker CLI is not installed on the Windows development host). |
| Enabling live remote mutations (`ENABLE_MAILWIZZ_MUTATIONS="true"`) | **NO-GO until verified** | All MailWizz HTTP and Alibaba Cloud DirectMail verifications were performed against local mocks and public API docs only; live target instance endpoints, auth headers, and webhook signatures have not been tested against the operator's production instances. |

---

## 2. Dependency Security Advisory Audit & Resolutions

### Resolved Advisories (Eliminated from `npm audit` and `npm audit --omit=dev`)

| Package | Advisory / Severity | Pre-Remediation State | Action Taken | Post-Remediation Status |
|---|---|---|---|---|
| `csv-parse` | `GHSA-8cw4-87c7-c6xx` (Moderate) | `< 7.0.2` (production CSV import dependency) | Upgraded to `csv-parse@^7.0.3` (`7.0.3` installed) | **RESOLVED** (absent from `npm audit` & `--omit=dev`) |
| `zod` | `GHSA-mrhx-c7xc-m3w5` (High) | `< 4.6.6` (API & schema validation across app) | Upgraded to `zod@^4.6.7` (`4.6.7` installed); updated `z.record(z.unknown())` → `z.record(z.string(), z.unknown())` in `src/services/mailwizz/types.ts` and `z.lazy` typing in `src/services/analysis/filter-engine.ts` | **RESOLVED** (absent from `npm audit` & `--omit=dev`) |
| `vitest` (`@vitest/mocker`, `tinypool`) | `GHSA-5gmw-xhrv-c9v3`, `GHSA-85c8-ppgw-ccpr` (Critical); `GHSA-82fw-gwwq-j7x9`, `GHSA-qxg6-89mg-rqv8` (Moderate) | Older `vitest` transitive chain (dev-only test runner) | Upgraded to `vitest@^5.1.0` (`5.1.0` installed); added `hookTimeout: 30000` in `vitest.config.ts` and `server.closeAllConnections?.()` in `tests/integration/sync-and-queue.test.ts` | **RESOLVED** (absent from `npm audit`) |

### Documented Remaining Upstream Transitive Advisories

| Package / Path | Advisory & Severity | Installed / Vulnerable Range | Executes in Prod App Runtime? | Technical Reason Kept & Mitigation | Release-Blocking? |
|---|---|---|---|---|---|
| `deepmerge-ts` (`GHSA-ggr8-5vv4-36mx`, High, CWE-674 stack exhaustion on recursive graphs) via `@prisma/config` → `prisma@6.19.3` | `GHSA-ggr8-5vv4-36mx` (High) | `deepmerge-ts < 8.0.0` (appears as 3 linked nodes in `npm audit --omit=dev` because `prisma` CLI sits in dependencies for container migrations) | **No.** Verified `@prisma/client` does not import `deepmerge-ts`; only `@prisma/config` (CLI config loader during local/deploy `prisma migrate`) imports `deepmerge-ts` (`node_modules/@prisma/config/dist/index.js`). It does not process user input or runtime requests. | `npm audit fix` proposes breaking upgrade `prisma@7.10.1` (`8.0.0-rc.33` also flagged by `npm outdated`). Per Phase 3.1 policy, `prisma` and `@prisma/client` remain locked in sync on `6.19.3`. **Mitigation:** Ensure only static `prisma.config`/schema files from the trusted image are read during `prisma migrate deploy`. | **No** (for trusted container deploy; revisit when scheduling planned Prisma 7.x+ major upgrade). |
| `minimatch` (`GHSA-g3hv-75wg-m249`, Moderate, CWE-405 globparts DoS) via `@typescript-eslint/typescript-estree@8.72.2` → `typescript-eslint@8.72.2` | `GHSA-g3hv-75wg-m249` (Moderate) | `>=7.0.0 <11.0.1` (`minimatch@10.2.6` under `@typescript-eslint/typescript-estree`; appears as 7 dev-only linked nodes) | **No.** Absent from `npm audit --omit=dev` (0 moderate runtime advisories). Dev lint-time dependency only (`eslint-config-next@16.4.6` → `typescript-eslint@8.72.2`). | `@typescript-eslint/typescript-estree@8.72.2` specifies `minimatch: "^10.2.2"`; non-forcing `npm audit fix` does not override to `11.0.1` without breaking the caret range. **Mitigation:** Dev/CI lint runs only on trusted repository globs. | **No** (dev-only). |

### Final Key Package Versions (`npm ls`)

- `next`: `16.4.6`
- `react` / `react-dom`: `19.3.1`
- `@prisma/client` & `prisma`: `6.19.3` (kept strictly compatible)
- `csv-parse`: `7.0.3`
- `zod`: `4.6.7`
- `vitest`: `5.1.0`
- `@playwright/test`: `1.65.1`
- `typescript`: `5.9.3`

---

## 3. Security & Subscriber-Safety Remediations Implemented

### A. Subscriber-Safety Enforcement (`src/services/cleanup/`, `src/services/mailwizz/`, `src/services/mutations/`)

1. **Cross-list substitution prevention (`src/services/cleanup/planner.ts`):** Queries matching `explicitSubscriberIds` enforce `mailingListId: input.mailingListId` and fail closed if any supplied subscriber ID belongs to a different list. `CREATE_SEGMENT` across multiple lists is rejected cleanly; `MOVE_SUBSCRIBERS` requires an explicit `targetListUid`.
2. **Incomplete history & missing-open protection (`src/services/analysis/classifier.ts`, `src/services/cleanup/safety.ts`, `src/services/cleanup/executor.ts`):** Missing open tracking or partial open-only history without verified `DELIVERED` events resolves to `INSUFFICIENT_DATA` and is excluded from automated `UNSUBSCRIBE`, `SUPPRESS`, or list-removal actions.
3. **Full live pre-mutation recheck (`src/services/cleanup/executor.ts`):** Immediately before every individual subscriber mutation, `executeCleanupOperation` reloads the live `Subscriber` and all `EngagementEvent` records from PostgreSQL, recomputes `classifySubscriber(...)` + `evaluateActionEligibility(...)`, and skips the subscriber without calling MailWizz if engagement increased, complaints/bounces arrived, or protection flags changed after dry-run preview.
4. **Remote UID & email identity verification (`src/services/cleanup/executor.ts`):** Before mutating MailWizz, `getRemoteSubscriber(rec.mailingListUid, rec.subscriberUid)` checks both `remoteRecord.subscriber_uid === rec.subscriberUid` (when returned) and normalized email match against `rec.email`. *(Also corrected `tests/integration/phase2-cleanup-reengagement.test.ts` mock responder to echo requested UID so 502 reconciliation tests exercise real failure recovery.)*
5. **Atomic state claiming & idempotency (`src/services/cleanup/planner.ts`, `restore.ts`, `executor.ts`):** `confirmAndEnqueueCleanup` and `resumeCleanupOperation` claim operations using conditional `updateMany({ where: { id, status } })` so concurrent confirmations or resumes cannot enqueue duplicate jobs. Re-executing an already `COMPLETED` or `CANCELLED` operation exits cleanly without mutations, and stale `syncJobId` workers exit safely.
6. **Safe `MOVE_SUBSCRIBERS` ordering (`src/services/cleanup/executor.ts`):** Copy into `targetListUid` is verified before calling unsubscribe on the source list; copy failure prevents source unsubscribe.
7. **Dangerous endpoint guardrails (`src/services/mailwizz/client.ts`, `src/services/mutations/mailwizz-writer.ts`):** Permanently blocks read/write requests targeting `/tracking/*` (`/tracking/open`, `/tracking/click`, `/tracking/unsubscribe`, `/tracking/`) and global `unsubscribe-by-email`.

### B. Security Boundary Hardening

1. **Shared CSV formula injection neutralization (`src/services/security/csv.ts`, `export.ts`, `planner.ts`, `reports/generator.ts`):** Unified `sanitizeCsvCell()` prefixes leading `=`, `+`, `-`, `@`, `\t`, `\r` (including after leading whitespace) with `'`, while preserving numeric formatting cleanly.
2. **CSV upload bounds & prototype-pollution prevention (`src/services/mailwizz/report-import.ts`, `src/services/deliverability/alibaba-directmail.ts`):** Enforced maximum byte caps (10 MB report import, 5 MB DirectMail CSV), row limits (100k / 20k via `to_line`), `max_record_size: 65_536`, and `FORBIDDEN_CSV_HEADERS` stripping `__proto__`, `constructor`, and `prototype`.
3. **DNS checker SSRF / private-target protection (`src/services/deliverability/dns-checker.ts`):** Rejects raw IPs (`net.isIP`), URLs/ports/userinfo, single-label hosts, `localhost`, `.local`, `.internal`, `.lan`, `.home`, `.corp`, `.intranet`, and `.arpa`; flags private/loopback/CGNAT/link-local `trackingDomain` A-records as `FAIL`.
4. **Webhook authenticity, replay protection & list scoping (`src/app/api/webhooks/mailwizz/route.ts`):** Added 512 KB body / 500-item batch limits, optional `x-hygiene-webhook-signature` (`sha256=<hmac>`) constant-time verification, 7-day replay window / 5-minute future skew rejection, deterministic `eventId`/`no_ts` dedupe key when `timestamp` is omitted, and strict list/campaign scoping.
5. **Fail-closed production CSRF secret, IP validation & secret redaction (`src/services/security/csrf.ts`, `rate-limit.ts`, `logger.ts`):** Throws in `NODE_ENV=production` if `APP_SESSION_SECRET` is missing or short; validates client IPs via `net.isIP()`; extends structured log redaction (`accesskey`, `credential`, `privatekey`, `private_key`, `encryption`, `signature`, `csrfsecret`, `rawtoken`, `snapshotenc`, `x-mw-signature`).
6. **Container hardening (`.dockerignore`, `Dockerfile`):** Added `.dockerignore` excluding `.env`, `.env.*`, `.git`, `node_modules`, `.next`, `backups`, and test artifacts; ensured `/app/backups` exists and is owned by non-root `appuser:appgroup`.

---

## 4. External API Documentation vs. Verification Scope

| Integration | Official API Basis Checked | Live Instance Tested? | Verification Coverage |
|---|---|---|---|
| **MailWizz 3.0.5 (plus 1.x/2.x compat)** | Official MailWizz REST API documentation (`X-Api-Key` / legacy signature headers, `/api/lists`, `/segments`, `/campaigns`, `/bounces`, and `/api/campaigns/{uid}/tracking/{open,click,unsubscribe}` exclusion). | **No** (no live MailWizz URL or API keys provided/connected). | Verified via unit compat tests (`tests/unit/mailwizz-compat.test.ts`), HTTP client retry/auth tests (`tests/unit/mailwizz-client.test.ts`), local mock MailWizz sync/mutation integration tests (`tests/integration/sync-and-queue.test.ts`, `tests/integration/phase2-cleanup-reengagement.test.ts`, `tests/integration/phase31-safety-and-security.test.ts`). |
| **Alibaba Cloud DirectMail** | Official Alibaba DirectMail `Dm/2015-11-23` RPC read-only operations (`DescAccountSummary`, `SenderStatisticsByTagNameAndBatchID`, `QueryDomainByParam`, `QueryInvalidAddressByParam`). | **No** (no live Alibaba AccessKey configured). | Verified via CSV parser, signature unit tests, prototype/size boundary integration tests, and error-handling tests using mock HTTP fetch (`tests/unit/phase3-deliverability.test.ts`, `tests/integration/phase3-deliverability-and-backup.test.ts`, `tests/integration/phase31-safety-and-security.test.ts`). |

---

## 5. Modified & Added Files on `remediation/phase-3.1-security-verification`

- **Security & Core Hardening:** `.dockerignore`, `Dockerfile`, `src/services/security/csv.ts`, `src/services/security/csrf.ts`, `src/services/security/export.ts`, `src/services/security/logger.ts`, `src/services/security/rate-limit.ts`, `src/app/api/webhooks/mailwizz/route.ts`
- **MailWizz / DirectMail / DNS Hardening:** `src/services/mailwizz/client.ts`, `src/services/mailwizz/types.ts`, `src/services/mailwizz/report-import.ts`, `src/services/mutations/mailwizz-writer.ts`, `src/services/deliverability/alibaba-directmail.ts`, `src/services/deliverability/dns-checker.ts`, `src/services/analysis/filter-engine.ts`, `src/services/reports/generator.ts`
- **Cleanup Safety Hardening:** `src/services/cleanup/planner.ts`, `src/services/cleanup/executor.ts`, `src/services/cleanup/restore.ts`
- **Dependencies & Tests:** `package.json`, `package-lock.json`, `vitest.config.ts`, `tests/integration/sync-and-queue.test.ts`, `tests/integration/phase2-cleanup-reengagement.test.ts`, `tests/integration/phase31-safety-and-security.test.ts` *(new)*, `tests/e2e/remediation-security.spec.ts` *(new)*
- **Documentation:** `docs/PHASE3_1_REMEDIATION_REPORT.md` *(this file)*

---

## 6. Verification Command Results

*(Run after final code/test edits on `remediation/phase-3.1-security-verification` with `ENABLE_MAILWIZZ_MUTATIONS="false"`)*

| Check | Command | Result |
|---|---|---|
| TypeScript check | `npm run typecheck` | **PASS** (exit 0) |
| ESLint check | `npm run lint` | **PASS** (exit 0) |
| Unit + Integration suite | `npm test` (`vitest run`) | **PASS** (11 files, 49 tests passed, 0 failed) |
| Database seed | `npm run db:seed` | **PASS** (3 lists, 2,190 subscribers, 12 campaigns, 11,082 events seeded cleanly) |
| Prisma migrations | `npx prisma migrate status` | **PASS** (4 migrations found; database schema up to date) |
| Next.js production build | `npm run build` | **PASS** (exit 0, Next.js 16.4.6 Turbopack standalone output) |
| Playwright E2E suite | `npm run test:e2e` | **PASS** (2/2 specs passed: `dashboard.spec.ts` & `remediation-security.spec.ts`) |
| Production dependency audit | `npm audit --omit=dev --json` | **3 High** (`deepmerge-ts` via `@prisma/config` → `prisma@6.19.3` CLI only; 0 Critical, 0 Moderate) |
| Full dependency audit | `npm audit --json` | **3 High, 7 Moderate, 0 Critical** (`deepmerge-ts` CLI-only + dev-only `minimatch` via `@typescript-eslint/typescript-estree@8.72.2`) |
| Secret scan | `git grep -nE` across tracked non-test files | **PASS** (0 hardcoded keys/secrets matched) |
| Docker CLI availability (Windows host) | `Get-Command docker` | **NOT INSTALLED** on Windows development host (requires Linux target execution below) |

---

## 7. Mandatory Linux Docker Target Validation Checklist

Because Docker is unavailable on this Windows host, execute the following on the isolated Linux deployment host before declaring production readiness:

```bash
# 1. Configure .env securely on the target host (keep mutations disabled initially)
cp .env.example .env
# Populate strong 32+ char APP_SESSION_SECRET and DATA_ENCRYPTION_KEY, set POSTGRES_PASSWORD,
# and ensure ENABLE_MAILWIZZ_MUTATIONS="false".

# 2. Build production images & start stack
docker compose build --no-cache
docker compose up -d postgres
docker compose run --rm web npx prisma migrate deploy
docker compose up -d

# 3. Verify health, non-root execution, and backup mount writability
curl -fsS http://127.0.0.1:3000/api/health
docker compose exec web id
docker compose exec web ls -ld /app/backups
docker compose logs --tail=50 web worker

# 4. Run smoke PostgreSQL backup & dry verification on target host
./scripts/backup-postgres.sh
```

**Before ever switching `ENABLE_MAILWIZZ_MUTATIONS="true"`:**
1. Validate read-only connectivity against your live MailWizz 3.0.5 instance in Settings (`/settings`) and confirm `GET` list/campaign/subscriber hydration succeeds cleanly.
2. Verify any configured MailWizz webhook delivers signed requests (`x-hygiene-webhook-signature`) and dedupes cleanly without forging opens.
3. Run a small dry-run preview (`SUPPRESS` or `UNSUBSCRIBE`), inspect the generated Dry-Run CSV formula escaping, and verify on a dedicated sandbox/test list first.
