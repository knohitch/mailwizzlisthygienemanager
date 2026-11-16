import crypto from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { resetEnvCacheForTests } from '@/lib/env';
import { classifySubscriber, type HygieneRuleConfig } from '@/services/analysis/classifier';
import {
  buildDryRunCsvReport,
  confirmAndEnqueueCleanup,
  previewCleanupOperation,
} from '@/services/cleanup/planner';
import { executeCleanupOperation } from '@/services/cleanup/executor';
import { evaluateActionEligibility } from '@/services/cleanup/safety';
import { restoreSuppressedSubscribers, resumeCleanupOperation } from '@/services/cleanup/restore';
import { analyzeDomainDns } from '@/services/deliverability/dns-checker';
import { importAlibabaDirectMailCsv } from '@/services/deliverability/alibaba-directmail';
import { importVerifiedCampaignReport } from '@/services/mailwizz/report-import';
import { MailWizzClient, ReadOnlyGuardError } from '@/services/mailwizz/client';
import { MailWizzMutationClient } from '@/services/mutations/mailwizz-writer';
import { mailWizzCapabilityRegistry } from '@/services/mailwizz/capability-registry';
import { sanitizeCsvCell } from '@/services/security/csv';
import { encryptSecret } from '@/services/security/crypto';
import { sanitizeForLog } from '@/services/security/logger';
import { generateReportCsv } from '@/services/reports/generator';
import { POST as webhookPost } from '@/app/api/webhooks/mailwizz/route';

const BASE_RULES: HygieneRuleConfig = {
  lookbackDays: 90,
  coolingDays: 60,
  inactiveDays: 90,
  longTermInactiveDays: 180,
  minDeliveredCampaigns: 5,
  countOpensAsEngaged: true,
  countClicksAsEngaged: true,
  countRepliesAsEngaged: true,
  countConversionsAsEngaged: true,
  excludedDomains: [],
  excludedSources: [],
  excludeRecentSubscribersDays: 0,
};

const LIST_A_ID = 'p31_list_a';
const LIST_B_ID = 'p31_list_b';
const CAMP_A_ID = 'p31_camp_a';
const P31_INST_ID = 'p31_test_inst';
const P31_CONN_ID = 'p31_test_conn';

describe('Phase 3.1 Subscriber-Safety & Security Boundary Verification', () => {
  beforeAll(async () => {
    await prisma.cleanupOperationRecord.deleteMany({
      where: { mailingListUid: { in: ['p31_uid_a', 'p31_uid_b'] } },
    });
    await prisma.cleanupOperation.deleteMany({
      where: { mailingListId: { in: [LIST_A_ID, LIST_B_ID] } },
    });
    await prisma.engagementEvent.deleteMany({
      where: { mailingListId: { in: [LIST_A_ID, LIST_B_ID] } },
    });
    await prisma.subscriber.deleteMany({
      where: { mailingListId: { in: [LIST_A_ID, LIST_B_ID] } },
    });
    await prisma.campaign.deleteMany({ where: { id: CAMP_A_ID } });
    await prisma.mailingList.deleteMany({ where: { id: { in: [LIST_A_ID, LIST_B_ID] } } });
    await prisma.mailWizzCustomerConnection.deleteMany({ where: { id: P31_CONN_ID } });
    await prisma.mailWizzInstallation.deleteMany({ where: { id: P31_INST_ID } });

    await prisma.mailWizzInstallation.upsert({
      where: { id: P31_INST_ID },
      update: { name: 'Phase31 Test MailWizz', isActive: true },
      create: {
        id: P31_INST_ID,
        name: 'Phase31 Test MailWizz',
        baseUrl: 'https://p31-mock.example.invalid/api/index.php',
        hostname: 'p31-mock.example.invalid',
      },
    });
    await prisma.mailWizzCustomerConnection.upsert({
      where: { id: P31_CONN_ID },
      update: { isEnabled: true, isQuarantine: false, isDemoData: false, status: 'CONNECTED' },
      create: {
        id: P31_CONN_ID,
        installationId: P31_INST_ID,
        customerName: 'Phase 3.1 Test Customer',
        customerSlug: 'p31-test-customer',
        isEnabled: true,
        isQuarantine: false,
        isDemoData: false,
        status: 'CONNECTED',
      },
    });

    await prisma.mailingList.createMany({
      data: [
        {
          id: LIST_A_ID,
          customerConnectionId: P31_CONN_ID,
          listUid: 'p31_uid_a',
          name: 'Phase31 Scope List A',
          optIn: 'single',
          fromEmail: 'news@example.com',
          isDemoData: false,
        },
        {
          id: LIST_B_ID,
          customerConnectionId: P31_CONN_ID,
          listUid: 'p31_uid_b',
          name: 'Phase31 Scope List B',
          optIn: 'single',
          fromEmail: 'news@example.com',
          isDemoData: false,
        },
      ],
    });

    await prisma.campaign.create({
      data: {
        id: CAMP_A_ID,
        customerConnectionId: P31_CONN_ID,
        campaignUid: 'p31_camp_uid_a',
        mailingListId: LIST_A_ID,
        name: 'Phase 3.1 Safety Test Campaign',
        status: 'sent',
        isDemoData: false,
      },
    });
  });

  afterAll(async () => {
    const ops = await prisma.cleanupOperation.findMany({
      where: { mailingListId: { in: [LIST_A_ID, LIST_B_ID] } },
      select: { syncJobId: true },
    });
    const syncJobIds = ops.map((o) => o.syncJobId).filter((x): x is string => Boolean(x));

    await prisma.cleanupOperationRecord.deleteMany({
      where: { mailingListUid: { in: ['p31_uid_a', 'p31_uid_b'] } },
    });
    await prisma.cleanupOperation.deleteMany({
      where: { mailingListId: { in: [LIST_A_ID, LIST_B_ID] } },
    });
    if (syncJobIds.length > 0) {
      await prisma.syncJob.deleteMany({
        where: { id: { in: syncJobIds } },
      });
    }
    await prisma.domainAuthCheck.deleteMany({
      where: { domain: { in: ['127.0.0.1', 'metadata.internal', 'local.test.example.com'] } },
    });
    await prisma.directMailDailyMetric.deleteMany({
      where: {
        source: 'ALIBABA_CSV_IMPORT',
        metricDate: new Date('2026-11-14T00:00:00Z'),
        domainName: 'all',
      },
    });
    await prisma.engagementEvent.deleteMany({
      where: { mailingListId: { in: [LIST_A_ID, LIST_B_ID] } },
    });
    await prisma.subscriber.deleteMany({
      where: { mailingListId: { in: [LIST_A_ID, LIST_B_ID] } },
    });
    await prisma.campaign.deleteMany({ where: { id: CAMP_A_ID } });
    await prisma.mailingList.deleteMany({ where: { id: { in: [LIST_A_ID, LIST_B_ID] } } });
    await prisma.mailWizzCustomerConnection.deleteMany({ where: { id: P31_CONN_ID } });
    await prisma.mailWizzInstallation.deleteMany({ where: { id: P31_INST_ID } });
    await prisma.appConfig.updateMany({
      where: { id: 'default' },
      data: { webhookSecretEnc: null },
    });
    resetEnvCacheForTests();
  });

  it('never classifies missing opens/incomplete delivery history as inactive or eligible for unsubscribe', () => {
    const noHistory = classifySubscriber(
      {
        email: 'no-opens@example.com',
        status: 'CONFIRMED',
        source: null,
        dateAddedMailwizz: new Date('2025-01-01T00:00:00Z'),
        events: [],
        now: new Date('2026-11-14T00:00:00Z'),
      },
      BASE_RULES
    );
    expect(noHistory.engagementStatus).toBe('INSUFFICIENT_DATA');
    expect(noHistory.historyCoverage).toBe('NONE');

    // Open-only partial events without DELIVERED history must remain INSUFFICIENT_DATA if outside active window
    const partialOpenOnly = classifySubscriber(
      {
        email: 'partial@example.com',
        status: 'CONFIRMED',
        source: null,
        dateAddedMailwizz: new Date('2025-01-01T00:00:00Z'),
        events: [
          {
            eventType: 'OPEN',
            source: 'WEBHOOK_LIVE',
            occurredAt: new Date('2026-01-01T00:00:00Z'),
            isHistorical: false,
            campaignId: CAMP_A_ID,
          },
        ],
        now: new Date('2026-11-14T00:00:00Z'),
      },
      BASE_RULES
    );
    expect(partialOpenOnly.engagementStatus).toBe('INSUFFICIENT_DATA');

    const elig = evaluateActionEligibility(
      {
        id: 'x',
        subscriberUid: 'sub_x',
        mailingListId: LIST_A_ID,
        mailingListUid: 'p31_uid_a',
        email: 'no-opens@example.com',
        firstName: null,
        lastName: null,
        status: 'CONFIRMED',
        engagementStatus: noHistory.engagementStatus,
        historyCoverage: noHistory.historyCoverage,
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
      { minDeliveredCampaigns: 5 }
    );
    expect(elig.eligible).toBe(false);
    expect(elig.reason).toMatch(/Safety lock/i);
  });

  it('prevents cross-list subscriber substitution, rechecks engagement & complaints pre-mutation, and blocks duplicate/dry-run writes', async () => {
    const now = new Date();
    const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);

    await prisma.subscriber.createMany({
      data: [
        {
          id: 'p31_sub_a1',
          customerConnectionId: P31_CONN_ID,
          subscriberUid: 'p31_suid_a1',
          mailingListId: LIST_A_ID,
          email: '=CMD|calc@example.com',
          emailHash: 'h_a1',
          firstName: '+Alice',
          lastName: '-Formula',
          status: 'CONFIRMED',
          rawStatus: 'confirmed',
          engagementStatus: 'INACTIVE',
          hygieneStatus: 'INACTIVE_CANDIDATE',
          historyCoverage: 'VERIFIED_FULL',
          deliveredCampaignsCount: 8,
          isDemoData: false,
        },
        {
          id: 'p31_sub_b1',
          customerConnectionId: P31_CONN_ID,
          subscriberUid: 'p31_suid_b1',
          mailingListId: LIST_B_ID,
          email: 'otherlist@example.com',
          emailHash: 'h_b1',
          status: 'CONFIRMED',
          rawStatus: 'confirmed',
          engagementStatus: 'INACTIVE',
          hygieneStatus: 'INACTIVE_CANDIDATE',
          historyCoverage: 'VERIFIED_FULL',
          deliveredCampaignsCount: 8,
          isDemoData: false,
        },
        {
          id: 'p31_sub_unsub',
          customerConnectionId: P31_CONN_ID,
          subscriberUid: 'p31_suid_unsub',
          mailingListId: LIST_A_ID,
          email: 'already.unsub@example.com',
          emailHash: 'h_unsub',
          status: 'UNSUBSCRIBED',
          rawStatus: 'unsubscribed',
          engagementStatus: 'EXCLUDED',
          hygieneStatus: 'UNSUBSCRIBED',
          historyCoverage: 'VERIFIED_FULL',
          deliveredCampaignsCount: 8,
          isDemoData: false,
        },
      ],
    });

    // Seed verified deliveries so pre-mutation classifier sees sufficient history for p31_sub_a1
    for (let i = 0; i < 6; i++) {
      await prisma.engagementEvent.create({
        data: {
          customerConnectionId: P31_CONN_ID,
          subscriberId: 'p31_sub_a1',
          campaignId: CAMP_A_ID,
          mailingListId: LIST_A_ID,
          eventType: 'DELIVERED',
          source: 'VERIFIED_EXPORT',
          occurredAt: daysAgo(150 + i * 5),
          isHistorical: true,
          isDemoData: false,
          dedupeKey: `p31_deliv_${i}`,
        },
      });
    }

    // 1. Cross-list explicit subscriber ID substitution MUST be rejected
    await expect(
      previewCleanupOperation({
        actionType: 'UNSUBSCRIBE',
        mailingListId: LIST_A_ID,
        explicitSubscriberIds: ['p31_sub_a1', 'p31_sub_b1'],
        filter: { combinator: 'AND', conditions: [] },
        actorEmail: 'admin@example.com',
      })
    ).rejects.toThrow(/list scoping violation/i);

    // 2. Dry-Run cannot execute directly and never calls MailWizz
    const dryOp = await previewCleanupOperation({
      actionType: 'UNSUBSCRIBE',
      mailingListId: LIST_A_ID,
      explicitSubscriberIds: ['p31_sub_a1', 'p31_sub_unsub'],
      filter: { combinator: 'AND', conditions: [] },
      actorEmail: 'admin@example.com',
    });
    expect(dryOp.eligibleCount).toBe(1);
    expect(dryOp.excludedCount).toBe(1); // already unsubscribed excluded

    await expect(executeCleanupOperation({ operationId: dryOp.id })).rejects.toThrow(
      /DRY RUN/i
    );

    // CSV formula neutralization in Dry-Run CSV & Hygiene Report CSV (masking keeps '=C***...)
    const dryCsv = await buildDryRunCsvReport(dryOp.id);
    expect(dryCsv).toContain("'=C***");
    const reportCsv = await generateReportCsv({
      reportType: 'INACTIVE_AUDIENCE',
      mailingListId: LIST_A_ID,
      maskContacts: false,
    });
    expect(reportCsv.csv).toContain("'=CMD");

    // 3. Inject a complaint AFTER dry-run preview -> live pre-mutation recheck MUST skip it and NEVER call unsubscribe
    await prisma.engagementEvent.create({
      data: {
        customerConnectionId: P31_CONN_ID,
        subscriberId: 'p31_sub_a1',
        campaignId: CAMP_A_ID,
        mailingListId: LIST_A_ID,
        eventType: 'COMPLAINT',
        source: 'WEBHOOK_LIVE',
        occurredAt: new Date(Date.now() + 2000),
        isHistorical: false,
        isDemoData: false,
        dedupeKey: 'p31_complaint_midjob',
      },
    });

    process.env.ENABLE_MAILWIZZ_MUTATIONS = 'true';
    resetEnvCacheForTests();
    const mockFetch = vi.fn(async () => new Response('{}', { status: 200 }));
    const mockWriter = new MailWizzMutationClient({
      apiUrl: 'https://mw.example.com/api/index.php',
      apiKey: 'test-key',
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    try {
      const nowIso = new Date().toISOString();
      await mailWizzCapabilityRegistry.saveCompatibilityReport({
        customerConnectionId: P31_CONN_ID,
        actorEmail: 'p31-compat-fixture@local.hygiene',
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
          historicalEngagementSummary: 'Verified Phase 3.1 test fixture',
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

      await confirmAndEnqueueCleanup({
        operationId: dryOp.id,
        confirmedListName: 'Phase31 Scope List A',
        confirmedCount: 1,
        actorEmail: 'admin@example.com',
      });

      // Second concurrent confirm MUST fail
      await expect(
        confirmAndEnqueueCleanup({
          operationId: dryOp.id,
          confirmedListName: 'Phase31 Scope List A',
          confirmedCount: 1,
          actorEmail: 'admin@example.com',
        })
      ).rejects.toThrow(/cannot be confirmed from status CONFIRMED/i);

      const execRes = await executeCleanupOperation({
        operationId: dryOp.id,
        mutationClient: mockWriter,
      });
      expect(execRes.finalStatus).toBe('COMPLETED');
      expect(execRes.succeededCount).toBe(0);
      expect(execRes.skippedCount).toBe(1);
      expect(mockFetch).not.toHaveBeenCalled();

      // Re-running an already COMPLETED operation is a safe no-op
      const replayExec = await executeCleanupOperation({
        operationId: dryOp.id,
        mutationClient: mockWriter,
      });
      expect(replayExec.finalStatus).toBe('COMPLETED');
      expect(mockFetch).not.toHaveBeenCalled();

      // Cannot resume a COMPLETED operation or restore UNSUBSCRIBE operations
      await expect(resumeCleanupOperation(dryOp.id, 'admin@example.com')).rejects.toThrow();
      await expect(
        restoreSuppressedSubscribers({
          operationId: dryOp.id,
          adminApproved: true,
          reason: 'Should fail consent compliance',
          actorEmail: 'admin@example.com',
        })
      ).rejects.toThrow(/consent compliance/i);
    } finally {
      await prisma.auditLog.deleteMany({
        where: {
          actorEmail: 'p31-compat-fixture@local.hygiene',
          action: 'MAILWIZZ_COMPATIBILITY_CHECK',
        },
      });
      process.env.ENABLE_MAILWIZZ_MUTATIONS = 'false';
      resetEnvCacheForTests();
    }
  });

  it('enforces CSV sanitization, prototype-pollution header blocks, SSRF DNS checks, webhook replay protection, log redaction, and /tracking blocking', async () => {
    // 1. Shared CSV formula sanitizer
    expect(sanitizeCsvCell('=CMD("calc")')).toBe('"\'=CMD(""calc"")"');
    expect(sanitizeCsvCell('  +1+1')).toBe("'  +1+1");
    expect(sanitizeCsvCell('-2+3')).toBe("'-2+3");
    expect(sanitizeCsvCell('@SUM(A1:A2)')).toBe("'@SUM(A1:A2)");
    expect(sanitizeCsvCell(-42)).toBe('-42');

    // 2. CSV size / prototype-header safety
    await expect(
      importAlibabaDirectMailCsv({
        csvContent: '__proto__,date\npolluted,2026-11-14',
        actorEmail: 'admin@example.com',
      })
    ).resolves.toEqual({ rowsImported: 1 });
    expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined();

    await expect(
      importAlibabaDirectMailCsv({
        csvContent: 'date,send_count\n' + '2026-11-14,10\n'.repeat(400_000),
        actorEmail: 'admin@example.com',
      })
    ).rejects.toThrow(/exceeds maximum size/i);

    await expect(
      importVerifiedCampaignReport({
        format: 'json',
        content: 'x'.repeat(10 * 1024 * 1024 + 5),
      })
    ).rejects.toThrow(/exceeds maximum allowed size/i);

    // 3. DNS checker SSRF / internal target rejections
    await expect(
      analyzeDomainDns({ domain: '127.0.0.1', actorEmail: 'admin@example.com' })
    ).rejects.toThrow(/public FQDNs/i);
    await expect(
      analyzeDomainDns({ domain: 'metadata.internal', actorEmail: 'admin@example.com' })
    ).rejects.toThrow(/public FQDNs/i);
    await expect(
      analyzeDomainDns({
        domain: 'http://evil.com:8080/path',
        actorEmail: 'admin@example.com',
      })
    ).rejects.toThrow(/Invalid hostname/i);

    const privateTrackingRes = await analyzeDomainDns({
      domain: 'sender.example.com',
      trackingDomain: 'track.example.com',
      actorEmail: 'admin@example.com',
      resolver: {
        resolveTxt: async () => [['v=spf1 ~all']],
        resolveMx: async () => [{ exchange: 'mx.example.com', priority: 10 }],
        resolveCname: async () => [],
        resolve4: async () => ['169.254.169.254'],
      },
    });
    expect(privateTrackingRes.trackingStatus).toBe('FAIL');
    expect(privateTrackingRes.trackingDetail).toMatch(/private\/loopback\/reserved/i);

    // 4. MailWizz read-only & writer block modern /tracking/* endpoints & global unsubscribe
    const roClient = new MailWizzClient({
      apiUrl: 'https://mw.example.com/api/index.php',
      apiKey: 'test-key-123456',
      fetchImpl: (async () => new Response('{}')) as unknown as typeof fetch,
    });
    await expect(
      roClient.getJson('/campaigns/c1/tracking/open/s1', {} as never)
    ).rejects.toBeInstanceOf(ReadOnlyGuardError);

    process.env.ENABLE_MAILWIZZ_MUTATIONS = 'true';
    resetEnvCacheForTests();
    try {
      const wrClient = new MailWizzMutationClient({
        apiUrl: 'https://mw.example.com/api/index.php',
        apiKey: 'test-key-123456',
        fetchImpl: (async () => new Response('{}')) as unknown as typeof fetch,
      });
      await expect(
        wrClient.getRemoteSubscriber('l1', 's1')
      ).resolves.toBeDefined();
      await expect(
        (wrClient as unknown as { requestJson: (m: string, p: string, s: unknown) => Promise<unknown> }).requestJson(
          'POST',
          '/lists/subscribers/unsubscribe-by-email',
          {}
        )
      ).rejects.toThrow(/permanently blocked/i);
    } finally {
      await prisma.auditLog.deleteMany({
        where: {
          actorEmail: 'p31-compat-fixture@local.hygiene',
          action: 'MAILWIZZ_COMPATIBILITY_CHECK',
        },
      });
      process.env.ENABLE_MAILWIZZ_MUTATIONS = 'false';
      resetEnvCacheForTests();
    }

    // 5. Webhook authenticity (HMAC + replay protection)
    const hookSecret = 'p31-webhook-secret-test-value-9999';
    await prisma.mailWizzCustomerConnection.update({
      where: { id: P31_CONN_ID },
      data: { webhookSecretEnc: encryptSecret(hookSecret) },
    });

    const badReq = new NextRequest(
      `http://127.0.0.1:3000/api/webhooks/mailwizz?connectionId=${P31_CONN_ID}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-hygiene-webhook-secret': 'wrong-secret',
        },
        body: JSON.stringify({
          event_type: 'open',
          campaign_uid: 'p31_camp_uid_a',
          subscriber_uid: 'p31_suid_a1',
        }),
      }
    );
    const res401 = await webhookPost(badReq);
    expect(res401.status).toBe(401);

    // Valid HMAC-signed replay without timestamp must dedupe instead of creating duplicate events
    const replayBody = JSON.stringify({
      event_type: 'open',
      campaign_uid: 'p31_camp_uid_a',
      subscriber_uid: 'p31_suid_a1',
      event_id: 'evt-p31-replay-1',
    });
    const sig = crypto.createHmac('sha256', hookSecret).update(replayBody).digest('hex');

    for (let i = 0; i < 2; i++) {
      const okReq = new NextRequest(
        `http://127.0.0.1:3000/api/webhooks/mailwizz?connectionId=${P31_CONN_ID}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-hygiene-webhook-signature': `sha256=${sig}`,
          },
          body: replayBody,
        }
      );
      const r = await webhookPost(okReq);
      expect(r.status).toBe(200);
    }
    const webhookOpenCount = await prisma.engagementEvent.count({
      where: { subscriberId: 'p31_sub_a1', eventType: 'OPEN', source: 'WEBHOOK_LIVE' },
    });
    expect(webhookOpenCount).toBe(1);

    // 6. Log sanitization catches extended secret keys
    const redacted = sanitizeForLog({
      accessKeySecret: 'top-secret',
      private_key: 'pem-secret',
      x_mw_signature: 'sig-123',
      subscriberEmail: 'bob@domain.com',
    }) as Record<string, unknown>;
    expect(redacted.accessKeySecret).toBe('[REDACTED_SECRET]');
    expect(redacted.private_key).toBe('[REDACTED_SECRET]');
    expect(redacted.x_mw_signature).toBe('[REDACTED_SECRET]');
  });
});
