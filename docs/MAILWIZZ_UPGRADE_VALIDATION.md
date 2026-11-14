# MailWizz Upgrade Validation Runbook

Follow this runbook before and after upgrading the connected MailWizz server from `3.0.5` to a patch (`3.0.x`), minor (`3.1+`), or major (`4.x+`) release.

## Step 1 — Pre-Upgrade Lock & Backup

1. Ensure `.env` has:
   ```env
   ENABLE_MAILWIZZ_MUTATIONS="false"
   ```
2. Trigger a local PostgreSQL backup or export (`GET /api/reports/hygiene?format=json` & `GET /api/exports/subscribers`) so historical engagement records and consent snapshots remain preserved locally.
3. Never rely on MailWizz core database edits — MailWizz List Hygiene Manager stores its own `EngagementEvent`, `HygieneEvaluation`, and `AuditLog` history independently.

## Step 2 — Perform MailWizz Upgrade & Run Non-Mutating Check

1. Upgrade your staging or production MailWizz instance separately.
2. Sign in to MailWizz List Hygiene Manager and navigate to **`/compatibility`** (in the top navigation bar).
3. If your upgraded MailWizz server does not return an API version header/metadata field:
   - Enter the upgraded version (for example `3.1.2`) under **Administrator-Supplied MailWizz Version**.
   - Click **Save Configured Version (UNVERIFIED)** — notice the UI explicitly labels it `UNVERIFIED` until confirmed by an API signal or contract pass.
4. Click **Run Compatibility Check** (`POST /api/compatibility` with `action: RUN_CHECK`).
   - This runs **strictly read-only `GET` requests** and validates structural contracts, pagination invariants, subscriber status mapping, segment operators, campaign stats, bounce records, and historical engagement isolation.
   - No subscribers are unsubscribed, copied, suppressed, or emailed.

## Step 3 — Interpret the Compatibility Verdict

- **`FULLY VERIFIED`**:
  - Core and reporting contracts passed. For `3.0.5` or approved `3.0.x`, mutations remain controlled solely by `ENABLE_MAILWIZZ_MUTATIONS`.
  - For a `3.1+` minor upgrade, review **Breaking-Update Warnings** and click **Approve Verified Version** only after inspecting the capability table.
- **`PARTIALLY COMPATIBLE`**:
  - Core read-only sync (`list_discovery`, `subscriber_retrieval`, `subscriber_pagination`, `subscriber_status_retrieval`) passed, while optional/secondary endpoints (e.g., `/campaigns`, `/segments`) returned `404` or drift errors.
  - Read-only analytics and clean-list CSV exports continue working safely.
  - Keep remote mutations disabled (`ENABLE_MAILWIZZ_MUTATIONS="false"`) until any broken segment/unsubscribe contracts are remediated.
- **`UNVERIFIED`**:
  - Check was not run yet or MailWizz credentials are not configured. Run Compatibility Check before enabling any cleanup job.
- **`INCOMPATIBLE`**:
  - Auth failed (`401`/`403`), host is unreachable, core subscriber/list schema broke, or an unimplemented **`4.x+` Major Version** (`RESTRICTED_SAFE_MODE`) was detected.
  - Remote mutations remain blocked fail-closed even if `ENABLE_MAILWIZZ_MUTATIONS="true"`.
  - **Action Required:** Inspect the contract errors on `/compatibility`, capture sample sanitized API responses, implement a versioned adapter (e.g., `MailWizzV4Adapter`) + contract tests in `tests/contract/`, and re-verify before approving mutations.

## Step 4 — Automated Verification Checklist (Engineering)

Before shipping any adapter update after a MailWizz release:

```bash
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run build
```

All existing `3.0.5` baseline tests, all 15 contract drift tests (`tests/contract/mailwizz-contracts.test.ts`), and DB integration tests (`tests/integration/phase32-compatibility.test.ts`) must pass with zero skipped assertions.
