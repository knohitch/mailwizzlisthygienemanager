import { prisma } from '@/lib/db';
import { getEnv } from '@/lib/env';
import { isMailWizzMutationsEnabled } from '@/services/mutations/gate';
import { decryptSecret } from '@/services/security/crypto';
import { mailWizzFutureAdapterResolver } from './adapter-resolver';
import { mailWizzV3Adapter } from './adapter-v3';
import { mailWizzCapabilityRegistry } from './capability-registry';
import { getMailWizzClientWithContext, resolveUnambiguousConnectionId } from './client-factory';
import { MailWizzApiError, MailWizzClient } from './client';
import type {
  CapabilityCheckEntry,
  CapabilityKey,
  CompatibilityCapabilityStatus,
  CompatibilityReport,
  CompatibilityVerdict,
  MailWizzAdapter,
} from './contracts';
import { inspectHistoricalSources } from './historical-sources';
import { mailWizzVersionDetector } from './version-detector';

export interface ValidateConnectionWithContractsParams {
  customerConnectionId?: string;
  client?: MailWizzClient | null;
  configuredVersion?: string | null;
  approvedVersion?: string | null;
  reportingDbUri?: string | null;
  reportingDbPrefix?: string;
  webhookConfigured?: boolean;
  envMutationsEnabled?: boolean;
  skipDbLookup?: boolean;
}

export class MailWizzCompatibilityValidator {
  private updateCap(
    caps: Map<CapabilityKey, CapabilityCheckEntry>,
    key: CapabilityKey,
    patch: Partial<CapabilityCheckEntry>
  ): void {
    const existing = caps.get(key);
    if (!existing) return;
    caps.set(key, {
      ...existing,
      ...patch,
      lastCheckedAt: patch.lastCheckedAt ?? new Date().toISOString(),
    });
  }

  /**
   * Executes strictly non-mutating (`GET` only) MailWizz API structural & semantic checks.
   * Never issues `POST`/`PUT`/`DELETE` requests and never calls `/tracking/*`.
   */
  async validate(
    params: ValidateConnectionWithContractsParams
  ): Promise<CompatibilityReport> {
    const adapter: MailWizzAdapter = mailWizzV3Adapter;
    const caps = new Map<CapabilityKey, CapabilityCheckEntry>(
      mailWizzCapabilityRegistry.buildBaselineEntries().map((c) => [c.key, c])
    );

    const envMutationsEnabled = params.envMutationsEnabled ?? isMailWizzMutationsEnabled();
    const warnings: string[] = [];
    const requiredManualActions: string[] = [];
    const additiveSet = new Set<string>();
    const checkedIso = new Date().toISOString();

    const histSummary = params.skipDbLookup
      ? {
          anyAvailable: Boolean(params.reportingDbUri),
          summaryText:
            'Historical source check skipped (offline fixture mode); verified CSV import remains available separately from MailWizz API.',
          verifiedExportCount: 0,
          reportingDbAvailable: false,
          reportingDbDetails: 'Offline validation',
          nativeActivityApiSupported: false,
          webhookLiveCount: 0,
        }
      : await inspectHistoricalSources({
          customerConnectionId: params.customerConnectionId,
          reportingDbUri: params.reportingDbUri,
          reportingDbPrefix: params.reportingDbPrefix,
          nativeActivityApiSupported: false,
        });

    if (params.webhookConfigured) {
      this.updateCap(caps, 'webhook_event_processing', {
        status: 'VERIFIED',
        testedReadOnly: true,
        reason: `Webhook secret configured and schema normalizer active (${histSummary.webhookLiveCount} live event(s) stored).`,
      });
    } else {
      this.updateCap(caps, 'webhook_event_processing', {
        status: 'AVAILABLE_BUT_UNTESTED',
        testedReadOnly: true,
        reason: 'Webhook receiver is ready, but MailWizz webhook secret is not yet configured.',
      });
    }

    if (!params.client) {
      const versionInfo = mailWizzVersionDetector.resolveVersionInfo({
        configuredVersion: params.configuredVersion,
        detectedVersion: null,
        approvedVersion: params.approvedVersion,
      });
      const resolved = mailWizzFutureAdapterResolver.resolve({
        versionInfo,
        envMutationsEnabled,
      });

      this.updateCap(caps, 'historical_engagement_retrieval', {
        status: histSummary.anyAvailable ? 'AVAILABLE_BUT_UNTESTED' : 'UNKNOWN',
        testedReadOnly: true,
        reason: histSummary.summaryText,
      });

      return {
        overallStatus: 'UNVERIFIED',
        adapterInUse: `${resolved.adapter.name} (${resolved.adapter.id})`,
        adapterMode: 'RESTRICTED_SAFE_MODE',
        connectionStatus: 'NOT_CONFIGURED',
        versionInfo,
        mutationSafetyAllowed: false,
        mutationLockReason:
          'MailWizz API credentials are not configured. All remote capabilities remain UNVERIFIED and fail-closed.',
        historicalEngagementAvailable: histSummary.anyAvailable,
        historicalEngagementSummary: histSummary.summaryText,
        capabilities: Array.from(caps.values()),
        warnings: [
          'MailWizz API connection has not been configured or validated yet.',
          ...resolved.warnings,
        ],
        requiredManualActions: [
          'Configure your MailWizz API URL and API Key in Settings & Sources, then click "Run Compatibility Check".',
        ],
        additiveFieldsObserved: [],
        lastVerifiedAt: checkedIso,
      };
    }

    let connectionStatus: CompatibilityReport['connectionStatus'] = 'CONNECTED';
    let listRateLimited = false;
    let firstListUid: string | null = null;
    let firstCampaignUid: string | null = null;
    let listSampleEmpty = false;
    let subscriberSampleEmpty = false;
    let nativeActivitySupported = false;

    // 1. List discovery structural check (GET /lists)
    try {
      const { rawJson } = await params.client.getRawJson('/lists', {
        page: 1,
        per_page: 10,
      });
      const listRes = adapter.normalizePaginatedEnvelope(
        rawJson,
        (r) => adapter.normalizeListRecord(r, '/lists'),
        '/lists'
      );
      listRes.additiveFields.forEach((f) => additiveSet.add(f));

      if (!listRes.ok || !listRes.data) {
        const errs = listRes.issues.filter((i) => i.severity === 'ERROR').map((i) => i.message);
        this.updateCap(caps, 'list_discovery', {
          status: 'UNSUPPORTED',
          testedReadOnly: true,
          reason: errs[0] || 'List response failed contract validation.',
          contractErrors: errs,
          additiveFieldsObserved: listRes.additiveFields,
        });
        warnings.push(`List discovery contract error: ${errs.join(' | ')}`);
      } else {
        listSampleEmpty = listRes.data.records.length === 0;
        firstListUid = listRes.data.records[0]?.listUid ?? null;

        // Also test single list detail if a list exists
        let singleListOk = true;
        const singleListErrs: string[] = [];
        if (firstListUid) {
          const singleRaw = await params.client.getRawJson(
            `/lists/${encodeURIComponent(firstListUid)}`
          );
          const singleRes = adapter.normalizeSingleListResponse(
            singleRaw.rawJson,
            `/lists/${firstListUid}`
          );
          singleRes.additiveFields.forEach((f) => additiveSet.add(f));
          if (!singleRes.ok) {
            singleListOk = false;
            singleListErrs.push(
              ...singleRes.issues.filter((i) => i.severity === 'ERROR').map((i) => i.message)
            );
          }
        }

        this.updateCap(caps, 'list_discovery', {
          status: singleListOk ? 'VERIFIED' : 'UNSUPPORTED',
          testedReadOnly: true,
          reason: singleListOk
            ? `Verified ${listRes.data.records.length} list record(s) (total reported: ${listRes.data.totalReportedCount}).`
            : singleListErrs[0] || 'List detail contract failed.',
          contractErrors: singleListErrs,
          additiveFieldsObserved: listRes.additiveFields,
        });
      }
    } catch (err) {
      if (
        err instanceof MailWizzApiError &&
        (err.statusCode === 401 || err.statusCode === 403)
      ) {
        connectionStatus = 'AUTH_FAILED';
        this.updateCap(caps, 'list_discovery', {
          status: 'BLOCKED',
          testedReadOnly: true,
          reason: `Authentication rejected (${err.message}). Check X-Api-Key / legacy-hmac / Bearer mode.`,
          contractErrors: [err.message],
        });
        warnings.push(`MailWizz authentication failed: ${err.message}`);
        requiredManualActions.push(
          'Verify MailWizz API Key and Auth Protocol Mode in Settings & Sources.'
        );
      } else if (err instanceof MailWizzApiError && err.statusCode === 429) {
        listRateLimited = true;
        this.updateCap(caps, 'list_discovery', {
          status: 'UNKNOWN',
          testedReadOnly: true,
          reason: `Transient HTTP 429 rate limit exceeded (${err.message}); endpoint availability cannot be marked unsupported.`,
          contractErrors: [err.message],
        });
        warnings.push(
          `Transient HTTP 429 rate limit received while probing /lists: ${err.message}`
        );
        requiredManualActions.push(
          'Reduce max API requests/second in Settings & Sources and re-run Compatibility Check.'
        );
      } else {
        connectionStatus = 'UNREACHABLE';
        const msg = err instanceof Error ? err.message : 'MailWizz unreachable';
        this.updateCap(caps, 'list_discovery', {
          status: 'UNSUPPORTED',
          testedReadOnly: true,
          reason: msg,
          contractErrors: [msg],
        });
        warnings.push(`MailWizz API check failed: ${msg}`);
      }
    }

    // 2. Subscriber retrieval, pagination, and status checks (only if connected and list exists)
    if (connectionStatus === 'CONNECTED' && !listRateLimited) {
      if (!firstListUid) {
        for (const k of [
          'subscriber_retrieval',
          'subscriber_pagination',
          'subscriber_status_retrieval',
          'segment_discovery',
          'segment_creation',
        ] as CapabilityKey[]) {
          this.updateCap(caps, k, {
            status: 'AVAILABLE_BUT_UNTESTED',
            testedReadOnly: true,
            reason:
              'MailWizz returned 0 lists; cannot verify subscriber or segment payloads without at least one list.',
          });
        }
      } else {
        try {
          const { rawJson } = await params.client.getRawJson(
            `/lists/${encodeURIComponent(firstListUid)}/subscribers`,
            { page: 1, per_page: 10 }
          );
          const subPage = adapter.normalizePaginatedEnvelope(
            rawJson,
            (r) =>
              adapter.normalizeSubscriberRecord(
                r,
                `/lists/${firstListUid}/subscribers`
              ),
            `/lists/${firstListUid}/subscribers`
          );
          subPage.additiveFields.forEach((f) => additiveSet.add(f));

          const paginationErrs = subPage.issues
            .filter((i) => i.code === 'PAGINATION_ANOMALY')
            .map((i) => i.message);
          const statusErrs = subPage.issues
            .filter(
              (i) =>
                i.code === 'UNKNOWN_SUBSCRIBER_STATUS' ||
                i.code === 'STATUS_SEMANTIC_DRIFT'
            )
            .map((i) => i.message);
          const structureErrs = subPage.issues
            .filter(
              (i) =>
                i.severity === 'ERROR' &&
                i.code !== 'PAGINATION_ANOMALY' &&
                i.code !== 'UNKNOWN_SUBSCRIBER_STATUS' &&
                i.code !== 'STATUS_SEMANTIC_DRIFT'
            )
            .map((i) => i.message);

          const hasRecords = (subPage.data?.records.length ?? 0) > 0;
          subscriberSampleEmpty = !hasRecords;

          // Pagination check: if total_pages >= 2, also probe page 2 safely
          let multiPageAdvanceOk = true;
          if (subPage.data && subPage.data.totalPages >= 2) {
            try {
              const page2Raw = await params.client.getRawJson(
                `/lists/${encodeURIComponent(firstListUid)}/subscribers`,
                { page: 2, per_page: 10 }
              );
              const page2 = adapter.normalizePaginatedEnvelope(
                page2Raw.rawJson,
                (r) =>
                  adapter.normalizeSubscriberRecord(
                    r,
                    `/lists/${firstListUid}/subscribers`
                  ),
                `/lists/${firstListUid}/subscribers?page=2`
              );
              if (!page2.ok || page2.data?.currentPage !== 2) {
                multiPageAdvanceOk = false;
                paginationErrs.push(
                  `Requested page=2 but server returned current_page=${page2.data?.currentPage ?? 'invalid'}.`
                );
              }
            } catch (p2Err) {
              multiPageAdvanceOk = false;
              paginationErrs.push(
                p2Err instanceof Error ? p2Err.message : 'Page 2 probe failed.'
              );
            }
          }

          if (structureErrs.length > 0) {
            this.updateCap(caps, 'subscriber_retrieval', {
              status: 'UNSUPPORTED',
              testedReadOnly: true,
              reason: structureErrs[0],
              contractErrors: structureErrs,
              additiveFieldsObserved: subPage.additiveFields,
            });
            warnings.push(`Subscriber retrieval contract error: ${structureErrs.join(' | ')}`);
          } else if (!hasRecords) {
            this.updateCap(caps, 'subscriber_retrieval', {
              status: 'AVAILABLE_BUT_UNTESTED',
              testedReadOnly: true,
              reason: 'Subscriber endpoint responded cleanly, but list contains 0 sample subscribers to validate fields.',
            });
          } else {
            this.updateCap(caps, 'subscriber_retrieval', {
              status: 'VERIFIED',
              testedReadOnly: true,
              reason: `Verified subscriber records (${subPage.data?.records.length} sampled of ${subPage.data?.totalReportedCount}).`,
              additiveFieldsObserved: subPage.additiveFields,
            });
          }

          if (paginationErrs.length > 0 || !multiPageAdvanceOk) {
            this.updateCap(caps, 'subscriber_pagination', {
              status: 'UNSUPPORTED',
              testedReadOnly: true,
              reason: paginationErrs[0],
              contractErrors: paginationErrs,
            });
            warnings.push(`Subscriber pagination issue: ${paginationErrs.join(' | ')}`);
          } else {
            this.updateCap(caps, 'subscriber_pagination', {
              status: hasRecords ? 'VERIFIED' : 'AVAILABLE_BUT_UNTESTED',
              testedReadOnly: true,
              reason: `Pagination metadata verified (total_pages=${subPage.data?.totalPages ?? 1}, current_page=${subPage.data?.currentPage ?? 1}).`,
            });
          }

          if (statusErrs.length > 0) {
            this.updateCap(caps, 'subscriber_status_retrieval', {
              status: 'UNSUPPORTED',
              testedReadOnly: true,
              reason: statusErrs[0],
              contractErrors: statusErrs,
            });
            warnings.push(
              `Subscriber consent status drift detected: ${statusErrs.join(' | ')} (Mutations stay blocked; unknown statuses never reinterpreted as confirmed/unsubscribed).`
            );
          } else if (!hasRecords) {
            this.updateCap(caps, 'subscriber_status_retrieval', {
              status: 'AVAILABLE_BUT_UNTESTED',
              testedReadOnly: true,
              reason: 'No sample subscriber rows returned to verify status vocabulary.',
            });
          } else {
            this.updateCap(caps, 'subscriber_status_retrieval', {
              status: 'VERIFIED',
              testedReadOnly: true,
              reason: 'All sampled subscriber statuses map cleanly to canonical MailWizz consent states.',
            });
          }
        } catch (subErr) {
          const msg = subErr instanceof Error ? subErr.message : 'Subscriber retrieval error';
          this.updateCap(caps, 'subscriber_retrieval', {
            status: 'UNSUPPORTED',
            testedReadOnly: true,
            reason: msg,
            contractErrors: [msg],
          });
          this.updateCap(caps, 'subscriber_pagination', {
            status: 'UNKNOWN',
            testedReadOnly: true,
            reason: 'Skipped due to subscriber retrieval error.',
          });
          this.updateCap(caps, 'subscriber_status_retrieval', {
            status: 'UNKNOWN',
            testedReadOnly: true,
            reason: 'Skipped due to subscriber retrieval error.',
          });
          warnings.push(`Subscriber endpoint error: ${msg}`);
        }

        // 3. Segment discovery & creation read-only prerequisites
        try {
          const { rawJson } = await params.client.getRawJson(
            `/lists/${encodeURIComponent(firstListUid)}/segments`,
            { page: 1, per_page: 10 }
          );
          const segPage = adapter.normalizePaginatedEnvelope(
            rawJson,
            (r) => adapter.normalizeSegmentSummary(r, `/lists/${firstListUid}/segments`),
            `/lists/${firstListUid}/segments`
          );
          if (!segPage.ok) {
            const errs = segPage.issues.filter((i) => i.severity === 'ERROR').map((i) => i.message);
            this.updateCap(caps, 'segment_discovery', {
              status: 'UNSUPPORTED',
              testedReadOnly: true,
              reason: errs[0] || 'Segment discovery contract failed.',
              contractErrors: errs,
            });
            warnings.push(`Segment discovery issue: ${errs.join(' | ')}`);
          } else {
            this.updateCap(caps, 'segment_discovery', {
              status: 'VERIFIED',
              testedReadOnly: true,
              reason: `Discovered ${segPage.data?.totalReportedCount ?? 0} segment(s) on list ${firstListUid}.`,
            });
          }
        } catch (segErr) {
          const isMissingEndpoint =
            segErr instanceof MailWizzApiError &&
            (segErr.statusCode === 404 || segErr.statusCode === 405 || segErr.statusCode === 501);
          const msg = segErr instanceof Error ? segErr.message : 'Segment endpoint failed';
          this.updateCap(caps, 'segment_discovery', {
            status: isMissingEndpoint ? 'UNSUPPORTED' : 'UNKNOWN',
            testedReadOnly: true,
            reason: msg,
            contractErrors: [msg],
          });
          warnings.push(`Segment discovery unavailable: ${msg}`);
        }

        // Verify segment creation read-only prerequisites without creating any remote segment
        try {
          await params.client.getListFields(firstListUid);
          await params.client.getSegmentConditionOperators();
          this.updateCap(caps, 'segment_creation', {
            status: envMutationsEnabled ? 'AVAILABLE_BUT_UNTESTED' : 'BLOCKED',
            testedReadOnly: true,
            reason: envMutationsEnabled
              ? 'Read-only list fields and segment condition operators passed; write capability awaits live dry-run execution.'
              : 'Read-only segment prerequisites passed, but mutations are locked (ENABLE_MAILWIZZ_MUTATIONS=false).',
          });
        } catch (opErr) {
          const msg = opErr instanceof Error ? opErr.message : 'Segment prerequisites unavailable';
          this.updateCap(caps, 'segment_creation', {
            status: envMutationsEnabled ? 'UNSUPPORTED' : 'BLOCKED',
            testedReadOnly: true,
            reason: `Segment field/operator metadata check failed: ${msg}`,
            contractErrors: [msg],
          });
        }
      }

      // 4. Campaign discovery, campaign statistics, bounce reporting, and historical activity probes
      try {
        const { rawJson } = await params.client.getRawJson('/campaigns', {
          page: 1,
          per_page: 10,
        });
        const campPage = adapter.normalizePaginatedEnvelope(
          rawJson,
          (r) => adapter.normalizeCampaignSummary(r, '/campaigns'),
          '/campaigns'
        );
        campPage.additiveFields.forEach((f) => additiveSet.add(f));

        if (!campPage.ok) {
          const errs = campPage.issues.filter((i) => i.severity === 'ERROR').map((i) => i.message);
          this.updateCap(caps, 'campaign_discovery', {
            status: 'UNSUPPORTED',
            testedReadOnly: true,
            reason: errs[0] || 'Campaign discovery schema failed.',
            contractErrors: errs,
          });
          warnings.push(`Campaign discovery error: ${errs.join(' | ')}`);
        } else {
          firstCampaignUid = campPage.data?.records[0]?.campaignUid ?? null;
          this.updateCap(caps, 'campaign_discovery', {
            status: 'VERIFIED',
            testedReadOnly: true,
            reason: `Discovered ${campPage.data?.totalReportedCount ?? 0} campaign(s).`,
            additiveFieldsObserved: campPage.additiveFields,
          });
        }
      } catch (campErr) {
        const msg = campErr instanceof Error ? campErr.message : 'Campaign discovery failed';
        this.updateCap(caps, 'campaign_discovery', {
          status: 'UNSUPPORTED',
          testedReadOnly: true,
          reason: msg,
          contractErrors: [msg],
        });
        warnings.push(`Campaign endpoint failed: ${msg}`);
      }

      if (firstCampaignUid) {
        // Campaign aggregate stats
        try {
          const { rawJson } = await params.client.getRawJson(
            `/campaigns/${encodeURIComponent(firstCampaignUid)}/stats`
          );
          const statsRes = adapter.normalizeCampaignStatsResponse(
            rawJson,
            `/campaigns/${firstCampaignUid}/stats`
          );
          statsRes.additiveFields.forEach((f) => additiveSet.add(f));

          if (!statsRes.ok) {
            const errs = statsRes.issues.filter((i) => i.severity === 'ERROR').map((i) => i.message);
            this.updateCap(caps, 'campaign_statistics', {
              status: 'UNSUPPORTED',
              testedReadOnly: true,
              reason: errs[0] || 'Campaign stats schema failed.',
              contractErrors: errs,
            });
            warnings.push(`Campaign stats issue: ${errs.join(' | ')}`);
          } else {
            this.updateCap(caps, 'campaign_statistics', {
              status: 'VERIFIED',
              testedReadOnly: true,
              reason: `Verified aggregate campaign statistics for ${firstCampaignUid}.`,
              additiveFieldsObserved: statsRes.additiveFields,
            });
          }
        } catch (statsErr) {
          const msg = statsErr instanceof Error ? statsErr.message : 'Campaign stats unavailable';
          this.updateCap(caps, 'campaign_statistics', {
            status: 'UNSUPPORTED',
            testedReadOnly: true,
            reason: msg,
            contractErrors: [msg],
          });
          warnings.push(`Campaign stats unavailable: ${msg}`);
        }

        // Bounce reporting
        try {
          const { rawJson } = await params.client.getRawJson(
            `/campaigns/${encodeURIComponent(firstCampaignUid)}/bounces`,
            { page: 1, per_page: 10 }
          );
          const bouncePage = adapter.normalizePaginatedEnvelope(
            rawJson,
            (r) =>
              adapter.normalizeBounceRecord(
                r,
                `/campaigns/${firstCampaignUid}/bounces`
              ),
            `/campaigns/${firstCampaignUid}/bounces`
          );
          if (!bouncePage.ok) {
            const errs = bouncePage.issues
              .filter((i) => i.severity === 'ERROR')
              .map((i) => i.message);
            this.updateCap(caps, 'bounce_reporting', {
              status: 'UNSUPPORTED',
              testedReadOnly: true,
              reason: errs[0] || 'Bounce log schema failed.',
              contractErrors: errs,
            });
            warnings.push(`Bounce reporting error: ${errs.join(' | ')}`);
          } else {
            this.updateCap(caps, 'bounce_reporting', {
              status: 'VERIFIED',
              testedReadOnly: true,
              reason: `Verified campaign bounce log format (${bouncePage.data?.totalReportedCount ?? 0} total bounce records).`,
            });
          }
        } catch (bErr) {
          const msg = bErr instanceof Error ? bErr.message : 'Bounce log unavailable';
          this.updateCap(caps, 'bounce_reporting', {
            status: 'UNSUPPORTED',
            testedReadOnly: true,
            reason: msg,
            contractErrors: [msg],
          });
          warnings.push(`Bounce reporting unavailable: ${msg}`);
        }

        // Non-mutating probe for native read-only activity endpoints (3.1+/4.x if added)
        for (const subpath of ['delivery-logs', 'opens', 'clicks'] as const) {
          const probe = await params.client.tryReadOnlyCampaignActivityEndpoint(
            firstCampaignUid,
            subpath,
            5
          );
          if (probe.supported) {
            nativeActivitySupported = true;
            break;
          }
        }
      } else {
        for (const k of ['campaign_statistics', 'bounce_reporting'] as CapabilityKey[]) {
          if (caps.get(k)?.status !== 'UNSUPPORTED') {
            this.updateCap(caps, k, {
              status: 'AVAILABLE_BUT_UNTESTED',
              testedReadOnly: true,
              reason: 'No historical campaign record found to sample stats or bounces.',
            });
          }
        }
      }
    }

    // 5. Version detection & adapter resolution
    const versionInfo = mailWizzVersionDetector.resolveVersionInfo({
      configuredVersion: params.configuredVersion,
      detectedVersion: params.client.getDetectedServerVersion(),
      approvedVersion: params.approvedVersion,
    });

    const coreReadOk =
      connectionStatus === 'CONNECTED' &&
      caps.get('list_discovery')?.status === 'VERIFIED' &&
      caps.get('subscriber_retrieval')?.status === 'VERIFIED' &&
      caps.get('subscriber_status_retrieval')?.status === 'VERIFIED';

    const resolvedAdapter = mailWizzFutureAdapterResolver.resolve({
      versionInfo,
      envMutationsEnabled,
      coreContractsPassed: coreReadOk,
      approvedVersionPassedCheck: coreReadOk,
    });

    warnings.push(...resolvedAdapter.warnings);
    requiredManualActions.push(...resolvedAdapter.requiredManualActions);

    // 6. Historical engagement resolution (strictly decoupled from mutation adapters & DirectMail)
    const effectiveHistAvailable = nativeActivitySupported || histSummary.anyAvailable;
    let histStatus: CompatibilityCapabilityStatus = 'AVAILABLE_BUT_UNTESTED';
    if (nativeActivitySupported || histSummary.reportingDbAvailable) {
      histStatus = 'VERIFIED';
    } else if (!effectiveHistAvailable) {
      histStatus = 'UNSUPPORTED';
      warnings.push(
        'No automated or imported historical engagement source is verified. Inactive cleanup classifications remain blocked on INSUFFICIENT_DATA.'
      );
    }

    this.updateCap(caps, 'historical_engagement_retrieval', {
      status: histStatus,
      testedReadOnly: true,
      reason: nativeActivitySupported
        ? 'Connected MailWizz instance supports read-only campaign activity endpoints alongside Priority B/C fallbacks.'
        : histSummary.summaryText,
    });

    // 7. Mutation capabilities (NEVER executed with write probes; gated cleanly)
    const canOfferMutations = envMutationsEnabled && resolvedAdapter.mutationSafetyAllowed && coreReadOk;
    const verifiedWrites = params.skipDbLookup
      ? new Set<string>()
      : await mailWizzCapabilityRegistry.loadVerifiedWriteCapabilities(
          versionInfo.effectiveVersion,
          params.customerConnectionId
        );
    for (const mutKey of [
      'list_creation',
      'subscriber_copying',
      'subscriber_unsubscribe',
    ] as const) {
      const existing = caps.get(mutKey);
      const isDisposableVerified = canOfferMutations && verifiedWrites.has(mutKey);
      this.updateCap(caps, mutKey, {
        status: isDisposableVerified
          ? 'VERIFIED'
          : canOfferMutations
            ? 'AVAILABLE_BUT_UNTESTED'
            : 'BLOCKED',
        testedReadOnly: false,
        reason: isDisposableVerified
          ? `Authorized disposable write verification recorded for MailWizz ${versionInfo.effectiveVersion ?? 'baseline'}.`
          : canOfferMutations
            ? 'Gate enabled and core read contracts passed, but write capability remains AVAILABLE_BUT_UNTESTED until verified on an authorized disposable list.'
            : resolvedAdapter.mutationLockReason ||
              existing?.reason ||
              'Remote mutations blocked by safety gate.',
      });
    }

    if (caps.get('segment_creation')?.status !== 'UNSUPPORTED') {
      const segVerified = canOfferMutations && verifiedWrites.has('segment_creation');
      this.updateCap(caps, 'segment_creation', {
        status: segVerified
          ? 'VERIFIED'
          : canOfferMutations
            ? 'AVAILABLE_BUT_UNTESTED'
            : 'BLOCKED',
        reason: segVerified
          ? `Authorized disposable segment write verification recorded for MailWizz ${versionInfo.effectiveVersion ?? 'baseline'}.`
          : canOfferMutations
            ? 'Read-only segment prerequisites passed, but segment creation remains AVAILABLE_BUT_UNTESTED until verified on an authorized disposable list.'
            : resolvedAdapter.mutationLockReason ||
              caps.get('segment_creation')?.reason ||
              'Remote mutations blocked.',
      });
    }

    // 8. Final verdict calculation (strictly honest; untested/unknown/future versions never marked FULLY VERIFIED)
    let overallStatus: CompatibilityVerdict = 'UNVERIFIED';
    const hasCoreFailure =
      connectionStatus === 'AUTH_FAILED' ||
      connectionStatus === 'UNREACHABLE' ||
      caps.get('list_discovery')?.status === 'UNSUPPORTED' ||
      caps.get('subscriber_retrieval')?.status === 'UNSUPPORTED' ||
      caps.get('subscriber_status_retrieval')?.status === 'UNSUPPORTED';

    const secondaryReadKeys: CapabilityKey[] = [
      'subscriber_pagination',
      'campaign_discovery',
      'campaign_statistics',
      'bounce_reporting',
      'segment_discovery',
    ];
    const hasSecondaryFailure = secondaryReadKeys.some(
      (k) => caps.get(k)?.status === 'UNSUPPORTED'
    );
    const hasUntestedCore = listSampleEmpty || subscriberSampleEmpty;

    if (hasCoreFailure) {
      overallStatus = 'INCOMPATIBLE';
    } else if (listRateLimited) {
      overallStatus = 'UNVERIFIED';
    } else if (
      versionInfo.parsed.classification === 'FUTURE_MAJOR' ||
      versionInfo.parsed.classification === 'UNKNOWN_CUSTOM'
    ) {
      overallStatus = coreReadOk ? 'PARTIALLY COMPATIBLE' : 'UNVERIFIED';
    } else if (resolvedAdapter.adapterMode === 'VERIFIED_NATIVE' && coreReadOk && !hasSecondaryFailure) {
      overallStatus = hasUntestedCore ? 'PARTIALLY COMPATIBLE' : 'FULLY VERIFIED';
    } else if (coreReadOk || caps.get('list_discovery')?.status === 'VERIFIED') {
      overallStatus = 'PARTIALLY COMPATIBLE';
    } else {
      overallStatus = 'UNVERIFIED';
    }

    return {
      customerConnectionId: params.customerConnectionId ?? null,
      overallStatus,
      adapterInUse: `${resolvedAdapter.adapter.name} (${resolvedAdapter.adapter.id})`,
      adapterMode: resolvedAdapter.adapterMode,
      connectionStatus,
      versionInfo,
      mutationSafetyAllowed: resolvedAdapter.mutationSafetyAllowed,
      mutationLockReason: resolvedAdapter.mutationLockReason,
      historicalEngagementAvailable: effectiveHistAvailable,
      historicalEngagementSummary: histSummary.summaryText,
      capabilities: Array.from(caps.values()),
      warnings: Array.from(new Set(warnings)),
      requiredManualActions: Array.from(new Set(requiredManualActions)),
      additiveFieldsObserved: Array.from(additiveSet),
      lastVerifiedAt: checkedIso,
    };
  }
}

export const mailWizzCompatibilityValidator = new MailWizzCompatibilityValidator();

/**
 * Loads DB/env configuration, runs a non-mutating MailWizz compatibility check,
 * updates version detection and capability registry cleanly, and persists the report.
 */
export async function runReadOnlyCompatibilityCheck(params: {
  customerConnectionId?: string;
  actorEmail: string;
  ipAddress?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<CompatibilityReport> {
  const env = getEnv();
  const cfg = await prisma.appConfig.upsert({
    where: { id: 'default' },
    update: {},
    create: { id: 'default' },
  });

  let connId: string | null = params.customerConnectionId?.trim() || null;
  if (!connId) {
    const activeConns = await prisma.mailWizzCustomerConnection.findMany({
      where: { isQuarantine: false },
      select: { id: true },
      take: 2,
    });
    if (activeConns.length === 1) {
      connId = activeConns[0].id;
    } else if (activeConns.length > 1) {
      throw new Error(
        'Multiple customer connections exist. Explicit customerConnectionId is required to run compatibility check.'
      );
    }
  }

  const compatCfg = await mailWizzCapabilityRegistry.loadCompatibilityConfig(
    connId ?? undefined
  );

  let client: MailWizzClient | null = null;
  let reportingDbUri: string | null = env.MAILWIZZ_REPORTING_DB_URL || null;
  let reportingDbPrefix = cfg.reportingDbPrefix || env.MAILWIZZ_REPORTING_DB_PREFIX;
  let webhookConfigured = Boolean(cfg.webhookSecretEnc || env.MAILWIZZ_WEBHOOK_SECRET);

  let isDemoConn = false;
  if (connId) {
    const conn = await prisma.mailWizzCustomerConnection.findUnique({
      where: { id: connId },
      include: { installation: true },
    });
    if (!conn) {
      throw new Error(`Customer connection "${connId}" not found.`);
    }
    isDemoConn = conn.isDemoData;
    if (conn.reportingDbUrlEnc) {
      reportingDbUri = decryptSecret(conn.reportingDbUrlEnc);
      reportingDbPrefix = conn.reportingDbPrefix || reportingDbPrefix;
    } else if (cfg.reportingDbUrlEnc) {
      reportingDbUri = decryptSecret(cfg.reportingDbUrlEnc);
    }
    webhookConfigured = Boolean(conn.webhookSecretEnc || webhookConfigured);

    if (conn.isDemoData && !params.fetchImpl) {
      client = null;
    } else {
      try {
        const ctx = await getMailWizzClientWithContext(connId, {
          fetchImpl: params.fetchImpl,
        });
        client = ctx.client;
      } catch {
        client = null;
      }
    }
  }

  const report = await mailWizzCompatibilityValidator.validate({
    customerConnectionId: connId ?? undefined,
    client,
    configuredVersion: compatCfg.configuredVersion,
    approvedVersion: compatCfg.approvedVersion,
    reportingDbUri,
    reportingDbPrefix,
    webhookConfigured,
    envMutationsEnabled: isMailWizzMutationsEnabled(),
  });

  if (connId && !isDemoConn) {
    await prisma.mailWizzCustomerConnection.update({
      where: { id: connId },
      data: {
        ...(report.versionInfo.detectedVersion
          ? { detectedVersion: report.versionInfo.detectedVersion }
          : {}),
        status:
          report.connectionStatus === 'CONNECTED'
            ? 'CONNECTED'
            : report.connectionStatus === 'AUTH_FAILED'
              ? 'AUTH_FAILED'
              : 'PENDING',
      },
    });
  } else if (report.versionInfo.detectedVersion) {
    await prisma.appConfig.update({
      where: { id: 'default' },
      data: { mailwizzDetectedVersion: report.versionInfo.detectedVersion },
    });
  }

  const scopedReport: CompatibilityReport = {
    ...report,
    customerConnectionId: connId ?? null,
  };

  await mailWizzCapabilityRegistry.saveCompatibilityReport({
    customerConnectionId: connId ?? undefined,
    report: scopedReport,
    actorEmail: params.actorEmail,
    ipAddress: params.ipAddress,
  });

  return scopedReport;
}

/**
 * Loads current compatibility dashboard view state without triggering external network calls.
 */
export async function getCompatibilityDashboardData(
  customerConnectionId?: string
): Promise<{
  customerConnectionId: string | null;
  report: CompatibilityReport;
  approvedAt: string | null;
  approvedByEmail: string | null;
  configNotes: string | null;
  phase1ReadOnly: boolean;
  isDemoMode: boolean;
}> {
  let connId: string | null = customerConnectionId?.trim() || null;
  if (!connId) {
    try {
      connId = await resolveUnambiguousConnectionId();
    } catch {
      const firstConn = await prisma.mailWizzCustomerConnection.findFirst({
        where: { isQuarantine: false },
        orderBy: [{ isPrimary: 'desc' }, { customerName: 'asc' }],
        select: { id: true },
      });
      connId = firstConn?.id ?? null;
    }
  }

  const [cfg, connRecord, compatCfg, persistedReport] = await Promise.all([
    prisma.appConfig.upsert({
      where: { id: 'default' },
      update: {},
      create: { id: 'default' },
    }),
    connId
      ? prisma.mailWizzCustomerConnection.findUnique({
          where: { id: connId },
          select: {
            id: true,
            detectedVersion: true,
            approvedVersion: true,
            webhookSecretEnc: true,
          },
        })
      : Promise.resolve(null),
    mailWizzCapabilityRegistry.loadCompatibilityConfig(connId ?? undefined),
    mailWizzCapabilityRegistry.loadLatestCompatibilityReport(connId ?? undefined),
  ]);

  const env = getEnv();
  const webhookConfigured = Boolean(
    connRecord?.webhookSecretEnc || cfg.webhookSecretEnc || env.MAILWIZZ_WEBHOOK_SECRET
  );

  if (persistedReport) {
    // Re-evaluate version info against latest saved configuredVersion / approvedVersion & current env gate
    const versionInfo = mailWizzVersionDetector.resolveVersionInfo({
      configuredVersion: compatCfg.configuredVersion,
      detectedVersion:
        persistedReport.versionInfo.detectedVersion ??
        connRecord?.detectedVersion ??
        cfg.mailwizzDetectedVersion,
      approvedVersion: compatCfg.approvedVersion,
    });
    const envMut = isMailWizzMutationsEnabled();
    const corePassed =
      persistedReport.connectionStatus === 'CONNECTED' &&
      persistedReport.capabilities
        .filter((c) => c.criticalForSync)
        .every((c) => c.status === 'VERIFIED');
    const resolved = mailWizzFutureAdapterResolver.resolve({
      versionInfo,
      envMutationsEnabled: envMut,
      coreContractsPassed:
        persistedReport.connectionStatus === 'NOT_CONFIGURED' ? undefined : corePassed,
      approvedVersionPassedCheck: corePassed,
    });

    const verifiedWrites = await mailWizzCapabilityRegistry.loadVerifiedWriteCapabilities(
      versionInfo.effectiveVersion,
      connId ?? undefined
    );
    const refreshedCaps = persistedReport.capabilities.map((cap) => {
      if (cap.category !== 'MUTATIONS' || cap.status === 'UNSUPPORTED') {
        return cap;
      }
      const canOffer =
        persistedReport.connectionStatus === 'CONNECTED' &&
        envMut &&
        resolved.mutationSafetyAllowed &&
        corePassed;
      if (!canOffer) {
        return {
          ...cap,
          status: 'BLOCKED' as const,
        };
      }
      if (verifiedWrites.has(cap.key as never)) {
        return {
          ...cap,
          status: 'VERIFIED' as const,
        };
      }
      return {
        ...cap,
        status: 'AVAILABLE_BUT_UNTESTED' as const,
      };
    });

    const refreshedReport: CompatibilityReport = {
      ...persistedReport,
      customerConnectionId: connId,
      capabilities: refreshedCaps,
      versionInfo,
      adapterMode:
        persistedReport.connectionStatus === 'NOT_CONFIGURED'
          ? 'RESTRICTED_SAFE_MODE'
          : resolved.adapterMode,
      mutationSafetyAllowed:
        persistedReport.connectionStatus === 'NOT_CONFIGURED'
          ? false
          : resolved.mutationSafetyAllowed,
      mutationLockReason:
        persistedReport.connectionStatus === 'NOT_CONFIGURED'
          ? persistedReport.mutationLockReason
          : resolved.mutationLockReason,
    };

    return {
      customerConnectionId: connId,
      report: refreshedReport,
      approvedAt: compatCfg.approvedAt,
      approvedByEmail: compatCfg.approvedByEmail,
      configNotes: compatCfg.notes,
      phase1ReadOnly: !isMailWizzMutationsEnabled(),
      isDemoMode: cfg.isDemoMode,
    };
  }

  const baselineReport = await mailWizzCompatibilityValidator.validate({
    client: null,
    configuredVersion: compatCfg.configuredVersion,
    approvedVersion: compatCfg.approvedVersion,
    webhookConfigured,
    envMutationsEnabled: isMailWizzMutationsEnabled(),
  });

  return {
    customerConnectionId: connId,
    report: {
      ...baselineReport,
      customerConnectionId: connId,
    },
    approvedAt: compatCfg.approvedAt,
    approvedByEmail: compatCfg.approvedByEmail,
    configNotes: compatCfg.notes,
    phase1ReadOnly: !isMailWizzMutationsEnabled(),
    isDemoMode: cfg.isDemoMode,
  };
}
