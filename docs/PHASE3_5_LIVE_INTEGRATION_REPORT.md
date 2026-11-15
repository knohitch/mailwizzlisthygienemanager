# Phase 3.5 — Live MailWizz 3.0.5 Integration & Deliverability Report (Corrected)

- **Date (UTC):** `2026-11-15T23:12:00Z`
- **Repository Branch:** `validation/phase-3.4-docker-acceptance`
- **Base Commit Prior to Update:** `c386831`
- **Isolated Hygiene Stack:** `cloud-vps` (`100.95.86.56`), Compose project `mw-hygiene-p35-isolated`, `/srv/mw-hygiene-p35-isolated`, `http://127.0.0.1:13000` (`ENABLE_MAILWIZZ_MUTATIONS=false`)
- **MailWizz Application:** `https://app.nohitchweb.com/` (version `3.0.5`, hosted on `nohitchweb.com`)
- **Email Provider:** Alibaba Cloud DirectMail (SMTP delivery servers in MailWizz), verified sending domains: `thevelvury.com`, `nhwmedia.com`, `kennynwakanma.com`, `stockattic.com`
- **Final Release Decision:** **NO-GO** for subscriber ingestion or cleanup actions (blocked on independent off-disk backup recovery copy and MailWizz `/api/` HTTP `503` + unavailable credentials).

---

## Executive Summary

1. **Infrastructure & Safety Controls (`COMPLETED`):** `mw-hygiene-p35-isolated` (`web`, `worker`, `postgres`) is healthy (`Up 20–21 hours`), `mailwizzMutationsEnabled` is `false`, `Subscriber=0`, `MailingList=0`, and all existing CapRover apps/databases remain untouched (`Up 3–8 days`).
2. **Backup Encryption & Recovery (`PARTIAL — Recovery Gate BLOCKED`):** `age 1.1.1` is installed on `cloud-vps`, primary key `C:\Users\Administrator\.mw-hygiene-keys\backup-recovery.key` is ACL-restricted on Windows, encrypted `.dump.age` creation + SHA-256 verification + in-memory Windows decryption + disposable DB restore (`hygiene_restore_verify_tmp`) all succeeded, and prior `.dump.enc` remains untouched. **Blocker:** Windows has only a single physical disk (`DeviceId: 0`, `Virtual HD`, containing `C:` and `E:`), and while `\\TSCLIENT\C` (RDP client redirect) appears in `net use`, no approved independent encrypted recovery destination has been designated or verified. Per policy, no real subscribers were imported.
3. **MailWizz 3.0.5 API Availability (`BLOCKED`):** Rechecked `https://app.nohitchweb.com/` at `23:11 UTC`:
   - `GET /` → `302` redirect to `https://app.nohitchweb.com/index.php/site/offline`
   - `GET /backend/` and `GET /customer/` → `302` redirects to guest login screens
   - `GET /api/`, `GET /api/index.php`, and `GET /api/index.php/lists` → HTTP **`503` `{"status":"error","error":"Service Unavailable."}`** (behind Cloudflare)
   - `GET /api/lists` and `GET /api/v1/lists` → HTTP **`404`** HTML ("Page Not Found")
   - In addition, `MAILWIZZ_API_URL` and `MAILWIZZ_API_KEY` remain `UNSET` in `/srv/mw-hygiene-p35-isolated/.env` and `AppConfig`.
4. **Corrected Sending-Domain Authentication Findings (`COMPLETED — Public DNS`):**
   Corrected the prior report so **hosting domain** `nohitchweb.com` is separated from the **four actual marketing sending domains** (`thevelvury.com`, `nhwmedia.com`, `kennynwakanma.com`, `stockattic.com`). **No DNS changes are proposed without campaign header verification**, and Alibaba "Verification successful" proves domain setup—not inbox placement vs Gmail Promotions vs spam filtering.

---

## Task Status Matrix

| Area | Status | Summary |
|---|---|---|
| 1. Backup Encryption (`age` + Disposable Restore) | **COMPLETED** | Encrypted `.dump.age` created, verified, decrypted locally, restored to disposable DB (`hygiene_restore_verify_tmp`), dropped cleanly. |
| 2. Independent Off-Disk Recovery Key Copy | **BLOCKED** | Single physical disk on Windows (`DeviceId: 0`); `\\TSCLIENT\C` not authorized/verified as encrypted recovery destination. |
| 3. MailWizz API Availability Check | **BLOCKED** | `/api/` & `/api/index.php/lists` return HTTP `503 {"status":"error","error":"Service Unavailable."}` (`/` redirects to `/index.php/site/offline`). |
| 4. Live MailWizz Connection & Compatibility | **NOT EXECUTED** | Blocked by backup gate, API `503`, and unset `MAILWIZZ_API_URL`/`MAILWIZZ_API_KEY`. |
| 5. Actual Sending-Domain Public DNS Audit (4 Domains) | **COMPLETED** | Public SPF, DKIM, DMARC, MX, and subdomain checks completed for `thevelvury.com`, `nhwmedia.com`, `kennynwakanma.com`, `stockattic.com`. |
| 6. Alibaba DirectMail Telemetry Comparison | **NOT EXECUTED** | No read-only Alibaba RAM credentials configured (`ALIBABA_ACCESS_KEY_ID: UNSET`). |
| 7. Subscriber Sampling (≤25) & List Sync (~1,800) | **NOT EXECUTED** | Zero subscribers imported (`Subscriber=0`, `MailingList=0`). |
| 8. Campaign / Open-Rate Decline Root-Cause Analysis | **NOT EXECUTED** | Blocked pending MailWizz API recovery + credentials + Alibaba reporting credentials. |

---

## 1. Backup Recovery Status

- **VPS Package & Recipient:** `/usr/bin/age` (`1.1.1`) installed; `BACKUP_AGE_RECIPIENT` configured (`age1dyv52hxs3gqz5j0ytd9phrz00qq4tm9p38v7zvt9ajcgpc7a0elqhum3cv`) in `/srv/mw-hygiene-p35-isolated/.env`. Private identity never placed on `cloud-vps`, Git, or logs.
- **Primary Windows Key:** Stored at `C:\Users\Administrator\.mw-hygiene-keys\backup-recovery.key`, NTFS inheritance disabled, ACL restricted to `WIN-K336HITEEEN\Administrator:(F)`.
- **Independent Storage Inspection:**
  - `Get-PhysicalDisk`: single `Virtual HD` (`DeviceId: 0`, `209,379,655,680` bytes); `C:` and `E:` share this same physical disk; `D:` (CD-ROM) and `A:` (Removable) are empty.
  - `OneDrive` / `OneDriveCommercial`: unset.
  - `net use`: `\\TSCLIENT\C` (RDP client local-drive redirection) exists, but is not an authorized/verified encrypted key-storage target; left untouched.
- **Verified Backups Preserved on `cloud-vps`:**
  - `./backups/hygiene_db_20261115T030608Z.dump.enc` (`74,016` bytes, `-rw-------`) + `.sha256` preserved.
  - `./backups/hygiene_db_20261115T033016Z.dump.age` (`74,643` bytes, `-rw-------`) + `.sha256` (`2d14c1d8f10a7333bf20f9492e65a10f8e47b627df5defc3fbf50a5aaff74d9a`) verified, decrypted locally (`74,427` bytes `PGDMP`), and restored cleanly into disposable DB `hygiene_restore_verify_tmp` (`migrations=4, app_configs=1, capabilities=30, audit_logs=19, admin_sessions=9`).

---

## 2. MailWizz API Availability & Connection Status

- **Observed Endpoint Behavior (`23:11 UTC`):**
  - `GET https://app.nohitchweb.com/` → `302 https://app.nohitchweb.com/index.php/site/offline` (MailWizz maintenance/offline mode active on frontend).
  - `GET https://app.nohitchweb.com/backend/` → `302 https://app.nohitchweb.com/backend/index.php/guest/index`.
  - `GET https://app.nohitchweb.com/customer/` → `302 https://app.nohitchweb.com/customer/index.php/guest/index`.
  - `GET https://app.nohitchweb.com/api/` & `GET https://app.nohitchweb.com/api/index.php` & `GET https://app.nohitchweb.com/api/index.php/lists` → HTTP `503` `{"status":"error","error":"Service Unavailable."}` (served through Cloudflare `server=cloudflare`).
  - `GET https://app.nohitchweb.com/api/lists` & `GET https://app.nohitchweb.com/api/v1/lists` → HTTP `404` HTML ("Page Not Found"), indicating clean-URL rewrite rules for `/api/*` are absent unless routed via `/api/index.php/*`.
- **Hygiene App Config:** `MAILWIZZ_API_URL`, `MAILWIZZ_API_KEY`, and `MAILWIZZ_REPORTING_DB_URL` remain `UNSET`; `overallStatus: "UNVERIFIED"`, `mutationSafetyAllowed: false`, `mailwizzMutationsEnabled: false`.

---

## 3. Corrected Sending-Domain Authentication Findings

### 3.1 Separation of Hosting Domain (`nohitchweb.com`) vs Marketing Sending Domains
- `nohitchweb.com` hosts the MailWizz web application (`app.nohitchweb.com`). Previously noted apex DNS issues on `nohitchweb.com` (`v=spf1 a mx ip4: 75.119.156.155 -all`, missing `_dmarc.nohitchweb.com`) are **not** evidence of marketing deliverability failures unless actual campaign headers show `nohitchweb.com` in `From:`, `Return-Path`, or click/open tracking URLs.

### 3.2 Actual Verified Sending Domains (`thevelvury.com`, `nhwmedia.com`, `kennynwakanma.com`, `stockattic.com`)

| Domain | SPF (`TXT`) | DKIM (`_domainkey` selectors discovered publicly) | DMARC (`_dmarc.<domain>`) | MX & Key Subdomains |
|---|---|---|---|---|
| **`thevelvury.com`** | `v=spf1 a mx ip4:75.119.156.155 ~all` *(note: does not include `spfdm-ap-southeast-1.aliyun.com` on apex or `mail.thevelvury.com`)* | `default._domainkey.thevelvury.com` (`v=DKIM1; h=sha256; k=rsa; ...`) | `v=DMARC1; p=none;` *(also on `_dmarc.mail.thevelvury.com`; no `rua`)* | MX `_dc-mx.f9d61f475753.thevelvury.com`; `mail.thevelvury.com` (`75.119.156.155`, MX self) |
| **`nhwmedia.com`** | `v=spf1 include:spfdm-ap-southeast-1.aliyun.com ip4:75.119.156.155 -all` | `mail._domainkey.nhwmedia.com` (`v=DKIM1; k=rsa; ...`) | `v=DMARC1;p=none;rua=mailto:dmarc_report@service.aliyun.com` | MX `mail.nhwmedia.com`, `nhwmedia.com` (`75.119.156.155`); `smtp.nhwmedia.com` (`75.119.156.155`); TXT verification `ca3-b3cb0b8462b74282a376988bec000059` |
| **`kennynwakanma.com`** | `v=spf1 a mx ip4:185.91.127.12 include:relay.mailbaby.net include:spfdm-ap-southeast-1.aliyun.com ~all` | *None resolved across 35 standard/Aliyun selectors tested (`aliyun*`, `alibaba`, `directmail`, `dm*`, `default`, `mail`, `dkim`, `s1/s2`, `k1/k2`, `selector1/2`, etc.)* | `v=DMARC1;p=none;rua=mailto:dmarc_report@service.aliyun.com` | MX `mail.kennynwakanma.com` (`185.91.127.12`) & `mxdm-ap-southeast-1.aliyun.com`; `smtp.kennynwakanma.com` (Cloudflare IPs) |
| **`stockattic.com`** | `v=spf1 include:spfdm-ap-southeast-1.aliyun.com ip4:75.119.156.155 -all` | `default._domainkey.stockattic.com` (`h=sha256`) & `mail._domainkey.stockattic.com` | `v=DMARC1;p=none;rua=mailto:dmarc_report@service.aliyun.com` | MX `mail.stockattic.com` (`75.119.156.155`); `send.stockattic.com` → Amazon SES (`feedback-smtp.us-east-1.amazonses.com`, `v=spf1 include:amazonses.com ~all`) |

### 3.3 Observations Requiring Header & Console Correlation (No DNS Changes Proposed Yet)
- **Return-Path / SPF Alignment:** Cannot be verified from DNS alone because Alibaba DirectMail SMTP delivery servers may use either Alibaba's default envelope `MAIL FROM` domain (where DMARC passes via **DKIM alignment** `d=<sending-domain>`) or a custom Return-Path domain. Notably, `thevelvury.com` has no `spfdm-ap-southeast-1.aliyun.com` include, whereas `nhwmedia.com`, `kennynwakanma.com`, and `stockattic.com` do. Inspecting an actual delivered message's `Return-Path`, `From:`, `DKIM-Signature` (`d=`, `s=`), and `Authentication-Results` headers will confirm alignment cleanly before touching any DNS record.
- **DKIM Selector Verification on `kennynwakanma.com`:** No DKIM record resolved on the 35 public selectors probed; compare with the exact selector configured in Alibaba Cloud DirectMail console (or campaign `DKIM-Signature` `s=` tag) to verify whether DKIM uses a non-standard selector or custom sending subdomain.
- **DMARC Policy (`p=none`):** All four sending domains publish `v=DMARC1; p=none;` (satisfying minimum DMARC existence); three route aggregate reports to `dmarc_report@service.aliyun.com`.
- **Tracking Domains:** None of `{track,tracking,click,link,go,t,trk}.<domain>` resolved on any of the four domains (`ENOTFOUND`). If MailWizz rewrites links and tracking pixels to `https://app.nohitchweb.com/`, that creates a cross-domain mismatch between the `From:` domain (`thevelvury.com` / `nhwmedia.com` / `kennynwakanma.com` / `stockattic.com`) and the tracking domain (`app.nohitchweb.com`) — verify inside MailWizz Settings/Tracking Domains once connected.

---

## 4. Alibaba Reporting, Subscriber Sync & Engagement Analysis

- **Alibaba Cloud DirectMail Reporting:** **Not Executed** (`ALIBABA_ACCESS_KEY_ID` and secret are `UNSET`).
- **Subscriber Synchronization & Reconciliation:** **Not Executed** (`Subscriber=0`, `MailingList=0`).
- **Engagement & Open-Rate Decline Root-Cause Analysis:** **Not Executed** — no campaign history, bounce/complaint logs, provider splits (Gmail/Outlook/Yahoo), or subscriber engagement timestamps have been imported yet.

---

## 5. Remaining Blockers & Exact Next Actions Required

1. **Satisfy Independent Backup Recovery Copy (Stage B Gate):**
   Copy `C:\Users\Administrator\.mw-hygiene-keys\backup-recovery.key` to an authorized off-disk / off-VPS encrypted destination (e.g., encrypted vault/drive on your local client computer via `\\TSCLIENT\C` or hardware media, NOT another folder on Windows `DeviceId: 0` and NOT `cloud-vps`), then confirm the independent copy is verified.
2. **Restore MailWizz API Availability (`https://app.nohitchweb.com/`):**
   In MailWizz Backend (`https://app.nohitchweb.com/backend/`):
   - Check `Settings -> Common -> Site status` (currently `/` redirects to `/index.php/site/offline`) and `Settings -> Api -> API status` (currently `/api/index.php/lists` returns `503 {"status":"error","error":"Service Unavailable."}`).
   - Confirm whether clean URLs are enabled for `/api` or whether `https://app.nohitchweb.com/api/index.php` is the active endpoint.
3. **Provide Read-Only Credentials in `http://127.0.0.1:13000` (SSH tunnel) or `.env`:**
   - MailWizz 3.0.5 API URL & API key (while keeping `ENABLE_MAILWIZZ_MUTATIONS=false`).
   - Optional: Alibaba Cloud DirectMail read-only RAM credentials (`ap-southeast-1`) and an EML/header sample showing `From:`, `Return-Path`, `DKIM-Signature`, and tracking URL domain for one recent campaign.
