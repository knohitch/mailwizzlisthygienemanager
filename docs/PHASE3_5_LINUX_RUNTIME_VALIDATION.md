# Phase 3.5 — Linux Docker Environment Validation Report

- **Repository Branch & Starting Commit:** `validation/phase-3.4-docker-acceptance` (`adf31d4` transferred & SHA-256 verified)
- **Target Host:** `cloud-vps` (`100.95.86.56` / `cloud.edfil.site`, Tailscale-only SSH)
- **Compose Project:** `mw-hygiene-p35-isolated` (`/srv/mw-hygiene-p35-isolated`, localhost `127.0.0.1:13000`)
- **Final Verdict:** **GO (Read-Only Phase 3.5 Integration) / NO-GO (Remote Mutations)**
  - **GO** to proceed into the separately authorized, strictly read-only **Phase 3.5 Integration** against live MailWizz 3.0.5 and Alibaba Cloud DirectMail while maintaining `ENABLE_MAILWIZZ_MUTATIONS="false"`.
  - **NO-GO** for enabling subscriber mutations or exposing port `13000` publicly without TLS/IP allowlist.

---

## 1. Selected Environment

| Metric | Observed Value on `cloud-vps` |
| --- | --- |
| Operating System | Ubuntu `24.04.4 LTS`, kernel `6.8.0-147-generic` |
| Docker / Compose | `Docker 29.4.0` (`build 9d7ad9f`), `Docker Compose v5.1.2` |
| Host Capacity | `4` vCPU, `7.8 GiB` RAM, `0B` swap (`5.1 GiB` available pre-deploy; `5.2 GiB` available post-deploy) |
| Disk Space (`/dev/sda1`) | `145G` total, `59G` free before -> **`51G` free after** image builds & containers (`65%` used) |
| Source Integrity | `git archive adf31d4` verified identical SHA-256 (`a7fa0e9b2a01526ba1387952e4520f0e3d20a1b7f162ad9d399554484b86884f`) before extraction |

---

## 2. Isolation Assessment & CapRover Preservation

- Isolated directory `/srv/mw-hygiene-p35-isolated` (`chmod 700`), `.env` (`chmod 600`), Compose project `mw-hygiene-p35-isolated`, isolated bridge network `mw-hygiene-p35-isolated_default`, dedicated volumes (`mw-hygiene-p35-isolated_postgres_data`, `mw-hygiene-p35-isolated_backups_data`), and fresh random Postgres/session/encryption secrets.
- Port binding strictly restricted to `127.0.0.1:13000->3000/tcp`; CapRover's `0.0.0.0:3000` (`captain-captain.1`), `80`/`443` (`captain-nginx.1`), all 6 existing PostgreSQL containers, 3 Redis instances, and all CapRover app/worker workloads remained continuously `Up` (`Up 2 days` / `Up 7 days`, zero unhealthy containers).
- Local `docker-compose.isolated.yml` enforced CPU limits (`postgres: 0.75`, `web: 1.0`, `worker: 0.75`), `mem_limit` (`512m` / `768m` / `512m`), `pids_limit: 256`, and `json-file` log rotation (`10m x 3`).
- Real MailWizz and Alibaba Cloud credentials remained unset throughout validation, and `ENABLE_MAILWIZZ_MUTATIONS="false"` was maintained in `.env` and `docker-compose.yml`.

---

## 3. Docker Build & Linux Fixes Applied

- **Built Images (`mw-hygiene-p35-isolated`):**
  - `mw-hygiene-p35-isolated-web:latest` — **`429MB`** (Next.js 16.4.6 Turbopack compile `77s`, TypeScript `118s`, `26/26` static pages).
  - `mw-hygiene-p35-isolated-worker:latest` — **`2.46GB`** (includes full `npm ci` dependency tree for `tsx` + Prisma CLI).
  - `mw-hygiene-p35-isolated-migrate:latest` — **`2.46GB`** (shares `Dockerfile.worker` layers).
- **Linux Runtime Defects Found & Fixed:**
  1. **Next.js Standalone Loopback Healthcheck (`web=unhealthy` -> `healthy`):** `node:22-alpine` assigns `HOSTNAME=<container-id>`, causing `server.js` to listen only on container `eth0` and fail internal `fetch('http://127.0.0.1:3000/api/health')` with `ECONNREFUSED 127.0.0.1:3000`. Added `ENV HOSTNAME=0.0.0.0` in [`Dockerfile`](../Dockerfile) and `HOSTNAME: "0.0.0.0"` on `web` in [`docker-compose.yml`](../docker-compose.yml), rebuilt `web`, and verified `internal_health_last_exit=0` and `web=healthy`.
  2. **CRLF Shebang Error in Shell Scripts:** Added `.gitattributes` (`*.sh text eol=lf`) and normalized LF line endings on `scripts/*.sh` after Linux flagged `/usr/bin/env: 'sh\r': No such file or directory`.

---

## 4. Deployment Authorization Status

- **Authorized & Executed:** Isolated Docker validation authorized specifically for `mw-hygiene-p35-isolated` on `cloud-vps` (`100.95.86.56`), port `13000`, with zero real MailWizz/Alibaba credentials and `ENABLE_MAILWIZZ_MUTATIONS="false"`.
- **Clean Pre-3.5 State Preserved:** Synthetic test rows (`p35_synth_list`, `p35-synthetic.invalid`) were cleared via `CLEAR_DEMO_DATA` + SQL cleanup after backup/restore and segmentation verification.

---

## 5. Executed Linux Runtime Tests (Real Command Results)

| # | Test Area | Observed Outcome on `cloud-vps` (`127.0.0.1:13000`) |
| --- | --- | --- |
| 1 | Container Image Builds | **PASSED** (`web` 429MB, `worker` 2.46GB, `migrate` 2.46GB) |
| 2 | Database Migrations | **PASSED** — all 4 Prisma migrations applied (`20261114164734_init` .. `20261114190323_mailwizz_multi_version_compat`) |
| 3 | Web, Worker & Postgres Health | **PASSED** — `health web=healthy worker=healthy postgres=healthy`; `GET /api/health` returned `{"status":"ok","database":"connected","worker":"healthy","phase":"phase-3-deliverability-ready","mailwizzMutationsEnabled":false}` |
| 4 | Auth & CSRF Protection | **PASSED** — unauthenticated `/api/dashboard` `401`; bad login `401`; valid login `200`; 64-char CSRF token issued; missing CSRF `POST /api/sync` rejected `403` |
| 5 | App Routes & Clean Dashboard | **PASSED** — `/`, `/login`, `/compatibility`, `/cleanup`, `/deliverability`, `/reports`, `/settings` all returned `HTTP 200`; initial dashboard empty (`0` subscribers, `0` lists) |
| 6 | Production Demo-Seed Safeguard | **PASSED** — `POST /api/sync` `{"action":"SEED_DEMO_DATA"}` blocked with `HTTP 403` (`NODE_ENV=production`) |
| 7 | Worker Processing & Mock Sync Client | **PASSED** — `ANALYZE_HYGIENE` job (`cmwh88esw000zmt07uvftl5g0`) claimed and completed (`COMPLETED`) by `worker` container; mocked `MailWizzClient.getLists` returned `listCount: 1` inside Linux worker |
| 8 | Segmentation & Dry-Run Cleanup + Mutation Lock | **PASSED** — `POST /api/subscribers/filter` matched synthetic `NEVER_ENGAGED` (`totalMatched: 1`); `POST /api/cleanup/preview` (`UNSUBSCRIBE`) generated `DRY_RUN_READY` (`matched: 3`, `eligible: 1`, `excluded: 2`); `POST /api/cleanup/execute` blocked with `HTTP 400` (`ENABLE_MAILWIZZ_MUTATIONS=false`) |
| 9 | Compatibility Dashboard & Synthetic DirectMail CSV | **PASSED** — `POST /api/compatibility` (`RUN_CHECK`) returned `UNVERIFIED` / `NOT_CONFIGURED` / `mutAllowed: false`; `POST /api/deliverability/alibaba` (`IMPORT_CSV`) imported `1` synthetic row |
| 10 | Disposable Backup & Restore | **PASSED** — `./scripts/backup-postgres.sh` created `.dump` & `.sha256` with `chmod 600`; deleted synthetic metric (`count=0`), verified SHA-256 (`OK`), restored via `./scripts/restore-postgres.sh` (`count=1`) |
| 11 | Container Restart Persistence | **PASSED** — `docker compose -p mw-hygiene-p35-isolated restart web worker` recovered both to `healthy`; `/api/health` confirmed `mailwizzMutationsEnabled: false`; dashboard retained `kpis.totalLists: 1`, `kpis.totalSubscribers: 3`, `phase1ReadOnly: true` |
| 12 | Network Exposure & Resource Usage | **PASSED** — `ss -tlnp` confirmed `127.0.0.1:13000` only; live `docker stats`: `postgres` `59.66MiB/512MiB` (`11.65%`, `14` PIDs), `web` `57.04MiB/768MiB` (`7.43%`, `19` PIDs), `worker` `44.12MiB/512MiB` (`8.62%`, `26` PIDs) — combined `~160.8MiB` |

---

## 6. Application & Worker Health Summary

- Post-cleanup `/api/health`: `{"status":"ok","database":"connected","worker":"healthy","phase":"phase-3-deliverability-ready","mailwizzMutationsEnabled":false}`.
- Zero restarts or degraded health on existing CapRover containers (`docker ps --filter "health=unhealthy"` empty).

---

## 7. Security & Image Layer Findings

- **Runtime User:** Confirmed `user=appuser:100` in both `mw-hygiene-p35-isolated-web` and `mw-hygiene-p35-isolated-worker`.
- **Advisories (`prisma` / `@prisma/config` / `deepmerge-ts`) Verified Directly Inside Built Images:**
  - `mw-hygiene-p35-isolated-web`: `deepmerge-ts=ABSENT`, `@prisma/config=ABSENT`, `prisma=ABSENT`, `@prisma/client=PRESENT`. **Zero runtime exposure.**
  - `mw-hygiene-p35-isolated-worker` / `migrate`: `deepmerge-ts=PRESENT`, `@prisma/config=PRESENT`, `prisma=PRESENT` (`2.46GB` full `npm ci` layer). Used only for `prisma migrate deploy` over local trusted migration files during one-shot `migrate`; never imported by `worker/` runtime code, though reducing worker image bloat and evaluating Prisma `7.x` remains an open post-3.5 improvement.

---

## 8. Backup & Restore Verification

- `./scripts/backup-postgres.sh` produced `./backups/hygiene_db_20261115T024110Z.dump` (`600`) and `.sha256` (`600`).
- `./scripts/restore-postgres.sh` validated checksum (`OK`) and restored deleted rows (`0 -> 1`) exclusively against `mw-hygiene-p35-isolated-postgres-1` (`mailwizz_hygiene_p35`).

---

## 9. Remaining Blockers

1. Separate explicit authorization to configure live **read-only** MailWizz 3.0.5 API credentials, Priority C `SELECT`-only MySQL reporting DB (or verified CSV exports), and Alibaba Cloud DirectMail reporting.
2. When promoting beyond SSH-tunneled validation on `127.0.0.1:13000` to an authenticated HTTPS endpoint, switch `COOKIE_SECURE="true"` and configure `ALLOWED_ADMIN_IPS`/`ALLOWED_ADMIN_CIDRS`.
3. Optional post-3.5 image optimization: prune devDependencies (`playwright`, `eslint`, etc.) and build-only CLI packages from the `worker` runtime stage to shrink `2.46GB` -> `<500MB`.

---

## 10. Next Steps for Read-Only MailWizz 3.0.5 Integration

1. Maintain `ENABLE_MAILWIZZ_MUTATIONS="false"` and keep access tunneled (`ssh -N -L 13000:127.0.0.1:13000 cloud-vps`) or behind TLS + VPN ACL.
2. Follow [`docs/PHASE3_5_LIVE_INTEGRATION_RUNBOOK.md`](./PHASE3_5_LIVE_INTEGRATION_RUNBOOK.md) once explicitly authorized to test live read-only MailWizz 3.0.5 connection validation, capability checks, subscriber/campaign sync, engagement history hydration, DirectMail reporting, and count reconciliation.
