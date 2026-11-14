import { describe, expect, it, vi } from 'vitest';
import {
  MailWizzApiError,
  MailWizzClient,
  normalizeMailWizzBaseUrl,
  ReadOnlyGuardError,
} from '@/services/mailwizz/client';
import { MailWizzCampaignStatsSchema } from '@/services/mailwizz/types';

describe('MailWizzClient', () => {
  it('enforces TLS unless allowInsecureHttp is explicitly enabled', () => {
    expect(() =>
      normalizeMailWizzBaseUrl('http://mailwizz.example.com/api/index.php', false)
    ).toThrow(/TLS is required/i);

    expect(
      normalizeMailWizzBaseUrl('https://mailwizz.example.com/api/index.php/', false)
    ).toBe('https://mailwizz.example.com/api/index.php');

    expect(
      normalizeMailWizzBaseUrl('http://127.0.0.1:4000/api/index.php', true)
    ).toBe('http://127.0.0.1:4000/api/index.php');
  });

  it('blocks trackOpening, trackUrl, trackUnsubscribe, and mutation paths at transport layer', async () => {
    const fetchMock = vi.fn();
    const client = new MailWizzClient({
      apiUrl: 'https://mw.example.com/api/index.php',
      apiKey: 'test-api-key-12345',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await expect(
      client.getJson('/campaigns/camp1/track-opening/sub1', MailWizzCampaignStatsSchema)
    ).rejects.toBeInstanceOf(ReadOnlyGuardError);

    await expect(
      client.getJson('/campaigns/camp1/track-url/sub1/hash1', MailWizzCampaignStatsSchema)
    ).rejects.toBeInstanceOf(ReadOnlyGuardError);

    await expect(
      client.getJson('/campaigns/camp1/track-unsubscribe/sub1', MailWizzCampaignStatsSchema)
    ).rejects.toBeInstanceOf(ReadOnlyGuardError);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends X-Api-Key header and paginates multi-page subscriber responses', async () => {
    const seenHeaders: Array<string | null> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      seenHeaders.push(headers.get('X-Api-Key'));
      const url = new URL(String(input));
      const page = Number(url.searchParams.get('page') ?? '1');

      if (page === 1) {
        return new Response(
          JSON.stringify({
            status: 'success',
            data: {
              count: '3',
              total_pages: 2,
              current_page: 1,
              next_page: 2,
              prev_page: null,
              records: [
                { subscriber_uid: 's1', EMAIL: 'a@example.com', status: 'confirmed' },
                { subscriber_uid: 's2', EMAIL: 'b@example.com', status: 'confirmed' },
              ],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({
          status: 'success',
          data: {
            count: '3',
            total_pages: 2,
            current_page: 2,
            next_page: null,
            prev_page: 1,
            records: [
              { subscriber_uid: 's3', EMAIL: 'c@example.com', status: 'unsubscribed' },
            ],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const client = new MailWizzClient({
      apiUrl: 'https://mw.example.com/api/index.php',
      apiKey: 'secret-key-xyz',
      maxRequestsPerSecond: 50,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const res = await client.getSubscribers('list-123', { perPage: 2 });
    expect(res.totalReportedCount).toBe(3);
    expect(res.records).toHaveLength(3);
    expect(seenHeaders).toEqual(['secret-key-xyz', 'secret-key-xyz']);
  });

  it('retries transient 429 and 503 responses and fails immediately on 401', async () => {
    let calls = 0;
    const retryMock = vi.fn(async () => {
      calls++;
      if (calls === 1) {
        return new Response(JSON.stringify({ status: 'error', error: 'Rate limit' }), {
          status: 429,
          headers: { 'Retry-After': '0' },
        });
      }
      if (calls === 2) {
        return new Response(JSON.stringify({ status: 'error', error: 'Maintenance' }), {
          status: 503,
        });
      }
      return new Response(
        JSON.stringify({
          status: 'success',
          data: { count: '0', total_pages: 1, current_page: 1, next_page: null, records: [] },
        }),
        { status: 200 }
      );
    });

    const client = new MailWizzClient({
      apiUrl: 'https://mw.example.com/api/index.php',
      apiKey: 'secret-key-xyz',
      maxRequestsPerSecond: 50,
      maxRetries: 3,
      fetchImpl: retryMock as unknown as typeof fetch,
    });

    const ok = await client.validateConnection();
    expect(ok.ok).toBe(true);
    expect(calls).toBe(3);

    const authFailMock = vi.fn(async () => {
      return new Response(JSON.stringify({ status: 'error', error: 'Invalid API key' }), {
        status: 401,
      });
    });

    const badClient = new MailWizzClient({
      apiUrl: 'https://mw.example.com/api/index.php',
      apiKey: 'wrong-key',
      maxRequestsPerSecond: 50,
      maxRetries: 3,
      fetchImpl: authFailMock as unknown as typeof fetch,
    });

    await expect(badClient.validateConnection()).rejects.toBeInstanceOf(MailWizzApiError);
    expect(authFailMock).toHaveBeenCalledTimes(1); // Non-retryable 401
  });
});
