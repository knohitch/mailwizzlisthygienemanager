# Technical Report: Historical Engagement Data in MailWizz 3.0.5

## Executive Summary

During inspection of the official **MailWizz 3.x REST API documentation** (`https://api-docs.mailwizz.com/`) and SDK references, we confirmed a critical architectural constraint:

**The MailWizz 3.0.5 customer REST API does NOT provide read-only endpoints to query per-subscriber historical email deliveries, opens, URL clicks, or spam complaints across campaigns.**

Because of this limitation, relying solely on the REST API cannot tell you whether Subscriber X received at least 5 campaigns and failed to open or click any of them. Attempting to infer inactivity from REST API subscriber status alone would risk unsubscribing engaged recipients.

To prevent false inactivity classifications, **MailWizz List Hygiene Manager** implements the four-tier priority strategy below and enforces an explicit **`UNKNOWN`** hygiene state whenever verified subscriber-level history is missing.

---

## 1. What Cannot Be Obtained Through the MailWizz 3.0.5 REST API Alone

1. **Per-Subscriber Delivery History (`campaign_delivery_log`):**
   - `GET /campaigns/{uid}/stats` exposes aggregate `delivery_success_count` and `delivery_error_count`, not individual recipient rows.
   - Without knowing how many campaigns were delivered to a specific subscriber, the rule *"minimum 5 delivered campaigns before inactivity classification"* cannot be evaluated from the REST API alone.
2. **Per-Subscriber Open History (`campaign_track_open`):**
   - `GET /campaigns/{uid}/stats` exposes aggregate `opens_count` and `unique_opens_count`, not which `subscriber_uid`s opened.
   - **Critical Warning:** `GET /campaigns/{uid}/track-opening/{subscriber_uid}` is a **tracking pixel receiver endpoint** that *writes* a new open record into MailWizz. Calling it to inspect history would corrupt campaign metrics and create false engagement. Our connector hard-blocks this path.
3. **Per-Subscriber Click History (`campaign_track_url`):**
   - `GET /campaigns/{uid}/stats` exposes aggregate `clicks_count` and `unique_clicks_count`, not per-subscriber clicks.
   - `GET /campaigns/{uid}/track-url/{subscriber_uid}/{url_hash}` is a **click-recording endpoint** and is hard-blocked in our connector.
4. **Per-Subscriber Spam Complaints & DirectMail SMTP Context:**
   - `GET /campaigns/{uid}/stats` exposes `complaints_count`, but no per-subscriber complaint list endpoint exists in the REST API.
   - Because MailWizz sends through **Alibaba Cloud DirectMail via SMTP**, ISP Feedback Loop (FBL) complaint events are generally not fed back to MailWizz automatically unless a separate bounce/complaint inbox or API integration is configured.

---

## 2. Priority Evaluation & Implemented Solutions

### Priority A — Official Read-Only REST API + Native Segments (Always Active)
- **What it provides:**
  - All mailing lists (`GET /lists`) and subscribers (`GET /lists/{uid}/subscribers`) with authoritative status (`confirmed`, `unconfirmed`, `unsubscribed`, `blacklisted`) and `date_added`.
  - Native MailWizz segments (`GET /lists/{uid}/segments/{seg_uid}` and `.../subscribers`), including inspection of `campaign_conditions` (if you already created engagement-based segments inside MailWizz UI, we discover their membership).
  - Historical campaigns (`GET /campaigns`), aggregate stats (`GET /campaigns/{uid}/stats`), and **per-subscriber bounce logs** (`GET /campaigns/{uid}/bounces`, distinguishing `hard`, `soft`, and `internal` bounces).
- **Limitation:** Does not provide per-subscriber delivery, open, or click timelines.

### Priority B — Verified Campaign Report Imports (`POST /api/reports/import`)
- **What it provides:**
  - Administrators can export campaign delivery, open, click, or complaint reports from the MailWizz Customer UI and import them as CSV or JSON.
  - Rows are validated, matched to existing subscribers/campaigns, deduplicated, and stored with provenance `VERIFIED_EXPORT`.

### Priority C — Strictly Read-Only MailWizz MySQL Reporting Connection (`reporting-db.ts`)
- **What it provides:**
  - If authorized by the administrator, a separate MySQL user restricted strictly to `SELECT` privileges can query MailWizz's internal historical tables.
- **Schema Verification Guard (No Blind SQL):**
  - Before running any data query, `verifyMailWizzReportingSchema()` executes `SHOW GRANTS FOR CURRENT_USER()` (refusing the connection if write/DDL privileges exist) and queries `INFORMATION_SCHEMA.TABLES` & `INFORMATION_SCHEMA.COLUMNS` with the configured table prefix (default `mw_`).
  - Typical MailWizz 3.x tables checked: `list`, `list_subscriber`, `campaign`, `campaign_delivery_log`, `campaign_delivery_log_archive`, `campaign_track_open`, `campaign_track_url`, `campaign_url`, `campaign_bounce_log`, `campaign_complain_log`.
  - Never modifies any MailWizz table and rejects any SQL containing write keywords at the connector level.

### Priority D — MailWizz Campaign Webhooks (`POST /api/webhooks/mailwizz`)
- **What it provides:**
  - Captures real-time `open`, `click`, and `unsubscribe` events dispatched by MailWizz's campaign webhook cron going forward (`https://www.mailwizz.com/kb/campaign-webhooks/`).
- **Important Boundary:** All webhook-ingested events are stored with `isHistorical = false` and `source = WEBHOOK_LIVE`. They are **never** backdated or presented as historical campaign performance prior to webhook activation.

---

## 3. Fail-Safe Classification Rules (`UNKNOWN` & Open-Only Separation)

1. **Fail-Safe `UNKNOWN` State:**
   - When a subscriber has no verified `DELIVERED` event history (i.e., `historyCoverage !== 'VERIFIED_FULL'`), the engine sets `hygieneStatus = UNKNOWN` and **refuses to classify the subscriber as `INACTIVE_CANDIDATE`**.
2. **Minimum Delivered Campaigns Threshold (Default: 5):**
   - Even with verified delivery history, subscribers with `< 5` delivered campaigns are classified as `INSUFFICIENT_HISTORY` rather than `INACTIVE_CANDIDATE`.
3. **Separating Open-Only from Strong Engagement:**
   - Because Apple Mail Privacy Protection (MPP) and corporate email scanners preload tracking pixels, `OPEN` events alone classify a subscriber as `ENGAGED_OPEN_ONLY`, kept strictly separate from `ENGAGED_STRONG` (verified `CLICK`, `REPLY`, or `CONVERSION`).
