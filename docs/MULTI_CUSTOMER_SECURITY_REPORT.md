# Multi-Customer API Security & Isolation Report (Phase 4)

## 1. Threat Model & Tenant Boundary Summary

Supporting multiple MailWizz customer API keys—especially when customers share the same MailWizz host (`https://app.nohitchweb.com/api/index.php`)—introduces critical security risks:
- Cross-customer subscriber/list leakage when UIDs (`list_uid`, `campaign_uid`, `subscriber_uid`) or emails exist across two customer accounts.
- Plaintext API key / webhook secret / reporting DB credential disclosure in API JSON responses, React state, server logs, or error stacks.
- SSRF/downgrade attacks via user-supplied MailWizz base URLs (`http://`, localhost, RFC1918/link-local/CGNAT/IPv6 ULA IPs).
- Unauthenticated or CSRF-forged connection management, key rotation, sync triggers, or destructive deletions.
- Replay/spoofing across webhook endpoints or stale worker jobs executing with revoked/rotated credentials.

---

## 2. Cryptographic & Credential Hygiene Controls

- **Authenticated Encryption at Rest (`AES-256-GCM`)**: Implemented in [`src/services/security/crypto.ts`](file:///E:/MyCodes/MailWizz%20List%20Hygiene%20Manager/src/services/security/crypto.ts). Each customer `MailWizzConnectionCredential.apiKeyEnc`, `MailWizzCustomerConnection.webhookSecretEnc`, and `MailWizzCustomerConnection.reportingDbUrlEnc` is encrypted with a fresh 12-byte random IV and 16-byte GCM auth tag derived from `APP_ENCRYPTION_KEY`.
- **Safe API / UI Projection (`SafeCustomerConnectionDto`)**: API handlers under `/api/connections*` never return `apiKeyEnc`, plaintext API keys, `webhookSecretEnc`, plaintext webhook secrets, or `reportingDbUrlEnc`. Only masked forms (`****<last4>`), SHA-256 fingerprints (`computeApiKeyFingerprint`), and boolean presence flags are serialized.
- **Rotation & Revocation Fencing**:
  - Rotating an API key (`ROTATE_KEY`) atomically marks prior credentials `ROTATED` (`isActive = false`, `rotatedAt = now()`), inserts an incremented `version` `ACTIVE` credential, and updates `apiKeyLast4`.
  - Revoking (`REVOKE_KEY`) sets `status = 'REVOKED'` (`isActive = false`), flips connection status to `AUTH_FAILED`, and blocks any further client creation.
  - `SyncJob.credentialVersion` is checked at execution time in [`src/services/jobs/handlers.ts`](file:///E:/MyCodes/MailWizz%20List%20Hygiene%20Manager/src/services/jobs/handlers.ts); stale queued jobs self-cancel before contacting MailWizz.
- **Log & Error Redaction**: [`src/services/security/logger.ts`](file:///E:/MyCodes/MailWizz%20List%20Hygiene%20Manager/src/services/security/logger.ts) (`redactSensitiveString`) and [`src/services/mailwizz/connections.ts`](file:///E:/MyCodes/MailWizz%20List%20Hygiene%20Manager/src/services/mailwizz/connections.ts) (`redactErrorMessage`) strip inline `X-Api-Key`, `Bearer`, `token=`, `password=`, `secret=`, and DB URI passwords before storing `lastErrorSafe` or emitting structured JSON logs.

---

## 3. Network, SSRF & Authentication Enforcement

- **Strict URL & SSRF Validation (`validateAndNormalizeConnectionUrl`)**:
  - Requires HTTPS in production/standard connections (HTTP rejected fail-closed; credentials in URL `username:password` rejected).
  - Blocks loopback (`localhost`, `127.0.0.0/8`, `::1`), RFC1918 private (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), link-local/cloud metadata (`169.254.0.0/16`, `fe80::/10`), CGNAT (`100.64.0.0/10`), `.local`, `.internal`, `.localhost`, and unroutable ranges; DNS-level SSRF checks remain enforced in `assertSafeOutboundUrl`.
- **Session, CSRF & Rate-Limit Controls (`requireApiAuth`)**:
  - Every connection read, create, update, rotate, revoke, validate, sample, sync, compatibility, and delete endpoint requires a valid HMAC-signed admin session cookie (`401 Unauthorized` when missing).
  - All state-changing methods (`POST`, `PATCH`, `DELETE`) require valid double-submit / session-bound CSRF headers (`requireCsrf: true`) and dedicated rate-limit buckets.
- **Typed Confirmation for Destructive Local Removal**: `DELETE /api/connections/[id]` requires `confirmationPhrase` to match exact `customerName` or `customerSlug` (`400` otherwise) and triggers cascade deletion inside PostgreSQL without issuing any remote MailWizz delete API calls.

---

## 4. Fail-Closed Tenant Isolation & Read-Only Safety Matrix

| Vector | Control Enforced |
| --- | --- |
| Cross-customer `listId` substitution in cleanup / filter / export / sync | Rejected (`Cross-customer ... blocked` / list-to-connection ownership verification) |
| Missing `customerConnectionId` when multiple non-quarantine accounts exist | Fail-closed rejection across `/api/reports/hygiene` CSV, `/api/exports/subscribers`, `/api/sync`, `/api/cleanup/*`, `/api/compatibility`, `/api/webhooks/mailwizz` |
| Shared MailWizz URL (`list_uid`, `campaign_uid`, email hash collision across customers) | Scoped composite DB keys `[customerConnectionId, listUid]`, `[customerConnectionId, campaignUid]`, `[customerConnectionId, mailingListId, subscriberUid]` |
| Webhook signature spoofing across customers | Per-connection `webhookSecretEnc` verified via `crypto.timingSafeEqual`; rejects missing explicit connection target in multi-tenant setups |
| Quarantine connection (`LEGACY_QUARANTINE`) | Cannot instantiate MailWizz client, cannot sync, cannot verify compatibility writes, cannot execute cleanups, cannot trigger re-engagement |
| Synthetic Demo Data (`isDemoData = true`) | Refuses `seedSyntheticDemoData()` when real non-quarantine connections exist; skips live external HTTP calls in validator/client-factory when no test `fetchImpl` is injected |
| Global Mutation Lock | `ENABLE_MAILWIZZ_MUTATIONS=false` preserved end-to-end; compatibility write approvals verified strictly per `(customerConnectionId, version, capabilityKey)` |

---

## 5. Dependency Audit & Secret-Leakage Scan Results

- **Production dependency audit (`npm audit --omit=dev`)**:
  - Observed 3 high-severity advisory alerts pointing through `prisma` -> `@prisma/config` -> `deepmerge-ts <8.0.0` (GHSA-ggr8-5vv4-36mx, fix suggests breaking upgrade to `prisma@7.10.1`; `prisma` itself is a CLI/build migration tool listed in `devDependencies`, while Next.js server runtime dependencies `next`, `react`, `zod`, `mysql2`, `csv-parse`, `@prisma/client` reported zero advisories).
- **Repository secret-leakage scan (`git grep --untracked`)**:
  - Scanned `src/`, `tests/`, `prisma/`, `worker/`, `scripts/` for private keys (`BEGIN ... PRIVATE KEY`, `AGE-SECRET-KEY-`), API token prefixes (`AKIA`, `sk_live_`, `ghp_`, `xoxb-`), live VPS IPs (`100.95.86.56`), and remote database URIs: **0 secret leaks detected**.
  - Verified `/api/connections*` and E2E responses never expose test/dummy plaintext API keys, webhook secrets, `APP_ENCRYPTION_KEY`, or `APP_SESSION_SECRET`.
