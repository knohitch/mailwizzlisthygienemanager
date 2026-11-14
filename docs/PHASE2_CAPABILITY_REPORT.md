# MailWizz List Hygiene Manager — Phase 2 Technical & Readiness Report

**Target MailWizz Version:** 3.0.5  
**Default Mode:** Safe Read-Only (`ENABLE_MAILWIZZ_MUTATIONS="false"`, Dry-Run First)  

---

## 1. Fully Implemented Functionality

- **Engagement Classification Engine (`src/services/analysis/classifier.ts`)**
  - Configurable windows: **30, 60, 90, 180, 365 days**, plus **custom date ranges** (`customRangeStart` / `customRangeEnd`), cooling windows (`coolingDays`), and long-term dormancy thresholds (`longTermInactiveDays`).
  - Mutually exclusive primary classifications:
    - `ACTIVE` (recent verified click/reply/conversion, or open when `countOpensAsEngaged=true`, tagged with Apple MPP caveat when open-only)
    - `COOLING` (verified engagement declining inside cooling window before inactivity cutoff)
    - `INACTIVE` (past configured inactivity cutoff with verified delivery evidence)
    - `LONG_TERM_INACTIVE` (`>= 180` days since last engagement with verified delivery evidence)
    - `NEVER_ENGAGED` (minimum delivered campaigns met, zero verified opens/clicks/replies/conversions)
    - `INSUFFICIENT_DATA` (no verified delivery history or fewer than minimum delivered campaigns — never classified as inactive)
    - `EXCLUDED` (unsubscribed, complained, hard-bounced, blacklisted, unconfirmed, VIP, active paid relationship, recent purchase, excluded domain/source, or recent-signup grace window)
  - Descriptive tags (`CLICK_NO_OPEN`, `OPEN_ONLY_MPP_CAVEAT`, `SUPPRESSED`, `ARCHIVED`, `VIP_PROTECTED`, `PAID_RELATIONSHIP`, `180D_PLUS_NO_ENGAGEMENT`) and human-readable explanations on every subscriber.
  - Preserves Phase 1 `hygieneStatus` alongside Phase 2 `engagementStatus`.

- **Smart Filtering Engine (`src/services/analysis/filter-engine.ts`, `/api/subscribers/filter`, `/cleanup`)**
  - Composable **AND / OR** queries over all 12 criteria: mailing list, engagement status, days since last engagement, days since signup, delivered campaigns count, unique opens, unique clicks, email domain, MailWizz subscriber status, source/signup method, engagement confidence, protected/VIP status, plus suppression/archive flags.
  - Computes and displays exact matching subscriber counts before any operation.

- **Dry-Run Preview, Encryption & Safety Protections (`src/services/cleanup/safety.ts`, `planner.ts`, `restore.ts`)**
  - Defaults every hygiene operation to **DRY RUN**.
  - Blocks copying ineligible (`UNSUBSCRIBED`, `COMPLAINED`, `HARD_BOUNCED`, `BLACKLISTED`, `UNCONFIRMED`, or `isSuppressed`) contacts into sendable lists.
  - Protects `INSUFFICIENT_DATA`, `ACTIVE`, VIPs, paid customers, and recent clicks/replies/conversions/purchases.
  - Multi-list unsubscribe protection: refuses cross-list unsubscribe operations from single-list criteria unless explicitly authorized, and never calls MailWizz's global `unsubscribe-by-email-from-all-lists` endpoint.
  - Stores AES-256-GCM encrypted pre-change snapshots (`CleanupOperation.snapshotEnc`) + SHA-256 integrity hashes and per-subscriber idempotency keys (`CleanupOperationRecord`).
  - Downloadable Dry-Run CSV reports (`/api/cleanup/[opId]?format=csv`).

- **Resumable Batch Job Engine (`src/services/cleanup/executor.ts`, `src/services/jobs/`)**
  - PostgreSQL-backed durable batch processing (`batchSize` 5–50) with **Pause**, **Resume**, **Cancel before pending batches**, checkpoint persistence, and mid-job re-verification (skips subscribers who open/click/reply/convert after dry-run preview).
  - Conservative rate limiting, exponential backoff with jitter on HTTP 429/5xx, remote status reconciliation before retrying ambiguous failures, and automatic **AUTO_STOPPED** halting when failure/discrepancy rates exceed thresholds.

- **Application-Level Suppression, Logical Archive & Safe Restore**
  - Recommended default `SUPPRESS` workflow excludes inactive contacts from routine sends without altering MailWizz subscription state.
  - `ARCHIVE` logically archives and suppresses contacts without deletion.
  - `RESTORE_SUPPRESSION` cleanly reverses app suppressions only after admin approval and eligibility verification (refusing unsubscribed, complained, hard-bounced, or blacklisted records).

- **Hygiene & Deliverability Reports (`/reports`, `/api/reports/hygiene`)**
  - All 8 required reports with on-screen summaries and optional PII-masked CSV exports: Active Audience, Inactive Audience, Never Engaged, Suppression Recommendations, Re-Engagement Campaigns, Cleanup Execution, Before & After Comparison, and Data Quality & Confidence.

---

## 2. Functionality Dependent on MailWizz 3.0.5 Configuration or List Settings

- **Creating Clean Lists (`POST /lists`):** Preserves sender `from_name`, `from_email`, `reply_to`, `subject`, and sets `opt_in=single`, `opt_out=single`. Succeeds only when the customer API key holds list-creation permissions.
- **Copying Eligible Confirmed Subscribers (`POST /lists/{LIST_UID}/subscribers/bulk`):** MailWizz triggers confirmation/welcome emails automatically if the destination list has `opt_in = double` or list-level welcome emails enabled. Therefore, `MailWizzMutationClient.createSubscribersBulk` explicitly blocks bulk copy unless destination list `opt_in` is verified as `"single"`. Copying never deletes from the source list.
- **Creating / Updating Segments (`POST /lists/{LIST_UID}/segments`, `PUT /lists/{LIST_UID}/segments/{SEGMENT_UID}`):** MailWizz native segments evaluate list fields and campaign `open`/`click` conditions supported by MailWizz 3.0.5 (`getListFields`, `getSegmentConditionOperators`); application-only filters (like reply/conversion protection flags) are evaluated inside this app.
- **Silent Single-List Unsubscribe (`PUT /lists/{LIST_UID}/subscribers/{SUBSCRIBER_UID}/unsubscribe`):** Requires `ENABLE_MAILWIZZ_MUTATIONS="true"` in server environment and valid customer API key permissions.

---

## 3. Functionality Dependent on Historical Data Sources or Webhooks

- **Inactivity (`INACTIVE`, `LONG_TERM_INACTIVE`, `NEVER_ENGAGED`) Classification:** Cannot be inferred from aggregate campaign statistics or MailWizz 3.0.5's REST API alone (`GET /lists/{uid}/subscribers` lacks per-subscriber delivery, open, and click logs). Requires Priority B (verified campaign report imports), Priority C (strictly read-only `SELECT` connection to the MailWizz reporting database), or accumulated Priority D (live webhooks). Without verified delivery history (`historyCoverage !== 'VERIFIED_FULL'`), subscribers remain `INSUFFICIENT_DATA` / `UNKNOWN` and bulk inactivity suppression/unsubscribe is locked.
- **Re-Engagement Evaluation (`evaluateReengagementPlan`):** Measuring renewed opens, clicks, replies, or conversions within the response window relies on synced webhook events (`WEBHOOK_LIVE`), imported campaign reports (`VERIFIED_EXPORT`), or the read-only reporting DB (`READONLY_REPORTING_DB`).

---

## 4. Functionality Requiring Explicit Administrator Approval

- **Executing Any Non-Dry-Run Cleanup Operation:** Requires administrator confirmation entering exact target list name + exact eligible subscriber count (`confirmAndEnqueueCleanup`), plus explicit large-batch approval checkbox when affecting `>= largeChangeThreshold` (default 100) records.
- **Remote MailWizz Mutations (`UNSUBSCRIBE`, `CREATE_LIST`, `CREATE_SEGMENT`, `COPY_SUBSCRIBERS`, `MOVE_SUBSCRIBERS`):** Additionally gated by server-side `ENABLE_MAILWIZZ_MUTATIONS="true"`.
- **Re-Engagement Campaign Approval:** Application creates drafts/segments and suggested copy, but an administrator must manually create/approve and send the campaign in MailWizz and record the approved Campaign UID (`approveReengagementCampaignManually`).
- **Suppression Rollback (`RESTORE_SUPPRESSION`):** Requires explicit administrator approval flag and verifies legal/consent eligibility before clearing suppression.

---

## 5. Unsupported or Intentionally Prohibited Operations

- **Permanent Subscriber Deletion (`DELETE /lists/{uid}/subscribers/{sub_uid}`):** Intentionally prohibited during routine hygiene cleanup. Blocked at `MailWizzMutationClient` transport layer.
- **Global Unsubscribe Across All Lists (`unsubscribe-by-email-from-all-lists`):** Permanently blocked at `MailWizzMutationClient` to prevent single-list inactivity from wiping consent on unrelated lists.
- **Tracking Endpoint Scraping (`track-opening`, `track-url`, `track-unsubscribe`):** Permanently blocked in both read-only and mutation HTTP clients.
- **Automatic Email Sending / Scheduling:** Application never sends emails directly via SMTP or triggers campaign sending/scheduling endpoints.
- **Automatic Re-Subscribing of Unsubscribed Contacts:** MailWizz `UNSUBSCRIBE` operations preserve encrypted pre-change snapshots and audit logs for review, but automated re-opt-in/resubscribe is permanently disallowed.
