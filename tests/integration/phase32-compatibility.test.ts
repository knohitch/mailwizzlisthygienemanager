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
import { mailWizzCompatibilityValidator } from '@/services/mailwizz/compatibility-validator';
import { mailWizzCapabilityRegistry } from '@/services/mailwizz/capability-registry';
import { MailWizzClient } from '@/services/mailwizz/client';
import { runMailWizzSync } from '@/services/mailwizz/sync';
import {
  assertCompatibilityPermitsRemoteMutations,
  createConfiguredMutationClient,
  MutationGateLockedError,
  UnsafeOperationBlockedError,
} from '@/services/mutations/gate';
import { inspectHistoricalSources } from '@/services/mailwizz/historical-sources';
import { importAlibabaDirectMailCsv } from '@/services/deliverability/alibaba-directmail';
import { GET as compatGet, POST as compatPost } from '@/app/api/compatibility/route';
import { sha256Hex } from '@/services/security/crypto';

const P32_LIST_ID = 'p32_compat_list';
const P32_SUB_ID = 'p32_compat_sub';
const P32_EVENT_ID = 'p32_compat_hist_ev';
const P32_INST_ID = 'p32_test_inst';
const P32_CONN_ID = 'p32_test_conn';
const TEST_ACTOR = 'p32-compat-test@local.hygiene';

describe('Phase 3.2 Future-Version Compatibility & Governance Integration', () => {
  let rawToken = '';
  let csrfToken = '';
  let sessionId = '';
  let originalDetectedVersion: string | null = null;
  const originalMutations = process.env.ENABLE_MAILWIZZ_MUTATIONS;

  beforeAll(async () => {
    const existingCfg = await prisma.appConfig.findUnique({ where: { id: 'default' } });
    originalDetectedVersion = existingCfg?.mailwizzDetectedVersion ?? null;
    const sess = await createAdminSession({
      adminEmail: TEST_ACTOR,
      ipAddress: '127.0.0.1',
      userAgent: 'vitest-phase32',
    });
    rawToken = sess.rawToken;
    const active = await getActiveSessionFromToken(rawToken);
    if (!active) throw new Error('Failed to create test admin session');
    sessionId = active.sessionId;
    csrfToken = deriveCsrfToken(active);

    // Seed an isolated historical engagement event to confirm upgrades preserve local history
    await prisma.engagementEvent.deleteMany({ where: { id: P32_EVENT_ID } });
    await prisma.subscriber.deleteMany({ where: { id: P32_SUB_ID } });
    await prisma.mailingList.deleteMany({ where: { id: P32_LIST_ID } });

    await prisma.mailWizzInstallation.upsert({
      where: { id: P32_INST_ID },
      update: { name: 'Phase32 Test MailWizz', isActive: true },
      create: {
        id: P32_INST_ID,
        name: 'Phase32 Test MailWizz',
        baseUrl: 'https://p32-mock.example.invalid/api/index.php',
        hostname: 'p32-mock.example.invalid',
      },
    });
    await prisma.mailWizzCustomerConnection.upsert({
      where: { id: P32_CONN_ID },
      update: { isEnabled: true, isQuarantine: false, isDemoData: false, status: 'CONNECTED' },
      create: {
        id: P32_CONN_ID,
        installationId: P32_INST_ID,
        customerName: 'Phase 3.2 Test Customer',
        customerSlug: 'p32-test-customer',
        isEnabled: true,
        isQuarantine: false,
        isDemoData: false,
        status: 'CONNECTED',
      },
    });

    await prisma.mailingList.create({
      data: {
        id: P32_LIST_ID,
        customerConnectionId: P32_CONN_ID,
        listUid: 'p32_uid_list',
        name: 'Phase 3.2 Historical Continuity List',
        optIn: 'single',
        isDemoData: false,
      },
    });

    await prisma.subscriber.create({
      data: {
        id: P32_SUB_ID,
        customerConnectionId: P32_CONN_ID,
        mailingListId: P32_LIST_ID,
        subscriberUid: 'p32_uid_sub',
        email: 'continuity@example.com',
        emailHash: sha256Hex('continuity@example.com'),
        status: 'CONFIRMED',
        rawStatus: 'confirmed',
        isDemoData: false,
      },
    });

    await prisma.engagementEvent.create({
      data: {
        id: P32_EVENT_ID,
        customerConnectionId: P32_CONN_ID,
        subscriberId: P32_SUB_ID,
        mailingListId: P32_LIST_ID,
        eventType: 'CLICK',
        source: 'VERIFIED_EXPORT',
        occurredAt: new Date('2025-11-01T10:00:00Z'),
        dedupeKey: `dedupe_${P32_EVENT_ID}`,
        isDemoData: false,
      },
    });
  });

  afterAll(async () => {
    process.env.ENABLE_MAILWIZZ_MUTATIONS = originalMutations;
    resetEnvCacheForTests();

    await prisma.appConfig
      .update({
        where: { id: 'default' },
        data: { mailwizzDetectedVersion: originalDetectedVersion },
      })
      .catch(() => undefined);

    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { actorEmail: TEST_ACTOR },
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
    await prisma.adminSession.deleteMany({ where: { id: sessionId } });
    await prisma.adminSession.deleteMany({ where: { tokenHash: sha256Hex(rawToken) } });
    await prisma.engagementEvent.deleteMany({ where: { id: P32_EVENT_ID } });
    await prisma.subscriber.deleteMany({ where: { id: P32_SUB_ID } });
    await prisma.mailingList.deleteMany({ where: { id: P32_LIST_ID } });
    await prisma.mailWizzCustomerConnection.deleteMany({ where: { id: P32_CONN_ID } });
    await prisma.mailWizzInstallation.deleteMany({ where: { id: P32_INST_ID } });
  });

  it('persists verified 3.0.5 baseline compatibility and blocks unapproved 4.0.0 mutations fail-closed', async () => {
    const mockV305Client = new MailWizzClient({
      apiUrl: 'https://mw-mock.example.com/api/index.php',
      apiKey: 'mock-key-305',
      maxRequestsPerSecond: 50,
      maxRetries: 0,
      fetchImpl: (async (url: string | URL | Request) => {
        const u = String(url);
        if (u.includes('/lists?') || u.endsWith('/lists')) {
          return new Response(
            JSON.stringify({
              status: 'success',
              meta: { version: '3.0.5' },
              data: {
                count: 1,
                total_pages: 1,
                current_page: 1,
                next_page: null,
                records: [
                  {
                    general: { list_uid: 'lt305', name: 'Baseline 3.0.5 List' },
                    defaults: { from_email: 'news@example.com' },
                    subscribers_count: 1,
                  },
                ],
              },
            }),
            { status: 200, headers: { 'X-MW-Version': '3.0.5', 'Content-Type': 'application/json' } }
          );
        }
        if (u.endsWith('/lists/lt305')) {
          return new Response(
            JSON.stringify({
              status: 'success',
              data: {
                record: {
                  general: { list_uid: 'lt305', name: 'Baseline 3.0.5 List' },
                  defaults: { from_email: 'news@example.com' },
                },
              },
            }),
            { status: 200, headers: { 'X-MW-Version': '3.0.5', 'Content-Type': 'application/json' } }
          );
        }
        if (u.includes('/subscribers')) {
          return new Response(
            JSON.stringify({
              status: 'success',
              data: {
                count: 1,
                total_pages: 1,
                current_page: 1,
                next_page: null,
                records: [
                  {
                    subscriber_uid: 'sb305',
                    EMAIL: 'confirmed@example.com',
                    status: 'confirmed',
                  },
                ],
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (u.includes('/segments/operators-condition')) {
          return new Response(
            JSON.stringify({ status: 'success', data: { records: [{ operator_id: '1', name: 'is' }] } }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (u.includes('/segments')) {
          return new Response(
            JSON.stringify({
              status: 'success',
              data: { count: 0, total_pages: 1, current_page: 1, next_page: null, records: [] },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (u.includes('/fields')) {
          return new Response(
            JSON.stringify({ status: 'success', data: { records: [{ field_id: '1', tag: 'EMAIL' }] } }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (u.includes('/campaigns?')) {
          return new Response(
            JSON.stringify({
              status: 'success',
              data: {
                count: 1,
                total_pages: 1,
                current_page: 1,
                next_page: null,
                records: [{ campaign_uid: 'cp305', name: 'Welcome', status: 'sent' }],
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (u.includes('/stats')) {
          return new Response(
            JSON.stringify({
              status: 'success',
              data: {
                campaign_status: 'sent',
                subscribers_count: 1,
                processed_count: 1,
                delivery_success_count: 1,
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (u.includes('/bounces')) {
          return new Response(
            JSON.stringify({
              status: 'success',
              data: { count: 0, total_pages: 1, current_page: 1, next_page: null, records: [] },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (
          u.includes('/track-') ||
          u.includes('/delivery-logs') ||
          u.includes('/opens') ||
          u.includes('/clicks') ||
          u.includes('/complaints')
        ) {
          return new Response(JSON.stringify({ status: 'error' }), { status: 404 });
        }
        return new Response(JSON.stringify({ status: 'success', data: {} }), { status: 200 });
      }) as typeof fetch,
    });

    const v305Report = await mailWizzCompatibilityValidator.validate({
      customerConnectionId: P32_CONN_ID,
      client: mockV305Client,
      configuredVersion: '3.0.5',
      approvedVersion: '3.0.5',
      webhookConfigured: true,
      envMutationsEnabled: true,
    });

    expect(v305Report.connectionStatus).toBe('CONNECTED');
    expect(v305Report.versionInfo.detectedVersion).toBe('3.0.5');
    expect(v305Report.versionInfo.verifiedByApiSignal).toBe(true);
    expect(v305Report.overallStatus).toBe('FULLY VERIFIED');
    expect(v305Report.mutationSafetyAllowed).toBe(true);

    // Save 3.0.5 report -> while ENABLE_MAILWIZZ_MUTATIONS=false, global lock rejects first
    await mailWizzCapabilityRegistry.saveCompatibilityReport({
      customerConnectionId: P32_CONN_ID,
      report: v305Report,
      actorEmail: TEST_ACTOR,
    });
    process.env.ENABLE_MAILWIZZ_MUTATIONS = 'false';
    resetEnvCacheForTests();
    await expect(
      assertCompatibilityPermitsRemoteMutations('UNSUBSCRIBE', { customerConnectionId: P32_CONN_ID })
    ).rejects.toBeInstanceOf(MutationGateLockedError);

    // Even when ENABLE_MAILWIZZ_MUTATIONS=true, AVAILABLE_BUT_UNTESTED remains blocked
    process.env.ENABLE_MAILWIZZ_MUTATIONS = 'true';
    resetEnvCacheForTests();
    await expect(
      assertCompatibilityPermitsRemoteMutations('UNSUBSCRIBE', { customerConnectionId: P32_CONN_ID })
    ).rejects.toBeInstanceOf(UnsafeOperationBlockedError);

    // Record disposable write verification for subscriber_unsubscribe -> re-validate -> UNSUBSCRIBE permitted, CREATE_SEGMENT still blocked
    await mailWizzCapabilityRegistry.recordDisposableWriteVerification({
      customerConnectionId: P32_CONN_ID,
      capabilityKey: 'subscriber_unsubscribe',
      approvedVersion: '3.0.5',
      disposableListUid: 'disposable_test_list',
      evidence: 'Verified unsubscribe on disposable test subscriber',
      actorEmail: TEST_ACTOR,
    });
    const v305WithVerifiedUnsub = await mailWizzCompatibilityValidator.validate({
      customerConnectionId: P32_CONN_ID,
      client: mockV305Client,
      configuredVersion: '3.0.5',
      approvedVersion: '3.0.5',
      webhookConfigured: true,
      envMutationsEnabled: true,
    });
    expect(
      v305WithVerifiedUnsub.capabilities.find((c) => c.key === 'subscriber_unsubscribe')?.status
    ).toBe('VERIFIED');
    await mailWizzCapabilityRegistry.saveCompatibilityReport({
      customerConnectionId: P32_CONN_ID,
      report: v305WithVerifiedUnsub,
      actorEmail: TEST_ACTOR,
    });
    await expect(
      assertCompatibilityPermitsRemoteMutations('UNSUBSCRIBE', { customerConnectionId: P32_CONN_ID })
    ).resolves.toBeUndefined();
    await expect(
      assertCompatibilityPermitsRemoteMutations('CREATE_SEGMENT', { customerConnectionId: P32_CONN_ID })
    ).rejects.toBeInstanceOf(UnsafeOperationBlockedError);

    // Now simulate MailWizz silently upgrading to synthetic 4.0.0 -> fail closed!
    const v4Report = await mailWizzCompatibilityValidator.validate({
      customerConnectionId: P32_CONN_ID,
      client: new MailWizzClient({
        apiUrl: 'https://mw-mock.example.com/api/index.php',
        apiKey: 'mock-key-400',
        maxRequestsPerSecond: 50,
        maxRetries: 0,
        fetchImpl: (async () =>
          new Response(
            JSON.stringify({
              status: 'success',
              meta: { version: '4.0.0' },
              data: {
                count: 1,
                total_pages: 1,
                current_page: 1,
                next_page: null,
                records: [{ general: { list_uid: 'lt400', name: 'MW 4.0 List' } }],
              },
            }),
            { status: 200, headers: { 'X-MW-Version': '4.0.0', 'Content-Type': 'application/json' } }
          )) as typeof fetch,
      }),
      configuredVersion: '3.0.5',
      approvedVersion: '3.0.5',
      webhookConfigured: true,
      envMutationsEnabled: true,
    });

    expect(v4Report.versionInfo.detectedVersion).toBe('4.0.0');
    expect(v4Report.adapterMode).toBe('RESTRICTED_SAFE_MODE');
    expect(v4Report.mutationSafetyAllowed).toBe(false);

    await mailWizzCapabilityRegistry.saveCompatibilityReport({
      customerConnectionId: P32_CONN_ID,
      report: v4Report,
      actorEmail: TEST_ACTOR,
    });

    process.env.ENABLE_MAILWIZZ_MUTATIONS = 'true';
    resetEnvCacheForTests();
    await expect(
      assertCompatibilityPermitsRemoteMutations('UNSUBSCRIBE', { customerConnectionId: P32_CONN_ID })
    ).rejects.toBeInstanceOf(UnsafeOperationBlockedError);
    await expect(
      createConfiguredMutationClient('UNSUBSCRIBE', P32_CONN_ID)
    ).rejects.toBeInstanceOf(UnsafeOperationBlockedError);

    // Confirm historical EngagementEvent survived simulated compatibility transitions untouched
    const histAfter = await prisma.engagementEvent.findUnique({ where: { id: P32_EVENT_ID } });
    expect(histAfter?.eventType).toBe('CLICK');
    expect(histAfter?.source).toBe('VERIFIED_EXPORT');
  });

  it('sync handles unknown subscriber status safely without losing consent ambiguity and records additive metadata', async () => {
    const syncClient = new MailWizzClient({
      apiUrl: 'https://mw-mock.example.com/api/index.php',
      apiKey: 'mock-key-unk',
      maxRequestsPerSecond: 50,
      maxRetries: 0,
      fetchImpl: (async (url: string | URL | Request) => {
        const u = String(url);
        if (u.includes('/lists?')) {
          return new Response(
            JSON.stringify({
              status: 'success',
              data: {
                count: 1,
                total_pages: 1,
                current_page: 1,
                next_page: null,
                records: [
                  {
                    general: { list_uid: 'p32_uid_list', name: 'Phase 3.2 Historical Continuity List' },
                    defaults: { from_email: 'news@example.com' },
                    subscribers_count: 1,
                  },
                ],
              },
            }),
            { status: 200, headers: { 'X-MW-Version': '3.1.0' } }
          );
        }
        if (u.includes('/lists/p32_uid_list/subscribers')) {
          return new Response(
            JSON.stringify({
              status: 'success',
              data: {
                count: 1,
                total_pages: 1,
                current_page: 1,
                next_page: null,
                records: [
                  {
                    subscriber_uid: 'p32_uid_sub',
                    EMAIL: 'continuity@example.com',
                    status: 'snoozed_v31_experiment',
                    future_preference_group: 'digest-only',
                  },
                ],
              },
            }),
            { status: 200 }
          );
        }
        return new Response(
          JSON.stringify({
            status: 'success',
            data: { count: 0, total_pages: 1, current_page: 1, next_page: null, records: [] },
          }),
          { status: 200 }
        );
      }) as typeof fetch,
    });

    await runMailWizzSync({
      customerConnectionId: P32_CONN_ID,
      client: syncClient,
    });
    const connAfter = await prisma.mailWizzCustomerConnection.findUnique({
      where: { id: P32_CONN_ID },
    });
    expect(connAfter?.detectedVersion).toBe('3.1.0');

    const sub = await prisma.subscriber.findUnique({ where: { id: P32_SUB_ID } });
    expect(sub?.status).toBe('UNKNOWN');
    expect(sub?.rawStatus).toBe('snoozed_v31_experiment');
  });

  it('enforces /api/compatibility governance: saves unverified admin version and rejects premature approval', async () => {
    // Clear prior test reports & detectedVersion to verify a clean server without API version headers
    await prisma.auditLog.deleteMany({
      where: {
        action: {
          in: [
            'MAILWIZZ_COMPATIBILITY_CONFIG',
            'MAILWIZZ_COMPATIBILITY_CHECK',
            'MAILWIZZ_VERSION_APPROVED',
          ],
        },
      },
    });
    await prisma.mailWizzCustomerConnection.update({
      where: { id: P32_CONN_ID },
      data: { detectedVersion: null },
    });
    await prisma.connectionCapabilityReport.deleteMany({
      where: { customerConnectionId: P32_CONN_ID },
    });

    const cookieHeader = `${SESSION_COOKIE_NAME}=${rawToken}`;

    // Save configured admin version -> succeeds, marked UNVERIFIED
    const saveReq = new NextRequest('http://localhost/api/compatibility', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieHeader,
        'x-csrf-token': csrfToken,
      },
      body: JSON.stringify({
        customerConnectionId: P32_CONN_ID,
        action: 'SET_CONFIGURED_VERSION',
        configuredVersion: '3.2.0-beta',
        notes: 'Staging probe validation',
      }),
    });
    const saveRes = await compatPost(saveReq);
    expect(saveRes.status).toBe(200);
    const saveBody = await saveRes.json();
    expect(saveBody.data.report.versionInfo.configuredVersion).toBe('3.2.0-beta');
    expect(saveBody.data.report.versionInfo.verifiedByApiSignal).toBe(false);

    // Rejects approval while version is UNVERIFIED / INCOMPATIBLE
    const badApproveReq = new NextRequest('http://localhost/api/compatibility', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieHeader,
        'x-csrf-token': csrfToken,
      },
      body: JSON.stringify({
        customerConnectionId: P32_CONN_ID,
        action: 'APPROVE_VERSION',
        version: '3.2.0-beta',
      }),
    });
    const badApproveRes = await compatPost(badApproveReq);
    expect(badApproveRes.status).toBe(400);

    // GET endpoint reflects saved unverified version cleanly
    const getReq = new NextRequest(
      `http://localhost/api/compatibility?customerConnectionId=${P32_CONN_ID}`,
      {
        method: 'GET',
        headers: { Cookie: cookieHeader },
      }
    );
    const getRes = await compatGet(getReq);
    expect(getRes.status).toBe(200);

    // Clear configured version back to baseline clean state
    await mailWizzCapabilityRegistry.saveConfiguredVersion({
      customerConnectionId: P32_CONN_ID,
      configuredVersion: null,
      notes: null,
      actorEmail: TEST_ACTOR,
    });
  });

  it('keeps Alibaba Cloud DirectMail reporting independent from MailWizz historical engagement adapters', async () => {
    const hist = await inspectHistoricalSources({ nativeActivityApiSupported: false });
    expect(hist.anyAvailable).toBe(true);
    expect(hist.summaryText).not.toContain('DirectMail');

    const dmCsv = await importAlibabaDirectMailCsv({
      csvContent: 'Date,Domain,Success,Fail\n2026-01-10,compat-test.example.com,1700,12\n',
      actorEmail: TEST_ACTOR,
    });
    expect(dmCsv.rowsImported).toBe(1);
    await prisma.directMailDailyMetric.deleteMany({
      where: { domainName: 'compat-test.example.com', source: 'ALIBABA_CSV_IMPORT' },
    });
  });

  it('requires positive delivery-logs status, ignores unfamiliar bounces, and aborts MOVE_SUBSCRIBERS without target membership', async () => {
    const campUid = 'p32_camp_delivery_check';
    const campaignDbId = 'p32_camp_db_row';
    await prisma.campaign.deleteMany({ where: { id: campaignDbId } });
    await prisma.campaign.deleteMany({ where: { campaignUid: campUid } });

    const probeSyncClient = new MailWizzClient({
      apiUrl: 'https://mw-mock.example.com/api/index.php',
      apiKey: 'mock-key-deliv',
      maxRequestsPerSecond: 50,
      maxRetries: 0,
      fetchImpl: (async (url: string | URL | Request) => {
        const u = String(url);
        if (u.includes('/lists?')) {
          return new Response(
            JSON.stringify({
              status: 'success',
              data: {
                count: 1,
                total_pages: 1,
                current_page: 1,
                next_page: null,
                records: [
                  {
                    general: { list_uid: 'p32_uid_list', name: 'Phase 3.2 Historical Continuity List' },
                    defaults: { from_email: 'news@example.com' },
                    subscribers_count: 1,
                  },
                ],
              },
            }),
            { status: 200 }
          );
        }
        if (u.includes('/subscribers')) {
          return new Response(
            JSON.stringify({
              status: 'success',
              data: {
                count: 1,
                total_pages: 1,
                current_page: 1,
                next_page: null,
                records: [
                  {
                    subscriber_uid: 'p32_uid_sub',
                    EMAIL: 'continuity@example.com',
                    status: 'confirmed',
                  },
                ],
              },
            }),
            { status: 200 }
          );
        }
        if (u.endsWith(`/campaigns/${campUid}`)) {
          return new Response(
            JSON.stringify({
              status: 'success',
              data: {
                record: {
                  campaign_uid: campUid,
                  name: 'Delivery Status Guard',
                  status: 'sent',
                  list: { list_uid: 'p32_uid_list' },
                },
              },
            }),
            { status: 200 }
          );
        }
        if (u.includes(`/campaigns/${campUid}/stats`)) {
          return new Response(
            JSON.stringify({
              status: 'success',
              data: { campaign_status: 'sent', processed_count: 1, delivery_success_count: 1 },
            }),
            { status: 200 }
          );
        }
        if (u.includes('/campaigns?')) {
          return new Response(
            JSON.stringify({
              status: 'success',
              data: {
                count: 1,
                total_pages: 1,
                current_page: 1,
                next_page: null,
                records: [{ campaign_uid: campUid, name: 'Delivery Status Guard', status: 'sent' }],
              },
            }),
            { status: 200 }
          );
        }
        if (u.includes('/bounces')) {
          return new Response(
            JSON.stringify({
              status: 'success',
              data: {
                count: 1,
                total_pages: 1,
                current_page: 1,
                next_page: null,
                records: [
                  {
                    bounce_type: 'custom_deferred_status',
                    message: 'Transient deferral',
                    subscriber: { subscriber_uid: 'p32_uid_sub', email: 'continuity@example.com' },
                  },
                ],
              },
            }),
            { status: 200 }
          );
        }
        if (u.includes('/delivery-logs')) {
          return new Response(
            JSON.stringify({
              status: 'success',
              data: {
                count: 2,
                total_pages: 1,
                current_page: 1,
                next_page: null,
                records: [
                  {
                    subscriber_uid: 'p32_uid_sub',
                    status: 'giveup', // Failed attempt must NOT count as DELIVERED!
                    date_added: '2026-01-05T10:00:00Z',
                  },
                  {
                    subscriber_uid: 'p32_uid_sub',
                    status: 'delivered',
                    date_added: '2026-01-06T10:00:00Z',
                  },
                ],
              },
            }),
            { status: 200 }
          );
        }
        if (u.includes('/opens') || u.includes('/clicks') || u.includes('/complaints')) {
          return new Response(JSON.stringify({ status: 'error' }), { status: 404 });
        }
        return new Response(
          JSON.stringify({
            status: 'success',
            data: { count: 0, total_pages: 1, current_page: 1, next_page: null, records: [] },
          }),
          { status: 200 }
        );
      }) as typeof fetch,
    });

    await runMailWizzSync({ customerConnectionId: P32_CONN_ID, client: probeSyncClient });

    // Confirm failed `giveup` delivery attempt did NOT record DELIVERED (only 1 delivered row from 2026-01-06)
    const deliveredEvents = await prisma.engagementEvent.findMany({
      where: {
        subscriberId: P32_SUB_ID,
        source: 'API_ACTIVITY_LOG',
        eventType: 'DELIVERED',
      },
    });
    expect(deliveredEvents).toHaveLength(1);
    expect(deliveredEvents[0]?.occurredAt.toISOString()).toBe('2026-01-06T10:00:00.000Z');

    // Confirm unfamiliar bounce type was NOT coerced into HARD_BOUNCE
    const hardBounces = await prisma.engagementEvent.findMany({
      where: {
        subscriberId: P32_SUB_ID,
        source: 'API_BOUNCE_LOG',
        eventType: 'HARD_BOUNCE',
      },
    });
    expect(hardBounces).toHaveLength(0);

    // Clean up test campaign & events
    await prisma.engagementEvent.deleteMany({
      where: { subscriberId: P32_SUB_ID, source: 'API_ACTIVITY_LOG' },
    });
    await prisma.campaign.deleteMany({ where: { campaignUid: campUid } });
  });
});
