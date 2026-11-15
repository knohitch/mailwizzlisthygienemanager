# Phase 3.5 — Live MailWizz 3.0.5 Integration & Subscriber Analysis Report

- **Date (UTC):** `2026-11-15T03:32:00Z`
- **Repository Branch:** `validation/phase-3.4-docker-acceptance`
- **Commit Before Report Update:** `5e9fe62`
- **Isolated Runtime Host:** `cloud-vps` (`100.95.86.56`), Compose project `mw-hygiene-p35-isolated`, directory `/srv/mw-hygiene-p35-isolated`, address `http://127.0.0.1:13000`
- **Final Release Decision:** **NO-GO** (pre-import backup independent-copy gate and live MailWizz API access/credentials are blocked; zero real subscribers imported and zero cleanup actions executed).

---

## Executive Summary (Plain English)

Here is what was completed overnight while keeping every production system, subscriber, and CapRover workload untouched (`ENABLE_MAILWIZZ_MUTATIONS=false`):

1. **Application & VPS Health (Done):** All isolated containers (`web`, `worker`, `postgres`) are healthy on `cloud-vps`, `50 GB` disk and `4.4 GB` RAM remain available, and all existing CapRover apps/databases remain running undisturbed.
2. **`age` Encrypted Backups & Disposable Restore Test (Encryption & Restore Done; Second Copy Blocked):**
   - Installed `age` (`1.1.1`) cleanly on `cloud-vps` with zero unrelated upgrades.
   - Created a dedicated off-VPS private recovery key on your Windows machine (`C:\Users\Administrator\.mw-hygiene-keys\backup-recovery.key`, locked strictly to `Administrator`) and configured only the public `age1...` recipient on the VPS.
   - Created an authenticated `.dump.age` backup on the VPS, copied it to Windows, decrypted it purely in RAM, and verified a genuine restore into a temporary disposable database (`hygiene_restore_verify_tmp`) before dropping that temporary database.
   - **Why subscriber import stopped here:** Windows currently has only **one physical disk** (`Virtual HD`, with `C:` and `E:` as partitions on the same disk) and no authorized external/cloud recovery destination connected. Following the mandatory safety rule, real subscriber data was **not** imported without a second independent recovery copy outside this disk and outside the VPS.
3. **MailWizz 3.0.5 Read-Only Connection (Blocked):**
   - No MailWizz API key is stored in the app's secure configuration yet, and checking `https://app.nohitchweb.com/` showed two immediate findings:
     - `https://app.nohitchweb.com/` currently redirects (`302`) to `/index.php/site/offline` (`503`), while `/backend/` and `/customer/` redirect to login.
     - Both `https://app.nohitchweb.com/api/` and `https://app.nohitchweb.com/api/index.php/lists` return HTTP **`503` `{"status":"error","error":"Service Unavailable."}`** (MailWizz API appears disabled/in offline mode), and `/api/lists` returns `404` HTML.
4. **Immediate Real Deliverability Issues Found via Public DNS (`nohitchweb.com`):**
   Even without MailWizz API access yet, inspecting public DNS for `nohitchweb.com` already uncovered major causes of poor deliverability/open rates:
   - **Broken SPF record:** `v=spf1 a mx ip4: 75.119.156.155 -all` contains an **illegal space** after `ip4:`, omits Alibaba Cloud DirectMail's `spf` include, and ends in `-all` (hard fail). Strict receivers evaluate this as `PermError` or `Fail`.
   - **Missing DMARC record:** `_dmarc.nohitchweb.com` does not exist (`ENOTFOUND`), violating Gmail/Yahoo 2024+ bulk-sender requirements.
   - **DKIM not found on standard apex selectors:** Standard selectors (`default`, `mail`, `dkim`, `aliyun`, `directmail`, etc.) returned `ENOTFOUND` on `nohitchweb.com` (check whether sending uses a separate subdomain or custom Alibaba selector).

---

## Stage-by-Stage Status

| Stage | Description | Status | Notes |
|---|---|---|---|
| **Stage A** | Verify Current System State | **COMPLETED** | Branch `validation/phase-3.4-docker-acceptance` (`5e9fe62`), all isolated & CapRover services healthy, `mailwizzMutationsEnabled: false`. |
| **Stage B** | Install `age`, Create Windows Key, Verify Independent Copy | **BLOCKED** | `age 1.1.1` installed on VPS; private key secured on Windows (`backup-recovery.key`). Blocked solely because no second physical/external encrypted recovery destination exists yet. |
| **Stage C** | Configure Recipient, `.dump.age` Backup & Disposable Restore | **COMPLETED** | `.dump.age` created (`0600`), SHA-256 verified, decrypted in memory on Windows, and genuinely restored to/verified in `hygiene_restore_verify_tmp` (dropped cleanly after). Pre-import checkpoint remains **BLOCKED** by Stage B independent copy. |
| **Stage D** | Connect Live MailWizz 3.0.5 Read-Only & Run `/compatibility` | **BLOCKED** | Blocked by Stage B gate + no stored MailWizz API key in authorized config + `https://app.nohitchweb.com/api/` & `/api/index.php/lists` returning `503 Service Unavailable.`. |
| **Stage E** | Initial 25-Subscriber Sample | **NOT EXECUTED** | Blocked by Stages B & D. |
| **Stage F** | Complete Read-Only Sync (~1,800-Subscriber List) | **NOT EXECUTED** | Blocked by Stages B, D, & E (`Subscriber=0`, `MailingList=0`). |
| **Stage G** | Historical Engagement Analysis (30/60/90/180/365d) | **NOT EXECUTED** | Blocked by Stages D & F. |
| **Stage H** | Deliverability Diagnostics (DNS / MailWizz / Alibaba) | **PARTIAL** | Public DNS audit for `nohitchweb.com` **COMPLETED** (critical SPF & DMARC defects found). MailWizz campaign stats & Alibaba DirectMail RAM metrics **NOT EXECUTED** (pending credentials). |
| **Stage I** | Real Subscriber Health Report (19 Metrics) | **NOT EXECUTED** | Zero real subscribers imported; no synthetic figures substituted. |

---

## 1. System State, Source Provenance & VPS Health (Stage A)

- **Git Branch & Base Commit Verified:** `validation/phase-3.4-docker-acceptance` at `5e9fe62` (following source commit `f079853`, whose `src/`, `worker/`, `prisma/`, `Dockerfile`, `Dockerfile.worker`, `docker-compose.yml`, `package.json`, and `package-lock.json` LF SHA-256 digests match `/srv/mw-hygiene-p35-isolated`).
- **Isolated Stack Image IDs & Status (`cloud-vps`):**
  - `mw-hygiene-p35-isolated-web-1`: `Up ... (healthy)`, `127.0.0.1:13000->3000/tcp`, image `mw-hygiene-p35-isolated-web` (`sha256:b653b77e4c5201f41f209d1b94dae18b286bf23f52cf4d2a388775d4cdbfdf38`)
  - `mw-hygiene-p35-isolated-worker-1`: `Up ... (healthy)`, image `mw-hygiene-p35-isolated-worker` (`sha256:e9681c17a3b161eb76889d08067f7023e653178e1228ad91238e4395a7f4cada`)
  - `mw-hygiene-p35-isolated-migrate-1`: `Exited (0)`, image `sha256:e9681c17a3b161eb76889d08067f7023e653178e1228ad91238e4395a7f4cada` (4/4 Prisma migrations applied)
  - `mw-hygiene-p35-isolated-postgres-1`: `Up ... (healthy)`, internal `5432/tcp` only, `postgres:16-alpine` (`sha256:f377d590e5474681d4d7838635031a2b50647923b7abfa803ce9b5ff35d5c663`)
- **Mutation Lock & Database Isolation:**
  - `GET http://127.0.0.1:13000/api/health` returned `{"status":"ok","database":"connected","worker":"healthy","phase":"phase-3-deliverability-ready","mailwizzMutationsEnabled":false,...}`.
  - `Subscriber=0`, `MailingList=0`.
- **Host Resources & Existing CapRover Health:**
  - RAM: `7.8Gi` total, `4.4Gi` available; Disk (`/`): `145G` total, `50G` available (`66%` used).
  - All CapRover containers (`captain-nginx`, `captain-captain`, `captain-certbot`, `xlrrank*`, `apimox`, `mox*`, `stock*`, `homesreach*`, `warmup*`, `venturstaq*`, `auditpro`, `elitehvac`, `thebest`, `redisdb`) remained healthy (`Up 2 days` / `Up 7 days`) with zero restarts or changes.

---

## 2. Age Installation, Key Protection & Disposable Restore Results (Stages B & C)

- **Linux `age` Installation (`cloud-vps`):** Non-destructive apt preflight showed `0 upgraded, 1 newly installed` (`age 1.1.1-1ubuntu0.24.04.3`); installed `--no-install-recommends` with zero container/system restarts. Verified `/usr/bin/age` (`1.1.1`).
- **Windows Primary Recovery Key Protection:**
  - Created outside the repo at `C:\Users\Administrator\.mw-hygiene-keys\backup-recovery.key` with NTFS inheritance disabled and ACL restricted exclusively to `WIN-K336HITEEEN\Administrator:(F)`.
  - Private identity never printed, logged, committed, or transferred to `cloud-vps`.
  - Public recipient set in `/srv/mw-hygiene-p35-isolated/.env` (`BACKUP_AGE_RECIPIENT="age1dyv52hxs3gqz5j0ytd9phrz00qq4tm9p38v7zvt9ajcgpc7a0elqhum3cv"`).
- **Independent Recovery Copy Verification (BLOCKED):**
  - `Get-PhysicalDisk` confirms the Windows workstation has only **one physical disk** (`DeviceId: 0`, `Virtual HD`, `209,379,655,680` bytes); `C:` and `E:` are partitions on that same physical disk, `D:`/`A:` are empty, and `net use` shows no mapped network drives. No authorized independent encrypted destination is currently mounted/configured.
- **Encrypted Backup & Disposable Restore Execution:**
  - Preserved prior backup `backups/hygiene_db_20261115T030608Z.dump.enc` (`74,016` bytes, `-rw-------`) + `.sha256` untouched.
  - `./scripts/backup-postgres.sh` generated `./backups/hygiene_db_20261115T033016Z.dump.age` (`74,643` bytes, `-rw-------`, header `age-encryption.org/v1`) and `.sha256` (`2d14c1d8f10a7333bf20f9492e65a10f8e47b627df5defc3fbf50a5aaff74d9a`).
  - Copied encrypted `.dump.age` + `.sha256` over SSH to `C:\Users\Administrator\.mw-hygiene-keys\restore-test\`, verified matching SHA-256 (`true`), decrypted purely in memory (`74,427` bytes, header `PGDMP`), and streamed over SSH directly into temporary database `hygiene_restore_verify_tmp`.
  - Verified actual restored rows (`migrations=4, app_configs=1, capabilities=30, audit_logs=19, admin_sessions=9`), then ran `DROP DATABASE hygiene_restore_verify_tmp`. Zero private keys and zero plaintext dumps ever touched disk during restore verification.

---

## 3. MailWizz Connection & Compatibility Status (Stage D)

- **Configuration State:** `MAILWIZZ_API_URL`, `MAILWIZZ_API_KEY`, and `MAILWIZZ_REPORTING_DB_URL` are `UNSET` in both `/srv/mw-hygiene-p35-isolated/.env` and PostgreSQL `AppConfig`.
- **Compatibility Dashboard State:** `overallStatus: "UNVERIFIED"`, `mutationSafetyAllowed: false`, `phase1ReadOnly: true`, `isDemoMode: false`, `capabilityCounts: {"VERIFIED":1,"AVAILABLE_BUT_UNTESTED":2,"BLOCKED":4,"UNKNOWN":8}`.
- **Live Endpoint Reachability Check (`https://app.nohitchweb.com/`, read-only GET):**
  - `GET /backend/` → `302 /backend/index.php/guest/index` (behind Cloudflare)
  - `GET /customer/` → `302 /customer/index.php/guest/index`
  - `GET /` → `302 /index.php/site/offline` (`503`)
  - `GET /api/` → `503 {"status":"error","error":"Service Unavailable."}`
  - `GET /api/index.php/lists` → `503 {"status":"error","error":"Service Unavailable."}`
  - `GET /api/lists` → `404` HTML ("Page Not Found")

---

## 4. Public DNS Deliverability Diagnostics (`nohitchweb.com` — Stage H Partial)

| Record Type | Hostname | Observed Result | Assessment |
|---|---|---|---|
| **SPF (`TXT`)** | `nohitchweb.com` | `v=spf1 a mx ip4: 75.119.156.155 -all` | **CRITICAL FAIL:** Invalid space in `ip4: 75.119.156.155` (RFC 7208 syntax error), missing Alibaba DirectMail SPF `include`, `a` points to Cloudflare IPs (`104.21.22.110`, `172.67.204.139`), strict `-all`. |
| **DMARC (`TXT`)** | `_dmarc.nohitchweb.com` | `ERR:ENOTFOUND` | **CRITICAL FAIL:** No DMARC record published. Required by Gmail/Yahoo bulk-sender policies. |
| **DKIM (`TXT`)** | `{default,mail,dkim,aliyun,alibaba,directmail,dm,s1,s2,k1,selector1,selector2,google,nohitch}._domainkey.nohitchweb.com` | All `ERR:ENOTFOUND` | **UNVERIFIED / ABSENT ON APEX:** Either DKIM uses a non-standard selector / separate sending subdomain, or DKIM is missing for `@nohitchweb.com`. |
| **MX / A / PTR** | `nohitchweb.com`, `mail`, `smtp`, `app` | `MX: mail.nohitchweb.com` (`75.119.156.155`, PTR `vsvinc.nohitch.com`); `smtp.nohitchweb.com` → `75.119.156.155`; `app.nohitchweb.com` → Cloudflare (`104.21.22.110`, `172.67.204.139`) | Verified host resolution. |
| **Tracking CNAMEs** | `{track,tracking,click,link,go}.nohitchweb.com` | All `ERR:ENOTFOUND` | Tracking domain hostname requires inspection inside MailWizz once API/UI is checked. |

- **Distinction Note:** No controlled inbox seed tests, MailWizz campaign metrics, or Alibaba DirectMail RAM reports ran; therefore SMTP acceptance vs inbox placement vs tracked opens remain **unknown** at campaign level until Stages D–H complete.

---

## 5. Unresolved Blockers & Recommended Next Steps

1. **Create an Independent Recovery Copy of the Windows `age` Identity:**
   Copy `C:\Users\Administrator\.mw-hygiene-keys\backup-recovery.key` to an authorized off-device encrypted destination (e.g., separate hardware token, offline password manager vault, or distinct encrypted external/cloud drive not on `DeviceId: 0`).
2. **Verify MailWizz API Status & URL Routing:**
   In `https://app.nohitchweb.com/backend/`, confirm whether `Settings -> API -> API status` is enabled (currently `/api/index.php/lists` returns `503 Service Unavailable.`), and confirm clean URL rewriting if intending to use `https://app.nohitchweb.com/api` vs `https://app.nohitchweb.com/api/index.php`.
3. **Enter Read-Only Credentials in `http://127.0.0.1:13000` (over SSH tunnel):**
   Supply your MailWizz 3.0.5 API URL & API key (plus optional read-only Alibaba DirectMail RAM credentials) inside Settings so compatibility checks, the 25-subscriber sample, and the ~1,800-subscriber sync can run safely with `ENABLE_MAILWIZZ_MUTATIONS=false`.
4. **Fix `nohitchweb.com` DNS Immediately (Independent of Hygiene App):**
   - Remove the space in `ip4:75.119.156.155` and add the exact Alibaba DirectMail SPF `include` assigned to your DirectMail sending domain (or configure a dedicated sending subdomain).
   - Verify and publish the Alibaba DirectMail DKIM TXT record for the active `From:` domain.
   - Publish a baseline DMARC record (e.g., `v=DMARC1; p=none; rua=mailto:...`) at `_dmarc.nohitchweb.com` (and/or `_dmarc.<sending-subdomain>`).
