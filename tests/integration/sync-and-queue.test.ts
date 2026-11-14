import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { encryptSecret } from '@/services/security/crypto';
import { runMailWizzSync } from '@/services/mailwizz/sync';
import { importVerifiedCampaignReport } from '@/services/mailwizz/report-import';
import { recomputeAllHygieneClassifications } from '@/services/analysis/classifier';
import {
  claimNextJob,
  completeJob,
  enqueueJob,
  failOrRetryJob,
} from '@/services/jobs/queue';
import { seedSyntheticDemoData } from '@/services/demo/seed-demo';

describe('Integration: Mock MailWizz 3.0.5 Sync, Report Import & Durable Job Queue', () => {
  let server: http.Server;
  let mockBaseUrl = '';
  const observedRequests: Array<{ method: string; url: string; apiKey: string | undefined }> =
    [];

  beforeAll(async () => {
    process.env.ALLOW_INSECURE_MAILWIZZ_HTTP = 'true';

    server = http.createServer((req, res) => {
      observedRequests.push({
        method: req.method ?? 'GET',
        url: req.url ?? '/',
        apiKey: req.headers['x-api-key'] as string | undefined,
      });

      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      res.setHeader('Content-Type', 'application/json');

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
                    list_uid: 'mw-int-list-1',
                    name: 'Integration Test List',
                    display_name: 'Integration Test List',
                    description: 'Mocked 3.0.5 list',
                  },
                },
              ],
            },
          })
        );
        return;
      }

      if (url.pathname === '/api/index.php/lists/mw-int-list-1/subscribers') {
        const page = Number(url.searchParams.get('page') ?? '1');
        if (page === 1) {
          res.end(
            JSON.stringify({
              status: 'success',
              data: {
                count: '3',
                total_pages: 2,
                current_page: 1,
                next_page: 2,
                records: [
                  {
                    subscriber_uid: 'sub-int-1',
                    EMAIL: 'engaged.int@example.com',
                    FNAME: 'Engaged',
                    LNAME: 'User',
                    status: 'confirmed',
                    source: 'import',
                    date_added: '2025-01-01 00:00:00',
                  },
                  {
                    subscriber_uid: 'sub-int-2',
                    EMAIL: 'bounced.int@example.com',
                    FNAME: 'Bounced',
                    LNAME: 'User',
                    status: 'confirmed',
                    source: 'import',
                    date_added: '2025-01-01 00:00:00',
                  },
                ],
              },
            })
          );
          return;
        }
        res.end(
          JSON.stringify({
            status: 'success',
            data: {
              count: '3',
              total_pages: 2,
              current_page: 2,
              next_page: null,
              records: [
                {
                  subscriber_uid: 'sub-int-3',
                  EMAIL: 'unsub.int@example.com',
                  FNAME: 'Unsub',
                  LNAME: 'User',
                  status: 'unsubscribed',
                  source: 'api',
                  date_added: '2025-01-01 00:00:00',
                },
              ],
            },
          })
        );
        return;
      }

      if (url.pathname === '/api/index.php/lists/mw-int-list-1/segments') {
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
                  segment_uid: 'seg-int-1',
                  name: 'Confirmed Only',
                  subscribers_count: 2,
                },
              ],
            },
          })
        );
        return;
      }

      if (url.pathname === '/api/index.php/lists/mw-int-list-1/segments/seg-int-1') {
        res.end(
          JSON.stringify({
            status: 'success',
            data: {
              record: {
                segment_uid: 'seg-int-1',
                segment_id: '1',
                name: 'Confirmed Only',
                operator_match: 'all',
                subscribers_count: 2,
                conditions: [],
                campaign_conditions: [],
              },
            },
          })
        );
        return;
      }

      if (
        url.pathname ===
        '/api/index.php/lists/mw-int-list-1/segments/seg-int-1/subscribers'
      ) {
        res.end(
          JSON.stringify({
            status: 'success',
            data: {
              count: '2',
              total_pages: 1,
              current_page: 1,
              next_page: null,
              records: [
                {
                  subscriber_uid: 'sub-int-1',
                  EMAIL: 'engaged.int@example.com',
                  status: 'confirmed',
                },
                {
                  subscriber_uid: 'sub-int-2',
                  EMAIL: 'bounced.int@example.com',
                  status: 'confirmed',
                },
              ],
            },
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
                  campaign_uid: 'camp-int-1',
                  campaign_id: '101',
                  name: 'Integration Campaign #1',
                  status: 'sent',
                },
              ],
            },
          })
        );
        return;
      }

      if (url.pathname === '/api/index.php/campaigns/camp-int-1') {
        res.end(
          JSON.stringify({
            status: 'success',
            data: {
              record: {
                campaign_uid: 'camp-int-1',
                campaign_id: '101',
                name: 'Integration Campaign #1',
                type: 'regular',
                subject: 'Test Subject',
                status: 'sent',
                send_at: '2026-11-01 10:00:00',
                list: {
                  list_uid: 'mw-int-list-1',
                  name: 'Integration Test List',
                  subscribers_count: 3,
                },
              },
            },
          })
        );
        return;
      }

      if (url.pathname === '/api/index.php/campaigns/camp-int-1/stats') {
        res.end(
          JSON.stringify({
            status: 'success',
            data: {
              campaign_status: 'sent',
              subscribers_count: 3,
              processed_count: 3,
              delivery_success_count: 2,
              delivery_success_rate: 66.67,
              delivery_error_count: 1,
              delivery_error_rate: 33.33,
              opens_count: 1,
              opens_rate: 50,
              unique_opens_count: 1,
              unique_opens_rate: 50,
              clicks_count: 1,
              clicks_rate: 50,
              unique_clicks_count: 1,
              unique_clicks_rate: 50,
              unsubscribes_count: 0,
              unsubscribes_rate: 0,
              complaints_count: 0,
              complaints_rate: 0,
              bounces_count: 1,
              bounces_rate: 33.33,
              hard_bounces_count: 1,
              hard_bounces_rate: 33.33,
              soft_bounces_count: 0,
              soft_bounces_rate: 0,
              internal_bounces_count: 0,
              internal_bounces_rate: 0,
            },
          })
        );
        return;
      }

      if (url.pathname === '/api/index.php/campaigns/camp-int-1/bounces') {
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
                  message: '550 5.1.1 User unknown',
                  processed: 'yes',
                  bounce_type: 'hard',
                  subscriber: {
                    subscriber_uid: 'sub-int-2',
                    email: 'bounced.int@example.com',
                  },
                },
              ],
            },
          })
        );
        return;
      }

      res.statusCode = 404;
      res.end(JSON.stringify({ status: 'error', error: 'Not found' }));
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          mockBaseUrl = `http://127.0.0.1:${addr.port}/api/index.php`;
        }
        resolve();
      });
    });

    await prisma.appConfig.upsert({
      where: { id: 'default' },
      update: {
        mailwizzApiUrl: mockBaseUrl,
        mailwizzApiKeyEnc: encryptSecret('integration-test-key'),
        mailwizzApiKeyLast4: '••••-key',
        maxApiRequestsPerSecond: 50,
        batchSize: 50,
      },
      create: {
        id: 'default',
        mailwizzApiUrl: mockBaseUrl,
        mailwizzApiKeyEnc: encryptSecret('integration-test-key'),
        mailwizzApiKeyLast4: '••••-key',
        maxApiRequestsPerSecond: 50,
        batchSize: 50,
      },
    });
  });

  afterAll(async () => {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    // Clean up test records & restore demo seed + clear temporary MailWizz URL
    await prisma.engagementEvent.deleteMany({
      where: { mailingList: { listUid: 'mw-int-list-1' } },
    });
    await prisma.subscriber.deleteMany({
      where: { mailingList: { listUid: 'mw-int-list-1' } },
    });
    await prisma.campaign.deleteMany({ where: { campaignUid: 'camp-int-1' } });
    await prisma.mailingList.deleteMany({ where: { listUid: 'mw-int-list-1' } });
    await prisma.syncJob.deleteMany({
      where: { payloadJson: { path: ['integrationTest'], equals: true } },
    });
    await prisma.appConfig.update({
      where: { id: 'default' },
      data: {
        mailwizzApiUrl: null,
        mailwizzApiKeyEnc: null,
        mailwizzApiKeyLast4: null,
      },
    });
    await seedSyntheticDemoData();
  });

  it('syncs lists, paginated subscribers, segments, campaigns, and bounces read-only without calling tracking endpoints', async () => {
    const result = await runMailWizzSync({ onlyListUid: 'mw-int-list-1' });
    expect(result.listsSynced).toBe(1);
    expect(result.subscribersSynced).toBe(3);
    expect(result.segmentsSynced).toBe(1);
    expect(result.campaignsSynced).toBe(1);
    expect(result.bounceEventsRecorded).toBe(1);

    // Assert every single HTTP call was strictly GET and never hit track-opening / track-url
    expect(observedRequests.length).toBeGreaterThan(0);
    for (const r of observedRequests) {
      expect(r.method).toBe('GET');
      expect(r.apiKey).toBe('integration-test-key');
      expect(r.url).not.toContain('track-opening');
      expect(r.url).not.toContain('track-url');
      expect(r.url).not.toContain('unsubscribe');
    }

    const list = await prisma.mailingList.findUnique({
      where: { listUid: 'mw-int-list-1' },
    });
    expect(list?.reconciliationStatus).toBe('MATCHED');
    expect(list?.syncedSubscriberCount).toBe(3);

    const sub1 = await prisma.subscriber.findFirst({
      where: { subscriberUid: 'sub-int-1' },
    });
    const sub2 = await prisma.subscriber.findFirst({
      where: { subscriberUid: 'sub-int-2' },
    });
    const sub3 = await prisma.subscriber.findFirst({
      where: { subscriberUid: 'sub-int-3' },
    });

    // API-only confirmed subscriber MUST be UNKNOWN (not falsely inactive!)
    expect(sub1?.hygieneStatus).toBe('UNKNOWN');
    expect(sub2?.hygieneStatus).toBe('HARD_BOUNCED');
    expect(sub3?.hygieneStatus).toBe('UNSUBSCRIBED');

    // Now import a verified CSV report (Priority B) for sub-int-1
    const importRes = await importVerifiedCampaignReport({
      format: 'csv',
      content: [
        'email,campaign_uid,event_type,occurred_at',
        'engaged.int@example.com,camp-int-1,DELIVERED,2026-11-01T10:00:00Z',
        'engaged.int@example.com,camp-int-1,CLICK,2026-11-01T10:15:00Z',
      ].join('\n'),
      mailingListId: list?.id,
    });
    expect(importRes.importedCount).toBe(2);

    await recomputeAllHygieneClassifications(list?.id);
    const updatedSub1 = await prisma.subscriber.findFirst({
      where: { subscriberUid: 'sub-int-1' },
    });
    expect(updatedSub1?.hygieneStatus).toBe('ENGAGED_STRONG');
  });

  it('enqueues, claims, retries on failure, and completes durable PostgreSQL SyncJobs', async () => {
    const job = await enqueueJob({
      type: 'ANALYZE_HYGIENE',
      payload: { integrationTest: true },
      maxAttempts: 2,
    });

    const claimed = await claimNextJob('test-worker-1');
    expect(claimed?.id).toBe(job.id);
    expect(claimed?.status).toBe('RUNNING');
    expect(claimed?.attempts).toBe(1);

    await failOrRetryJob(claimed!, new Error('Simulated transient failure'));
    const retried = await prisma.syncJob.findUnique({ where: { id: job.id } });
    expect(retried?.status).toBe('PENDING');

    // Make immediately eligible for second attempt
    await prisma.syncJob.update({
      where: { id: job.id },
      data: { runAt: new Date(Date.now() - 1000) },
    });

    const claimed2 = await claimNextJob('test-worker-1');
    expect(claimed2?.id).toBe(job.id);
    expect(claimed2?.attempts).toBe(2);

    await completeJob(job.id, { updatedSubscribers: 3 });
    const done = await prisma.syncJob.findUnique({ where: { id: job.id } });
    expect(done?.status).toBe('COMPLETED');
  });
});
