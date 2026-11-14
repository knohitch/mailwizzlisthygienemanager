import { describe, expect, it } from 'vitest';
import {
  classifySubscriber,
  type HygieneRuleConfig,
} from '@/services/analysis/classifier';

const BASE_CONFIG: HygieneRuleConfig = {
  lookbackDays: 90,
  minDeliveredCampaigns: 5,
  countOpensAsEngaged: true,
  countClicksAsEngaged: true,
  countRepliesAsEngaged: true,
  countConversionsAsEngaged: true,
  excludedDomains: ['vipclient.com'],
  excludedSources: ['vip_manual'],
  excludeRecentSubscribersDays: 14,
};

const NOW = new Date('2026-11-14T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

function makeDeliveries(count: number) {
  return Array.from({ length: count }, (_, idx) => ({
    eventType: 'DELIVERED' as const,
    source: 'READONLY_REPORTING_DB' as const,
    occurredAt: daysAgo(10 + idx * 10),
    isHistorical: true,
    campaignId: `camp-${idx}`,
  }));
}

describe('Engagement Analysis Classifier', () => {
  it('marks subscriber as UNKNOWN when no verified delivery history exists', () => {
    const res = classifySubscriber(
      {
        email: 'api.only@example.com',
        status: 'CONFIRMED',
        source: 'import',
        dateAddedMailwizz: daysAgo(200),
        events: [],
        now: NOW,
      },
      BASE_CONFIG
    );
    expect(res.hygieneStatus).toBe('UNKNOWN');
    expect(res.historyCoverage).toBe('NONE');
  });

  it('marks subscriber as UNKNOWN when only live webhook events exist without delivery history', () => {
    const res = classifySubscriber(
      {
        email: 'webhook.only@example.com',
        status: 'CONFIRMED',
        source: 'import',
        dateAddedMailwizz: daysAgo(200),
        events: [
          {
            eventType: 'OPEN',
            source: 'WEBHOOK_LIVE',
            occurredAt: daysAgo(120), // outside 90d lookback
            isHistorical: false,
            campaignId: 'camp-1',
          },
        ],
        now: NOW,
      },
      BASE_CONFIG
    );
    expect(res.hygieneStatus).toBe('UNKNOWN');
    expect(res.historyCoverage).toBe('PARTIAL_EXPORTS_OR_WEBHOOKS');
  });

  it('marks subscriber as INSUFFICIENT_HISTORY when delivered campaigns < 5', () => {
    const res = classifySubscriber(
      {
        email: 'newish@example.com',
        status: 'CONFIRMED',
        source: 'import',
        dateAddedMailwizz: daysAgo(60),
        events: makeDeliveries(4),
        now: NOW,
      },
      BASE_CONFIG
    );
    expect(res.hygieneStatus).toBe('INSUFFICIENT_HISTORY');
    expect(res.deliveredCampaignsCount).toBe(4);
  });

  it('marks subscriber as INACTIVE_CANDIDATE when >= 5 delivered and zero engagement in lookback', () => {
    const res = classifySubscriber(
      {
        email: 'dormant@example.com',
        status: 'CONFIRMED',
        source: 'import',
        dateAddedMailwizz: daysAgo(200),
        events: [
          ...makeDeliveries(5),
          {
            eventType: 'OPEN',
            source: 'READONLY_REPORTING_DB',
            occurredAt: daysAgo(120),
            isHistorical: true,
            campaignId: 'camp-old',
          },
        ],
        now: NOW,
      },
      BASE_CONFIG
    );
    expect(res.hygieneStatus).toBe('INACTIVE_CANDIDATE');
    expect(res.deliveredCampaignsCount).toBe(5);
  });

  it('separates ENGAGED_STRONG from ENGAGED_OPEN_ONLY', () => {
    const openOnly = classifySubscriber(
      {
        email: 'opener@example.com',
        status: 'CONFIRMED',
        source: 'import',
        dateAddedMailwizz: daysAgo(200),
        events: [
          ...makeDeliveries(5),
          {
            eventType: 'OPEN',
            source: 'VERIFIED_EXPORT',
            occurredAt: daysAgo(5),
            isHistorical: true,
            campaignId: 'camp-0',
          },
        ],
        now: NOW,
      },
      BASE_CONFIG
    );
    expect(openOnly.hygieneStatus).toBe('ENGAGED_OPEN_ONLY');
    expect(openOnly.lastOpenAt).not.toBeNull();
    expect(openOnly.lastStrongEngagementAt).toBeNull();

    const clicker = classifySubscriber(
      {
        email: 'clicker@example.com',
        status: 'CONFIRMED',
        source: 'import',
        dateAddedMailwizz: daysAgo(200),
        events: [
          ...makeDeliveries(5),
          {
            eventType: 'CLICK',
            source: 'VERIFIED_EXPORT',
            occurredAt: daysAgo(5),
            isHistorical: true,
            campaignId: 'camp-0',
          },
        ],
        now: NOW,
      },
      BASE_CONFIG
    );
    expect(clicker.hygieneStatus).toBe('ENGAGED_STRONG');
    expect(clicker.lastStrongEngagementAt).not.toBeNull();
  });

  it('respects countOpensAsEngaged = false by ignoring opens', () => {
    const res = classifySubscriber(
      {
        email: 'opener@example.com',
        status: 'CONFIRMED',
        source: 'import',
        dateAddedMailwizz: daysAgo(200),
        events: [
          ...makeDeliveries(5),
          {
            eventType: 'OPEN',
            source: 'VERIFIED_EXPORT',
            occurredAt: daysAgo(5),
            isHistorical: true,
            campaignId: 'camp-0',
          },
        ],
        now: NOW,
      },
      { ...BASE_CONFIG, countOpensAsEngaged: false }
    );
    expect(res.hygieneStatus).toBe('INACTIVE_CANDIDATE');
  });

  it('enforces exclusion rules for VIP domains, sources, and recent signups', () => {
    const domainEx = classifySubscriber(
      {
        email: 'ceo@vipclient.com',
        status: 'CONFIRMED',
        source: 'import',
        dateAddedMailwizz: daysAgo(200),
        events: makeDeliveries(6),
        now: NOW,
      },
      BASE_CONFIG
    );
    expect(domainEx.hygieneStatus).toBe('EXCLUDED');
    expect(domainEx.isExcluded).toBe(true);

    const recentEx = classifySubscriber(
      {
        email: 'brandnew@example.com',
        status: 'CONFIRMED',
        source: 'api',
        dateAddedMailwizz: daysAgo(3),
        events: [],
        now: NOW,
      },
      BASE_CONFIG
    );
    expect(recentEx.hygieneStatus).toBe('EXCLUDED');
  });

  it('prioritizes hard bounces, complaints, unsubscribed, and unconfirmed statuses', () => {
    const bounced = classifySubscriber(
      {
        email: 'bounce@example.com',
        status: 'CONFIRMED',
        source: 'import',
        dateAddedMailwizz: daysAgo(200),
        events: [
          {
            eventType: 'HARD_BOUNCE',
            source: 'API_BOUNCE_LOG',
            occurredAt: daysAgo(2),
            isHistorical: true,
            campaignId: 'camp-1',
          },
        ],
        now: NOW,
      },
      BASE_CONFIG
    );
    expect(bounced.hygieneStatus).toBe('HARD_BOUNCED');

    const unsub = classifySubscriber(
      {
        email: 'unsub@example.com',
        status: 'UNSUBSCRIBED',
        source: 'import',
        dateAddedMailwizz: daysAgo(200),
        events: [],
        now: NOW,
      },
      BASE_CONFIG
    );
    expect(unsub.hygieneStatus).toBe('UNSUBSCRIBED');
  });
});
