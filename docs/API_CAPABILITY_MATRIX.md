# MailWizz 3.0.5 API Capability Matrix

Status key:
- **VERIFIED**: Confirmed in official MailWizz 3.x REST API documentation (`https://api-docs.mailwizz.com/`) and/or implemented & verified against mocked MailWizz responses. *(Live instance validation occurs when you enter your MailWizz credentials in Settings.)*
- **UNAVAILABLE**: Confirmed absent or unsafe for read-only history retrieval in the MailWizz 3.x REST API.
- **NOT_YET_TESTED**: Implemented and ready, awaiting credentials for your live MailWizz 3.0.5 instance / MySQL reporting DB.

| Category | Feature / Endpoint | Status | Notes |
| --- | --- | --- | --- |
| Authentication | `X-Api-Key` HTTP Header | VERIFIED (Docs) / NOT_YET_TESTED (Live) | MailWizz 2.x/3.x authenticate via `X-Api-Key` header (customer API key). Live validation happens via `POST /api/settings/validate`. |
| Lists | `GET /lists` & `GET /lists/{list_uid}` | VERIFIED | Auto-discovers all mailing lists with pagination (`page`, `per_page`) without manual list IDs. |
| Subscribers | `GET /lists/{list_uid}/subscribers` | VERIFIED | Paginated retrieval of subscriber UID, email, custom fields, status (`confirmed`, `unconfirmed`, `unsubscribed`, `blacklisted`), source, and `date_added`. |
| Segments | `GET /lists/{list_uid}/segments`, `GET /lists/{list_uid}/segments/{seg_uid}`, `.../subscribers` | VERIFIED | Discovers native segments, segment `conditions` & `campaign_conditions`, and matching subscribers. |
| Campaigns | `GET /campaigns` & `GET /campaigns/{campaign_uid}` | VERIFIED | Discovers historical campaigns, status, `send_at`, list UID, and segment reference. |
| Campaign Stats | `GET /campaigns/{campaign_uid}/stats` | VERIFIED | Returns aggregate `delivery_success_count`, `delivery_error_count`, `opens_count`, `unique_opens_count`, `clicks_count`, `unique_clicks_count`, `unsubscribes_count`, `complaints_count`, `hard_bounces_count`, `soft_bounces_count`, `internal_bounces_count`. |
| Campaign Bounces | `GET /campaigns/{campaign_uid}/bounces` | VERIFIED | Returns paginated subscriber-level bounce records (`bounce_type`: `hard`/`soft`/`internal`, `message`, `processed`, `subscriber.subscriber_uid`). |
| Subscriber Open History | Per-subscriber historical open log endpoint | **UNAVAILABLE** | No read-only endpoint exists in MailWizz 3.x REST API. `GET /campaigns/{uid}/track-opening/{sub_uid}` is a **write trigger** that records fake opens and is hard-blocked in `MailWizzClient`. |
| Subscriber Click History | Per-subscriber historical URL click log endpoint | **UNAVAILABLE** | No read-only endpoint exists in MailWizz 3.x REST API. `GET /campaigns/{uid}/track-url/{sub_uid}/{hash}` is a **write trigger** that records fake clicks and is hard-blocked in `MailWizzClient`. |
| Subscriber Delivery History | Per-subscriber historical delivery log endpoint | **UNAVAILABLE** | Delivery success/error counts exist only in aggregate on `/campaigns/{uid}/stats`. Per-subscriber delivery count requires Priority B, C, or D. |
| Subscriber Spam Complaints | Per-subscriber complaint log endpoint | **UNAVAILABLE** | Aggregate `complaints_count` is on `/campaigns/{uid}/stats`, but per-subscriber complaint list is not exposed via the 3.x REST API. Furthermore, Alibaba Cloud DirectMail SMTP typically does not emit standard ISP Feedback Loop (FBL) headers unless configured separately. |
| Priority B | Verified Campaign Report Import (`POST /api/reports/import`) | VERIFIED | Imports CSV/JSON campaign exports from MailWizz Customer UI with provenance `VERIFIED_EXPORT`. |
| Priority C | Optional Read-Only MySQL Reporting DB (`reporting-db.ts`) | NOT_YET_TESTED | Inspects `INFORMATION_SCHEMA` on installed MailWizz 3.0.5 MySQL DB and enforces `SELECT`-only privileges (`SHOW GRANTS`). |
| Priority D | Campaign Webhooks (`POST /api/webhooks/mailwizz`) | VERIFIED | Collects future `open` / `click` / `unsubscribe` events going forward (`isHistorical: false`). |
| Phase 2 Mutations | Unsubscribe / Segment Creation / Move Subscribers | UNAVAILABLE (Locked) | Disabled by default (`ENABLE_MAILWIZZ_MUTATIONS=false`). |
