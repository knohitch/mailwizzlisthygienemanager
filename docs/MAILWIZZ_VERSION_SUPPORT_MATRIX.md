# MailWizz Version Support Matrix

> **Honest Support Policy:** Support status distinguishes what is verified against **MailWizz `3.0.5`** fixtures and local contract/integration suites versus synthetic future-version simulations. No unknown future MailWizz release (`3.1+`, `4.x`) has been run live against an external server.

| Version Family | Detection Classification | Initial Resolver Mode | Read-Only Sync Behavior | Remote Mutation Gate Behavior | Live Verification Status |
|---|---|---|---|---|---|
| **`3.0.5`** | `BASELINE_3_0_5` | `VERIFIED_NATIVE` (when contracts pass) / `PROVISIONAL_COMPAT_READONLY` (before check) | Full read-only sync, pagination, segments, campaign stats, bounce reporting | Permitted only after passing read-only check **and** `ENABLE_MAILWIZZ_MUTATIONS="true"` | Baseline target (`3.0.5`) verified via fixtures & mocks; awaiting live VPS credentials |
| **`3.0.x`** (`3.0.6`, `3.0.9`, etc.) | `PATCH_3_0_X` | `VERIFIED_NATIVE` if unchanged & approved; `PROVISIONAL_COMPAT_READONLY` on newly seen patch transition | Full read-only contract probing; additive fields ignored cleanly | Blocked on upgrade transition until read-only Compatibility Check passes & administrator confirms | Supported design via contract tolerance; synthetic tests pass |
| **`3.1+` (`3.x` Minor)** | `MINOR_3_X` | `PROVISIONAL_COMPAT_READONLY` | Allowed for any read-only endpoint whose contracts pass (`FULLY VERIFIED` or `PARTIALLY COMPATIBLE`) | **Blocked fail-closed** until connected read-only check passes core sync contracts AND admin explicitly clicks **Approve Verified Version** | Synthetic `3.1.0`/`3.2.0` drift tests pass; requires live check on real `3.1+` |
| **`1.x` / `2.x`** | `LEGACY_1_2_X` | `VERIFIED_NATIVE` or `PROVISIONAL_COMPAT_READONLY` via `compat.ts` HMAC/auth fallback | Uses legacy HMAC `X-MW-*` headers when `public:private` key pair configured | Guarded by compatibility check & `ENABLE_MAILWIZZ_MUTATIONS` | Auth signing & response tolerance unit-tested |
| **`4.x+` (Future Major)** | `FUTURE_MAJOR` | `RESTRICTED_SAFE_MODE` | Read-only probing runs safely without writes; broken endpoints degrade to `UNSUPPORTED` cleanly | **Permanently Blocked (Fail-Closed)** regardless of `ENABLE_MAILWIZZ_MUTATIONS` until a new validated `MailWizzAdapter` ships | Synthetic `4.0.0` drift tests confirm fail-closed blocking |
| **Unknown / Custom Build** | `UNKNOWN_CUSTOM` | `RESTRICTED_SAFE_MODE` | Non-mutating read-only discovery with strict contract checking | **Blocked Fail-Closed** until verified or mapped | Synthetic custom-tag test passes |

## Capability Status Vocabulary (5 Explicit States)

Every tracked MailWizz capability on `/compatibility` uses one of five distinct states:

1. **`VERIFIED`**: Connected, read-only probed, and strict schema/type validation passed.
2. **`AVAILABLE_BUT_UNTESTED`**: Endpoint/prerequisites exist in baseline or config (e.g. webhook receiver or write prerequisites with `ENABLE_MAILWIZZ_MUTATIONS=false`), not yet live-exercised.
3. **`UNSUPPORTED`**: Official endpoint returned `404`/`405`/`501` or broke required schema/type contracts.
4. **`UNKNOWN`**: Transient error (timeout, `429` rate limit, or unprobed dependency). Never treated as verified or safe to mutate.
5. **`BLOCKED`**: Intentionally locked by safety policy (`ENABLE_MAILWIZZ_MUTATIONS=false`, missing version approval, auth failure, or fail-closed future major version).

## Tracked Capabilities (15 Total)

- **Core Sync Read:** `list_discovery`, `subscriber_retrieval`, `subscriber_pagination`, `subscriber_status_retrieval`, `campaign_discovery`, `campaign_statistics`
- **Historical & Bounce Reporting:** `historical_engagement_retrieval`, `bounce_reporting`
- **Segmentation & Clean-List Mutations (Guarded):** `segment_discovery`, `segment_creation`, `list_creation`, `subscriber_copying`, `subscriber_suppression`, `subscriber_unsubscribe`
- **Webhooks:** `webhook_event_processing`
