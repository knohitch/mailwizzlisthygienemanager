import http from 'node:http';
import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { resetEnvCacheForTests } from '@/lib/env';
import { POST as webhookPost } from '@/app/api/webhooks/mailwizz/route';
import {
  createCustomerConnection,
  deleteCustomerConnection,
  getCustomerConnectionById,
  listCustomerConnections,
  revokeCustomerConnectionCredential,
  rotateCustomerConnectionApiKey,
  setConnectionSyncPaused,
  updateCustomerConnection,
} from '@/services/mailwizz/connections';
import {
  clearConnectionRateLimitersForTests,
  getMailWizzClientWithContext,
  resolveUnambiguousConnectionId,
} from '@/services/mailwizz/client-factory';
import { runMailWizzSync } from '@/services/mailwizz/sync';
import { importVerifiedCampaignReport } from '@/services/mailwizz/report-import';
import { mailWizzCapabilityRegistry } from '@/services/mailwizz/capability-registry';
import { mailWizzCompatibilityValidator } from '@/services/mailwizz/compatibility-validator';
import { MailWizzClient } from '@/services/mailwizz/client';
import {
  assertCompatibilityPermitsRemoteMutations,
  UnsafeOperationBlockedError,
} from '@/services/mutations/gate';
import { previewCleanupOperation } from '@/services/cleanup/planner';
import { restoreSuppressedSubscribers } from '@/services/cleanup/restore';
import { generateAllReportsSummary, generateReportCsv } from '@/services/reports/generator';
import { generateSubscriberExport } from '@/services/security/export';
import { claimNextJob, completeJob, enqueueJob } from '@/services/jobs/queue';
import { executeSyncJob } from '@/services/jobs/handlers';
import { seedSyntheticDemoData } from '@/services/demo/seed-demo';
import { encryptSecret } from '@/services/security/crypto';

const ACTOR = 'phase4-isolation@local.hygiene';

describe('Integration: Phase 4 Multi-Customer Connections, Isolation, Lifecycle & Fair Scheduling', () => {
  let server: http.Server;
  let sharedBaseUrl = '';
  const observedApiCalls: Array<{ path: string; apiKey: string | undefined }> = [];
  const createdConnectionIds: string[] = [];
  const createdJobIds: string[] = [];
  const quarantineInstId = 'p4-legacy-quarantine-inst';
  const quarantineConnId = 'p4-legacy-quarantine-conn';
  const prevAllowHttp = process.env.ALLOW_INSECURE_MAILWIZZ_HTTP;
  const prevMutations = process.env.ENABLE_MAILWIZZ_MUTATIONS;

  beforeAll(async () => {
    process.env.ALLOW_INSECURE_MAILWIZZ_HTTP = 'true';
    resetEnvCacheForTests();
    clearConnectionRateLimitersForTests();

    // Shared mock MailWizz endpoint that serves key-isolated customer tenants using IDENTICAL list_uid & campaign_uid
    server = http.createServer((req, res) => {
      const apiKey = req.headers['x-api-key'] as string | undefined;
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      observedApiCalls.push({ path: url.pathname, apiKey });
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('X-MW-Version', '3.0.5');

      const tenantLabel =
        apiKey === 'mw-alpha-secret-key-1111'
          ? 'Alpha'
          : apiKey === 'mw-beta-secret-key-2222'
            ? 'Beta'
            : null;

      if (!tenantLabel) {
        res.statusCode = 401;
        res.end(JSON.stringify({ status: 'error', error: 'Unauthorized API key' }));
        return;
      }

      if (url.pathname === '/api/index.php/lists') {
        res.end(
          JSON.stringify({
            status: 'success',
            data: {
              count: '1',
              total_pages: 1,
              current_page: 1,
              next_page: null,
              records: [
                {
                  general: {
                    list_uid: 'shared_list_uid',
                    name: `${tenantLabel} Shared UID List`,
                    display_name: `${tenantLabel} List`,
                  },
                },
              ],
            },
          })
        );
        return;
      }

      if (url.pathname === '/api/index.php/lists/shared_list_uid/subscribers') {
        res.end(
          JSON.stringify({
            status: 'success',
            data: {
              count: '1',
              total_pages: 1,
              current_page: 1,
              next_page: null,
              records: [
                {
                  subscriber_uid: 'shared_sub_uid',
                  EMAIL: 'shared.person@example.com',
                  FNAME: tenantLabel,
                  LNAME: 'Subscriber',
                  status: 'confirmed',
                  date_added: '2026-01-01 00:00:00',
                },
              ],
            },
          })
        );
        return;
      }

      if (url.pathname === '/api/index.php/lists/shared_list_uid/segments') {
        res.end(
          JSON.stringify({
            status: 'success',
            data: { count: '0', total_pages: 1, current_page: 1, next_page: null, records: [] },
          })
        );
        return;
      }

      if (url.pathname === '/api/index.php/campaigns') {
        res.end(
          JSON.stringify({
            status: 'success',
            data: {
              count: '1',
              total_pages: 1,
              current_page: 1,
              next_page: null,
              records: [
                {
                  campaign_uid: 'shared_camp_uid',
                  name: `${tenantLabel} Shared Campaign`,
                  status: 'sent',
                },
              ],
            },
          })
        );
        return;
      }

      if (url.pathname === '/api/index.php/campaigns/shared_camp_uid') {
        res.end(
          JSON.stringify({
            status: 'success',
            data: {
              record: {
                campaign_uid: 'shared_camp_uid',
                name: `${tenantLabel} Shared Campaign`,
                status: 'sent',
                send_at: '2026-11-01 09:00:00',
                list: { list_uid: 'shared_list_uid', subscribers_count: 1 },
              },
            },
          })
        );
        return;
      }

      if (url.pathname === '/api/index.php/campaigns/shared_camp_uid/stats') {
        res.end(
          JSON.stringify({
            status: 'success',
            data: {
              campaign_status: 'sent',
              subscribers_count: 1,
              processed_count: 1,
              delivery_success_count: 1,
              delivery_error_count: 0,
              opens_count: 0,
              unique_opens_count: 0,
              clicks_count: 0,
              unique_clicks_count: 0,
            },
          })
        );
        return;
      }

      if (url.pathname === '/api/index.php/campaigns/shared_camp_uid/bounces') {
        res.end(
          JSON.stringify({
            status: 'success',
            data: { count: '0', total_pages: 1, current_page: 1, next_page: null, records: [] },
          })
        );
        return;
      }

      res.statusCode = 404;
      res.end(JSON.stringify({ status: 'error' }));
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          sharedBaseUrl = `http://127.0.0.1:${addr.port}/api/index.php`;
        }
        resolve();
      });
    });

    // Clear any prior leftover Phase 4 test connections by slug prefix
    const stale = await prisma.mailWizzCustomerConnection.findMany({
      where: {
        OR: [
          { customerSlug: { startsWith: 'p4-iso-' } },
          { id: quarantineConnId },
        ],
      },
      select: { id: true },
    });
    if (stale.length > 0) {
      await prisma.syncJob.deleteMany({
        where: { customerConnectionId: { in: stale.map((s) => s.id) } },
      });
      await prisma.mailWizzCustomerConnection.deleteMany({
        where: { id: { in: stale.map((s) => s.id) } },
      });
    }
    await prisma.mailWizzInstallation.deleteMany({
      where: {
        OR: [
          { id: quarantineInstId },
          { hostname: { startsWith: 'p4-page-' } },
        ],
      },
    });
  });

  afterAll(async () => {
    process.env.ALLOW_INSECURE_MAILWIZZ_HTTP = prevAllowHttp;
    process.env.ENABLE_MAILWIZZ_MUTATIONS = prevMutations;
    resetEnvCacheForTests();
    clearConnectionRateLimitersForTests();

    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));

    if (createdJobIds.length > 0) {
      await prisma.syncJob.deleteMany({ where: { id: { in: createdJobIds } } });
    }
    const allIds = [...createdConnectionIds, quarantineConnId];
    await prisma.syncJob.deleteMany({
      where: { customerConnectionId: { in: allIds } },
    });
    await prisma.auditLog.deleteMany({
      where: {
        OR: [{ actorEmail: ACTOR }, { customerConnectionId: { in: allIds } }],
      },
    });
    await prisma.mailWizzCustomerConnection.deleteMany({
      where: {
        OR: [
          { id: { in: allIds } },
          { customerSlug: { startsWith: 'p4-iso-' } },
        ],
      },
    });
    await prisma.mailWizzInstallation.deleteMany({
      where: {
        OR: [
          { baseUrl: sharedBaseUrl },
          { id: quarantineInstId },
          { hostname: { startsWith: 'p4-page-' } },
        ],
      },
    });
  });

  it('isolates two customers on the same MailWizz URL with identical list_uid, campaign_uid, and subscriber email across sync, webhooks, imports, exports, cleanup, compatibility, rotation, and deletion', async () => {
    // 1. Create Alpha & Beta sharing sharedBaseUrl
    const connA = await createCustomerConnection({
      customerName: 'P4 Alpha Brand',
      customerSlug: 'p4-iso-alpha',
      baseUrl: sharedBaseUrl,
      installationName: 'Shared Nohitch Host',
      apiKey: 'mw-alpha-secret-key-1111',
      authMode: 'x-api-key',
      webhookSecret: 'hook-alpha-secret-value',
      maxRequestsPerSecond: 20,
      actorEmail: ACTOR,
    });
    createdConnectionIds.push(connA.id);

    const connB = await createCustomerConnection({
      customerName: 'P4 Beta Brand',
      customerSlug: 'p4-iso-beta',
      baseUrl: sharedBaseUrl,
      apiKey: 'mw-beta-secret-key-2222',
      authMode: 'x-api-key',
      webhookSecret: 'hook-beta-secret-value',
      maxRequestsPerSecond: 20,
      actorEmail: ACTOR,
    });
    createdConnectionIds.push(connB.id);

    // Same installation record reused; never return plaintext secrets
    expect(connA.installationId).toBe(connB.installationId);
    expect(connA.apiKeyMasked).toBe('****1111');
    expect(connB.apiKeyMasked).toBe('****2222');
    expect(JSON.stringify(connA)).not.toContain('mw-alpha-secret-key-1111');
    expect(JSON.stringify(connB)).not.toContain('mw-beta-secret-key-2222');

    // Multiple active connections -> ambiguous implicit helper MUST fail closed
    await expect(resolveUnambiguousConnectionId()).rejects.toThrow(
      /Multiple customer connections exist/i
    );

    // 2. Sync Alpha and Beta independently using per-customer API keys
    observedApiCalls.length = 0;
    const syncA = await runMailWizzSync({ customerConnectionId: connA.id });
    expect(syncA.listsSynced).toBe(1);
    expect(syncA.subscribersSynced).toBe(1);
    expect(observedApiCalls.length).toBeGreaterThan(0);
    expect(observedApiCalls.every((c) => c.apiKey === 'mw-alpha-secret-key-1111')).toBe(true);

    observedApiCalls.length = 0;
    const syncB = await runMailWizzSync({ customerConnectionId: connB.id });
    expect(syncB.listsSynced).toBe(1);
    expect(syncB.subscribersSynced).toBe(1);
    expect(observedApiCalls.every((c) => c.apiKey === 'mw-beta-secret-key-2222')).toBe(true);

    const listA = await prisma.mailingList.findUniqueOrThrow({
      where: {
        customerConnectionId_listUid: {
          customerConnectionId: connA.id,
          listUid: 'shared_list_uid',
        },
      },
    });
    const listB = await prisma.mailingList.findUniqueOrThrow({
      where: {
        customerConnectionId_listUid: {
          customerConnectionId: connB.id,
          listUid: 'shared_list_uid',
        },
      },
    });
    expect(listA.id).not.toBe(listB.id);
    expect(listA.name).toContain('Alpha');
    expect(listB.name).toContain('Beta');

    const subA = await prisma.subscriber.findFirstOrThrow({
      where: { customerConnectionId: connA.id, mailingListId: listA.id },
    });
    const subB = await prisma.subscriber.findFirstOrThrow({
      where: { customerConnectionId: connB.id, mailingListId: listB.id },
    });
    expect(subA.firstName).toBe('Alpha');
    expect(subB.firstName).toBe('Beta');

    // 3. Priority B CSV import strictly scoped to target customer/list
    await expect(
      importVerifiedCampaignReport({
        customerConnectionId: connA.id,
        mailingListId: listB.id,
        format: 'csv',
        content: 'email,campaign_uid,event_type,occurred_at\nshared.person@example.com,shared_camp_uid,CLICK,2026-11-10T10:00:00Z',
      })
    ).rejects.toThrow(/Cross-customer/i);

    const impA = await importVerifiedCampaignReport({
      customerConnectionId: connA.id,
      mailingListId: listA.id,
      format: 'csv',
      content: [
        'email,campaign_uid,event_type,occurred_at',
        'shared.person@example.com,shared_camp_uid,DELIVERED,2026-11-01T10:00:00Z',
        'shared.person@example.com,shared_camp_uid,CLICK,2026-11-10T10:00:00Z',
      ].join('\n'),
    });
    expect(impA.importedCount).toBe(2);

    expect(
      await prisma.engagementEvent.count({ where: { customerConnectionId: connA.id } })
    ).toBe(2);
    expect(
      await prisma.engagementEvent.count({ where: { customerConnectionId: connB.id } })
    ).toBe(0);

    // 4. Webhook secret isolation + unambiguous target lookup
    const webhookBody = JSON.stringify({
      event_type: 'open',
      campaign_uid: 'shared_camp_uid',
      subscriber_uid: 'shared_sub_uid',
      event_id: 'p4-hook-evt-1',
    });
    const alphaSig = crypto
      .createHmac('sha256', 'hook-alpha-secret-value')
      .update(webhookBody)
      .digest('hex');

    // Missing connectionId fails closed (400)
    const ambigWebhookRes = await webhookPost(
      new NextRequest('http://127.0.0.1:3000/api/webhooks/mailwizz', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-hygiene-webhook-signature': `sha256=${alphaSig}`,
        },
        body: webhookBody,
      })
    );
    expect(ambigWebhookRes.status).toBe(400);

    // Alpha's HMAC signature rejected on Beta (401)
    const wrongTenantWebhookRes = await webhookPost(
      new NextRequest(`http://127.0.0.1:3000/api/webhooks/mailwizz?connectionId=${connB.id}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-hygiene-webhook-signature': `sha256=${alphaSig}`,
        },
        body: webhookBody,
      })
    );
    expect(wrongTenantWebhookRes.status).toBe(401);

    // Beta's HMAC signature accepted ONLY for Beta
    const betaSig = crypto
      .createHmac('sha256', 'hook-beta-secret-value')
      .update(webhookBody)
      .digest('hex');
    const betaWebhookRes = await webhookPost(
      new NextRequest(`http://127.0.0.1:3000/api/webhooks/mailwizz?connectionId=${connB.id}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-hygiene-webhook-signature': `sha256=${betaSig}`,
        },
        body: webhookBody,
      })
    );
    expect(betaWebhookRes.status).toBe(200);
    expect(
      await prisma.engagementEvent.count({
        where: { customerConnectionId: connB.id, source: 'WEBHOOK_LIVE' },
      })
    ).toBe(1);
    expect(
      await prisma.engagementEvent.count({
        where: { customerConnectionId: connA.id, source: 'WEBHOOK_LIVE' },
      })
    ).toBe(0);

    // 5. Reports & Subscriber Exports refuse cross-customer mixes and isolate cleanly
    await expect(generateAllReportsSummary(listB.id, connA.id)).rejects.toThrow(/Cross-customer/i);
    await expect(
      generateReportCsv({
        reportType: 'ACTIVE_AUDIENCE',
        customerConnectionId: connA.id,
        mailingListId: listB.id,
      })
    ).rejects.toThrow(/Cross-customer/i);
    await expect(
      generateSubscriberExport({
        customerConnectionId: connA.id,
        mailingListId: listB.id,
        format: 'csv',
        encrypted: false,
        actorEmail: ACTOR,
      })
    ).rejects.toThrow(/Cross-customer/i);
    await expect(
      generateSubscriberExport({
        format: 'csv',
        encrypted: false,
        actorEmail: ACTOR,
      })
    ).rejects.toThrow(/Customer connection selection is required/i);

    const exportA = await generateSubscriberExport({
      customerConnectionId: connA.id,
      format: 'csv',
      encrypted: false,
      actorEmail: ACTOR,
    });
    expect(exportA.rowCount).toBe(1);
    expect(exportA.body.toString('utf8')).toContain('Alpha');
    expect(exportA.body.toString('utf8')).not.toContain('Beta');

    // 6. Cleanup & Restore reject cross-customer subscribers and cross-customer targetListUid
    await expect(
      previewCleanupOperation({
        actionType: 'SUPPRESS',
        mailingListId: listA.id,
        explicitSubscriberIds: [subB.id],
        filter: { combinator: 'AND', conditions: [] },
        actorEmail: ACTOR,
      })
    ).rejects.toThrow(/scoping violation|cannot be substituted across lists/i);

    const betaOnlyList = await prisma.mailingList.create({
      data: {
        customerConnectionId: connB.id,
        listUid: 'beta_only_list_uid',
        name: 'Beta Private Target List',
        optIn: 'single',
        isDemoData: false,
      },
    });
    await expect(
      previewCleanupOperation({
        actionType: 'MOVE_SUBSCRIBERS',
        mailingListId: listA.id,
        targetListUid: betaOnlyList.listUid,
        filter: { combinator: 'AND', conditions: [] },
        actorEmail: ACTOR,
      })
    ).rejects.toThrow(/Customer isolation violation/i);

    await expect(
      restoreSuppressedSubscribers({
        customerConnectionId: connA.id,
        subscriberIds: [subB.id],
        adminApproved: true,
        reason: 'Cross-customer restore test',
        actorEmail: ACTOR,
      })
    ).rejects.toThrow(/Customer isolation violation/i);

    await expect(
      restoreSuppressedSubscribers({
        subscriberIds: [subA.id, subB.id],
        adminApproved: true,
        reason: 'Multi-customer batch restore test',
        actorEmail: ACTOR,
      })
    ).rejects.toThrow(/Customer isolation violation/i);

    // 7. Compatibility & mutation approval on Alpha MUST NEVER unlock Beta
    const verifiedCaps = mailWizzCapabilityRegistry.buildBaselineEntries().map((cap) =>
      cap.criticalForSync || cap.key === 'subscriber_unsubscribe'
        ? { ...cap, status: 'VERIFIED' as const, testedReadOnly: true, reason: 'Verified for Alpha' }
        : cap
    );
    const alphaCompatReport = {
      customerConnectionId: connA.id,
      overallStatus: 'FULLY VERIFIED' as const,
      adapterInUse: 'MailWizz 3.x REST Adapter (mailwizz-v3)',
      adapterMode: 'VERIFIED_NATIVE' as const,
      connectionStatus: 'CONNECTED' as const,
      versionInfo: {
        configuredVersion: '3.0.5',
        detectedVersion: '3.0.5',
        approvedVersion: '3.0.5',
        effectiveVersion: '3.0.5',
        source: 'API_HEADER_OR_META' as const,
        verifiedByApiSignal: true,
        parsed: {
          raw: '3.0.5',
          major: 3,
          minor: 0,
          patch: 5,
          prerelease: null,
          classification: 'BASELINE_3_0_5' as const,
          isBaseline305: true,
          isVerifiedLineage: true,
        },
        upgradeDetected: false,
        upgradeSummary: null,
      },
      mutationSafetyAllowed: true,
      mutationLockReason: null,
      historicalEngagementAvailable: true,
      historicalEngagementSummary: 'Verified Alpha',
      capabilities: verifiedCaps,
      warnings: [],
      requiredManualActions: [],
      additiveFieldsObserved: [],
      lastVerifiedAt: new Date().toISOString(),
    };
    await mailWizzCapabilityRegistry.saveCompatibilityReport({
      customerConnectionId: connA.id,
      report: alphaCompatReport,
      actorEmail: ACTOR,
    });
    process.env.ENABLE_MAILWIZZ_MUTATIONS = 'true';
    resetEnvCacheForTests();

    await expect(
      assertCompatibilityPermitsRemoteMutations('UNSUBSCRIBE', { customerConnectionId: connA.id })
    ).resolves.toBeUndefined();
    await expect(
      assertCompatibilityPermitsRemoteMutations('UNSUBSCRIBE', { customerConnectionId: connB.id })
    ).rejects.toBeInstanceOf(UnsafeOperationBlockedError);

    await mailWizzCapabilityRegistry.recordDisposableWriteVerification({
      customerConnectionId: connA.id,
      capabilityKey: 'subscriber_unsubscribe',
      approvedVersion: '3.0.5',
      disposableListUid: listA.listUid,
      evidence: 'Verified unsubscribe on Alpha only',
      actorEmail: ACTOR,
    });
    expect(
      (await mailWizzCapabilityRegistry.loadVerifiedWriteCapabilities('3.0.5', connB.id)).size
    ).toBe(0);

    // Compatibility validator offline run on Beta sees zero Alpha verified writes
    const betaOfflineReport = await mailWizzCompatibilityValidator.validate({
      customerConnectionId: connB.id,
      client: new MailWizzClient({
        apiUrl: sharedBaseUrl,
        apiKey: 'mw-beta-secret-key-2222',
        allowInsecureHttp: true,
      }),
      configuredVersion: '3.0.5',
      approvedVersion: '3.0.5',
      webhookConfigured: true,
      envMutationsEnabled: true,
    });
    const betaUnsubStatus = betaOfflineReport.capabilities.find(
      (c) => c.key === 'subscriber_unsubscribe'
    )?.status;
    expect(betaUnsubStatus).not.toBe('VERIFIED');
    expect(['BLOCKED', 'AVAILABLE_BUT_UNTESTED']).toContain(betaUnsubStatus);

    process.env.ENABLE_MAILWIZZ_MUTATIONS = 'false';
    resetEnvCacheForTests();

    // 8. Pausing & disabling connection blocks enqueue + execution
    await setConnectionSyncPaused({
      connectionId: connB.id,
      isPaused: true,
      reason: 'Maintenance pause',
      actorEmail: ACTOR,
    });
    await expect(
      enqueueJob({
        type: 'FULL_SYNC',
        customerConnectionId: connB.id,
      })
    ).rejects.toThrow(/paused/i);
    await expect(runMailWizzSync({ customerConnectionId: connB.id })).rejects.toThrow(/paused/i);

    await setConnectionSyncPaused({
      connectionId: connB.id,
      isPaused: false,
      reason: 'Resumed',
      actorEmail: ACTOR,
    });

    // 9. API key rotation increments credentialVersion, marks v1 ROTATED, cancels stale jobs, and aborts stale worker execution
    const jobBeforeRotate = await enqueueJob({
      type: 'ANALYZE_HYGIENE',
      customerConnectionId: connA.id,
      payload: { customerConnectionId: connA.id },
    });
    createdJobIds.push(jobBeforeRotate.id);
    expect(jobBeforeRotate.credentialVersion).toBe(1);

    const rotatedConnA = await rotateCustomerConnectionApiKey({
      connectionId: connA.id,
      newApiKey: 'mw-alpha-rotated-key-9999',
      actorEmail: ACTOR,
    });
    expect(rotatedConnA.credentialVersion).toBe(2);
    expect(rotatedConnA.apiKeyMasked).toBe('****9999');

    const cancelledJobAfterRotate = await prisma.syncJob.findUniqueOrThrow({
      where: { id: jobBeforeRotate.id },
    });
    expect(cancelledJobAfterRotate.status).toBe('CANCELLED');

    // Even if a worker executes a stale v1 job directly, executeSyncJob aborts fail-closed!
    const staleForcedJob = await enqueueJob({
      type: 'ANALYZE_HYGIENE',
      customerConnectionId: connA.id,
      credentialVersion: 1,
      payload: { customerConnectionId: connA.id },
    });
    createdJobIds.push(staleForcedJob.id);
    await executeSyncJob(staleForcedJob);
    const aborted = await prisma.syncJob.findUniqueOrThrow({
      where: { id: staleForcedJob.id },
    });
    expect(aborted.status).toBe('CANCELLED');
    expect(aborted.lastError).toMatch(/rotated or revoked/i);

    await expect(
      getMailWizzClientWithContext(connA.id, { expectedCredentialVersion: 1 })
    ).rejects.toThrow(/Credential version mismatch|rotated/i);

    // 10. Revoking credential disables connection & rejects client creation
    const revokedConnA = await revokeCustomerConnectionCredential({
      connectionId: connA.id,
      reason: 'Compromised test token',
      actorEmail: ACTOR,
    });
    expect(revokedConnA.isEnabled).toBe(false);
    expect(revokedConnA.hasActiveCredential).toBe(false);
    await expect(getMailWizzClientWithContext(connA.id)).rejects.toThrow(/disabled/i);

    // 11. Typed delete confirmation: wrong phrase & RUNNING job both block deletion; right phrase deletes ONLY Alpha
    await expect(
      deleteCustomerConnection({
        connectionId: connA.id,
        confirmationPhrase: 'WRONG-PHRASE',
        actorEmail: ACTOR,
      })
    ).rejects.toThrow(/does not match/i);

    await prisma.syncJob.update({
      where: { id: staleForcedJob.id },
      data: { status: 'RUNNING', heartbeatAt: new Date() },
    });
    await expect(
      deleteCustomerConnection({
        connectionId: connA.id,
        confirmationPhrase: connA.customerName,
        actorEmail: ACTOR,
      })
    ).rejects.toThrow(/while background jobs are RUNNING/i);

    await prisma.syncJob.update({
      where: { id: staleForcedJob.id },
      data: { status: 'CANCELLED', finishedAt: new Date() },
    });

    const delRes = await deleteCustomerConnection({
      connectionId: connA.id,
      confirmationPhrase: connA.customerSlug,
      actorEmail: ACTOR,
    });
    expect(delRes.deletedConnectionId).toBe(connA.id);
    expect(await getCustomerConnectionById(connA.id)).toBeNull();
    expect(await prisma.mailingList.findUnique({ where: { id: listA.id } })).toBeNull();
    // Beta data remains 100% intact!
    expect(await prisma.mailingList.findUnique({ where: { id: listB.id } })).not.toBeNull();
    expect(await prisma.subscriber.findUnique({ where: { id: subB.id } })).not.toBeNull();
  });

  it('enforces quarantine protections, refuses unsafe demo seeding, supports 25+ connection pagination/filtering, and schedules worker jobs fairly across customers', async () => {
    // 12. Legacy quarantined connection stays blocked & excluded
    await prisma.mailWizzInstallation.create({
      data: {
        id: quarantineInstId,
        name: 'Quarantine Test Host',
        baseUrl: 'https://quarantine.example.invalid/api/index.php',
        hostname: 'quarantine.example.invalid',
      },
    });
    await prisma.mailWizzCustomerConnection.create({
      data: {
        id: quarantineConnId,
        installationId: quarantineInstId,
        customerName: 'Legacy Quarantine Customer',
        customerSlug: 'p4-iso-quarantine',
        isEnabled: false,
        isQuarantine: true,
        isDemoData: false,
        status: 'LEGACY_QUARANTINE',
      },
    });
    await prisma.mailWizzConnectionCredential.create({
      data: {
        customerConnectionId: quarantineConnId,
        version: 1,
        apiKeyEnc: encryptSecret('quarantine-secret-value-1234'),
        apiKeyLast4: '1234',
        apiKeyFingerprint: 'p4-quarantine-fp',
        isActive: true,
        status: 'ACTIVE',
        createdByEmail: ACTOR,
      },
    });

    await expect(
      updateCustomerConnection(quarantineConnId, { isEnabled: true, actorEmail: ACTOR })
    ).rejects.toThrow(/Quarantined legacy connections cannot be enabled/i);
    await expect(
      rotateCustomerConnectionApiKey({
        connectionId: quarantineConnId,
        newApiKey: 'new-quarantine-key-9999',
        actorEmail: ACTOR,
      })
    ).rejects.toThrow(/quarantined legacy connection/i);
    await expect(getMailWizzClientWithContext(quarantineConnId)).rejects.toThrow(/quarantined/i);
    await expect(
      enqueueJob({ type: 'ANALYZE_HYGIENE', customerConnectionId: quarantineConnId })
    ).rejects.toThrow(/disabled or quarantined/i);

    // 13. Demo seeder refuses to overwrite when real non-demo customer connections exist
    await expect(seedSyntheticDemoData()).rejects.toThrow(/Refusing to seed synthetic demo data/i);

    // 14. Create 25 connections & verify pagination + search + status + installation filters
    const batchConns: string[] = [];
    for (let i = 1; i <= 25; i++) {
      const padded = String(i).padStart(2, '0');
      const created = await createCustomerConnection({
        customerName: `P4 Paginated Tenant ${padded}`,
        customerSlug: `p4-iso-page-${padded}`,
        baseUrl: `https://p4-page-${padded}.example.invalid/api/index.php`,
        apiKey: `mw-page-key-${padded}-9999`,
        actorEmail: ACTOR,
      });
      createdConnectionIds.push(created.id);
      batchConns.push(created.id);
    }

    const page1 = await listCustomerConnections({
      search: 'p4-iso-page-',
      page: 1,
      pageSize: 10,
    });
    expect(page1.total).toBe(25);
    expect(page1.totalPages).toBe(3);
    expect(page1.items).toHaveLength(10);

    const page3 = await listCustomerConnections({
      search: 'p4-iso-page-',
      page: 3,
      pageSize: 10,
    });
    expect(page3.items).toHaveLength(5);

    const quarantineOnly = await listCustomerConnections({
      status: 'LEGACY_QUARANTINE',
      includeQuarantine: true,
    });
    expect(quarantineOnly.items.some((c) => c.id === quarantineConnId)).toBe(true);

    // 15. Fair round-robin scheduling across multiple customers (Tenant 01 has 2 jobs, Tenant 02 has 1)
    const tenant01Id = batchConns[0];
    const tenant02Id = batchConns[1];

    // Clear any stray pending jobs from prior steps first
    await prisma.syncJob.updateMany({
      where: {
        status: 'PENDING',
        customerConnectionId: { notIn: [tenant01Id, tenant02Id] },
      },
      data: { status: 'CANCELLED', finishedAt: new Date() },
    });

    const t1JobA = await enqueueJob({
      type: 'ANALYZE_HYGIENE',
      customerConnectionId: tenant01Id,
      runAt: new Date(Date.now() - 5000),
    });
    const t1JobB = await enqueueJob({
      type: 'ANALYZE_HYGIENE',
      customerConnectionId: tenant01Id,
      runAt: new Date(Date.now() - 4000),
    });
    const t2JobA = await enqueueJob({
      type: 'ANALYZE_HYGIENE',
      customerConnectionId: tenant02Id,
      runAt: new Date(Date.now() - 3000),
    });
    createdJobIds.push(t1JobA.id, t1JobB.id, t2JobA.id);

    // Claim 1 goes to Tenant 01 (earliest runAt); leave RUNNING -> per-connection concurrency (1) holds t1JobB while Tenant 02 gets Claim 2!
    const claimed1 = await claimNextJob('p4-fair-worker-1');
    expect(claimed1?.customerConnectionId).toBe(tenant01Id);

    const claimed2 = await claimNextJob('p4-fair-worker-2');
    expect(claimed2?.customerConnectionId).toBe(tenant02Id);

    if (claimed1) await completeJob(claimed1.id, { ok: true });
    if (claimed2) await completeJob(claimed2.id, { ok: true });

    const claimed3 = await claimNextJob('p4-fair-worker-1');
    expect(claimed3?.id).toBe(t1JobB.id);
    if (claimed3) await completeJob(claimed3.id, { ok: true });
  });
});
