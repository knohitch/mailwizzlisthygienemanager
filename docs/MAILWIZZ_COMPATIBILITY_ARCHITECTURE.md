# MailWizz Compatibility & Future-Version Architecture

> **Scope & Truthfulness Note:** Compatibility is currently verified against **MailWizz `3.0.5`** contracts and mock/fixture test suites (plus synthetic drift and future-major test fixtures). No unknown future MailWizz server release (e.g., `3.1+`, `4.x`) has been executed live in this environment.

## 1. Architectural Overview

MailWizz integration is isolated behind a versioned adapter and contract-validation boundary so the core engagement classifier, list-hygiene UI, cleanup planner/executor, and deliverables never read or depend directly on raw MailWizz JSON payloads.

```
MailWizz API / Webhooks / Reporting Sources
  │
  ├── Passive Version Detector (`src/services/mailwizz/version-detector.ts`)
  │     └── Reads official HTTP response headers / envelope metadata only (never invents endpoints)
  │     └── Separates `API_HEADER_OR_META` (verified signal) from `ADMIN_SUPPLIED` (`UNVERIFIED`)
  │
  ├── Normalized Adapter (`src/services/mailwizz/adapter-v3.ts`)
  │     └── Implements `MailWizzAdapter` (`src/services/mailwizz/contracts.ts`)
  │     └── Converts MailWizz responses into canonical `Internal*` models
  │     └── Tolerates valid additive fields; rejects missing required / corrupt typed fields
  │     └── Maps unknown subscriber statuses fail-safe to `UNKNOWN` (never coerced to safe-to-unsubscribe)
  │
  ├── Future Adapter Resolver (`src/services/mailwizz/adapter-resolver.ts`)
  │     └── Resolves `VERIFIED_NATIVE`, `PROVISIONAL_COMPAT_READONLY`, or `RESTRICTED_SAFE_MODE`
  │     └── No fictional `V4` stubs; unknown/future major versions lock remote mutations fail-closed
  │
  ├── Read-Only Compatibility Validator (`src/services/mailwizz/compatibility-validator.ts`)
  │     └── Probes official `GET` endpoints cleanly without mutating remote subscribers/segments
  │     └── Produces `CompatibilityReport` & 15-item capability status (`VERIFIED` | `AVAILABLE_BUT_UNTESTED` | `UNSUPPORTED` | `UNKNOWN` | `BLOCKED`)
  │
  ├── Capability Registry (`src/services/mailwizz/capability-registry.ts`)
  │     └── Persists reports, admin-supplied configured versions, and guarded approvals in `AuditLog` + `ApiCapabilityCheck` (zero schema breaking changes)
  │
  └── Mutation Gate (`src/services/mutations/gate.ts`) & Cleanup Executor (`src/services/cleanup/executor.ts`)
        └── Calls `assertCompatibilityPermitsRemoteMutations()` before any remote write or client creation
```

## 2. Core Isolation Boundaries

1. **Canonical Internal Domain Contracts (`src/services/mailwizz/contracts.ts`)**
   - `InternalMailingList`, `InternalSubscriber`, `InternalSegmentSummary`, `InternalSegmentDetail`, `InternalCampaignSummary`, `InternalCampaignDetail`, `InternalCampaignStats`, `InternalBounceRecord`, `InternalActivityRecord`, `InternalWebhookEvent`, `InternalPaginatedPage<T>`.
   - Core services (`sync.ts`, `classifier.ts`, `planner.ts`, `executor.ts`, `webhooks/mailwizz/route.ts`) rely on adapter normalization rather than raw JSON shapes.

2. **Passive Version Detection — Zero Invented Endpoints (`src/services/mailwizz/version-detector.ts`)**
   - `MailWizzClient.getRawJson()` extracts version strings passively from standard response headers (`X-MW-Version`, `X-MailWizz-Version`, `X-Api-Version`, `Server`) and metadata keys (`meta.version`, `meta.mailwizz_version`, `version`, `app_version`).
   - Administrator-entered versions saved on `/compatibility` are explicitly stored and rendered as `UNVERIFIED — Admin-Supplied` unless matched by an authentic API signal.

3. **Subscriber Status Fail-Safe (`mapStrictMailWizzSubscriberStatus` in `adapter-v3.ts`)**
   - Canonical MailWizz statuses map cleanly (`confirmed` -> `CONFIRMED`, `unconfirmed` -> `UNCONFIRMED`, `unsubscribed` -> `UNSUBSCRIBED`, `blacklisted` -> `BLACKLISTED`, `bounced` -> `BOUNCED`, `complained` -> `COMPLAINED`).
   - Any novel or unknown status string is preserved in `rawStatus`, mapped to `SubscriberStatus.UNKNOWN` with `unknownStatusDetected = true`, and logged as a `UNKNOWN_SUBSCRIBER_STATUS` contract warning.
   - `executor.ts` refuses to unsubscribe subscribers whose live MailWizz status is `UNKNOWN`, unrecognized, or already excluded.

4. **Mutation Gate Fail-Closed Enforcement (`src/services/mutations/gate.ts`)**
   - Even if `ENABLE_MAILWIZZ_MUTATIONS="true"`, `assertCompatibilityPermitsRemoteMutations()` throws `UnsafeOperationBlockedError` when:
     - The latest connected compatibility verdict is `INCOMPATIBLE`; or
     - `mutationSafetyAllowed` is `false` (such as unapproved `3.1+` minor upgrades, `FUTURE_MAJOR` `4.x+`, or `UNKNOWN_CUSTOM` versions); or
     - Core sync contract validation has failed or remains unverified for an upgraded server.

5. **Decoupled Historical Engagement & Deliverability (`src/services/mailwizz/historical-sources.ts` & `src/services/deliverability/alibaba-directmail.ts`)**
   - `HistoricalEngagementSourceAdapter` implementations (`VerifiedExportHistoricalAdapter`, `ReadOnlyReportingDbHistoricalAdapter`) are cleanly decoupled from MailWizz mutation adapters and survive MailWizz upgrades without losing PostgreSQL `EngagementEvent` records.
   - Alibaba Cloud DirectMail reporting remains strictly isolated in `src/services/deliverability/alibaba-directmail.ts` and DNS diagnostics remain in `src/services/deliverability/dns-checker.ts`.

6. **Database Schema Compatibility**
   - Phase 3.2 stores compatibility reports, admin-supplied configured versions, and approved version decisions in existing `AuditLog` (`MAILWIZZ_COMPATIBILITY_CHECK`, `MAILWIZZ_COMPATIBILITY_CONFIG`, `MAILWIZZ_VERSION_APPROVED`) and `ApiCapabilityCheck` rows — zero Prisma migrations or breaking table alterations.
