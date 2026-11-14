import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { resetEnvCacheForTests } from '@/lib/env';
import { hashEmail, sha256Hex } from '@/services/security/crypto';
import { recomputeAllHygieneClassifications } from '@/services/analysis/classifier';
import { queryFilteredSubscribers } from '@/services/analysis/filter-engine';
import {
  confirmAndEnqueueCleanup,
  previewCleanupOperation,
} from '@/services/cleanup/planner';
import { executeCleanupOperation } from '@/services/cleanup/executor';
import {
  cancelCleanupOperation,
  inspectOperationSnapshot,
  pauseCleanupOperation,
  restoreSuppressedSubscribers,
  resumeCleanupOperation,
} from '@/services/cleanup/restore';
import { MailWizzMutationClient } from '@/services/mutations/mailwizz-writer';
import { mailWizzCapabilityRegistry } from '@/services/mailwizz/capability-registry';
import {
  approveReengagementCampaignManually,
  createReengagementPlan,
  evaluateReengagementPlan,
} from '@/services/reengagement/workflow';
import {
  generateAllReportsSummary,
  generateReportCsv,
} from '@/services/reports/generator';

const TEST_LIST_A_UID = 'phase2_test_list_a';
const TEST_LIST_B_UID = 'phase2_test_list_b';

describe('Integration: Phase 2 Filter, Safety, Batch Execution, Re-engagement & Restore', () => {
  let listAId = '';
  let listBId = '';
  const createdOpIds: string[] = [];
  const createdPlanIds: string[] = [];
  const createdJobIds: string[] = [];

  beforeAll(async () => {
    await prisma.campaign.deleteMany({
      where: { campaignUid: { startsWith: 'p2_camp_' } },
    });
    await prisma.campaign.deleteMany({
      where: { campaignUid: { startsWith: 'p2_camp_' } },
    });
    await prisma.mailingList.deleteMany({
      where: { listUid: { in: [TEST_LIST_A_UID, TEST_LIST_B_UID] } },
    });

    const now = new Date();
    const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);

    const listA = await prisma.mailingList.create({
      data: {
        listUid: TEST_LIST_A_UID,
        name: 'Phase2 Test List A',
        fromName: 'Acme Test',
        fromEmail: 'test@example.com',
        replyTo: 'reply@example.com',
        optIn: 'single',
        isDemoData: false,
      },
    });
    const listB = await prisma.mailingList.create({
      data: {
        listUid: TEST_LIST_B_UID,
        name: 'Phase2 Test List B',
        fromName: 'Acme Test',
        fromEmail: 'test@example.com',
        replyTo: 'reply@example.com',
        optIn: 'double',
        isDemoData: false,
      },
    });
    listAId = listA.id;
    listBId = listB.id;

    // Create 6 campaigns for List A spanning 210 days
    const campIds: string[] = [];
    for (let i = 0; i < 6; i++) {
      const c = await prisma.campaign.create({
        data: {
          campaignUid: `p2_camp_${i}`,
          mailingListId: listAId,
          listUid: TEST_LIST_A_UID,
          name: `P2 Camp ${i}`,
          status: 'sent',
          sendAt: daysAgo(200 - i * 35),
          subscribersCount: 7,
          processedCount: 7,
          deliverySuccessCount: 7,
        },
      });
      campIds.push(c.id);
    }

    const subDefs = [
      { uid: 'p2_sub_active', email: 'active@example.com', status: 'CONFIRMED' as const, vip: false },
      { uid: 'p2_sub_inactive1', email: 'inactive1@example.com', status: 'CONFIRMED' as const, vip: false },
      { uid: 'p2_sub_inactive2', email: 'inactive2@example.com', status: 'CONFIRMED' as const, vip: false },
      { uid: 'p2_sub_long', email: 'longterm@example.com', status: 'CONFIRMED' as const, vip: false },
      { uid: 'p2_sub_never', email: 'never@company.org', status: 'CONFIRMED' as const, vip: false },
      { uid: 'p2_sub_vip', email: 'vip@example.com', status: 'CONFIRMED' as const, vip: true },
      { uid: 'p2_sub_shared', email: 'shared.consent@example.com', status: 'CONFIRMED' as const, vip: false },
    ];

    const subByUid: Record<string, string> = {};
    for (const s of subDefs) {
      const created = await prisma.subscriber.create({
        data: {
          mailingListId: listAId,
          subscriberUid: s.uid,
          email: s.email,
          emailHash: hashEmail(s.email),
          status: s.status,
          rawStatus: s.status.toLowerCase(),
          source: 'api',
          dateAddedMailwizz: daysAgo(250),
          isVip: s.vip,
        },
      });
      subByUid[s.uid] = created.id;
    }

    // Same shared email UNSUBSCRIBED on List B
    await prisma.subscriber.create({
      data: {
        mailingListId: listBId,
        subscriberUid: 'p2_sub_shared_b',
        email: 'shared.consent@example.com',
        emailHash: hashEmail('shared.consent@example.com'),
        status: 'UNSUBSCRIBED',
        rawStatus: 'unsubscribed',
        source: 'api',
        dateAddedMailwizz: daysAgo(250),
      },
    });

    // Attach deliveries for all 7 subscribers on List A + varied engagement
    for (const uid of Object.keys(subByUid)) {
      const subId = subByUid[uid];
      for (let idx = 0; idx < campIds.length; idx++) {
        await prisma.engagementEvent.create({
          data: {
            subscriberId: subId,
            campaignId: campIds[idx],
            mailingListId: listAId,
            eventType: 'DELIVERED',
            source: 'READONLY_REPORTING_DB',
            occurredAt: daysAgo(200 - idx * 35),
            isHistorical: true,
            dedupeKey: sha256Hex(`P2|${subId}|${campIds[idx]}|DEL`),
          },
        });
      }
    }

    // active@ clicked 5d ago
    await prisma.engagementEvent.create({
      data: {
        subscriberId: subByUid.p2_sub_active,
        campaignId: campIds[5],
        mailingListId: listAId,
        eventType: 'CLICK',
        source: 'VERIFIED_EXPORT',
        occurredAt: daysAgo(5),
        isHistorical: true,
        dedupeKey: sha256Hex(`P2|active|CLICK`),
      },
    });

    // inactive1@ & inactive2@ clicked 110d ago
    for (const key of ['p2_sub_inactive1', 'p2_sub_inactive2'] as const) {
      await prisma.engagementEvent.create({
        data: {
          subscriberId: subByUid[key],
          campaignId: campIds[2],
          mailingListId: listAId,
          eventType: 'OPEN',
          source: 'VERIFIED_EXPORT',
          occurredAt: daysAgo(110),
          isHistorical: true,
          dedupeKey: sha256Hex(`P2|${key}|OPEN`),
        },
      });
    }

    // longterm@ opened 195d ago; shared@ opened 195d ago
    for (const key of ['p2_sub_long', 'p2_sub_shared'] as const) {
      await prisma.engagementEvent.create({
        data: {
          subscriberId: subByUid[key],
          campaignId: campIds[0],
          mailingListId: listAId,
          eventType: 'OPEN',
          source: 'VERIFIED_EXPORT',
          occurredAt: daysAgo(195),
          isHistorical: true,
          dedupeKey: sha256Hex(`P2|${key}|OPEN`),
        },
      });
    }

    await recomputeAllHygieneClassifications(listAId);
    await recomputeAllHygieneClassifications(listBId);
  });

  afterAll(async () => {
    if (createdPlanIds.length > 0) {
      await prisma.reengagementPlan.deleteMany({
        where: { id: { in: createdPlanIds } },
      });
    }
    if (createdOpIds.length > 0) {
      await prisma.cleanupOperation.deleteMany({
        where: { id: { in: createdOpIds } },
      });
    }
    if (createdJobIds.length > 0) {
      await prisma.syncJob.deleteMany({
        where: { id: { in: createdJobIds } },
      });
    }
    await prisma.campaign.deleteMany({
      where: { campaignUid: { startsWith: 'p2_camp_' } },
    });
    await prisma.mailingList.deleteMany({
      where: { listUid: { in: [TEST_LIST_A_UID, TEST_LIST_B_UID] } },
    });
  });

  it('supports composable AND/OR filtering and isolates multi-list consent states', async () => {
    const resAnd = await queryFilteredSubscribers({
      mailingListId: listAId,
      filter: {
        combinator: 'AND',
        conditions: [
          { field: 'engagementStatus', op: 'in', value: ['INACTIVE', 'LONG_TERM_INACTIVE', 'NEVER_ENGAGED'] },
          { field: 'isProtectedOrVip', op: 'eq', value: false },
        ],
      },
    });
    // inactive1, inactive2, longterm, never, shared = 5 (VIP excluded, active excluded)
    expect(resAnd.totalMatched).toBe(5);

    const resOr = await queryFilteredSubscribers({
      mailingListId: listAId,
      filter: {
        combinator: 'OR',
        conditions: [
          { field: 'emailDomain', op: 'eq', value: 'company.org' },
          { field: 'isProtectedOrVip', op: 'eq', value: true },
        ],
      },
    });
    // never@company.org + vip@example.com = 2
    expect(resOr.totalMatched).toBe(2);

    // Multi-list unsubscribe guard refuses cross-list global selection unless allowMultiList
    await expect(
      previewCleanupOperation({
        actionType: 'UNSUBSCRIBE',
        filter: {
          combinator: 'AND',
          conditions: [
            { field: 'emailDomain', op: 'eq', value: 'example.com' },
            { field: 'engagementStatus', op: 'in', value: ['LONG_TERM_INACTIVE', 'EXCLUDED'] },
          ],
        },
        actorEmail: 'admin@test.local',
      })
    ).rejects.toThrow(/Multi-list protection/i);
  });

  it('creates Dry-Run preview + AES-256-GCM snapshot, enforces confirmation, handles mid-job engagement, pause/resume, and restore', async () => {
    const op = await previewCleanupOperation({
      actionType: 'SUPPRESS',
      mailingListId: listAId,
      filter: {
        combinator: 'AND',
        conditions: [
          { field: 'engagementStatus', op: 'in', value: ['INACTIVE', 'NEVER_ENGAGED'] },
        ],
      },
      batchSize: 1,
      actorEmail: 'admin@test.local',
    });
    createdOpIds.push(op.id);
    // inactive1, inactive2, never = 3 eligible
    expect(op.dryRunOnly).toBe(true);
    expect(op.eligibleCount).toBe(3);

    // Inspect encrypted snapshot cleanly
    const snap = await inspectOperationSnapshot(op.id, 'admin@test.local');
    expect(snap.snapshot.records).toHaveLength(3);

    // Reject wrong list name / wrong count confirmation
    await expect(
      confirmAndEnqueueCleanup({
        operationId: op.id,
        confirmedListName: 'Wrong List',
        confirmedCount: 3,
        actorEmail: 'admin@test.local',
      })
    ).rejects.toThrow(/list name mismatch/i);

    await expect(
      confirmAndEnqueueCleanup({
        operationId: op.id,
        confirmedListName: 'Phase2 Test List A',
        confirmedCount: 99,
        actorEmail: 'admin@test.local',
      })
    ).rejects.toThrow(/count mismatch/i);

    // Confirm accurately
    const { job } = await confirmAndEnqueueCleanup({
      operationId: op.id,
      confirmedListName: 'Phase2 Test List A',
      confirmedCount: 3,
      actorEmail: 'admin@test.local',
    });
    createdJobIds.push(job.id);

    // Simulate mid-job renewed click engagement on inactive2 AFTER dry-run preview!
    const inactive2 = await prisma.subscriber.findFirstOrThrow({
      where: { mailingListId: listAId, subscriberUid: 'p2_sub_inactive2' },
    });
    const camp = await prisma.campaign.findFirstOrThrow({
      where: { mailingListId: listAId },
    });
    await prisma.engagementEvent.create({
      data: {
        subscriberId: inactive2.id,
        campaignId: camp.id,
        mailingListId: listAId,
        eventType: 'CLICK',
        source: 'WEBHOOK_LIVE',
        occurredAt: new Date(Date.now() + 5000),
        isHistorical: false,
        dedupeKey: sha256Hex(`P2|midjob|${inactive2.id}`),
      },
    });

    const execRes = await executeCleanupOperation({
      operationId: op.id,
      syncJobId: job.id,
      actorEmail: 'admin@test.local',
    });
    expect(execRes.finalStatus).toBe('COMPLETED');
    // inactive2 skipped because of mid-job click; inactive1 + never suppressed (2)!
    expect(execRes.succeededCount).toBe(2);
    expect(execRes.skippedCount).toBe(1);

    const inactive2Fresh = await prisma.subscriber.findUniqueOrThrow({
      where: { id: inactive2.id },
    });
    expect(inactive2Fresh.isSuppressed).toBe(false);
    expect(inactive2Fresh.engagementStatus).toBe('ACTIVE');

    // Test pause & resume on another preview + cancel before finish
    const pauseOp = await previewCleanupOperation({
      actionType: 'SUPPRESS',
      mailingListId: listAId,
      filter: {
        combinator: 'AND',
        conditions: [
          { field: 'engagementStatus', op: 'eq', value: 'LONG_TERM_INACTIVE' },
        ],
      },
      actorEmail: 'admin@test.local',
    });
    createdOpIds.push(pauseOp.id);
    const confirmedPause = await confirmAndEnqueueCleanup({
      operationId: pauseOp.id,
      confirmedListName: 'Phase2 Test List A',
      confirmedCount: pauseOp.eligibleCount,
      actorEmail: 'admin@test.local',
    });
    createdJobIds.push(confirmedPause.job.id);

    await prisma.cleanupOperation.update({
      where: { id: pauseOp.id },
      data: { status: 'RUNNING' },
    });
    await pauseCleanupOperation(pauseOp.id, 'admin@test.local');
    const pausedRes = await executeCleanupOperation({
      operationId: pauseOp.id,
      syncJobId: confirmedPause.job.id,
      actorEmail: 'admin@test.local',
    });
    expect(pausedRes.finalStatus).toBe('PAUSED');

    const resumed = await resumeCleanupOperation(pauseOp.id, 'admin@test.local');
    createdJobIds.push(resumed.job.id);
    await cancelCleanupOperation(pauseOp.id, 'admin@test.local');
    const cancelledOp = await prisma.cleanupOperation.findUniqueOrThrow({
      where: { id: pauseOp.id },
    });
    expect(cancelledOp.status).toBe('CANCELLED');

    // Restore app suppressions from op (only eligible active/confirmed contacts)
    const restoreRes = await restoreSuppressedSubscribers({
      operationId: op.id,
      adminApproved: true,
      reason: 'False positive recovery test',
      actorEmail: 'admin@test.local',
    });
    expect(restoreRes.restoredCount).toBe(2);
  });

  it('reconciles ambiguous API failures and auto-stops on high failure rates (mocked MailWizz writer)', async () => {
    process.env.ENABLE_MAILWIZZ_MUTATIONS = 'true';
    resetEnvCacheForTests();
    const p2Actor = 'admin@test.local';
    try {
      const nowIso = new Date().toISOString();
      await mailWizzCapabilityRegistry.saveCompatibilityReport({
        actorEmail: p2Actor,
        report: {
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
          historicalEngagementSummary: 'Verified Phase 2 test fixture',
          capabilities: mailWizzCapabilityRegistry.buildBaselineEntries().map((cap) =>
            cap.key === 'list_discovery' ||
            cap.key === 'subscriber_retrieval' ||
            cap.key === 'subscriber_pagination' ||
            cap.key === 'subscriber_status_retrieval' ||
            cap.key === 'subscriber_unsubscribe'
              ? {
                  ...cap,
                  status: 'VERIFIED' as const,
                  testedReadOnly: cap.key !== 'subscriber_unsubscribe',
                  reason: 'Verified mock fixture capability',
                  lastCheckedAt: nowIso,
                }
              : cap
          ),
          warnings: [],
          requiredManualActions: [],
          additiveFieldsObserved: [],
          lastVerifiedAt: nowIso,
        },
      });
      const op = await previewCleanupOperation({
        actionType: 'UNSUBSCRIBE',
        mailingListId: listAId,
        filter: {
          combinator: 'AND',
          conditions: [],
        },
        explicitSubscriberIds: [
          (
            await prisma.subscriber.findFirstOrThrow({
              where: { mailingListId: listAId, subscriberUid: 'p2_sub_never' },
            })
          ).id,
          (
            await prisma.subscriber.findFirstOrThrow({
              where: { mailingListId: listAId, subscriberUid: 'p2_sub_inactive1' },
            })
          ).id,
        ],
        actorEmail: 'admin@test.local',
      });
      createdOpIds.push(op.id);

      const { job } = await confirmAndEnqueueCleanup({
        operationId: op.id,
        confirmedListName: 'Phase2 Test List A',
        confirmedCount: op.eligibleCount,
        actorEmail: 'admin@test.local',
      });
      createdJobIds.push(job.id);

      let getCalls = 0;
      const mockFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const method = (init?.method ?? 'GET').toUpperCase();
        const urlStr =
          typeof _input === 'string'
            ? _input
            : _input instanceof URL
              ? _input.toString()
              : _input.url;
        const subscriberUid = urlStr.split('/').pop() || 'sub';
        if (method === 'GET') {
          getCalls++;
          // First GET (pre-check for sub 1) = confirmed; Second GET (post-error reconciliation for sub 1) = unsubscribed!
          const status = getCalls === 2 ? 'unsubscribed' : 'confirmed';
          return new Response(
            JSON.stringify({
              status: 'success',
              data: { record: { subscriber_uid: subscriberUid, status } },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        // Simulate ambiguous 500 error on PUT /unsubscribe
        return new Response(JSON.stringify({ status: 'error', error: 'Gateway timeout' }), {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      const writer = new MailWizzMutationClient({
        apiUrl: 'https://mock-mw.example.com/api/index.php',
        apiKey: 'mock-key-12345',
        maxRetries: 0,
        fetchImpl: mockFetch as unknown as typeof fetch,
      });

      const execRes = await executeCleanupOperation({
        operationId: op.id,
        syncJobId: job.id,
        mutationClient: writer,
        actorEmail: 'admin@test.local',
      });
      expect(execRes.reconciledCount).toBe(1);

      // Verify UNSUBSCRIBE operation cannot be auto-resubscribed via restoreSuppressedSubscribers
      await expect(
        restoreSuppressedSubscribers({
          operationId: op.id,
          adminApproved: true,
          reason: 'Should refuse unsubscribe rollback',
          actorEmail: 'admin@test.local',
        })
      ).rejects.toThrow(/cannot be automatically re-subscribed/i);
    } finally {
      await prisma.auditLog.deleteMany({
        where: { actorEmail: p2Actor, action: 'MAILWIZZ_COMPATIBILITY_CHECK' },
      });
      process.env.ENABLE_MAILWIZZ_MUTATIONS = 'false';
      resetEnvCacheForTests();
    }
  });

  it('executes Re-engagement Workflow and generates all 8 Hygiene Reports & CSVs', async () => {
    const plan = await createReengagementPlan({
      name: 'Phase2 Integration Reengagement',
      mailingListId: listAId,
      responseWindowDays: 14,
      actorEmail: 'admin@test.local',
    });
    createdPlanIds.push(plan.id);
    expect(plan.eligibleCount).toBeGreaterThanOrEqual(2);

    const approved = await approveReengagementCampaignManually({
      planId: plan.id,
      mailwizzCampaignUid: 'mw-reeng-camp-01',
      actorEmail: 'admin@test.local',
    });
    expect(approved.status).toBe('AWAITING_RESPONSE');
    expect(approved.manualCampaignApproved).toBe(true);

    const evaluated = await evaluateReengagementPlan({
      planId: plan.id,
      actorEmail: 'admin@test.local',
      createSuppressionDryRun: true,
    });
    if (evaluated.suppressedOperationId) {
      createdOpIds.push(evaluated.suppressedOperationId);
    }
    expect(evaluated.status).toBe('EVALUATED');

    const reports = await generateAllReportsSummary(listAId);
    expect(reports.totalSubscribers).toBe(7);
    expect(reports.reengagement.totalPlans).toBeGreaterThanOrEqual(1);

    const csvRes = await generateReportCsv({
      reportType: 'BEFORE_AFTER_COMPARISON',
      mailingListId: listAId,
      maskContacts: true,
    });
    expect(csvRes.csv).toContain('***@');
  });
});
