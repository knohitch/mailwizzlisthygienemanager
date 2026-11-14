import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { resetEnvCacheForTests } from '@/lib/env';
import {
  createAdminSession,
  getActiveSessionFromToken,
  SESSION_COOKIE_NAME,
} from '@/services/security/auth';
import { deriveCsrfToken } from '@/services/security/csrf';
import { sha256Hex } from '@/services/security/crypto';
import {
  assertCompatibilityPermitsRemoteMutations,
  createConfiguredMutationClient,
  isMailWizzMutationsEnabled,
  MailWizzMutationClient,
  MutationGateLockedError,
  UnsafeOperationBlockedError,
} from '@/services/mutations/gate';
import { mailWizzCapabilityRegistry } from '@/services/mailwizz/capability-registry';
import type { CompatibilityReport } from '@/services/mailwizz/contracts';
import { previewCleanupOperation, confirmAndEnqueueCleanup } from '@/services/cleanup/planner';
import {
  createReengagementPlan,
  createSegmentForReengagementPlan,
} from '@/services/reengagement/workflow';
import { seedSyntheticDemoData } from '@/services/demo/seed-demo';
import { GET as healthGet } from '@/app/api/health/route';
import { POST as syncPost } from '@/app/api/sync/route';

const P33_LIST_ID = 'p33_real_list';
const P33_SUB_ID = 'p33_real_sub';
const P33_ACTOR = 'p33-readiness@local.hygiene';

function buildPartialApprovedReport(): CompatibilityReport {
  const nowIso = new Date().toISOString();
  const baseCaps = mailWizzCapabilityRegistry.buildBaselineEntries().map((cap) => {
    if (
      cap.key === 'list_discovery' ||
      cap.key === 'subscriber_retrieval' ||
      cap.key === 'subscriber_pagination' ||
      cap.key === 'subscriber_status_retrieval'
    ) {
      return {
        ...cap,
        status: 'VERIFIED' as const,
        testedReadOnly: true,
        reason: 'Verified read-only contract',
        lastCheckedAt: nowIso,
      };
    }
    if (cap.key === 'subscriber_unsubscribe') {
      return {
        ...cap,
        status: 'AVAILABLE_BUT_UNTESTED' as const,
        testedReadOnly: false,
        reason: 'Unsubscribe prerequisite checks passed',
        lastCheckedAt: nowIso,
      };
    }
    if (cap.key === 'segment_discovery' || cap.key === 'segment_creation') {
      return {
        ...cap,
        status: 'UNSUPPORTED' as const,
        testedReadOnly: true,
        reason: 'HTTP 404 on /campaigns/segments/condition-operators',
        contractErrors: ['HTTP 404 Not Found'],
        lastCheckedAt: nowIso,
      };
    }
    if (cap.key === 'subscriber_copying' || cap.key === 'list_creation') {
      return {
        ...cap,
        status: 'UNSUPPORTED' as const,
        testedReadOnly: true,
        reason: 'Bulk copy endpoint disabled on target server',
        lastCheckedAt: nowIso,
      };
    }
    return cap;
  });

  return {
    overallStatus: 'PARTIALLY COMPATIBLE',
    adapterInUse: 'MailWizz 3.x REST Adapter (mailwizz-v3)',
    adapterMode: 'VERIFIED_NATIVE',
    connectionStatus: 'CONNECTED',
    versionInfo: {
      configuredVersion: '3.1.2',
      detectedVersion: '3.1.2',
      approvedVersion: '3.1.2',
      effectiveVersion: '3.1.2',
      source: 'API_HEADER_OR_META',
      verifiedByApiSignal: true,
      parsed: {
        raw: '3.1.2',
        major: 3,
        minor: 1,
        patch: 2,
        prerelease: null,
        classification: 'MINOR_3_X',
        isBaseline305: false,
        isVerifiedLineage: true,
      },
      upgradeDetected: false,
      upgradeSummary: null,
    },
    mutationSafetyAllowed: true,
    mutationLockReason: null,
    historicalEngagementAvailable: true,
    historicalEngagementSummary: 'Verified export coverage',
    capabilities: baseCaps,
    warnings: [],
    requiredManualActions: [],
    additiveFieldsObserved: [],
    lastVerifiedAt: nowIso,
  };
}

describe('Phase 3.3 Isolated Deployment, Per-Operation Guard & Demo Isolation Readiness', () => {
  let rawToken = '';
  let csrfToken = '';
  let sessionId = '';
  const createdOpIds: string[] = [];
  const createdPlanIds: string[] = [];
  const prevMutations = process.env.ENABLE_MAILWIZZ_MUTATIONS;
  const prevNodeEnv = process.env.NODE_ENV;

  beforeAll(async () => {
    const sess = await createAdminSession({
      adminEmail: P33_ACTOR,
      ipAddress: '127.0.0.1',
      userAgent: 'vitest-p33',
    });
    rawToken = sess.rawToken;
    const active = await getActiveSessionFromToken(rawToken);
    if (!active) throw new Error('Failed to establish Phase 3.3 admin session');
    sessionId = active.sessionId;
    csrfToken = deriveCsrfToken(active);

    await prisma.cleanupOperationRecord.deleteMany({
      where: { mailingListUid: 'p33_uid_list' },
    });
    await prisma.reengagementPlan.deleteMany({
      where: { mailingListId: P33_LIST_ID },
    });
    await prisma.subscriber.deleteMany({ where: { id: P33_SUB_ID } });
    await prisma.mailingList.deleteMany({ where: { id: P33_LIST_ID } });

    await prisma.mailingList.create({
      data: {
        id: P33_LIST_ID,
        listUid: 'p33_uid_list',
        name: 'Phase 3.3 Real Readiness List',
        optIn: 'single',
        isDemoData: false,
      },
    });

    await prisma.subscriber.create({
      data: {
        id: P33_SUB_ID,
        mailingListId: P33_LIST_ID,
        subscriberUid: 'p33_uid_sub',
        email: 'p33.real@example.com',
        emailHash: sha256Hex('p33.real@example.com'),
        status: 'CONFIRMED',
        rawStatus: 'confirmed',
        engagementStatus: 'INACTIVE',
        hygieneStatus: 'INACTIVE_CANDIDATE',
        historyCoverage: 'VERIFIED_FULL',
        deliveredCampaignsCount: 6,
        isDemoData: false,
      },
    });
  });

  afterAll(async () => {
    process.env.ENABLE_MAILWIZZ_MUTATIONS = prevMutations;
    (process.env as Record<string, string | undefined>).NODE_ENV = prevNodeEnv;
    resetEnvCacheForTests();

    if (createdOpIds.length > 0) {
      await prisma.cleanupOperationRecord.deleteMany({
        where: { operationId: { in: createdOpIds } },
      });
      await prisma.cleanupOperation.deleteMany({
        where: { id: { in: createdOpIds } },
      });
    }
    if (createdPlanIds.length > 0) {
      await prisma.reengagementPlan.deleteMany({
        where: { id: { in: createdPlanIds } },
      });
    }
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { actorEmail: P33_ACTOR },
          { action: 'MAILWIZZ_COMPATIBILITY_CHECK', resourceId: '3.1.2' },
        ],
      },
    });
    await prisma.adminSession.deleteMany({ where: { id: sessionId } });
    await prisma.subscriber.deleteMany({ where: { id: P33_SUB_ID } });
    await prisma.mailingList.deleteMany({ where: { id: P33_LIST_ID } });
  });

  it('reports healthy database/worker status and keeps ENABLE_MAILWIZZ_MUTATIONS=false on /api/health', async () => {
    process.env.ENABLE_MAILWIZZ_MUTATIONS = 'false';
    resetEnvCacheForTests();

    expect(isMailWizzMutationsEnabled()).toBe(false);
    const res = await healthGet();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      database: string;
      worker: string;
      mailwizzMutationsEnabled: boolean;
    };
    expect(body.status).toBe('ok');
    expect(body.database).toBe('connected');
    expect(['healthy', 'stale-heartbeat']).toContain(body.worker);
    expect(body.mailwizzMutationsEnabled).toBe(false);
  });

  it('requires per-operation compatibility verification even when a MailWizz version is approved', async () => {
    const partialReport = buildPartialApprovedReport();
    await mailWizzCapabilityRegistry.saveCompatibilityReport({
      report: partialReport,
      actorEmail: P33_ACTOR,
    });

    process.env.ENABLE_MAILWIZZ_MUTATIONS = 'true';
    resetEnvCacheForTests();

    // Version-level approval + UNSUBSCRIBE capability passes
    await expect(assertCompatibilityPermitsRemoteMutations('UNSUBSCRIBE')).resolves.toBeUndefined();

    // Per-operation checks still block UNSUPPORTED operations on the same approved version
    await expect(
      assertCompatibilityPermitsRemoteMutations('CREATE_SEGMENT')
    ).rejects.toBeInstanceOf(UnsafeOperationBlockedError);
    await expect(
      assertCompatibilityPermitsRemoteMutations('COPY_SUBSCRIBERS')
    ).rejects.toBeInstanceOf(UnsafeOperationBlockedError);
    await expect(
      assertCompatibilityPermitsRemoteMutations('MOVE_SUBSCRIBERS')
    ).rejects.toBeInstanceOf(UnsafeOperationBlockedError);
    await expect(
      createConfiguredMutationClient('CREATE_SEGMENT')
    ).rejects.toBeInstanceOf(UnsafeOperationBlockedError);

    // Planner confirmation also rejects unsupported remote action at enqueue time
    const segOp = await previewCleanupOperation({
      actionType: 'CREATE_SEGMENT',
      mailingListId: P33_LIST_ID,
      filter: { combinator: 'AND', conditions: [] },
      explicitSubscriberIds: [P33_SUB_ID],
      targetSegmentName: 'P33 Unsupported Seg Test',
      actorEmail: P33_ACTOR,
    });
    createdOpIds.push(segOp.id);

    await expect(
      confirmAndEnqueueCleanup({
        operationId: segOp.id,
        confirmedListName: 'Phase 3.3 Real Readiness List',
        confirmedCount: segOp.eligibleCount,
        actorEmail: P33_ACTOR,
      })
    ).rejects.toBeInstanceOf(UnsafeOperationBlockedError);

    // Re-engagement segment creation also rejects unsupported segment capability
    const plan = await createReengagementPlan({
      name: 'P33 Segment Gate Check',
      mailingListId: P33_LIST_ID,
      actorEmail: P33_ACTOR,
    });
    createdPlanIds.push(plan.id);
    await expect(
      createSegmentForReengagementPlan({
        planId: plan.id,
        actorEmail: P33_ACTOR,
      })
    ).rejects.toBeInstanceOf(UnsafeOperationBlockedError);

    // With ENABLE_MAILWIZZ_MUTATIONS=false, low-level writer still hard-locks any remote write
    process.env.ENABLE_MAILWIZZ_MUTATIONS = 'false';
    resetEnvCacheForTests();
    const lockedWriter = new MailWizzMutationClient({
      apiUrl: 'https://mw.example.com/api/index.php',
      apiKey: 'read-only-check-key',
    });
    await expect(
      lockedWriter.unsubscribeSubscriber({
        listUid: 'p33_uid_list',
        subscriberUid: 'p33_uid_sub',
        actorEmail: P33_ACTOR,
      })
    ).rejects.toBeInstanceOf(MutationGateLockedError);
  });

  it('prevents synthetic 2,190-subscriber demo seeding from mixing into real data or production mode', async () => {
    // Real (isDemoData: false) list & subscriber exist in setup above
    await expect(seedSyntheticDemoData()).rejects.toThrow(/real \(non-demo\) MailWizz data/i);

    const realSubAfter = await prisma.subscriber.findUnique({ where: { id: P33_SUB_ID } });
    expect(realSubAfter?.email).toBe('p33.real@example.com');
    expect(realSubAfter?.isDemoData).toBe(false);

    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    const prodSeedReq = new NextRequest('http://localhost:3000/api/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: `${SESSION_COOKIE_NAME}=${rawToken}`,
        'x-csrf-token': csrfToken,
      },
      body: JSON.stringify({ action: 'SEED_DEMO_DATA' }),
    });
    const prodSeedRes = await syncPost(prodSeedReq);
    expect(prodSeedRes.status).toBe(403);
  });
});
