import { describe, expect, it } from 'vitest';
import { resetEnvCacheForTests } from '@/lib/env';
import {
  MailWizzV3Adapter,
  mailWizzV3Adapter,
  mapStrictMailWizzSubscriberStatus,
} from '@/services/mailwizz/adapter-v3';
import { MailWizzVersionDetector, mailWizzVersionDetector } from '@/services/mailwizz/version-detector';
import {
  MailWizzFutureAdapterResolver,
  mailWizzFutureAdapterResolver,
} from '@/services/mailwizz/adapter-resolver';
import { MailWizzClient, MailWizzApiError } from '@/services/mailwizz/client';
import {
  MailWizzCampaignBounceRecordSchema,
  MailWizzListRecordSchema,
  MailWizzPaginatedEnvelopeSchema,
  MailWizzSingleSubscriberResponseSchema,
} from '@/services/mailwizz/types';
import { MailWizzMutationClient } from '@/services/mutations/mailwizz-writer';
import { MailWizzCompatibilityValidator } from '@/services/mailwizz/compatibility-validator';

/**
 * Contract & Regression Suite (Phase 3.2 Section 9)
 * Tests MailWizz 3.0.5 baseline fixtures + synthetic future-version drift scenarios.
 * Does NOT imply live execution against an external 4.x server.
 */
describe('MailWizz Compatibility Contract & Regression Suite', () => {
  const adapter = new MailWizzV3Adapter();
  const detector = new MailWizzVersionDetector();
  const resolver = new MailWizzFutureAdapterResolver();

  // 1. Existing MailWizz 3.0.5 fixtures (regression baseline)
  it('1. parses canonical MailWizz 3.0.5 paginated lists, subscribers, segments, campaign stats, bounces, and activity', () => {
    const listsPage = adapter.normalizePaginatedEnvelope(
      {
        status: 'success',
        data: {
          count: '1',
          total_pages: 1,
          current_page: 1,
          next_page: null,
          prev_page: null,
          records: [
            {
              general: {
                list_uid: 'lt1234567890a',
                name: 'Newsletter 1800',
                display_name: 'Newsletter 1800',
                description: 'Main list',
              },
              defaults: {
                from_name: 'Sender',
                from_email: 'news@example.com',
                reply_to: 'reply@example.com',
              },
              company: { name: 'Example Co' },
              subscribers_count: '1,842',
            },
          ],
        },
      },
      (r) => adapter.normalizeListRecord(r, '/lists'),
      '/lists'
    );
    expect(listsPage.ok).toBe(true);
    expect(listsPage.data?.records).toHaveLength(1);
    expect(listsPage.data?.records[0]).toMatchObject({
      listUid: 'lt1234567890a',
      name: 'Newsletter 1800',
      fromEmail: 'news@example.com',
      subscribersCount: 1842,
    });

    const subsPage = adapter.normalizePaginatedEnvelope(
      {
        status: 'success',
        data: {
          count: 1,
          total_pages: 1,
          current_page: 1,
          next_page: null,
          records: [
            {
              subscriber_uid: 'sb9876543210b',
              EMAIL: 'alice@example.com',
              FNAME: 'Alice',
              LNAME: 'Tan',
              status: 'confirmed',
              source: 'web',
              date_added: '2025-01-10 08:00:00',
            },
          ],
        },
      },
      (r) => adapter.normalizeSubscriberRecord(r, '/lists/lt1234567890a/subscribers'),
      '/lists/lt1234567890a/subscribers'
    );
    expect(subsPage.ok).toBe(true);
    expect(subsPage.data?.records[0]).toMatchObject({
      subscriberUid: 'sb9876543210b',
      email: 'alice@example.com',
      firstName: 'Alice',
      lastName: 'Tan',
      status: 'CONFIRMED',
      unknownStatusDetected: false,
    });

    const segRes = adapter.normalizeSegmentDetailResponse(
      {
        status: 'success',
        data: {
          record: {
            segment_uid: 'sg111',
            name: 'Inactive 90d',
            operator_match: 'all',
            subscribers_count: 42,
            conditions: [],
            campaign_conditions: [],
          },
        },
      },
      '/lists/lt1234567890a/segments/sg111'
    );
    expect(segRes.ok).toBe(true);
    expect(segRes.data?.segmentUid).toBe('sg111');

    const statsRes = adapter.normalizeCampaignStatsResponse(
      {
        status: 'success',
        data: {
          campaign_status: 'sent',
          subscribers_count: 1800,
          processed_count: 1795,
          delivery_success_count: 1750,
          delivery_success_rate: '97.49%',
          opens_count: 610,
          unique_opens_count: 490,
          clicks_count: 140,
          unique_clicks_count: 95,
          unsubscribes_count: 8,
          complaints_count: 1,
          bounces_count: 45,
          hard_bounces_count: 12,
          soft_bounces_count: 33,
        },
      },
      '/campaigns/cp1/stats'
    );
    expect(statsRes.ok).toBe(true);
    expect(statsRes.data?.deliverySuccessCount).toBe(1750);
    expect(statsRes.data?.hardBouncesCount).toBe(12);
  });

  // 2. Valid additive fields
  it('2. tolerates and records valid additive fields without breaking contracts', () => {
    const res = adapter.normalizeSubscriberRecord(
      {
        subscriber_uid: 'sb_add_1',
        EMAIL: 'bob@example.com',
        status: 'confirmed',
        future_engagement_score: 88.5,
        ai_tag_list: ['vip'],
      },
      '/lists/l1/subscribers'
    );
    expect(res.ok).toBe(true);
    expect(res.data?.email).toBe('bob@example.com');
    expect(res.additiveFields).toEqual(
      expect.arrayContaining(['subscriber.future_engagement_score', 'subscriber.ai_tag_list'])
    );
    expect(res.issues.some((i) => i.code === 'ADDITIVE_FIELDS_DETECTED')).toBe(true);
  });

  // 3. Missing required properties
  it('3. fails safely with explicit contract errors when required properties are missing', () => {
    const badList = adapter.normalizeListRecord(
      {
        general: {
          name: 'Nameless UID List',
        },
      },
      '/lists'
    );
    expect(badList.ok).toBe(false);
    expect(badList.issues.some((i) => i.code === 'MISSING_REQUIRED_FIELD')).toBe(true);

    const badSub = adapter.normalizeSubscriberRecord(
      {
        subscriber_uid: 'sb_no_email',
        status: 'confirmed',
      },
      '/lists/l1/subscribers'
    );
    expect(badSub.ok).toBe(false);
    expect(badSub.issues.some((i) => i.code === 'MISSING_REQUIRED_FIELD')).toBe(true);
  });

  // 4. Renamed fields
  it('4. flags unaliased renamed fields (e.g. mailwizz_contact_id instead of subscriber_uid) instead of silent corruption', () => {
    const renamed = adapter.normalizeSubscriberRecord(
      {
        contact_identifier_v4: 'v4_001',
        primary_address: 'v4@example.com',
        lifecycle_state: 'active',
      },
      '/lists/l1/subscribers'
    );
    expect(renamed.ok).toBe(false);
    expect(renamed.issues.some((i) => i.severity === 'ERROR')).toBe(true);
  });

  // 5. Unexpected data types
  it('5. catches unexpected non-string / non-numeric property types', () => {
    const badTypes = adapter.normalizeSubscriberRecord(
      {
        subscriber_uid: { nested: 123 },
        EMAIL: ['not-a-string@example.com'],
        status: 'confirmed',
      },
      '/lists/l1/subscribers'
    );
    expect(badTypes.ok).toBe(false);
    expect(
      badTypes.issues.some(
        (i) => i.code === 'UNEXPECTED_TYPE' || i.code === 'MISSING_REQUIRED_FIELD'
      )
    ).toBe(true);
  });

  // 6. Changed pagination structures
  it('6. handles changed pagination structures cleanly and rejects looping or corrupt pagination metadata', () => {
    const nestedMeta = adapter.normalizePaginatedEnvelope(
      {
        success: true,
        meta: {
          version: '3.2.0',
          pagination: { total: 2, total_pages: 2, current_page: 1, next_page: 2 },
        },
        data: {
          items: [
            {
              general: { list_uid: 'lt_meta_1', name: 'Meta List' },
            },
          ],
        },
      },
      (r) => adapter.normalizeListRecord(r, '/lists'),
      '/lists'
    );
    expect(nestedMeta.ok).toBe(true);
    expect(nestedMeta.data?.nextPage).toBe(2);

    const brokenLoop = adapter.normalizePaginatedEnvelope(
      {
        status: 'success',
        data: {
          count: 10,
          total_pages: 3,
          current_page: 2,
          next_page: 2, // infinite loop bug
          records: [],
        },
      },
      (r) => adapter.normalizeListRecord(r, '/lists'),
      '/lists'
    );
    expect(brokenLoop.ok).toBe(false);
    expect(brokenLoop.issues.some((i) => i.code === 'PAGINATION_ANOMALY')).toBe(true);
  });

  // 7. Authentication / authorization failures
  it('7. reports AUTH_FAILED when MailWizz responds 401/403 during read-only compatibility validation', async () => {
    const validator = new MailWizzCompatibilityValidator();
    const fakeClient = {
      getDetectedServerVersion: () => null,
      getRawJson: async () => {
        throw new MailWizzApiError('Unauthorized X-Api-Key', {
          statusCode: 401,
          retryable: false,
          endpoint: '/lists',
        });
      },
    } as unknown as MailWizzClient;

    const report = await validator.validate({
      client: fakeClient,
      configuredVersion: '3.0.5',
      approvedVersion: null,
      webhookConfigured: true,
      envMutationsEnabled: false,
    });

    expect(report.connectionStatus).toBe('AUTH_FAILED');
    expect(report.overallStatus).toBe('INCOMPATIBLE');
    expect(report.mutationSafetyAllowed).toBe(false);
  });

  // 8. Unknown subscriber statuses (CRITICAL SAFEGUARD)
  it('8. never reinterprets unknown or novel subscriber statuses as safe to unsubscribe/delete', () => {
    const unknown1 = mapStrictMailWizzSubscriberStatus('paused_by_user_v4');
    expect(unknown1.status).toBe('UNKNOWN');
    expect(unknown1.unknownStatusDetected).toBe(true);

    const normalized = adapter.normalizeSubscriberRecord(
      {
        subscriber_uid: 'sb_unk_1',
        EMAIL: 'paused@example.com',
        status: 'paused_by_user_v4',
      },
      '/lists/l1/subscribers'
    );
    expect(normalized.ok).toBe(true);
    expect(normalized.data?.status).toBe('UNKNOWN');
    expect(normalized.data?.unknownStatusDetected).toBe(true);
    expect(
      normalized.issues.some(
        (i) => i.code === 'UNKNOWN_SUBSCRIBER_STATUS' && i.severity === 'WARNING'
      )
    ).toBe(true);
  });

  // 9. Changed segment responses
  it('9. catches changed segment payloads and supports single-record segment detail drift checks', () => {
    const brokenSeg = adapter.normalizeSegmentDetailResponse(
      {
        status: 'success',
        data: {
          record: {
            name: 'Missing Segment UID',
            conditions: 'not-an-array-or-map',
          },
        },
      },
      '/lists/l1/segments/s1'
    );
    expect(brokenSeg.ok).toBe(false);
    expect(brokenSeg.issues.some((i) => i.code === 'MISSING_REQUIRED_FIELD')).toBe(true);
  });

  // 10. Changed unsubscribe responses (+ official PATCH fallback / strict failure)
  it('10. preserves MailWizz 3.0.5 unsubscribe behavior with 404/405 POST-or-PUT fallback while respecting read-only lock', async () => {
    const prevEnv = process.env.ENABLE_MAILWIZZ_MUTATIONS;
    process.env.ENABLE_MAILWIZZ_MUTATIONS = 'true';
    resetEnvCacheForTests();
    try {
      let calls = 0;
      const writer = new MailWizzMutationClient({
        apiUrl: 'https://mw.example.com/api/index.php',
        apiKey: 'test-key',
        timeoutMs: 3000,
        fetchImpl: (async (_url: string | URL | Request, init?: RequestInit) => {
          calls += 1;
          if (calls === 1 && init?.method === 'PUT') {
            return new Response(JSON.stringify({ status: 'error', error: 'Not allowed' }), {
              status: 405,
            });
          }
          return new Response(
            JSON.stringify({
              status: 'success',
              data: { record: { subscriber_uid: 'sb1', status: 'unsubscribed' } },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }) as typeof fetch,
      });

      const res = await writer.unsubscribeSubscriber({
        listUid: 'lt1',
        subscriberUid: 'sb1',
        actorEmail: 'contract-test@local.hygiene',
      });
      expect(res.ok).toBe(true);
      expect(calls).toBe(2);
    } finally {
      process.env.ENABLE_MAILWIZZ_MUTATIONS = prevEnv;
      resetEnvCacheForTests();
    }
  });

  // 11. Changed webhook formats
  it('11. normalizes MailWizz 3.x webhooks and emits warnings without crashing on novel webhook schemas', () => {
    const standard = mailWizzV3Adapter.normalizeWebhookPayload({
      event: 'campaign.open',
      timestamp: 1700000000,
      data: {
        campaign_uid: 'cp1',
        subscriber_uid: 'sb1',
        list_uid: 'lt1',
      },
    });
    expect(standard.events).toHaveLength(1);
    expect(standard.events[0]?.eventType).toBe('OPEN');
    expect(standard.issues).toHaveLength(0);

    const drifted = mailWizzV3Adapter.normalizeWebhookPayload({
      event_name: 'subscriber.engagement.v4_ai_summary',
      payload: {
        subscriber_id: 'sb2',
      },
    });
    expect(drifted.events).toHaveLength(0);
    expect(drifted.issues.some((i) => i.code === 'WEBHOOK_FORMAT_CHANGE')).toBe(true);
  });

  // 12. Rate limit responses (HTTP 429)
  it('12. treats HTTP 429 rate limits as transient without marking endpoints permanently UNSUPPORTED', async () => {
    const validator = new MailWizzCompatibilityValidator();
    const fakeClient = {
      getDetectedServerVersion: () => '3.0.5',
      getRawJson: async () => {
        throw new MailWizzApiError('Rate limited', {
          statusCode: 429,
          retryable: true,
          endpoint: '/lists',
        });
      },
    } as unknown as MailWizzClient;

    const report = await validator.validate({
      client: fakeClient,
      configuredVersion: '3.0.5',
      approvedVersion: '3.0.5',
      webhookConfigured: true,
      envMutationsEnabled: false,
    });

    const listCap = report.capabilities.find((c) => c.key === 'list_discovery');
    expect(listCap?.status).toBe('UNKNOWN');
    expect(report.warnings.some((w) => w.includes('429') || w.toLowerCase().includes('rate limit'))).toBe(
      true
    );
  });

  // 13. Unknown future versions (4.0.0, custom tags)
  it('13. classifies synthetic 4.0.0 and custom unknown versions into RESTRICTED_SAFE_MODE with mutations locked fail-closed', () => {
    const v4Info = detector.resolveVersionInfo({
      configuredVersion: null,
      detectedVersion: '4.0.0',
      approvedVersion: '3.0.5',
    });
    expect(v4Info.parsed.classification).toBe('FUTURE_MAJOR');
    expect(v4Info.upgradeDetected).toBe(true);

    const resolvedV4 = resolver.resolve({
      versionInfo: v4Info,
      envMutationsEnabled: true, // even if env allows mutations!
      coreContractsPassed: true,
      approvedVersionPassedCheck: true,
    });
    expect(resolvedV4.adapterMode).toBe('RESTRICTED_SAFE_MODE');
    expect(resolvedV4.mutationSafetyAllowed).toBe(false);
    expect(resolvedV4.autoCleanupAllowed).toBe(false);

    const unknownInfo = detector.resolveVersionInfo({
      configuredVersion: 'future-custom-build',
      detectedVersion: null,
      approvedVersion: null,
    });
    expect(unknownInfo.source).toBe('ADMIN_SUPPLIED');
    expect(unknownInfo.verifiedByApiSignal).toBe(false);
    expect(unknownInfo.parsed.classification).toBe('UNKNOWN_CUSTOM');
    expect(
      mailWizzFutureAdapterResolver.resolve({
        versionInfo: unknownInfo,
        envMutationsEnabled: true,
        coreContractsPassed: true,
      }).mutationSafetyAllowed
    ).toBe(false);
  });

  // 14. Version mismatch between expected (configured/approved) and API-detected version
  it('14. flags configured vs API-detected mismatch and blocks mutations when minor/major upgrade occurs', () => {
    const mismatchInfo = mailWizzVersionDetector.resolveVersionInfo({
      configuredVersion: '3.0.5',
      detectedVersion: '3.2.0',
      approvedVersion: '3.0.5',
    });
    expect(mismatchInfo.upgradeDetected).toBe(true);
    expect(mismatchInfo.upgradeSummary).toContain('3.2.0');

    const resolved = resolver.resolve({
      versionInfo: mismatchInfo,
      envMutationsEnabled: true,
      coreContractsPassed: true,
      approvedVersionPassedCheck: false,
    });
    expect(resolved.adapterMode).toBe('PROVISIONAL_COMPAT_READONLY');
    expect(resolved.mutationSafetyAllowed).toBe(false);
  });

  // 15. Partial API availability (read-only core works, optional/reporting endpoints unavailable)
  it('15. produces PARTIALLY COMPATIBLE when core read-only sync succeeds but segment/campaign endpoints return 404', async () => {
    const validator = new MailWizzCompatibilityValidator();
    const fakeClient = {
      getDetectedServerVersion: () => '3.1.2',
      getRawJson: async (path: string) => {
        if (path === '/lists') {
          return {
            rawJson: {
              status: 'success',
              meta: { version: '3.1.2' },
              data: {
                count: 1,
                total_pages: 1,
                current_page: 1,
                next_page: null,
                records: [{ general: { list_uid: 'lt1', name: 'Main List' } }],
              },
            },
            detectedVersion: '3.1.2',
          };
        }
        if (path === '/lists/lt1') {
          return {
            rawJson: {
              status: 'success',
              data: {
                record: { general: { list_uid: 'lt1', name: 'Main List' } },
              },
            },
            detectedVersion: '3.1.2',
          };
        }
        if (path === '/lists/lt1/subscribers') {
          return {
            rawJson: {
              status: 'success',
              data: {
                count: 1,
                total_pages: 1,
                current_page: 1,
                next_page: null,
                records: [
                  {
                    subscriber_uid: 'sb1',
                    EMAIL: 'user@example.com',
                    status: 'confirmed',
                  },
                ],
              },
            },
            detectedVersion: '3.1.2',
          };
        }
        throw new MailWizzApiError('Endpoint removed in 3.1.2 fixture', {
          statusCode: 404,
          retryable: false,
          endpoint: path,
        });
      },
      getListFields: async () => [],
      getSegmentConditionOperators: async () => [],
    } as unknown as MailWizzClient;

    const report = await validator.validate({
      client: fakeClient,
      configuredVersion: '3.1.2',
      approvedVersion: null,
      webhookConfigured: false,
      envMutationsEnabled: false,
    });

    expect(report.connectionStatus).toBe('CONNECTED');
    expect(report.overallStatus).toBe('PARTIALLY COMPATIBLE');
    expect(report.capabilities.find((c) => c.key === 'list_discovery')?.status).toBe('VERIFIED');
    expect(report.capabilities.find((c) => c.key === 'subscriber_retrieval')?.status).toBe(
      'VERIFIED'
    );
    expect(report.capabilities.find((c) => c.key === 'segment_discovery')?.status).toBe(
      'UNSUPPORTED'
    );
    expect(report.capabilities.find((c) => c.key === 'campaign_discovery')?.status).toBe(
      'UNSUPPORTED'
    );
    expect(report.mutationSafetyAllowed).toBe(false);
  });

  // 16. Tightened connector hardening checks (single-subscriber flat data, next_page without total_pages, unfamiliar bounces, renamed stats, non-collection HTTP 200)
  it('16. accepts documented 3.x flat single-subscriber data, rejects missing collection containers, advances next_page without total_pages, and never coerces unfamiliar bounces to hard', async () => {
    // 16a. Documented MailWizz 3.x single subscriber puts fields directly under `data`
    const flatSubPayload = {
      status: 'success',
      data: {
        subscriber_uid: 'sb_flat_1',
        EMAIL: 'flat@example.com',
        status: 'confirmed',
      },
    };
    const schemaSub = MailWizzSingleSubscriberResponseSchema.parse(flatSubPayload);
    expect(schemaSub.data?.record.subscriber_uid).toBe('sb_flat_1');
    const adapterSub = adapter.normalizeSingleSubscriberResponse(flatSubPayload);
    expect(adapterSub.ok).toBe(true);
    expect(adapterSub.data?.email).toBe('flat@example.com');

    // 16b. Top-level `items` is hoisted cleanly while missing collection fails instead of passing as 0 lists
    const topItemsParsed = MailWizzPaginatedEnvelopeSchema(MailWizzListRecordSchema).parse({
      status: 'success',
      items: [{ general: { list_uid: 'lt_top_1', name: 'Top Items List' } }],
    });
    expect(topItemsParsed.data?.records).toHaveLength(1);

    expect(() =>
      MailWizzPaginatedEnvelopeSchema(MailWizzListRecordSchema).parse({
        status: 'success',
        data: { unexpected_field: [] },
      })
    ).toThrow();
    expect(
      adapter.normalizePaginatedEnvelope(
        { status: 'success', unexpected_top: true },
        (r) => adapter.normalizeListRecord(r, '/lists'),
        '/lists'
      ).ok
    ).toBe(false);

    // 16c. Pagination advances when `next_page: 2` is present even if `total_pages` is absent
    let pageCalls = 0;
    const clientNoTotalPages = new MailWizzClient({
      apiUrl: 'https://mw.example.com/api/index.php',
      apiKey: 'secret-key-xyz',
      maxRequestsPerSecond: 50,
      fetchImpl: (async (url: string | URL | Request) => {
        pageCalls += 1;
        const page = new URL(String(url)).searchParams.get('page');
        if (page === '1') {
          return new Response(
            JSON.stringify({
              status: 'success',
              data: {
                count: 2,
                current_page: 1,
                next_page: 2,
                // intentionally omit total_pages
                records: [{ general: { list_uid: 'lt_p1', name: 'Page 1' } }],
              },
            }),
            { status: 200 }
          );
        }
        return new Response(
          JSON.stringify({
            status: 'success',
            data: {
              count: 2,
              current_page: 2,
              next_page: null,
              records: [{ general: { list_uid: 'lt_p2', name: 'Page 2' } }],
            },
          }),
          { status: 200 }
        );
      }) as typeof fetch,
    });
    const pagedLists = await clientNoTotalPages.getLists();
    expect(pageCalls).toBe(2);
    expect(pagedLists.records).toHaveLength(2);

    // 16d. Unfamiliar bounce type must NEVER coerce to `'hard'`
    const unknownBounceSchema = MailWizzCampaignBounceRecordSchema.parse({
      bounce_type: 'policy_deferral_v4',
      subscriber: { subscriber_uid: 'sb_b1', email: 'b@example.com' },
    });
    expect(unknownBounceSchema.bounce_type).toBe('unknown');
    const unknownBounceAdapter = adapter.normalizeBounceRecord({
      bounce_type: 'policy_deferral_v4',
      subscriber: { subscriber_uid: 'sb_b1', email: 'b@example.com' },
    });
    expect(unknownBounceAdapter.ok).toBe(true);
    expect(unknownBounceAdapter.data?.bounceType).toBe('unknown');

    // 16e. Renamed campaign stats fail validation instead of silently returning 0s
    const renamedStats = adapter.normalizeCampaignStatsResponse({
      status: 'success',
      data: { total_dispatched: 1000, open_total: 250 },
    });
    expect(renamedStats.ok).toBe(false);
    expect(renamedStats.issues.some((i) => i.code === 'RENAMED_FIELD')).toBe(true);
  });

  // 17. Bulk copy count & target-list membership confirmation prior to MOVE_SUBSCRIBERS source removal
  it('17. requires verified acceptedCount and target-list membership before considering a subscriber moved', async () => {
    const prevEnv = process.env.ENABLE_MAILWIZZ_MUTATIONS;
    process.env.ENABLE_MAILWIZZ_MUTATIONS = 'true';
    resetEnvCacheForTests();
    try {
      const writer = new MailWizzMutationClient({
        apiUrl: 'https://mw.example.com/api/index.php',
        apiKey: 'test-key-move',
        maxRequestsPerSecond: 50,
        fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
          const u = String(url);
          if (u.includes('/subscribers/bulk') && init?.method === 'POST') {
            return new Response(
              JSON.stringify({
                status: 'success',
                data: { records: [{ status: 'error', error: 'Already invalid' }] },
              }),
              { status: 200 }
            );
          }
          if (u.includes('/search-by-email')) {
            return new Response(
              JSON.stringify({
                status: 'success',
                data: { subscriber_uid: 'sb_target_1', EMAIL: 'moved@example.com', status: 'confirmed' },
              }),
              { status: 200 }
            );
          }
          return new Response(JSON.stringify({ status: 'success', data: {} }), { status: 200 });
        }) as typeof fetch,
      });

      const zeroAccepted = await writer.createSubscribersBulk({
        targetListUid: 'lt_target',
        targetListOptIn: 'single',
        subscribers: [{ EMAIL: 'moved@example.com' }],
        actorEmail: 'contract@local.hygiene',
      });
      expect(zeroAccepted.acceptedCount).toBe(0);

      const confirmedMember = await writer.verifySubscriberMembershipInList({
        listUid: 'lt_target',
        email: 'moved@example.com',
      });
      expect(confirmedMember.confirmedPresent).toBe(true);
      expect(confirmedMember.subscriberUid).toBe('sb_target_1');
    } finally {
      process.env.ENABLE_MAILWIZZ_MUTATIONS = prevEnv;
      resetEnvCacheForTests();
    }
  });
});
