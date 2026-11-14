# MailWizz List Hygiene Manager (Phases 1–3 Complete)

A self-hosted, security-hardened web application for **MailWizz 3.0.5** (with Alibaba Cloud DirectMail SMTP) that analyzes mailing lists, classifies multi-window engagement, manages dry-run segmentation/suppression/cleanup workflows, provides source-separated deliverability & domain authentication diagnostics, and prepares safe self-hosted deployment.

> **Mutation Safety Gate:** All MailWizz write/mutation interfaces remain **locked by default** behind `ENABLE_MAILWIZZ_MUTATIONS="false"`. Only read-only diagnostics, local suppression/filtering, dry-run previews, and CSV exports run while this flag is `false`.

---

## Architecture

- **Web Console (`src/app`, `src/components`)**: Next.js (App Router) + TypeScript + Tailwind CSS + Radix UI accessible components.
- **Database & Durable Queue (`prisma/schema.prisma`)**: PostgreSQL + Prisma ORM (`SyncJob` table with `FOR UPDATE SKIP LOCKED` atomic claiming).
- **Dedicated Background Worker (`worker/index.ts`)**: Independent Node/TypeScript worker process handling full syncs, list syncs, hygiene recomputation, scheduled syncs, and retention cleanup.
- **MailWizz 3.0.5 Connector (`src/services/mailwizz/`)**:
  - `X-Api-Key` header authentication, TLS enforcement, token-bucket rate limiting (`maxApiRequestsPerSecond`), exponential backoff retries on `429`/`5xx`, and full pagination.
  - Priority B CSV/JSON verified report importer (`report-import.ts`).
  - Priority C optional `SELECT`-only MySQL reporting DB connector with `INFORMATION_SCHEMA` verification (`reporting-db.ts`).
  - Priority D live webhook ingestion endpoint (`POST /api/webhooks/mailwizz`, tagged `isHistorical: false`).
- **Engagement Analysis Engine (`src/services/analysis/`)**:
  - Tracks **Strong Engagement** (clicks, replies, conversions) separately from **Open-Only Engagement** (subject to Apple Mail Privacy Protection / image proxy false opens).
  - Enforces minimum delivered campaigns threshold (default `5`) before classifying inactivity.
  - Labels subscribers **`UNKNOWN`** and disables inactivity classification whenever subscriber-level delivery/engagement history is unavailable.
- **Security (`src/services/security/`)**:
  - Single-administrator authentication with `scrypt` password verification and PostgreSQL-backed HTTP-only sessions.
  - Per-session HMAC CSRF protection (`X-CSRF-Token`).
  - AES-256-GCM encryption for stored API keys, reporting DB URIs, webhook secrets, and encrypted subscriber exports (`.enc.json`).
  - Automatic PII and secret redaction in logs and audit records.

---

## Quick Start (Local Development)

1. **Copy environment template:**
   ```bash
   cp .env.example .env
   ```
   Generate strong secrets for `APP_SESSION_SECRET` and `APP_ENCRYPTION_KEY`:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
   Set `DATABASE_URL`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` in `.env`.

2. **Install dependencies & migrate database:**
   ```bash
   npm install
   npx prisma generate
   npx prisma migrate deploy
   ```

3. **(Optional) Load synthetic demo fixtures (~2,190 subscribers including a 1,800-subscriber list):**
   ```bash
   npm run db:seed
   ```

4. **Start the web server and background worker:**
   ```bash
   npm run dev
   # In a second terminal:
   npm run worker
   ```

5. Open `http://localhost:3000` and sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

---

## Self-Hosted Deployment (Docker Compose)

1. Ensure `.env` exists with strong `POSTGRES_PASSWORD`, `ADMIN_PASSWORD`, `APP_SESSION_SECRET`, `APP_ENCRYPTION_KEY`, and `COOKIE_SECURE="true"` (when behind HTTPS reverse proxy).
2. Build and start all services (`postgres`, `migrate`, `web`, `worker`):
   ```bash
   docker compose up -d --build
   ```
3. Check health:
   ```bash
   curl http://localhost:3000/api/health
   ```

Note: Do **not** embed secrets into Docker images. `Dockerfile` and `Dockerfile.worker` load configuration exclusively at runtime from `.env` / environment variables.

---

## Testing & Verification

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

---

## Documentation & Operations Reports

- [MailWizz 3.0.5 API Capability Matrix](docs/API_CAPABILITY_MATRIX.md)
- [Historical Engagement Technical Report](docs/HISTORICAL_ENGAGEMENT_REPORT.md)
- [Deployment & Operating Manual](docs/DEPLOYMENT_AND_OPERATING_MANUAL.md)
- [Phase 3 Final Handover Report](docs/PHASE3_HANDOVER_REPORT.md)
