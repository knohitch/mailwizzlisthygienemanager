import { describe, expect, it } from 'vitest';
import {
  classifySubscriber,
  type HygieneRuleConfig,
} from '@/services/analysis/classifier';

const NOW = new Date('2026-11-14T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

const BASE_CONFIG: HygieneRuleConfig = {
  lookbackDays: 90,
  coolingDays: 60,
  inactiveDays: 90,
  longTermInactiveDays: 180,
  minDeliveredCampaigns: 5,
  countOpensAsEngaged: true,
  countClicksAsEngaged: true,
  countRepliesAsEngaged: true,
  countConversionsAsEngaged: true,
  excludedDomains: ['vipclient.com'],
  excludedSources: ['vip_manual'],
  excludeRecentSubscribersDays: 14,
};

function makeDeliveries(count: number, startDaysAgo = 200) {
  return Array.from({ length: count }, (_, idx) => ({
    eventType: 'DELIVERED' as const,
    source: 'READONLY_REPORTING_DB' as const,
    occurredAt: daysAgo(Math.max(1, startDaysAgo - idx * 15)),
    isHistorical: true,
    campaignId: `camp-${idx + 1}`,
  }));
}

describe('Phase 2 Engagement Classification Engine & Date Boundaries', () => {
  it('enforces exact 29/30, 59/60, 89/90, 179/180, 181, and 365 day boundaries', () => {
    // With 30-day inactivity rule (cooling clamps to 30): 29d = ACTIVE, 30d = INACTIVE
    const cfg30: HygieneRuleConfig = { ...BASE_CONFIG, lookbackDays: 30, inactiveDays: 30 };
    const at29 = classifySubscriber(
      {
        email: 'd29@example.com',
        status: 'CONFIRMED',
        source: 'import',
        dateAddedMailwizz: daysAgo(250),
        events: [
          ...makeDeliveries(6),
          { eventType: 'CLICK', source: 'VERIFIED_EXPORT', occurredAt: daysAgo(29), isHistorical: true, campaignId: 'c1' },
        ],
        now: NOW,
      },
      cfg30
    );
    expect(at29.engagementStatus).toBe('ACTIVE');

    const at30 = classifySubscriber(
      {
        email: 'd30@example.com',
        status: 'CONFIRMED',
        source: 'import',
        dateAddedMailwizz: daysAgo(250),
        events: [
          ...makeDeliveries(6),
          { eventType: 'CLICK', source: 'VERIFIED_EXPORT', occurredAt: daysAgo(30), isHistorical: true, campaignId: 'c1' },
        ],
        now: NOW,
      },
      cfg30
    );
    expect(at30.engagementStatus).toBe('INACTIVE');

    // Default 60d cooling / 90d inactive / 180d long-term boundaries:
    const makeSubAtDays = (d: number) =>
      classifySubscriber(
        {
          email: `d${d}@example.com`,
          status: 'CONFIRMED',
          source: 'import',
          dateAddedMailwizz: daysAgo(400),
          events: [
            ...makeDeliveries(6, 380),
            { eventType: 'CLICK', source: 'VERIFIED_EXPORT', occurredAt: daysAgo(d), isHistorical: true, campaignId: 'c1' },
          ],
          now: NOW,
        },
        BASE_CONFIG
      );

    expect(makeSubAtDays(59).engagementStatus).toBe('ACTIVE');
    expect(makeSubAtDays(60).engagementStatus).toBe('COOLING');
    expect(makeSubAtDays(89).engagementStatus).toBe('COOLING');
    expect(makeSubAtDays(90).engagementStatus).toBe('INACTIVE');
    expect(makeSubAtDays(179).engagementStatus).toBe('INACTIVE');
    expect(makeSubAtDays(180).engagementStatus).toBe('LONG_TERM_INACTIVE');
    expect(makeSubAtDays(181).engagementStatus).toBe('LONG_TERM_INACTIVE');
    expect(makeSubAtDays(365).engagementStatus).toBe('LONG_TERM_INACTIVE');
  });

  it('supports 365-day window and custom date ranges cleanly', () => {
    const customConfig: HygieneRuleConfig = {
      ...BASE_CONFIG,
      customRangeStart: daysAgo(45),
      customRangeEnd: daysAgo(15),
    };

    const engagedInCustom = classifySubscriber(
      {
        email: 'custom.hit@example.com',
        status: 'CONFIRMED',
        source: 'import',
        dateAddedMailwizz: daysAgo(200),
        events: [
          ...makeDeliveries(5),
          { eventType: 'CLICK', source: 'VERIFIED_EXPORT', occurredAt: daysAgo(30), isHistorical: true, campaignId: 'c1' },
        ],
        now: NOW,
      },
      customConfig
    );
    expect(engagedInCustom.engagementStatus).toBe('ACTIVE');

    const missedCustom = classifySubscriber(
      {
        email: 'custom.miss@example.com',
        status: 'CONFIRMED',
        source: 'import',
        dateAddedMailwizz: daysAgo(200),
        events: [
          ...makeDeliveries(5),
          { eventType: 'CLICK', source: 'VERIFIED_EXPORT', occurredAt: daysAgo(100), isHistorical: true, campaignId: 'c1' },
        ],
        now: NOW,
      },
      customConfig
    );
    expect(missedCustom.engagementStatus).toBe('INACTIVE');

    // 365-day lookback keeps someone engaged at 300d active if cooling/inactive are 365
    const cfg365: HygieneRuleConfig = {
      ...BASE_CONFIG,
      lookbackDays: 365,
      inactiveDays: 365,
      coolingDays: 365,
      longTermInactiveDays: 365,
    };
    const at300 = classifySubscriber(
      {
        email: 'annual@example.com',
        status: 'CONFIRMED',
        source: 'import',
        dateAddedMailwizz: daysAgo(400),
        events: [
          ...makeDeliveries(6, 380),
          { eventType: 'REPLY', source: 'VERIFIED_EXPORT', occurredAt: daysAgo(300), isHistorical: true, campaignId: 'c1' },
        ],
        now: NOW,
      },
      cfg365
    );
    expect(at300.engagementStatus).toBe('ACTIVE');
    expect(at300.lastReplyAt).not.toBeNull();
  });

  it('handles NEVER_ENGAGED, CLICK_NO_OPEN, Apple MPP open-only, 0 delivered, and protections', () => {
    // 1. Never engaged (>= 5 deliveries, 0 engagement)
    const neverEngaged = classifySubscriber(
      {
        email: 'never@example.com',
        status: 'CONFIRMED',
        source: 'import',
        dateAddedMailwizz: daysAgo(220),
        events: makeDeliveries(12, 200),
        now: NOW,
      },
      BASE_CONFIG
    );
    expect(neverEngaged.engagementStatus).toBe('NEVER_ENGAGED');
    expect(neverEngaged.engagementReason).toContain('12 confirmed campaign deliveries');

    // 2. Click without open (image blocking)
    const clickNoOpen = classifySubscriber(
      {
        email: 'noimages@example.com',
        status: 'CONFIRMED',
        source: 'import',
        dateAddedMailwizz: daysAgo(200),
        events: [
          ...makeDeliveries(5),
          { eventType: 'CLICK', source: 'VERIFIED_EXPORT', occurredAt: daysAgo(12), isHistorical: true, campaignId: 'c1' },
        ],
        now: NOW,
      },
      BASE_CONFIG
    );
    expect(clickNoOpen.engagementStatus).toBe('ACTIVE');
    expect(clickNoOpen.descriptiveTags).toContain('CLICK_NO_OPEN');
    expect(clickNoOpen.engagementConfidence).toBe('HIGH');

    // 3. Open-only (Apple MPP caveat)
    const openOnly = classifySubscriber(
      {
        email: 'mpp@example.com',
        status: 'CONFIRMED',
        source: 'import',
        dateAddedMailwizz: daysAgo(200),
        events: [
          ...makeDeliveries(5),
          { eventType: 'OPEN', source: 'VERIFIED_EXPORT', occurredAt: daysAgo(5), isHistorical: true, campaignId: 'c1' },
        ],
        now: NOW,
      },
      BASE_CONFIG
    );
    expect(openOnly.engagementStatus).toBe('ACTIVE');
    expect(openOnly.descriptiveTags).toContain('OPEN_ONLY_MPP_CAVEAT');
    expect(openOnly.engagementConfidence).toBe('MEDIUM');

    // 4. 0 delivered campaigns -> INSUFFICIENT_DATA (never inactive!)
    const zeroDelivered = classifySubscriber(
      {
        email: 'nodelivery@example.com',
        status: 'CONFIRMED',
        source: 'import',
        dateAddedMailwizz: daysAgo(200),
        events: [],
        now: NOW,
      },
      BASE_CONFIG
    );
    expect(zeroDelivered.engagementStatus).toBe('INSUFFICIENT_DATA');
    expect(zeroDelivered.engagementConfidence).toBe('NONE');

    // 5. VIP & Paid Relationship & Recent Purchase -> EXCLUDED
    const vip = classifySubscriber(
      {
        email: 'vip@example.com',
        status: 'CONFIRMED',
        source: 'import',
        dateAddedMailwizz: daysAgo(300),
        isVip: true,
        events: makeDeliveries(10),
        now: NOW,
      },
      BASE_CONFIG
    );
    expect(vip.engagementStatus).toBe('EXCLUDED');
    expect(vip.descriptiveTags).toContain('VIP_PROTECTED');
  });
});
