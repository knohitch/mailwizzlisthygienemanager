import { prisma } from '@/lib/db';
import type {
  EngagementClass,
  EngagementConfidence,
  EngagementEvent,
  HistoryCoverage,
  HygieneStatus,
  SubscriberStatus,
} from '@prisma/client';

const MS_PER_DAY = 86_400_000;

export interface HygieneRuleConfig {
  lookbackDays: number;
  coolingDays?: number;
  inactiveDays?: number;
  longTermInactiveDays?: number;
  customRangeStart?: Date | null;
  customRangeEnd?: Date | null;
  minDeliveredCampaigns: number;
  countOpensAsEngaged: boolean;
  countClicksAsEngaged: boolean;
  countRepliesAsEngaged: boolean;
  countConversionsAsEngaged: boolean;
  excludedDomains: string[];
  excludedSources: string[];
  excludeRecentSubscribersDays: number;
}

export interface SubscriberClassificationInput {
  email: string;
  status: SubscriberStatus;
  source: string | null;
  dateAddedMailwizz: Date | null;
  isVip?: boolean;
  hasPaidRelationship?: boolean;
  lastPurchaseAt?: Date | null;
  isSuppressed?: boolean;
  isArchived?: boolean;
  events: Array<
    Pick<
      EngagementEvent,
      'eventType' | 'source' | 'occurredAt' | 'isHistorical' | 'campaignId'
    >
  >;
  now?: Date;
}

export interface SubscriberClassificationOutput {
  isExcluded: boolean;
  exclusionReason: string | null;
  hygieneStatus: HygieneStatus;
  hygieneReason: string;
  engagementStatus: EngagementClass;
  engagementReason: string;
  descriptiveTags: string[];
  engagementConfidence: EngagementConfidence;
  historyCoverage: HistoryCoverage;
  deliveredCampaignsCount: number;
  opensCount: number;
  clicksCount: number;
  repliesCount: number;
  conversionsCount: number;
  hardBouncesCount: number;
  softBouncesCount: number;
  complaintsCount: number;
  lastDeliveredAt: Date | null;
  lastOpenAt: Date | null;
  lastClickAt: Date | null;
  lastReplyAt: Date | null;
  lastConversionAt: Date | null;
  lastStrongEngagementAt: Date | null;
  lastBounceAt: Date | null;
}

function maxDate(a: Date | null, b: Date): Date {
  return a === null || b.getTime() > a.getTime() ? b : a;
}

function minDate(a: Date | null, b: Date): Date {
  return a === null || b.getTime() < a.getTime() ? b : a;
}

function daysBetween(earlier: Date, later: Date): number {
  return Math.max(0, Math.floor((later.getTime() - earlier.getTime()) / MS_PER_DAY));
}

interface AggregateMetrics {
  historyCoverage: HistoryCoverage;
  deliveredCampaignsCount: number;
  opensCount: number;
  clicksCount: number;
  repliesCount: number;
  conversionsCount: number;
  hardBouncesCount: number;
  softBouncesCount: number;
  complaintsCount: number;
  firstDeliveredAt: Date | null;
  lastDeliveredAt: Date | null;
  lastOpenAt: Date | null;
  lastClickAt: Date | null;
  lastReplyAt: Date | null;
  lastConversionAt: Date | null;
  lastStrongEngagementAt: Date | null;
  lastBounceAt: Date | null;
  lastMeaningfulEngagementAt: Date | null;
  lastMeaningfulInCustomRangeAt: Date | null;
  totalMeaningfulCount: number;
}

function aggregateSubscriberEvents(
  events: SubscriberClassificationInput['events'],
  config: HygieneRuleConfig,
  customStart: Date | null,
  customEnd: Date | null
): AggregateMetrics {
  let deliveredCount = 0;
  const deliveredCampaignIds = new Set<string>();
  let opensCount = 0;
  let clicksCount = 0;
  let repliesCount = 0;
  let conversionsCount = 0;
  let hardBouncesCount = 0;
  let softBouncesCount = 0;
  let complaintsCount = 0;

  let firstDeliveredAt: Date | null = null;
  let lastDeliveredAt: Date | null = null;
  let lastOpenAt: Date | null = null;
  let lastClickAt: Date | null = null;
  let lastReplyAt: Date | null = null;
  let lastConversionAt: Date | null = null;
  let lastStrongEngagementAt: Date | null = null;
  let lastBounceAt: Date | null = null;
  let lastMeaningfulEngagementAt: Date | null = null;
  let lastMeaningfulInCustomRangeAt: Date | null = null;
  let totalMeaningfulCount = 0;

  let hasHistoricalDeliverySource = false;
  let hasAnyEngagementOrWebhookSource = false;
  let hasBounceOnlySource = false;

  for (const ev of events) {
    if (ev.source === 'API_BOUNCE_LOG') {
      hasBounceOnlySource = true;
    } else if (
      ev.source === 'VERIFIED_EXPORT' ||
      ev.source === 'READONLY_REPORTING_DB' ||
      ev.source === 'API_ACTIVITY_LOG' ||
      ev.source === 'SYNTHETIC_DEMO'
    ) {
      if (ev.eventType === 'DELIVERED') {
        hasHistoricalDeliverySource = true;
      }
      hasAnyEngagementOrWebhookSource = true;
    } else if (ev.source === 'WEBHOOK_LIVE' || ev.source === 'NATIVE_SEGMENT') {
      hasAnyEngagementOrWebhookSource = true;
    }

    let isCountedEngagement = false;
    switch (ev.eventType) {
      case 'DELIVERED':
        deliveredCount++;
        if (ev.campaignId) deliveredCampaignIds.add(ev.campaignId);
        firstDeliveredAt = minDate(firstDeliveredAt, ev.occurredAt);
        lastDeliveredAt = maxDate(lastDeliveredAt, ev.occurredAt);
        break;
      case 'OPEN':
        opensCount++;
        lastOpenAt = maxDate(lastOpenAt, ev.occurredAt);
        if (config.countOpensAsEngaged) isCountedEngagement = true;
        break;
      case 'CLICK':
        clicksCount++;
        lastClickAt = maxDate(lastClickAt, ev.occurredAt);
        lastStrongEngagementAt = maxDate(lastStrongEngagementAt, ev.occurredAt);
        if (config.countClicksAsEngaged) isCountedEngagement = true;
        break;
      case 'REPLY':
        repliesCount++;
        lastReplyAt = maxDate(lastReplyAt, ev.occurredAt);
        lastStrongEngagementAt = maxDate(lastStrongEngagementAt, ev.occurredAt);
        if (config.countRepliesAsEngaged) isCountedEngagement = true;
        break;
      case 'CONVERSION':
        conversionsCount++;
        lastConversionAt = maxDate(lastConversionAt, ev.occurredAt);
        lastStrongEngagementAt = maxDate(lastStrongEngagementAt, ev.occurredAt);
        if (config.countConversionsAsEngaged) isCountedEngagement = true;
        break;
      case 'HARD_BOUNCE':
        hardBouncesCount++;
        lastBounceAt = maxDate(lastBounceAt, ev.occurredAt);
        break;
      case 'SOFT_BOUNCE':
        softBouncesCount++;
        lastBounceAt = maxDate(lastBounceAt, ev.occurredAt);
        break;
      case 'COMPLAINT':
        complaintsCount++;
        break;
      default:
        break;
    }

    if (isCountedEngagement) {
      totalMeaningfulCount++;
      lastMeaningfulEngagementAt = maxDate(lastMeaningfulEngagementAt, ev.occurredAt);
      if (customStart) {
        const endBound = customEnd ?? new Date();
        if (
          ev.occurredAt.getTime() >= customStart.getTime() &&
          ev.occurredAt.getTime() <= endBound.getTime()
        ) {
          lastMeaningfulInCustomRangeAt = maxDate(
            lastMeaningfulInCustomRangeAt,
            ev.occurredAt
          );
        }
      }
    }
  }

  const deliveredCampaignsCount =
    deliveredCampaignIds.size > 0 ? deliveredCampaignIds.size : deliveredCount;

  const historyCoverage: HistoryCoverage = hasHistoricalDeliverySource
    ? 'VERIFIED_FULL'
    : hasAnyEngagementOrWebhookSource
      ? 'PARTIAL_EXPORTS_OR_WEBHOOKS'
      : hasBounceOnlySource
        ? 'BOUNCE_ONLY'
        : 'NONE';

  return {
    historyCoverage,
    deliveredCampaignsCount,
    opensCount,
    clicksCount,
    repliesCount,
    conversionsCount,
    hardBouncesCount,
    softBouncesCount,
    complaintsCount,
    firstDeliveredAt,
    lastDeliveredAt,
    lastOpenAt,
    lastClickAt,
    lastReplyAt,
    lastConversionAt,
    lastStrongEngagementAt,
    lastBounceAt,
    lastMeaningfulEngagementAt,
    lastMeaningfulInCustomRangeAt,
    totalMeaningfulCount,
  };
}

function buildDescriptiveTags(
  sub: SubscriberClassificationInput,
  m: AggregateMetrics,
  extraTags: string[]
): string[] {
  const tags = new Set<string>(extraTags);
  if (m.clicksCount > 0 && m.opensCount === 0) {
    tags.add('CLICK_NO_OPEN');
  }
  if (sub.isSuppressed) tags.add('SUPPRESSED');
  if (sub.isArchived) tags.add('ARCHIVED');
  if (sub.isVip) tags.add('VIP_PROTECTED');
  if (sub.hasPaidRelationship) tags.add('PAID_RELATIONSHIP');
  if (m.softBouncesCount > 0) tags.add('SOFT_BOUNCE_RECORDED');
  if (m.conversionsCount > 0) tags.add('HAS_CONVERSION');
  if (m.repliesCount > 0) tags.add('HAS_REPLY');
  return Array.from(tags);
}

function computeConfidence(
  historyCoverage: HistoryCoverage,
  m: AggregateMetrics,
  hasStrongRecentOrLifetime: boolean
): EngagementConfidence {
  if (historyCoverage === 'VERIFIED_FULL') {
    if (hasStrongRecentOrLifetime || m.deliveredCampaignsCount >= 5) {
      return m.opensCount > 0 &&
        m.clicksCount === 0 &&
        m.repliesCount === 0 &&
        m.conversionsCount === 0
        ? 'MEDIUM'
        : 'HIGH';
    }
    return 'LOW';
  }
  if (historyCoverage === 'PARTIAL_EXPORTS_OR_WEBHOOKS') {
    return hasStrongRecentOrLifetime ? 'MEDIUM' : 'LOW';
  }
  if (historyCoverage === 'BOUNCE_ONLY') return 'LOW';
  return 'NONE';
}

export function classifySubscriber(
  sub: SubscriberClassificationInput,
  config: HygieneRuleConfig
): SubscriberClassificationOutput {
  const now = sub.now ?? new Date();
  const inactiveDays = Math.max(1, config.inactiveDays ?? config.lookbackDays);
  const longTermDays = Math.max(inactiveDays, config.longTermInactiveDays ?? 180);
  const requestedCooling = config.coolingDays ?? 60;
  // Cooling window applies only when strictly below the configured inactivity threshold
  const coolingDays =
    requestedCooling < inactiveDays ? requestedCooling : inactiveDays;

  const customStart = config.customRangeStart ?? null;
  const customEnd = config.customRangeEnd ?? now;

  const m = aggregateSubscriberEvents(sub.events, config, customStart, customEnd);

  const deliverySpanDays =
    m.firstDeliveredAt !== null ? daysBetween(m.firstDeliveredAt, now) : 0;
  const hasStrongEngagement =
    m.clicksCount > 0 || m.repliesCount > 0 || m.conversionsCount > 0;
  const confidence = computeConfidence(m.historyCoverage, m, hasStrongEngagement);

  const makeOutput = (params: {
    isExcluded: boolean;
    exclusionReason: string | null;
    hygieneStatus: HygieneStatus;
    hygieneReason: string;
    engagementStatus: EngagementClass;
    engagementReason: string;
    extraTags?: string[];
    confidenceOverride?: EngagementConfidence;
  }): SubscriberClassificationOutput => ({
    isExcluded: params.isExcluded,
    exclusionReason: params.exclusionReason,
    hygieneStatus: params.hygieneStatus,
    hygieneReason: params.hygieneReason,
    engagementStatus: params.engagementStatus,
    engagementReason: params.engagementReason,
    descriptiveTags: buildDescriptiveTags(sub, m, params.extraTags ?? []),
    engagementConfidence: params.confidenceOverride ?? confidence,
    historyCoverage: m.historyCoverage,
    deliveredCampaignsCount: m.deliveredCampaignsCount,
    opensCount: m.opensCount,
    clicksCount: m.clicksCount,
    repliesCount: m.repliesCount,
    conversionsCount: m.conversionsCount,
    hardBouncesCount: m.hardBouncesCount,
    softBouncesCount: m.softBouncesCount,
    complaintsCount: m.complaintsCount,
    lastDeliveredAt: m.lastDeliveredAt,
    lastOpenAt: m.lastOpenAt,
    lastClickAt: m.lastClickAt,
    lastReplyAt: m.lastReplyAt,
    lastConversionAt: m.lastConversionAt,
    lastStrongEngagementAt: m.lastStrongEngagementAt,
    lastBounceAt: m.lastBounceAt,
  });

  // 1. Ineligible / terminal statuses -> EXCLUDED in Phase 2 + specific status in Phase 1
  if (m.complaintsCount > 0) {
    return makeOutput({
      isExcluded: true,
      exclusionReason: `Spam complaint (${m.complaintsCount})`,
      hygieneStatus: 'COMPLAINED',
      hygieneReason: `Recorded ${m.complaintsCount} spam complaint(s).`,
      engagementStatus: 'EXCLUDED',
      engagementReason: `Excluded from marketing actions: recorded ${m.complaintsCount} spam complaint(s).`,
      extraTags: ['COMPLAINED'],
    });
  }
  if (m.hardBouncesCount > 0) {
    return makeOutput({
      isExcluded: true,
      exclusionReason: `Hard bounce (${m.hardBouncesCount})`,
      hygieneStatus: 'HARD_BOUNCED',
      hygieneReason: `Recorded ${m.hardBouncesCount} hard bounce(s) from campaign bounce logs.`,
      engagementStatus: 'EXCLUDED',
      engagementReason: `Excluded from marketing actions: ${m.hardBouncesCount} hard bounce(s) recorded.`,
      extraTags: ['HARD_BOUNCED'],
    });
  }
  if (sub.status === 'BLACKLISTED') {
    return makeOutput({
      isExcluded: true,
      exclusionReason: 'Blacklisted in MailWizz',
      hygieneStatus: 'BLACKLISTED',
      hygieneReason: 'Marked as blacklisted in MailWizz.',
      engagementStatus: 'EXCLUDED',
      engagementReason: 'Excluded from marketing actions: blacklisted in MailWizz.',
      extraTags: ['BLACKLISTED'],
    });
  }
  if (sub.status === 'UNSUBSCRIBED') {
    return makeOutput({
      isExcluded: true,
      exclusionReason: 'Already unsubscribed in MailWizz',
      hygieneStatus: 'UNSUBSCRIBED',
      hygieneReason: 'Already unsubscribed in MailWizz.',
      engagementStatus: 'EXCLUDED',
      engagementReason: 'Excluded from marketing actions: subscriber already unsubscribed.',
      extraTags: ['UNSUBSCRIBED'],
    });
  }
  if (sub.status === 'UNCONFIRMED') {
    return makeOutput({
      isExcluded: true,
      exclusionReason: 'Unconfirmed opt-in',
      hygieneStatus: 'UNCONFIRMED',
      hygieneReason: 'Pending double opt-in confirmation in MailWizz.',
      engagementStatus: 'EXCLUDED',
      engagementReason: 'Excluded from marketing actions: pending opt-in confirmation.',
      extraTags: ['UNCONFIRMED'],
    });
  }
  if (sub.status === 'MOVED' || sub.status === 'UNAPPROVED') {
    return makeOutput({
      isExcluded: true,
      exclusionReason: `MailWizz status: ${sub.status}`,
      hygieneStatus: 'EXCLUDED',
      hygieneReason: `Excluded because MailWizz status is ${sub.status}.`,
      engagementStatus: 'EXCLUDED',
      engagementReason: `Excluded from marketing actions: MailWizz status is ${sub.status}.`,
      extraTags: [`STATUS_${sub.status}`],
    });
  }

  // 2. Administrator protection & exclusion rules (VIP, paid relationship, domain, source, grace window)
  if (sub.isVip) {
    return makeOutput({
      isExcluded: true,
      exclusionReason: 'VIP protected subscriber',
      hygieneStatus: 'EXCLUDED',
      hygieneReason: 'Protected VIP contact exempt from inactivity cleanup.',
      engagementStatus: 'EXCLUDED',
      engagementReason: 'Excluded by VIP protection flag.',
      extraTags: ['VIP_PROTECTED'],
    });
  }
  if (sub.hasPaidRelationship) {
    return makeOutput({
      isExcluded: true,
      exclusionReason: 'Active paid customer relationship',
      hygieneStatus: 'EXCLUDED',
      hygieneReason: 'Protected active paid customer relationship.',
      engagementStatus: 'EXCLUDED',
      engagementReason: 'Excluded due to active paid relationship protection.',
      extraTags: ['PAID_RELATIONSHIP'],
    });
  }
  if (sub.lastPurchaseAt && daysBetween(sub.lastPurchaseAt, now) < 365) {
    return makeOutput({
      isExcluded: true,
      exclusionReason: 'Recent purchase protection',
      hygieneStatus: 'EXCLUDED',
      hygieneReason: `Protected due to verified purchase ${daysBetween(sub.lastPurchaseAt, now)} day(s) ago.`,
      engagementStatus: 'EXCLUDED',
      engagementReason: `Excluded due to verified purchase within the last year (${daysBetween(sub.lastPurchaseAt, now)} day(s) ago).`,
      extraTags: ['RECENT_PURCHASE'],
    });
  }

  const emailDomain = sub.email.split('@')[1]?.toLowerCase() ?? '';
  if (
    emailDomain &&
    config.excludedDomains.some((d) => d.trim().toLowerCase() === emailDomain)
  ) {
    return makeOutput({
      isExcluded: true,
      exclusionReason: `Excluded domain: ${emailDomain}`,
      hygieneStatus: 'EXCLUDED',
      hygieneReason: `Excluded by domain rule (${emailDomain}).`,
      engagementStatus: 'EXCLUDED',
      engagementReason: `Excluded by configured domain protection rule (${emailDomain}).`,
      extraTags: ['EXCLUDED_DOMAIN'],
    });
  }

  if (
    sub.source &&
    config.excludedSources.some(
      (s) => s.trim().toLowerCase() === sub.source!.trim().toLowerCase()
    )
  ) {
    return makeOutput({
      isExcluded: true,
      exclusionReason: `Excluded source: ${sub.source}`,
      hygieneStatus: 'EXCLUDED',
      hygieneReason: `Excluded by subscriber source (${sub.source}).`,
      engagementStatus: 'EXCLUDED',
      engagementReason: `Excluded by protected subscriber source (${sub.source}).`,
      extraTags: ['EXCLUDED_SOURCE'],
    });
  }

  if (config.excludeRecentSubscribersDays > 0 && sub.dateAddedMailwizz) {
    const signupAgeDays = daysBetween(sub.dateAddedMailwizz, now);
    if (signupAgeDays < config.excludeRecentSubscribersDays) {
      return makeOutput({
        isExcluded: true,
        exclusionReason: `Added within ${config.excludeRecentSubscribersDays}-day grace period`,
        hygieneStatus: 'EXCLUDED',
        hygieneReason: `Subscribed ${signupAgeDays} day(s) ago (within ${config.excludeRecentSubscribersDays}-day grace window).`,
        engagementStatus: 'EXCLUDED',
        engagementReason: `Excluded by recent-signup grace period (subscribed ${signupAgeDays} day(s) ago; grace window ${config.excludeRecentSubscribersDays} days).`,
        extraTags: ['RECENT_SIGNUP_GRACE'],
      });
    }
  }

  // 3. Evaluate Engagement Timeline (supports custom date range OR lookback/cooling/inactive/long-term)
  const lookbackCutoffMs = now.getTime() - inactiveDays * MS_PER_DAY;
  const recentStrongEvent = sub.events.find((ev) => {
    const t = ev.occurredAt.getTime();
    const inPeriod = customStart
      ? t >= customStart.getTime() && t <= customEnd.getTime()
      : t > lookbackCutoffMs;
    if (!inPeriod) return false;
    if (ev.eventType === 'CLICK' && config.countClicksAsEngaged) return true;
    if (ev.eventType === 'REPLY' && config.countRepliesAsEngaged) return true;
    if (ev.eventType === 'CONVERSION' && config.countConversionsAsEngaged) return true;
    return false;
  });

  const recentOpenEvent =
    config.countOpensAsEngaged &&
    m.lastOpenAt !== null &&
    (customStart
      ? m.lastOpenAt.getTime() >= customStart.getTime() &&
        m.lastOpenAt.getTime() <= customEnd.getTime()
      : m.lastOpenAt.getTime() > lookbackCutoffMs);

  const ageOfLastEngagementDays =
    m.lastMeaningfulEngagementAt !== null
      ? daysBetween(m.lastMeaningfulEngagementAt, now)
      : null;

  const isCooling =
    !customStart &&
    ageOfLastEngagementDays !== null &&
    ageOfLastEngagementDays >= coolingDays &&
    ageOfLastEngagementDays < inactiveDays;

  if (recentStrongEvent) {
    if (isCooling) {
      return makeOutput({
        isExcluded: false,
        exclusionReason: null,
        hygieneStatus: 'ENGAGED_STRONG',
        hygieneReason: `Strong engagement ${ageOfLastEngagementDays} days ago; entering ${coolingDays}-${inactiveDays - 1}d cooling zone.`,
        engagementStatus: 'COOLING',
        engagementReason: `Last verified click/reply/conversion was ${ageOfLastEngagementDays} day(s) ago (${coolingDays}-${inactiveDays - 1} day cooling window across ${m.deliveredCampaignsCount} delivered campaigns). Recommend reducing routine send frequency.`,
        extraTags: ['DECLINING_ENGAGEMENT'],
      });
    }
    return makeOutput({
      isExcluded: false,
      exclusionReason: null,
      hygieneStatus: 'ENGAGED_STRONG',
      hygieneReason: `Strong engagement (click/reply/conversion) within ${inactiveDays}-day lookback.`,
      engagementStatus: 'ACTIVE',
      engagementReason: `Active: verified click/reply/conversion ${ageOfLastEngagementDays} day(s) ago across ${m.deliveredCampaignsCount} delivered campaign(s).`,
    });
  }

  if (recentOpenEvent && m.lastOpenAt) {
    const openAgeDays = daysBetween(m.lastOpenAt, now);
    if (isCooling) {
      return makeOutput({
        isExcluded: false,
        exclusionReason: null,
        hygieneStatus: 'ENGAGED_OPEN_ONLY',
        hygieneReason: `Open-only engagement ${openAgeDays} days ago (cooling window; no verified clicks).`,
        engagementStatus: 'COOLING',
        engagementReason: `Cooling (open-only): last tracked open was ${openAgeDays} day(s) ago (${coolingDays}-${inactiveDays - 1} day cooling window) with ${m.clicksCount} clicks across ${m.deliveredCampaignsCount} delivered campaigns.`,
        extraTags: ['OPEN_ONLY_MPP_CAVEAT', 'DECLINING_ENGAGEMENT'],
      });
    }
    return makeOutput({
      isExcluded: false,
      exclusionReason: null,
      hygieneStatus: 'ENGAGED_OPEN_ONLY',
      hygieneReason: `Open-only engagement within ${inactiveDays} days (no verified clicks; open tracking may reflect mail privacy proxies).`,
      engagementStatus: 'ACTIVE',
      engagementReason: `Active (open-only): tracked open ${openAgeDays} day(s) ago across ${m.deliveredCampaignsCount} delivered campaign(s), with ${m.clicksCount} verified clicks (caveat: pixel opens may reflect Apple MPP/proxy preloading).`,
      extraTags: ['OPEN_ONLY_MPP_CAVEAT'],
    });
  }

  // 4. Historical coverage safety gate: NEVER classify inactive without verified delivery history
  if (m.historyCoverage !== 'VERIFIED_FULL') {
    return makeOutput({
      isExcluded: false,
      exclusionReason: null,
      hygieneStatus: 'UNKNOWN',
      hygieneReason:
        'UNKNOWN: Subscriber-level delivery/engagement history is not exposed by the MailWizz 3.0.5 REST API alone. Inactivity classification is disabled until verified exports, read-only reporting DB, or forward webhooks are configured.',
      engagementStatus: 'INSUFFICIENT_DATA',
      engagementReason: `Insufficient data (${m.historyCoverage}): cannot establish subscriber-level delivery history without verified campaign exports or reporting DB; inactivity judgment disabled.`,
      extraTags: ['NO_VERIFIED_DELIVERY_HISTORY'],
      confidenceOverride: m.historyCoverage === 'NONE' ? 'NONE' : 'LOW',
    });
  }

  // 5. Minimum delivered campaigns threshold (default 5)
  if (m.deliveredCampaignsCount < config.minDeliveredCampaigns) {
    return makeOutput({
      isExcluded: false,
      exclusionReason: null,
      hygieneStatus: 'INSUFFICIENT_HISTORY',
      hygieneReason: `Only ${m.deliveredCampaignsCount} delivered campaign(s); minimum ${config.minDeliveredCampaigns} required before inactivity classification.`,
      engagementStatus: 'INSUFFICIENT_DATA',
      engagementReason: `Insufficient campaign exposure: only ${m.deliveredCampaignsCount} confirmed delivered campaign(s); minimum ${config.minDeliveredCampaigns} required before classifying as inactive.`,
      extraTags: ['BELOW_MIN_DELIVERED_CAMPAIGNS'],
      confidenceOverride: 'LOW',
    });
  }

  // 6. Verified inactivity categories (NEVER_ENGAGED vs LONG_TERM_INACTIVE vs INACTIVE)
  const metricSummary = `Subscriber has received ${m.deliveredCampaignsCount} confirmed campaign deliveries over ${deliverySpanDays} days, has ${m.opensCount} verified opens, ${m.clicksCount} verified clicks, ${m.repliesCount} verified replies, and ${m.conversionsCount} verified conversions.`;
  const extraDormantTags =
    !config.countOpensAsEngaged && m.opensCount > 0 ? ['OPENED_NO_CLICK'] : [];

  if (m.totalMeaningfulCount === 0) {
    if (deliverySpanDays >= longTermDays) {
      extraDormantTags.push('180D_PLUS_NO_ENGAGEMENT');
    }
    return makeOutput({
      isExcluded: false,
      exclusionReason: null,
      hygieneStatus: 'INACTIVE_CANDIDATE',
      hygieneReason: `Never engaged across ${m.deliveredCampaignsCount} delivered campaigns over ${deliverySpanDays} days.`,
      engagementStatus: 'NEVER_ENGAGED',
      engagementReason: `Never engaged: ${metricSummary}`,
      extraTags: extraDormantTags,
    });
  }

  if (ageOfLastEngagementDays !== null && ageOfLastEngagementDays >= longTermDays) {
    return makeOutput({
      isExcluded: false,
      exclusionReason: null,
      hygieneStatus: 'INACTIVE_CANDIDATE',
      hygieneReason: `No qualifying engagement for ${ageOfLastEngagementDays} days (>= ${longTermDays}-day long-term threshold) across ${m.deliveredCampaignsCount} delivered campaigns.`,
      engagementStatus: 'LONG_TERM_INACTIVE',
      engagementReason: `Long-term inactive (${ageOfLastEngagementDays} days since last engagement, threshold ${longTermDays} days): ${metricSummary}`,
      extraTags: ['180D_PLUS_NO_ENGAGEMENT', ...extraDormantTags],
    });
  }

  return makeOutput({
    isExcluded: false,
    exclusionReason: null,
    hygieneStatus: 'INACTIVE_CANDIDATE',
    hygieneReason: `No qualifying engagement in last ${inactiveDays} days across ${m.deliveredCampaignsCount} delivered campaigns.`,
    engagementStatus: 'INACTIVE',
    engagementReason: `Inactive (${ageOfLastEngagementDays ?? inactiveDays} days since last engagement, threshold ${inactiveDays} days): ${metricSummary}`,
    extraTags: extraDormantTags,
  });
}

export async function loadHygieneRuleConfig(): Promise<HygieneRuleConfig> {
  const cfg = await prisma.appConfig.upsert({
    where: { id: 'default' },
    update: {},
    create: { id: 'default' },
  });

  const excludedDomains = Array.isArray(cfg.excludedDomainsJson)
    ? cfg.excludedDomainsJson.map(String)
    : [];
  const excludedSources = Array.isArray(cfg.excludedSourcesJson)
    ? cfg.excludedSourcesJson.map(String)
    : [];

  return {
    lookbackDays: cfg.lookbackDays,
    coolingDays: cfg.coolingDays,
    inactiveDays: cfg.inactiveDays || cfg.lookbackDays,
    longTermInactiveDays: cfg.longTermInactiveDays,
    customRangeStart: cfg.customRangeStart,
    customRangeEnd: cfg.customRangeEnd,
    minDeliveredCampaigns: cfg.minDeliveredCampaigns,
    countOpensAsEngaged: cfg.countOpensAsEngaged,
    countClicksAsEngaged: cfg.countClicksAsEngaged,
    countRepliesAsEngaged: cfg.countRepliesAsEngaged,
    countConversionsAsEngaged: cfg.countConversionsAsEngaged,
    excludedDomains,
    excludedSources,
    excludeRecentSubscribersDays: cfg.excludeRecentSubscribersDays,
  };
}

export async function recomputeAllHygieneClassifications(
  mailingListId?: string,
  customerConnectionId?: string,
  overrideConfig?: Partial<HygieneRuleConfig>
): Promise<{ updatedSubscribers: number }> {
  const baseConfig = await loadHygieneRuleConfig();
  const config: HygieneRuleConfig = {
    ...baseConfig,
    ...overrideConfig,
  };

  const subscribers = await prisma.subscriber.findMany({
    where: {
      ...(mailingListId ? { mailingListId } : {}),
      ...(customerConnectionId ? { customerConnectionId } : {}),
    },
    include: {
      engagementEvents: {
        select: {
          eventType: true,
          source: true,
          occurredAt: true,
          isHistorical: true,
          campaignId: true,
        },
      },
    },
  });

  const now = new Date();
  let updatedSubscribers = 0;

  const sameTime = (a: Date | null, b: Date | null) =>
    (a?.getTime() ?? null) === (b?.getTime() ?? null);

  const pendingUpdates: Array<ReturnType<typeof prisma.subscriber.update>> = [];
  for (const sub of subscribers) {
    const result = classifySubscriber(
      {
        email: sub.email,
        status: sub.status,
        source: sub.source,
        dateAddedMailwizz: sub.dateAddedMailwizz,
        isVip: sub.isVip,
        hasPaidRelationship: sub.hasPaidRelationship,
        lastPurchaseAt: sub.lastPurchaseAt,
        isSuppressed: sub.isSuppressed,
        isArchived: sub.isArchived,
        events: sub.engagementEvents,
        now,
      },
      config
    );

    const unchanged =
      sub.isExcluded === result.isExcluded &&
      sub.exclusionReason === result.exclusionReason &&
      sub.hygieneStatus === result.hygieneStatus &&
      sub.engagementStatus === result.engagementStatus &&
      sub.engagementConfidence === result.engagementConfidence &&
      sub.historyCoverage === result.historyCoverage &&
      sub.deliveredCampaignsCount === result.deliveredCampaignsCount &&
      sub.opensCount === result.opensCount &&
      sub.clicksCount === mClamp(result.clicksCount) &&
      sameTime(sub.lastOpenAt, result.lastOpenAt) &&
      sameTime(sub.lastClickAt, result.lastClickAt);

    if (unchanged) continue;

    pendingUpdates.push(
      prisma.subscriber.update({
        where: { id: sub.id },
        data: {
          isExcluded: result.isExcluded,
          exclusionReason: result.exclusionReason,
          hygieneStatus: result.hygieneStatus,
          hygieneReason: result.hygieneReason,
          engagementStatus: result.engagementStatus,
          engagementReason: result.engagementReason,
          descriptiveTagsJson: result.descriptiveTags,
          engagementConfidence: result.engagementConfidence,
          historyCoverage: result.historyCoverage,
          deliveredCampaignsCount: result.deliveredCampaignsCount,
          opensCount: result.opensCount,
          clicksCount: mClamp(result.clicksCount),
          repliesCount: result.repliesCount,
          conversionsCount: result.conversionsCount,
          hardBouncesCount: result.hardBouncesCount,
          softBouncesCount: result.softBouncesCount,
          complaintsCount: result.complaintsCount,
          lastDeliveredAt: result.lastDeliveredAt,
          lastOpenAt: result.lastOpenAt,
          lastClickAt: result.lastClickAt,
          lastReplyAt: result.lastReplyAt,
          lastConversionAt: result.lastConversionAt,
          lastStrongEngagementAt: result.lastStrongEngagementAt,
          lastBounceAt: result.lastBounceAt,
        },
      })
    );
  }

  const chunkSize = 250;
  for (let i = 0; i < pendingUpdates.length; i += chunkSize) {
    const chunk = pendingUpdates.slice(i, i + chunkSize);
    await prisma.$transaction(chunk);
    updatedSubscribers += chunk.length;
  }

  return { updatedSubscribers };
}

function mClamp(v: number): number {
  return Math.max(0, v);
}
