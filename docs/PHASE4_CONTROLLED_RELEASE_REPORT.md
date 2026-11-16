# MailWizz List Hygiene Manager — Phase 4 Controlled Release Report

- **Date (UTC):** `2026-11-16T17:06:00Z`
- **Repository Branch:** `feature/phase-4-multi-customer-api` (not merged or pushed)
- **Validated Release Commit:** `638cfc2a66dd20ec1640f328ccebb572af9d7856` (`638cfc2`) — code verified identical to canary runtime commit `6fc8a4f` (difference is strictly documentation file `docs/PHASE4_STAGING_ACCEPTANCE_REPORT.md`)
- **Release Tarball SHA-256 (`mw-hygiene-p4-638cfc2.tar.gz`):** `0ad3a879b619512de88f439e649f678424f348ae7f1cd6094225a05b02fbc0d0` (matched before extraction)
- **Upgraded Environment:** `/srv/mw-hygiene-p35-isolated` on `cloud-vps` (`100.95.86.56`), Compose project `mw-hygiene-p35-isolated`, localhost-only port `127.0.0.1:13000`
- **Canary & CapRover Preservation:** Phase 4 canary (`mw-hygiene-p4-canary`, `127.0.0.1:13001`) and all CapRover services remained untouched and healthy

---

## Plain-English Executive Summary

The isolated Hygiene Manager (`mw-hygiene-p35-isolated` at `http://127.0.0.1:13000`) has been **safely upgraded** to Phase 4 multi-customer support without losing any configuration, session, capability, or audit records and without affecting CapRover apps or the canary server. All 6 database migrations applied cleanly, `/connections` is live, and all subscriber write/mutation locks remain `false` (strictly read-only).

Live retesting also confirmed that **MailWizz (`https://app.nohitchweb.com/`) is back online** and its API responds normally at `https://app.nohitchweb.com/api/index.php` (requiring `/api/index.php` and valid customer API keys).

However, **no real customer API keys or real subscribers were imported yet**. Before storing real keys or importing subscriber records, one remaining recovery safeguard must be completed: placing and verifying a second copy of the private `backup-recovery.key` on an authorized encrypted disk outside Windows Virtual Disk `0`.

### Explicit Release Decisions

| Gate / Capability | Decision | Reason |
|---|---|---|
| **1. Phase 4 Software & Schema Deployment (`p35`)** | **GO (COMPLETED)** | Upgraded safely to `638cfc2` with zero data loss, all 6 Prisma migrations applied, and all containers healthy. |
| **2. Real Customer API Credential Onboarding** | **HOLD / BLOCKED** | Blocked pending verified independent off-disk recovery-key copy (plus user supplying the authorized customer API key(s)). |
| **3. Read-Only Subscriber Synchronization** | **HOLD / BLOCKED** | Blocked by Gate 2 (`backup-recovery.key` off-disk redundancy) and awaiting first customer API key validation + ≤25-record mapping check. |
| **4. Live Subscriber Modifications (`ENABLE_MAILWIZZ_MUTATIONS`)** | **NO-GO (LOCKED OFF)** | `ENABLE_MAILWIZZ_MUTATIONS=false` remains enforced everywhere; zero MailWizz subscriber mutations allowed. |

---

## 1. Source Reconciliation & Deployment Version

- Reconciled `6fc8a4f` (canary-verified code) vs `638cfc2` (`HEAD` of `feature/phase-4-multi-customer-api`): `git diff 6fc8a4f..638cfc2 --stat` showed **only** `docs/PHASE4_STAGING_ACCEPTANCE_REPORT.md` (`+149` lines, zero application, worker, or Prisma changes).
- Exported commit `638cfc2a66dd20ec1640f328ccebb572af9d7856`, verified SHA-256 `0ad3a879b619512de88f439e649f678424f348ae7f1cd6094225a05b02fbc0d0` on both Windows and `cloud-vps`, and extracted into `/srv/mw-hygiene-p35-isolated` without altering `.env`, `docker-compose.isolated.yml`, or `./backups/`.

---

## 2. Backup & Independent Recovery-Key Gate Results

- **Pre-Upgrade Encrypted Backup of `p35` (`COMPLETED`):**
  - Ran `/srv/mw-hygiene-p35-isolated/scripts/backup-postgres.sh` before modifying `p35`:
    - Created `./backups/hygiene_db_20261116T165913Z.dump.age` (`74,643` bytes, SHA-256 `b668356b96cdfadcdf5b0ff54bbeb2c6dc393293dda0c7fcc1aea4529bf49fb9`).
    - Verified `sha256sum -c` on `cloud-vps` and SHA-256 match on Windows.
    - Verified off-VPS decryption on Windows with `C:\Users\Administrator\.mw-hygiene-keys\backup-recovery.key` streamed via SSH into disposable database `p35_preupgrade_restore_verify` (`migs=4, cfgs=1, caps=30, audits=19, sessions=9, subs=0`), then dropped the temporary database and deleted temporary local scratch files cleanly.
    - All prior encrypted backups (`hygiene_db_20261115T030608Z.dump.enc`, `hygiene_db_20261115T033016Z.dump.age`) remain preserved.
- **Independent Off-Disk Recovery-Key Check (`BLOCKED`):**
  - Windows host has a single virtual hard disk (`DeviceId: 0`, `Virtual HD`) holding both `C:` and `E:`; `OneDrive` / `OneDriveCommercial` are unset.
  - `net use` shows an active Microsoft Terminal Services redirected drive `\\TSCLIENT\C` (the RDP client's `C:` drive), which is physically outside `Virtual HD` `0`, **but** Windows TSCLIENT SMB redirection does not expose client-host BitLocker/disk-encryption status to this session, and no specific folder path on `\\TSCLIENT\C` has been designated or verified as encrypted by the user.
  - Per policy, **no copy was written to `\\TSCLIENT\C`**, the private key was **never uploaded to `cloud-vps` or Git**, and **real customer credentials + subscriber imports remain BLOCKED** until the user designates/verifies an authorized encrypted off-disk destination and confirms the duplicate key copy matches.

---

## 3. Database Migration & Preservation Results (`p35`)

- Stopped `mw-hygiene-p35-isolated` `web` and `worker` cleanly before running migrations.
- Applied Phase 4 migrations via `migrate`:
  - `20261116000000_phase4_multi_customer_connections`
  - `20261116120000_phase4_safe_archive_restrict_fk`
- Verified `npx prisma migrate status`: **6 migrations applied, `Database schema is up to date!`**.
- **Pre-Upgrade & Post-Upgrade Record Preservation (`mailwizz_hygiene_p35`):**
  - `AppConfig`: `1` (`has_url=f`, `has_key=f`, `isDemoMode=f`, `lookbackDays=90`, `minDeliveredCampaigns=5`) — preserved `1 -> 1`.
  - `AdminSession`: preserved (`9` pre-upgrade).
  - `AuditLog`: `19` pre-upgrade preserved (`28` after post-upgrade verification tests).
  - `ApiCapabilityCheck`: `30 -> 30` (safely quarantined under `conn-legacy-quarantine`, `status=LEGACY_QUARANTINE`, `isEnabled=f`, `isQuarantine=t`).
  - `MailingList`: `0 -> 0`; `Subscriber`: `0 -> 0`.
- **Canary Audit-Row Discrepancy Reconciled:** Verified live `mw-hygiene-p4-canary-postgres-1` `"AuditLog"` table holds **`31`** rows (`canary_live_audits = 31`). The earlier `16` vs `31` difference occurred between an earlier incomplete run snapshot notification and the completed run captured in `hygiene_db_20261116T155131Z.dump.age`, whose restored database verified `audits = 31`.

---

## 4. Docker Image IDs & Runtime Health (`p35`)

- **Previous `p35` Images (Recorded Pre-Upgrade):**
  - `web`: `sha256:b653b77e4c5201f41f209d1b94dae18b286bf23f52cf4d2a388775d4cdbfdf38`
  - `worker`: `sha256:e9681c17a3b161eb76889d08067f7023e653178e1228ad91238e4395a7f4cada`
  - `postgres`: `postgres:16-alpine` (`sha256:f377d590e5474681d4d7838635031a2b50647923b7abfa803ce9b5ff35d5c663`)
- **Upgraded `p35` Containers & Images (`638cfc2`):**
  - `mw-hygiene-p35-isolated-web-1` (`cbacdd73f947...`): `sha256:1b3b8c97ccf03206b13f8529ce0f5ad0ac710d592849bebbade1a0aa5334a605` — **`Up (healthy)`** (`127.0.0.1:13000->3000/tcp`)
  - `mw-hygiene-p35-isolated-worker-1` (`bf2a21353ac4...`): `sha256:a656f05650241fb9aee0f0ba00db6c55d2fb00aa1e4c90aace798607228102da` — **`Up (healthy)`**
  - `mw-hygiene-p35-isolated-postgres-1` (`9112a1c8fbef...`): `sha256:f377d590e5474681d4d7838635031a2b50647923b7abfa803ce9b5ff35d5c663` — **`Up 39 hours (healthy)`** (preserved!)
  - `mw-hygiene-p35-isolated-migrate-1`: `sha256:0e58378549fe...` — **`Exited (0)`**
- **`GET http://127.0.0.1:13000/api/health`:** `200 OK` -> `{"status":"ok","database":"connected","worker":"healthy","phase":"phase-3-deliverability-ready","mailwizzMutationsEnabled":false,...}`.
- **Canary & CapRover:** All 3 canary containers (`13001`) and all CapRover containers (`Up 3–9 days`) remained healthy and untouched.

---

## 5. Customer Connections Post-Upgrade Functional Verification (`p35`)

Tested live against `http://127.0.0.1:13000` using temporary empty synthetic fixtures (removed cleanly after testing, leaving zero synthetic customers or lists behind):
- Unauthenticated `GET /api/connections` (`401`), invalid login (`401`), missing CSRF `POST /api/connections` (`403`).
- All SSR pages (`/connections`, `/compatibility`, `/reports`, `/settings`, `/deliverability`, `/`) returned `200 OK`.
- Exercised full synthetic Add -> Edit -> Disable -> Re-enable (`isPaused=false` restored) -> Key Rotation (`****4321` -> `****8765`, `v2`, zero plaintext leak) -> Scoped Compatibility (`mutationSafetyAllowed=false`) -> Scoped Dashboard (`scope='CUSTOMER'`, `phase1ReadOnly=true`) -> Safe Archive (`hasActiveCredential=false`, `status='DISABLED'`) -> Empty Connection Delete (`200 OK`).

---

## 6. MailWizz 3.0.5 API Accessibility Recheck (`https://app.nohitchweb.com/`)

Read-only `curl` checks against `https://app.nohitchweb.com/` on `2026-11-16T16:58:17Z` confirmed MailWizz is back online:
- `GET https://app.nohitchweb.com/` -> **`HTTP/2 200`** (MailWizz web frontend live; previous `/index.php/site/offline` redirect cleared).
- `GET https://app.nohitchweb.com/customer/index.php/guest/index` -> **`HTTP/2 200`**.
- `GET https://app.nohitchweb.com/api/` & `GET https://app.nohitchweb.com/api/index.php` -> **`HTTP/2 200`**, `content-type: application/json; charset=UTF-8`, body `[]` (previous `503` resolved).
- `GET https://app.nohitchweb.com/api/index.php/lists` (unauthenticated) -> **`HTTP/2 400`**, JSON `{"status":"error","error":"Invalid API request params. Please refer to the documentation."}` (confirms active MailWizz API handler requiring API credentials/signature).
- `GET https://app.nohitchweb.com/api/lists` (without `/index.php`) -> **`HTTP/2 404`** HTML ("Page Not Found").
- **Cloudflare Proxy:** `server: cloudflare`, `cf-cache-status: DYNAMIC`; no JS challenge, Turnstile, or WAF block interfered with `/api/index.php/*` JSON responses.
- **Configured API Base URL to Use:** `https://app.nohitchweb.com/api/index.php`.

---

## 7. First Customer Connection Readiness & Preserved Deliverability Scope

- `/connections` on `http://127.0.0.1:13000` is ready to accept multiple customer API keys with per-customer encryption (`APP_ENCRYPTION_KEY`), masked UI/API projections, SSRF checks, per-customer + per-installation rate caps, compatibility gating, and Safe Archive protection.
- **No MailWizz DB extraction attempted** and **no customer API key stored** because the off-disk recovery-key gate remains open and no authorized key has been supplied yet.
- **Alibaba DirectMail & Sending Domains Preserved Unchanged:** `thevelvury.com`, `nhwmedia.com`, `kennynwakanma.com`, and `stockattic.com` remain our independent marketing sending domains; `nohitchweb.com` remains MailWizz application hosting only. Zero DNS, SPF, DKIM, DMARC, MailWizz SMTP, or Alibaba configuration changes were made.

---

## 8. Remaining Dependency Advisories & Rollback Reference

- `npm audit --omit=dev`: 3 high-severity transitive findings (`deepmerge-ts <8.0.0`, GHSA-ggr8-5vv4-36mx via `prisma` -> `@prisma/config`; suggested fix proposes breaking major upgrade to `prisma@7.10.1`); Next.js runtime dependencies clear.
- **Rollback Reference (if ever required):** Pre-upgrade `.dump.age` (`./backups/hygiene_db_20261116T165913Z.dump.age`) plus `scripts/restore-postgres.sh` and pre-Phase-4 image SHA IDs documented in Section 4 allow full restoration without data loss.

---

## 9. Exact Remaining Steps Before Beginning Live Subscriber Analysis

1. **Satisfy Independent Off-Disk Recovery Key Gate:** Confirm whether a specific folder on `\\TSCLIENT\C` (on an encrypted client PC disk) or an external encrypted vault/USB volume is authorized, copy `C:\Users\Administrator\.mw-hygiene-keys\backup-recovery.key` to that destination, and verify SHA-256 parity against the primary Windows copy.
2. **Connect First Authorized Customer API Key via `/connections` (SSH tunnel to `http://127.0.0.1:13000`):**
   - Click **Add Customer Connection** on `/connections` (`https://app.nohitchweb.com/api/index.php`, `authMode: x-api-key` or `auto`, enter the customer's authorized MailWizz 3.0.5 API key while keeping `ENABLE_MAILWIZZ_MUTATIONS=false`).
3. **Validate Read-Only & Run First Bounded Verification:**
   - Click **Validate** (`CONNECTED`, confirm MailWizz `3.0.5` detected and Auth mode verified).
   - Open `/compatibility?customerConnectionId=<id>` and run **Read-Only Compatibility Check**.
   - Click **Sample (<=10)** (or run bounded ≤25-subscriber inspection) to list accessible MailWizz list names/counts and verify field mapping with PII masked before authorizing full read-only list sync (`Sync Read-Only`).
