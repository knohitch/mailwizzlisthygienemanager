# Phase 3.5 — Live MailWizz 3.0.5 Integration & Subscriber Analysis Report

- **Date (UTC):** `2026-11-15T03:14:00Z`
- **Repository Branch:** `validation/phase-3.4-docker-acceptance`
- **Inspected Commit:** `f07985319f3a82c3fa223061f4dc93221bc4d3cd` (`f079853`)
- **Isolated Runtime Host:** `cloud-vps` (`100.95.86.56`), Compose project `mw-hygiene-p35-isolated`, directory `/srv/mw-hygiene-p35-isolated`, bound exclusively to `http://127.0.0.1:13000`
- **Decision Verdict:** **NO-GO** for subscriber import or cleanup review — stopped cleanly at Section 1 (`age` AEAD backup & off-VPS recovery key not yet installed/confirmed on `cloud-vps`) and Section 3 (explicit live connection authorization and MailWizz 3.0.5 API credentials not yet provided).

---

## 1. Backup Protection Validation (Pre-Import Gate)

### 1.1 Review of Prior Implementation
Review of commit `f079853`'s `scripts/backup-postgres.sh` / `scripts/restore-postgres.sh` identified two pre-import confidentiality/recoverability gaps:
1. **Unauthenticated cipher mode:** `openssl enc -aes-256-cbc -pbkdf2` provides confidentiality only (no AEAD integrity/authentication tag; `.sha256` sidecar files are not cryptographic AEAD).
2. **Co-located fallback secret:** Because `BACKUP_ENCRYPTION_KEY` was `UNSET` in `.env`, the script fell back to `APP_ENCRYPTION_KEY` stored on the same VPS, coupling PostgreSQL backup decryption to the application secret file.

### 1.2 Hardening Applied (`age` Authenticated Encryption + Off-VPS Recovery Key)
Updated the repository and host scripts without modifying runtime containers:
- [scripts/backup-postgres.sh](scripts/backup-postgres.sh): Requires `age` AEAD (`age -r "$BACKUP_AGE_RECIPIENT" -o ...`) writing `./backups/hygiene_db_<UTC>.dump.age` + `.sha256` under `umask 077` (`0600`), streams `pg_dump -F c` directly to `age` so zero temporary plaintext `.dump` files touch disk, removes fallback to `APP_ENCRYPTION_KEY`, and enforces `BACKUP_RETENTION_DAYS` (default `14`) with `shred -u`.
- [scripts/restore-postgres.sh](scripts/restore-postgres.sh): Requires `age`, checksum verification (`.sha256`), and an explicit off-VPS private recovery identity (`BACKUP_AGE_IDENTITY_FILE` or positional argument 2) supplied only at restore time; retains explicit `BACKUP_ENCRYPTION_KEY` path for legacy `.dump.enc` archives and refuses unencrypted `.dump` inputs.
- [.env.example](.env.example) & [docs/DEPLOYMENT_AND_OPERATING_MANUAL.md](DEPLOYMENT_AND_OPERATING_MANUAL.md): Documented dedicated off-VPS `age-keygen` workflow, `BACKUP_AGE_RECIPIENT`, `14`-day `shred -u` retention, and non-VPS recovery procedures.

### 1.3 Preservation & Blocking Status on `cloud-vps`
- Existing encrypted backup `backups/hygiene_db_20261115T030608Z.dump.enc` (`74,016` bytes, `-rw-------`) and `.sha256` (`113` bytes, `-rw-------`) remain **untouched**. No plaintext `.dump` files exist in `backups/`.
- `age v1.3.2` is present locally on the operator workstation, whereas on `cloud-vps`:
  - `age` / `age-keygen`: **Not installed** (apt candidate `age 1.1.1-1ubuntu0.24.04.3` is available).
  - `BACKUP_AGE_RECIPIENT`: **UNSET** (`BACKUP_ENCRYPTION_KEY: UNSET`).
  - Fail-closed verification on `cloud-vps`: `./scripts/backup-postgres.sh` exits immediately with `Error: 'age' is required for authenticated backup encryption (https://age-encryption.org).`
- **Section 1 Gate Status:** **BLOCKED** pending operator authorization to install `age` on `cloud-vps`, confirmation of an external off-VPS `age` private recovery key, setting `BACKUP_AGE_RECIPIENT` in `.env`, and a verified `.dump.age` restore test against `mw-hygiene-p35-isolated`.

---

## 2. Deployed Application Version & Provenance

LF-normalized SHA-256 digests of `/srv/mw-hygiene-p35-isolated` match local commit `f07985319f3a82c3fa223061f4dc93221bc4d3cd` (`validation/phase-3.4-docker-acceptance`):

| Component / Tree | Count / Scope | Verified LF SHA-256 / Prefix (Local `f079853` === `cloud-vps`) |
|---|---|---|
| `src/` | 94 files | `2e02e8352aa0d633bb7cf720552b74a3b93a28179c724705158e5735f2e61602` |
| `worker/` | 1 file | `46d0bb024fc1468574b416a3f6418160687b72dc0efbd89e9f16d41027b3341a` |
| `prisma/` | 7 files | `5f07467a29c36fa67da8db1b050885f5200777c0a88ca380966f9a8b1a58ac46` |
| `Dockerfile` | Web image build | `3ee165ff222e` |
| `Dockerfile.worker` | Worker / migrate build | `7639e373b3b2` |
| `docker-compose.yml` | Stack definition | `73d605f841a8` |
| `package.json` / `package-lock.json` | Dependencies | `3f79992002f9` / `4ebdc9d4f954` |
| `prisma/schema.prisma` | Schema | `6a23b26ad88b` |
| `scripts/docker-smoke.sh` | Smoke check script | `dc7e198f741d` |

### Running Container & Image IDs (`cloud-vps`)
- `mw-hygiene-p35-isolated-web-1` (`917e6217dd52`, `Up ... (healthy)`, `127.0.0.1:13000->3000/tcp`): image `mw-hygiene-p35-isolated-web` (`sha256:b653b77e4c5201f41f209d1b94dae18b286bf23f52cf4d2a388775d4cdbfdf38`, created `2026-11-15T03:37:43+01:00`).
- `mw-hygiene-p35-isolated-worker-1` (`8d1232667a8f`, `Up ... (healthy)`): image `mw-hygiene-p35-isolated-worker` (`sha256:e9681c17a3b161eb76889d08067f7023e653178e1228ad91238e4395a7f4cada`, created `2026-11-15T03:16:22+01:00`).
- `mw-hygiene-p35-isolated-migrate-1` (`5910b1d16ccc`, `Exited (0)`): image `sha256:e9681c17a3b161eb76889d08067f7023e653178e1228ad91238e4395a7f4cada`; `_prisma_migrations` verified 4 applied migrations (`20261114164734_init`, `20261114170053_phase2_hygiene_engine`, `20261114171713_phase3_deliverability_diagnostics`, `20261114190323_mailwizz_multi_version_compat`).
- `mw-hygiene-p35-isolated-postgres-1` (`9112a1c8fbef`, `Up ... (healthy)`, `5432/tcp` internal): `postgres:16-alpine` (`sha256:f377d590e5474681d4d7838635031a2b50647923b7abfa803ce9b5ff35d5c663`).
- **Deployment Rebuild Impact:** Backup scripts (`scripts/*`), `.env.example`, and documentation (`docs/*`) are excluded from the runtime container layers of `Dockerfile` (`public`, `.next/standalone`, `.next/static`, `prisma`) and `Dockerfile.worker` (`package.json`, `tsconfig.json`, `prisma`, `src`, `worker`). **No container rebuild is required.** CapRover workloads remain untouched.

---

## 3. Live MailWizz Connection, Compatibility & Safety Lock

Read-only inspection of `/srv/mw-hygiene-p35-isolated/.env` and PostgreSQL `AppConfig` confirms:
- `ENABLE_MAILWIZZ_MUTATIONS`: `false` (`GET /api/health` → `mailwizzMutationsEnabled: false`)
- `MAILWIZZ_API_URL`: `UNSET` (`AppConfig.mailwizzApiUrl = <unset>`)
- `MAILWIZZ_API_KEY`: `UNSET` (`AppConfig.mailwizzApiKeyEnc = NULL`)
- `MAILWIZZ_REPORTING_DB_URL`: `UNSET` (`AppConfig.reportingDbUrlEnc = NULL`)
- `mailwizzDetectedVersion`: `<unset>`
- `GET /api/compatibility`: `overallStatus: "UNVERIFIED"`, `mutationSafetyAllowed: false`, `phase1ReadOnly: true`, `isDemoMode: false`, capability counts `{"VERIFIED":1,"AVAILABLE_BUT_UNTESTED":2,"BLOCKED":4,"UNKNOWN":8}`.

Live API validation against MailWizz 3.0.5 was **not executed** because credentials and explicit connection authorization have not been provided.

---

## 4. Sample Ingestion, Target List Sync, Historical Engagement, & Deliverability

Zero synthetic or estimated metrics were substituted. All downstream analytical steps remain **Not Executed (Blocked)**:

| Phase Step | Status | Reason / Dependency |
|---|---|---|
| 25-subscriber sample validation (pagination, IDs, status/email mapping, consent, activity, duplicates, errors) | **Not Executed** | Blocked by Section 1 (`age` + off-VPS key) and Section 3 (MailWizz 3.0.5 URL/API key + connection authorization) |
| Target ~1,800-subscriber list sync & reconciliation | **Not Executed** | Requires passed 25-subscriber sample + explicit full-sync authorization |
| Historical engagement analysis (30/60/90/180/365d, opens, clicks, bounces, complaints, campaign exposure) | **Not Executed** | Requires MailWizz API sync + historical exports (or separately approved `SELECT`-only MySQL account) |
| Deliverability & DNS authentication (`SPF`, `DKIM`, `DMARC`, bounces, complaints, tracking audit) | **Not Executed** | Requires campaign telemetry + domain hostnames (`From:`, tracking domain, DKIM selector). Alibaba DirectMail remains an independent optional read-only feed and does not block MailWizz engagement analysis. |

### Subscriber Health Report Placeholder (Zero Real Data Imported Yet)
`MailingList=0`, `Subscriber=0`, `Campaign=0`, `EngagementEvent=0`, `DomainAuthCheck=0`, `DirectMailDailyMetric=0`. No list size, confirmed count, engaged/inactive breakdown, audience-reduction estimate, or re-engagement plan can be reported until verified live data is imported.

---

## 5. Exact Requirements Missing to Unblock Execution

To proceed cleanly from **NO-GO** into the 25-subscriber read-only sample and real ~1,800-subscriber analysis:

1. **Backup Gate (Section 1):**
   - Authorize installing `age` (`1.1.1-1ubuntu0.24.04.3`) on `cloud-vps`.
   - Confirm generation/storage of a dedicated off-VPS `age` private recovery key (for example generated locally via `age-keygen` on the operator workstation, keeping `AGE-SECRET-KEY-1...` strictly outside `cloud-vps`), add only its public `BACKUP_AGE_RECIPIENT="age1..."` to `.env`, and run one encrypted `.dump.age` backup + isolated restore verification.
2. **MailWizz 3.0.5 Read-Only Connection (Sections 3–4):**
   - Explicitly authorize connecting `mw-hygiene-p35-isolated` to your live MailWizz 3.0.5 server (`ENABLE_MAILWIZZ_MUTATIONS="false"`).
   - Provide the MailWizz 3.0.5 API base URL and read-only API key via the authenticated Settings UI (`http://127.0.0.1:13000` over SSH tunnel) or `.env`.
3. **Target List & Engagement / DNS Inputs (Sections 5–7):**
   - Confirm the target ~1,800-subscriber list (once `GET /lists` metadata is inspected read-only) for the 25-subscriber sample and subsequent read-only sync.
   - Provide or confirm the preferred historical engagement source (MailWizz API / exported campaign CSVs first; separately approved `SELECT`-only MySQL account only if exports/API lack subscriber-level history).
   - Provide sending `From:` domain(s), MailWizz tracking hostname (if configured), and DKIM selector(s) for DNS/tracking diagnostics (plus optional read-only Alibaba DirectMail RAM credentials when ready).
