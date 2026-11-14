# Deployment & Operating Manual — MailWizz List Hygiene Manager

This manual describes safe, isolated self-hosted deployment and day-to-day operation of **MailWizz List Hygiene Manager** alongside **MailWizz 3.0.5** and **Alibaba Cloud DirectMail (SMTP)**.

> **CRITICAL ARCHITECTURAL RULE:** Deploy this application on an **isolated host, VM, or Docker stack** separate from your MailWizz production web/SMTP server. It must never touch MailWizz core files, MailWizz queues, or Alibaba DirectMail SMTP credentials.

---

## 1. Minimum Resource Requirements

For ~1,800–25,000 subscribers:
- **CPU:** 2 vCPU (1 vCPU shared minimum; container limits configured in `docker-compose.yml`)
- **RAM:** 2 GB total system RAM (`web`: 768 MB limit, `worker`: 512 MB limit, `postgres`: 512 MB limit)
- **Disk:** 10 GB SSD minimum (plus space for PostgreSQL WAL and encrypted backups)
- **OS:** Linux (Ubuntu 22.04/24.04 or Debian 12) with Docker Engine + Docker Compose v2

---

## 2. Environment Configuration (`.env`)

Copy `.env.example` to `.env` (`chmod 600 .env`) and configure:

| Variable | Requirement | Purpose |
| --- | --- | --- |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | Mandatory | Dedicated application PostgreSQL database |
| `DATABASE_URL` | Mandatory | `postgresql://<user>:<pass>@postgres:5432/<db>` |
| `APP_BASE_URL` | Mandatory | Public HTTPS URL behind reverse proxy (`https://hygiene.internal.example.com`) |
| `ADMIN_EMAIL` | Mandatory | Single administrator login email |
| `ADMIN_PASSWORD_HASH` (or `ADMIN_PASSWORD`) | Mandatory | `scrypt$salt$hash` preferred in production |
| `APP_SESSION_SECRET` | Mandatory (32+ chars) | `openssl rand -hex 32` |
| `APP_ENCRYPTION_KEY` | Mandatory (32+ chars) | AES-256-GCM key for encrypted secrets & `.enc.json` backups (**back up separately!**) |
| `COOKIE_SECURE` | `"true"` in prod | Requires HTTPS TLS termination |
| `ENABLE_MAILWIZZ_MUTATIONS` | `"false"` initially | Master lock disabling live MailWizz list/subscriber writes until operator sign-off |
| `APP_BIND_HOST` / `APP_PORT` | `127.0.0.1` / `3000` | Binds Next.js to localhost only so reverse proxy handles TLS & network ACLs |
| `ALLOWED_ADMIN_IPS` / `ALLOWED_ADMIN_CIDRS` | Recommended | Comma-separated office/VPN IPs or CIDRs (`10.8.0.0/24`) enforced at app auth layer |

---

## 3. Reverse Proxy & TLS (Never Expose Publicly Unencrypted)

Do **not** expose port `3000` directly to the public internet. Place **Caddy** or **Nginx** in front with TLS 1.2+/1.3, VPN/IP allowlisting, and forwarded IP headers.

### Example Nginx Config
```nginx
server {
    listen 443 ssl http2;
    server_name hygiene.internal.example.com;

    ssl_certificate     /etc/letsencrypt/live/hygiene.internal.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/hygiene.internal.example.com/privkey.pem;

    # Restrict to office/VPN IPs in addition to ALLOWED_ADMIN_CIDRS
    allow 10.8.0.0/24;
    deny all;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Example Caddyfile
```caddy
hygiene.internal.example.com {
    @blocked not remote_ip 10.8.0.0/24 127.0.0.1
    respond @blocked 403
    reverse_proxy 127.0.0.1:3000
}
```

---

## 4. Database Migration & Service Startup

1. Run schema migration (handled automatically by the `migrate` one-shot service in `docker-compose.yml`):
   ```bash
   docker compose run --rm migrate
   ```
2. Start PostgreSQL, Web Console, and Background Worker:
   ```bash
   docker compose up -d --build
   ```
3. Verify container health and `/api/health`:
   ```bash
   docker compose ps
   curl -fsS http://127.0.0.1:3000/api/health
   ```
   Expected response includes `"status":"ok"`, `"database":"connected"`, `"worker":"healthy"`, and `"mailwizzMutationsEnabled":false`.

---

## 5. Worker Supervision & Restart Policies

- Both `web` and `worker` services define `restart: unless-stopped`, `init: true`, memory caps (`768m` / `512m`), and Docker `healthcheck` directives.
- The worker (`worker/index.ts`) claims queued jobs atomically via PostgreSQL `FOR UPDATE SKIP LOCKED` and updates `heartbeatAt` continuously.
- If a container stops mid-batch, any unacknowledged chunk resumes from `CleanupOperation.checkpointIndex` with idempotency keys (`CleanupOperationRecord.idempotencyKey`) preventing duplicate MailWizz mutations.
- Inspect worker logs cleanly without exposing subscriber PII:
  ```bash
  docker compose logs -f --tail=100 worker
  ```

---

## 6. Backup & Restore Procedures

Always retain **both** the PostgreSQL dump **and** your offline copy of `APP_ENCRYPTION_KEY` (encrypted secrets and `.enc.json` snapshots cannot be decrypted without `APP_ENCRYPTION_KEY`).

### Automated PostgreSQL Backup
Run `./scripts/backup-postgres.sh` (or schedule via host `cron`):
```bash
./scripts/backup-postgres.sh
```
This produces `./backups/hygiene_db_<UTC>.dump` plus a `.sha256` checksum file.

### PostgreSQL Restore
```bash
./scripts/restore-postgres.sh ./backups/hygiene_db_<UTC>.dump
docker compose restart web worker
```

### Application Logical Config & Deliverability Snapshot
In addition to `pg_dump`, `src/services/security/backup.ts` (`exportEncryptedAppBackup` / `restoreEncryptedAppBackup`) produces AES-256-GCM encrypted, SHA-256 verified JSON backups of rule settings, saved smart filters, DNS checks, Alibaba DirectMail metrics, seed inbox placement logs, and Postmaster stats without exporting raw subscriber PII.

---

## 7. Enabling Live MailWizz Mutations (Explicit Operator Approval Required)

Keep `ENABLE_MAILWIZZ_MUTATIONS="false"` until you have:
1. Validated MailWizz 3.0.5 API connectivity (`Settings & Sources`).
2. Verified historical engagement coverage (API + MySQL Read-Only Reporting DB or CSV report imports).
3. Reviewed Dry-Run reports and target subscriber counts on `/cleanup` and `/reengagement`.
4. Confirmed target domain SPF/DKIM/DMARC checks on `/deliverability`.

Only when explicitly ready, set `ENABLE_MAILWIZZ_MUTATIONS="true"` in `.env` and recreate `web` + `worker`:
```bash
docker compose up -d --force-recreate web worker
```
Large-batch safeguards (`> largeChangeThreshold`, default `100` subscribers) and exact list-name + count typing remain mandatory even when mutations are enabled.
