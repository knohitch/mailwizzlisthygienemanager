import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { resetEnvCacheForTests } from '@/lib/env';
import {
  assertCompatibilityPermitsRemoteMutations,
  MutationGateLockedError,
  UnsafeOperationBlockedError,
} from '@/services/mutations/gate';
import { mailWizzCapabilityRegistry } from '@/services/mailwizz/capability-registry';
import { mailWizzCompatibilityValidator } from '@/services/mailwizz/compatibility-validator';
import { MailWizzClient } from '@/services/mailwizz/client';
import type { CompatibilityReport } from '@/services/mailwizz/contracts';
import { evaluateActionEligibility } from '@/services/cleanup/safety';
import { previewCleanupOperation, confirmAndEnqueueCleanup } from '@/services/cleanup/planner';
import { executeCleanupOperation } from '@/services/cleanup/executor';
import { enqueueJob, recoverStaleJobs } from '@/services/jobs/queue';
import { sha256Hex } from '@/services/security/crypto';

const P34_ACTOR = 'p34-acceptance@local.hygiene';
const P34_LIST_ID = 'p34_accept_list';
const P34_SUB_ID = 'p34_accept_sub';
const P34_DEMO_LIST_ID = 'p34_demo_list';
const P34_INST_ID = 'p34_test_inst';
const P34_CONN_ID = 'p34_test_conn';

function buildFullVerifiedReport(unsubscribeStatus: 'VERIFIED' | 'AVAILABLE_BUT_UNTESTED'): CompatibilityReport {
  const nowIso = new Date().toISOString();
  const capabilities = mailWizzCapabilityRegistry.buildBaselineEntries().map((cap) => {
    if (
      cap.key === 'list_discovery' ||
      cap.key === 'subscriber_retrieval' ||
      cap.key === 'subscriber_pagination' ||
      cap.key === 'subscriber_status_retrieval' ||
      cap.key === 'campaign_discovery' ||
      cap.key === 'campaign_statistics'
    ) {
      return {
        ...cap,
        status: 'VERIFIED' as const,
        testedReadOnly: true,
        reason: 'Verified read contract',
        lastCheckedAt: nowIso,
      };
    }
    if (cap.key === 'subscriber_unsubscribe') {
      return {
        ...cap,
        status: unsubscribeStatus,
        testedReadOnly: false,
        reason:
          unsubscribeStatus === 'VERIFIED'
            ? 'Verified on disposable test list'
            : 'Write prerequisites passed; awaiting disposable write verification',
        lastCheckedAt: nowIso,
      };
    }
    return cap;
  });

  return {
    overallStatus: 'FULLY VERIFIED',
    adapterInUse: 'MailWizz 3.x REST Adapter (mailwizz-v3)',
    adapterMode: 'VERIFIED_NATIVE',
    connectionStatus: 'CONNECTED',
    versionInfo: {
      configuredVersion: '3.0.5',
      detectedVersion: '3.0.5',
      approvedVersion: '3.0.5',
      effectiveVersion: '3.0.5',
      source: 'API_HEADER_OR_META',
      verifiedByApiSignal: true,
      parsed: {
        raw: '3.0.5',
        major: 3,
        minor: 0,
        patch: 5,
        prerelease: null,
        classification: 'BASELINE_3_0_5',
        isBaseline305: true,
        isVerifiedLineage: true,
      },
      upgradeDetected: false,
      upgradeSummary: null,
    },
    mutationSafetyAllowed: true,
    mutationLockReason: null,
    historicalEngagementAvailable: true,
    historicalEngagementSummary: 'Verified test history source',
    capabilities,
    warnings: [],
    requiredManualActions: [],
    additiveFieldsObserved: [],
    lastVerifiedAt: nowIso,
  };
}

describe('Integration: Phase 3.4 Docker Acceptance & Hardened Mutation Gates', () => {
  const originalMutations = process.env.ENABLE_MAILWIZZ_MUTATIONS;
  const createdOpIds: string[] = [];
  const createdJobIds: string[] = [];

  beforeAll(async () => {
    await prisma.mailWizzInstallation.upsert({
      where: { id: P34_INST_ID },
      update: { name: 'Phase34 Test MailWizz', isActive: true },
      create: {
        id: P34_INST_ID,
        name: 'Phase34 Test MailWizz',
        baseUrl: 'https://p34-mock.example.invalid/api/index.php',
        hostname: 'p34-mock.example.invalid',
      },
    });
    await prisma.mailWizzCustomerConnection.upsert({
      where: { id: P34_CONN_ID },
      update: { isEnabled: true, isQuarantine: false, isDemoData: false, status: 'CONNECTED' },
      create: {
        id: P34_CONN_ID,
        installationId: P34_INST_ID,
        customerName: 'Phase 3.4 Test Customer',
        customerSlug: 'p34-test-customer',
        isEnabled: true,
        isQuarantine: false,
        isDemoData: false,
        status: 'CONNECTED',
      },
    });

    await prisma.mailingList.upsert({
      where: {
        customerConnectionId_listUid: {
          customerConnectionId: P34_CONN_ID,
          listUid: 'p34_real_uid',
        },
      },
      update: { isDemoData: false, name: 'Phase 3.4 Eligible List' },
      create: {
        id: P34_LIST_ID,
        customerConnectionId: P34_CONN_ID,
        listUid: 'p34_real_uid',
        name: 'Phase 3.4 Eligible List',
        displayName: 'Phase 3.4 Eligible List',
        optIn: 'single',
        isDemoData: false,
      },
    });

    await prisma.mailingList.upsert({
      where: {
        customerConnectionId_listUid: {
          customerConnectionId: P34_CONN_ID,
          listUid: 'p34_demo_uid',
        },
      },
      update: { isDemoData: true, name: 'Phase 3.4 Demo List' },
      create: {
        id: P34_DEMO_LIST_ID,
        customerConnectionId: P34_CONN_ID,
        listUid: 'p34_demo_uid',
        name: 'Phase 3.4 Demo List',
        displayName: 'Phase 3.4 Demo List',
        optIn: 'single',
        isDemoData: true,
      },
    });

    await prisma.subscriber.upsert({
      where: {
        mailingListId_subscriberUid: {
          mailingListId: P34_LIST_ID,
          subscriberUid: 'p34_sub_uid',
        },
      },
      update: {
        email: 'p34.eligible@example.com',
        status: 'CONFIRMED',
        engagementStatus: 'LONG_TERM_INACTIVE',
        hygieneStatus: 'INACTIVE_CANDIDATE',
        historyCoverage: 'VERIFIED_FULL',
        deliveredCampaignsCount: 8,
        isSuppressed: false,
        isArchived: false,
        isVip: false,
        hasPaidRelationship: false,
        isExcluded: false,
        isDemoData: false,
      },
      create: {
        id: P34_SUB_ID,
        customerConnectionId: P34_CONN_ID,
        mailingListId: P34_LIST_ID,
        subscriberUid: 'p34_sub_uid',
        email: 'p34.eligible@example.com',
        emailHash: sha256Hex('p34.eligible@example.com'),
        status: 'CONFIRMED',
        rawStatus: 'confirmed',
        engagementStatus: 'LONG_TERM_INACTIVE',
        hygieneStatus: 'INACTIVE_CANDIDATE',
        historyCoverage: 'VERIFIED_FULL',
        deliveredCampaignsCount: 8,
        isDemoData: false,
      },
    });
  });

  afterAll(async () => {
    process.env.ENABLE_MAILWIZZ_MUTATIONS = originalMutations;
    resetEnvCacheForTests();

    if (createdOpIds.length > 0) {
      await prisma.cleanupOperationRecord.deleteMany({
        where: { operationId: { in: createdOpIds } },
      });
      await prisma.cleanupOperation.deleteMany({
        where: { id: { in: createdOpIds } },
      });
    }
    if (createdJobIds.length > 0) {
      await prisma.syncJob.deleteMany({
        where: { id: { in: createdJobIds } },
      });
    }
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { actorEmail: P34_ACTOR },
          {
            action: {
              in: [
                'MAILWIZZ_COMPATIBILITY_CONFIG',
                'MAILWIZZ_COMPATIBILITY_CHECK',
                'MAILWIZZ_VERSION_APPROVED',
                'MAILWIZZ_WRITE_CAPABILITY_VERIFIED',
                'MAILWIZZ_COMPATIBILITY_RESET',
              ],
            },
          },
        ],
      },
    });
    await prisma.subscriber.deleteMany({ where: { id: P34_SUB_ID } });
    await prisma.mailingList.deleteMany({ where: { id: { in: [P34_LIST_ID, P34_DEMO_LIST_ID] } } });
    await prisma.mailWizzCustomerConnection.deleteMany({ where: { id: P34_CONN_ID } });
    await prisma.mailWizzInstallation.deleteMany({ where: { id: P34_INST_ID } });
  });

  it('enforces global lock, blocks AVAILABLE_BUT_UNTESTED, rejects demo disposable verification, and clears cache on reset', async () => {
    // 1. Even with a VERIFIED report saved, ENABLE_MAILWIZZ_MUTATIONS=false blocks remote mutations globally
    await mailWizzCapabilityRegistry.saveCompatibilityReport({
      customerConnectionId: P34_CONN_ID,
      report: buildFullVerifiedReport('VERIFIED'),
      actorEmail: P34_ACTOR,
    });
    process.env.ENABLE_MAILWIZZ_MUTATIONS = 'false';
    resetEnvCacheForTests();
    await expect(
      assertCompatibilityPermitsRemoteMutations('UNSUBSCRIBE', { customerConnectionId: P34_CONN_ID })
    ).rejects.toBeInstanceOf(MutationGateLockedError);

    // Demo lists and mutation-disabled environments cannot record disposable write verification
    await expect(
      mailWizzCapabilityRegistry.recordDisposableWriteVerification({
        customerConnectionId: P34_CONN_ID,
        capabilityKey: 'subscriber_unsubscribe',
        approvedVersion: '3.0.5',
        disposableListUid: 'p34_real_uid',
        evidence: 'Should fail while mutations disabled',
        actorEmail: P34_ACTOR,
      })
    ).rejects.toThrow(/ENABLE_MAILWIZZ_MUTATIONS=false/i);

    process.env.ENABLE_MAILWIZZ_MUTATIONS = 'true';
    resetEnvCacheForTests();

    await expect(
      mailWizzCapabilityRegistry.recordDisposableWriteVerification({
        customerConnectionId: P34_CONN_ID,
        capabilityKey: 'subscriber_unsubscribe',
        approvedVersion: '3.0.5',
        disposableListUid: 'demo-list-1',
        evidence: 'Must reject demo prefix',
        actorEmail: P34_ACTOR,
      })
    ).rejects.toThrow(/non-demo/i);

    await expect(
      mailWizzCapabilityRegistry.recordDisposableWriteVerification({
        customerConnectionId: P34_CONN_ID,
        capabilityKey: 'subscriber_unsubscribe',
        approvedVersion: '3.0.5',
        disposableListUid: 'p34_demo_uid',
        evidence: 'Must reject isDemoData=true list',
        actorEmail: P34_ACTOR,
      })
    ).rejects.toThrow(/synthetic demo data/i);

    // 2. AVAILABLE_BUT_UNTESTED must fail closed even when version=3.0.5 is approved and ENABLE_MAILWIZZ_MUTATIONS=true
    await mailWizzCapabilityRegistry.saveCompatibilityReport({
      customerConnectionId: P34_CONN_ID,
      report: buildFullVerifiedReport('AVAILABLE_BUT_UNTESTED'),
      actorEmail: P34_ACTOR,
    });
    await expect(
      assertCompatibilityPermitsRemoteMutations('UNSUBSCRIBE', { customerConnectionId: P34_CONN_ID })
    ).rejects.toBeInstanceOf(UnsafeOperationBlockedError);

    // 3. After disposable write verification + invalidation reset, cached compatibility clears cleanly
    await mailWizzCapabilityRegistry.recordDisposableWriteVerification({
      customerConnectionId: P34_CONN_ID,
      capabilityKey: 'subscriber_unsubscribe',
      approvedVersion: '3.0.5',
      disposableListUid: 'p34_real_uid',
      evidence: 'Authorized disposable sandbox unsubscribe ok',
      actorEmail: P34_ACTOR,
    });
    expect(
      (await mailWizzCapabilityRegistry.loadVerifiedWriteCapabilities('3.0.5', P34_CONN_ID)).has(
        'subscriber_unsubscribe'
      )
    ).toBe(true);

    await mailWizzCapabilityRegistry.invalidateCachedCompatibility({
      customerConnectionId: P34_CONN_ID,
      actorEmail: P34_ACTOR,
      reason: 'Simulated MailWizz endpoint change',
    });
    expect(
      (await mailWizzCapabilityRegistry.loadVerifiedWriteCapabilities('3.0.5', P34_CONN_ID)).size
    ).toBe(0);
    expect(await mailWizzCapabilityRegistry.loadLatestCompatibilityReport(P34_CONN_ID)).toBeNull();
    await expect(
      assertCompatibilityPermitsRemoteMutations('UNSUBSCRIBE', { customerConnectionId: P34_CONN_ID })
    ).rejects.toBeInstanceOf(UnsafeOperationBlockedError);

    process.env.ENABLE_MAILWIZZ_MUTATIONS = 'false';
    resetEnvCacheForTests();
  });

  it('rejects tampered pre-change snapshots, blocks missing historical engagement auto-unsubscribe, and fails closed on future version', async () => {
    // Missing history never qualifies for UNSUBSCRIBE
    const insufficientDecision = evaluateActionEligibility(
      {
        id: 'missing_hist_sub',
        subscriberUid: 'missing_hist_uid',
        mailingListId: P34_LIST_ID,
        mailingListUid: 'p34_real_uid',
        email: 'nohist@example.com',
        firstName: null,
        lastName: null,
        status: 'CONFIRMED',
        engagementStatus: 'INSUFFICIENT_DATA',
        historyCoverage: 'NONE',
        deliveredCampaignsCount: 0,
        clicksCount: 0,
        repliesCount: 0,
        conversionsCount: 0,
        hardBouncesCount: 0,
        complaintsCount: 0,
        lastClickAt: null,
        lastReplyAt: null,
        lastConversionAt: null,
        lastPurchaseAt: null,
        isExcluded: false,
        exclusionReason: null,
        isVip: false,
        hasPaidRelationship: false,
        isSuppressed: false,
        isArchived: false,
      },
      'UNSUBSCRIBE',
      { minDeliveredCampaigns: 3 }
    );
    expect(insufficientDecision.eligible).toBe(false);
    expect(insufficientDecision.reason).toMatch(/Safety lock/i);

    // Unknown future version 4.2.0 fails closed even with readable /lists
    const futureReport = await mailWizzCompatibilityValidator.validate({
      client: new MailWizzClient({
        apiUrl: 'https://mw-mock.example.com/api/index.php',
        apiKey: 'mock-future-key',
        maxRequestsPerSecond: 50,
        maxRetries: 0,
        fetchImpl: (async () =>
          new Response(
            JSON.stringify({
              status: 'success',
              meta: { version: '4.2.0' },
              data: { count: 1, total_pages: 1, current_page: 1, next_page: null, records: [] },
            }),
            { status: 200, headers: { 'X-MW-Version': '4.2.0', 'Content-Type': 'application/json' } }
          )) as typeof fetch,
      }),
      configuredVersion: '3.0.5',
      approvedVersion: '3.0.5',
      webhookConfigured: true,
      envMutationsEnabled: true,
      skipDbLookup: true,
    });
    expect(futureReport.adapterMode).toBe('RESTRICTED_SAFE_MODE');
    expect(futureReport.mutationSafetyAllowed).toBe(false);

    // Tampered pre-change snapshot checksum aborts CleanupOperation execution before touching subscribers
    const op = await previewCleanupOperation({
      actionType: 'SUPPRESS',
      mailingListId: P34_LIST_ID,
      filter: { combinator: 'AND', conditions: [] },
      explicitSubscriberIds: [P34_SUB_ID],
      actorEmail: P34_ACTOR,
    });
    createdOpIds.push(op.id);

    const confirmed = await confirmAndEnqueueCleanup({
      operationId: op.id,
      confirmedListName: 'Phase 3.4 Eligible List',
      confirmedCount: op.eligibleCount,
      actorEmail: P34_ACTOR,
    });
    createdJobIds.push(confirmed.job.id);

    await prisma.cleanupOperation.update({
      where: { id: op.id },
      data: { snapshotSha256: '0'.repeat(64) },
    });

    await expect(
      executeCleanupOperation({ operationId: op.id, syncJobId: confirmed.job.id, actorEmail: P34_ACTOR })
    ).rejects.toThrow(/snapshot checksum mismatch/i);
  });

  it('recovers interrupted stale RUNNING worker jobs across container restarts', async () => {
    const staleJob = await enqueueJob({
      type: 'ANALYZE_HYGIENE',
      payload: { source: 'phase34-restart-test' },
      maxAttempts: 3,
    });
    createdJobIds.push(staleJob.id);

    await prisma.syncJob.update({
      where: { id: staleJob.id },
      data: {
        status: 'RUNNING',
        attempts: 1,
        lockedBy: 'crashed-worker-container',
        heartbeatAt: new Date(Date.now() - 10 * 60_000),
      },
    });

    const recoveredCount = await recoverStaleJobs(5 * 60_000);
    expect(recoveredCount).toBeGreaterThanOrEqual(1);

    const after = await prisma.syncJob.findUnique({ where: { id: staleJob.id } });
    expect(after?.status).toBe('PENDING');
    expect(after?.lockedBy).toBeNull();
    expect(after?.lastError).toMatch(/timed out/i);
  });
});
