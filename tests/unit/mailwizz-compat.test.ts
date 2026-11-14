import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildMailWizzAuthHeaders,
  coerceArrayFromPhpJson,
  coerceNumberFromMailWizz,
  detectMailWizzVersionFromResponse,
} from '@/services/mailwizz/compat';
import { MailWizzClient } from '@/services/mailwizz/client';
import {
  MailWizzCampaignBounceRecordSchema,
  MailWizzCampaignStatsSchema,
  MailWizzListRecordSchema,
  MailWizzPaginatedEnvelopeSchema,
  MailWizzSegmentDetailSchema,
  MailWizzSubscriberRecordSchema,
} from '@/services/mailwizz/types';
import { MailWizzMutationClient } from '@/services/mutations/mailwizz-writer';
import { resetEnvCacheForTests } from '@/lib/env';

describe('MailWizz Multi-Version Compatibility (1.x / 2.x / 3.x / Future)', () => {
  const originalMutations = process.env.ENABLE_MAILWIZZ_MUTATIONS;

  afterEach(() => {
    process.env.ENABLE_MAILWIZZ_MUTATIONS = originalMutations;
    resetEnvCacheForTests();
  });

  it('builds auth headers for 1.x public:private HMAC, 2.x/3.x X-Api-Key, and Bearer mode', () => {
    const legacy = buildMailWizzAuthHeaders({
      apiKey: 'pubKey123:privSecret456',
      authMode: 'auto',
      method: 'GET',
      requestUrl: 'https://mw.example.com/api/lists?page=1',
      timestamp: '1700000000',
      remoteAddr: '127.0.0.1',
    });
    expect(legacy['X-MW-PUBLIC-KEY']).toBe('pubKey123');
    expect(legacy['X-MW-TIMESTAMP']).toBe('1700000000');
    expect(legacy['X-MW-SIGNATURE']).toMatch(/^[a-f0-9]{40}$/);
    expect(legacy['X-Api-Key']).toBe('pubKey123');

    const modern = buildMailWizzAuthHeaders({
      apiKey: 'singleApiKey3x',
      authMode: 'auto',
      method: 'GET',
      requestUrl: 'https://mw.example.com/api/lists',
    });
    expect(modern).toEqual({ 'X-Api-Key': 'singleApiKey3x' });

    const bearer = buildMailWizzAuthHeaders({
      apiKey: 'tokenFuture4x',
      authMode: 'bearer',
      method: 'GET',
      requestUrl: 'https://mw.example.com/api/lists',
    });
    expect(bearer).toEqual({ Authorization: 'Bearer tokenFuture4x' });
  });

  it('coerces PHP object-encoded arrays, formatted counts/percentages, and future REST envelopes', () => {
    expect(coerceArrayFromPhpJson({ '0': { a: 1 }, '2': { b: 2 } })).toEqual([
      { a: 1 },
      { b: 2 },
    ]);
    expect(coerceArrayFromPhpJson(null)).toEqual([]);
    expect(coerceNumberFromMailWizz('1,842')).toBe(1842);
    expect(coerceNumberFromMailWizz('24.75%')).toBe(24.75);

    // Segment detail with PHP associative object maps instead of arrays
    const seg = MailWizzSegmentDetailSchema.parse({
      status: 'success',
      data: {
        record: {
          segment_uid: 'seg-1',
          name: 'PHP Object Conditions',
          conditions: { '1': { field_id: '1', value: 'x' } },
          campaign_conditions: null,
        },
      },
    });
    expect(seg.data?.record.conditions).toHaveLength(1);
    expect(seg.data?.record.campaign_conditions).toEqual([]);

    // Future envelope using `success: true`, `data.items`, `meta.pagination`, and flat list fields
    const listEnv = MailWizzPaginatedEnvelopeSchema(MailWizzListRecordSchema).parse({
      success: true,
      meta: { version: '4.1.0', pagination: { total: 1, total_pages: 1, current_page: 1 } },
      data: {
        items: [{ uid: 'lst_future_1', name: 'Future List', opt_in: 'single' }],
      },
    });
    expect(listEnv.status).toBe('success');
    expect(listEnv.data?.count).toBe(1);
    expect(listEnv.data?.records[0]?.general.list_uid).toBe('lst_future_1');

    // Subscriber & Bounce field alias tolerance
    const sub = MailWizzSubscriberRecordSchema.parse({
      uid: 'sub_future_1',
      email: 'alice@example.com',
      first_name: 'Alice',
      last_name: 'Ng',
      status: 'confirmed',
    });
    expect(sub.subscriber_uid).toBe('sub_future_1');
    expect(sub.EMAIL).toBe('alice@example.com');
    expect(sub.FNAME).toBe('Alice');

    const bounce = MailWizzCampaignBounceRecordSchema.parse({
      type: 'transient_soft',
      subscriber_uid: 'sub_future_1',
      email: 'alice@example.com',
    });
    expect(bounce.bounce_type).toBe('soft');
    expect(bounce.subscriber.subscriber_uid).toBe('sub_future_1');

    const stats = MailWizzCampaignStatsSchema.parse({
      data: {
        processed_count: '1,800',
        delivery_success_count: '1,750',
        opens_rate: '22.5%',
      },
    });
    expect(stats.data?.processed_count).toBe(1800);
    expect(stats.data?.opens_rate).toBe(22.5);
  });

  it('detects server version, steps down per_page on 400, and advances pages without next_page', async () => {
    const seenPerPages: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const perPage = url.searchParams.get('per_page') ?? '';
      const page = Number(url.searchParams.get('page') ?? '1');
      seenPerPages.push(`${page}:${perPage}`);

      if (perPage === '100') {
        return new Response(JSON.stringify({ status: 'error', error: 'per_page max 50' }), {
          status: 400,
        });
      }

      if (page === 1) {
        return new Response(
          JSON.stringify({
            status: 'success',
            data: {
              count: 2,
              total_pages: 2,
              current_page: 1,
              // intentionally omit next_page to test current_page < total_pages advance
              records: [{ general: { list_uid: 'l1', name: 'List 1' } }],
            },
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'X-MailWizz-Version': '3.4.2',
            },
          }
        );
      }

      return new Response(
        JSON.stringify({
          status: 'success',
          data: {
            count: 2,
            total_pages: 2,
            current_page: 2,
            records: [{ general: { list_uid: 'l2', name: 'List 2' } }],
          },
        }),
        { status: 200 }
      );
    });

    const client = new MailWizzClient({
      apiUrl: 'https://mw.example.com/api/index.php',
      apiKey: 'test-key-xyz',
      maxRequestsPerSecond: 50,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const lists = await client.getLists(100);
    expect(lists.records).toHaveLength(2);
    expect(seenPerPages).toEqual(['1:100', '1:50', '2:50']);
    expect(client.getDetectedServerVersion()).toBe('3.4.2');

    expect(
      detectMailWizzVersionFromResponse(new Headers({ 'x-mw-version': '2.1.8' }), {})
    ).toBe('2.1.8');
  });

  it('gracefully probes optional future campaign activity endpoints (404 vs 200)', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/opens')) {
        return new Response(
          JSON.stringify({
            status: 'success',
            data: {
              count: 1,
              total_pages: 1,
              current_page: 1,
              records: [
                {
                  subscriber_uid: 'sub-1',
                  date_added: '2026-11-10T10:00:00Z',
                },
              ],
            },
          }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ status: 'error', error: 'Not found' }), {
        status: 404,
      });
    });

    const client = new MailWizzClient({
      apiUrl: 'https://mw.example.com/api/index.php',
      apiKey: 'test-key-xyz',
      maxRequestsPerSecond: 50,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const opensProbe = await client.tryReadOnlyCampaignActivityEndpoint('c1', 'opens');
    expect(opensProbe.supported).toBe(true);
    expect(opensProbe.records).toHaveLength(1);

    const clicksProbe = await client.tryReadOnlyCampaignActivityEndpoint('c1', 'clicks');
    expect(clicksProbe.supported).toBe(false);
    expect(clicksProbe.records).toEqual([]);
  });

  it('falls back to PUT subscriber status update when /unsubscribe endpoint returns 404', async () => {
    process.env.ENABLE_MAILWIZZ_MUTATIONS = 'true';
    resetEnvCacheForTests();

    const calls: Array<{ method: string; path: string; body: string }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? init.body : '';
      calls.push({ method, path, body });

      if (path.endsWith('/unsubscribe')) {
        return new Response(JSON.stringify({ status: 'error', error: 'Not found' }), {
          status: 404,
        });
      }
      return new Response(JSON.stringify({ status: 'success' }), { status: 200 });
    });

    const writer = new MailWizzMutationClient({
      apiUrl: 'https://mw.example.com/api/index.php',
      apiKey: 'pub123:priv456',
      authMode: 'legacy-hmac',
      maxRequestsPerSecond: 20,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const res = await writer.unsubscribeSubscriber({
      listUid: 'listA',
      subscriberUid: 'subA',
      actorEmail: 'admin@example.com',
    });

    expect(res.ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[0].path).toContain('/subscribers/subA/unsubscribe');
    expect(calls[1].path).toContain('/subscribers/subA');
    expect(calls[1].body).toContain('status=unsubscribed');
  });
});
