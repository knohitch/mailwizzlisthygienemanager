import type {
  CleanupActionType,
  EngagementClass,
  HistoryCoverage,
  SubscriberStatus,
} from '@prisma/client';

export interface SubscriberSafetyCandidate {
  id: string;
  subscriberUid: string;
  mailingListId: string;
  mailingListUid: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  status: SubscriberStatus;
  engagementStatus: EngagementClass;
  historyCoverage: HistoryCoverage;
  deliveredCampaignsCount: number;
  clicksCount: number;
  repliesCount: number;
  conversionsCount: number;
  hardBouncesCount: number;
  complaintsCount: number;
  lastClickAt: Date | null;
  lastReplyAt: Date | null;
  lastConversionAt: Date | null;
  lastPurchaseAt: Date | null;
  isExcluded: boolean;
  exclusionReason: string | null;
  isVip: boolean;
  hasPaidRelationship: boolean;
  isSuppressed: boolean;
  isArchived: boolean;
}

export interface EligibilityDecision {
  eligible: boolean;
  reason: string;
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}***@${domain}`;
}

/**
 * Evaluates mandatory Phase 2 safety protections per subscriber before preview or execution.
 */
export function evaluateActionEligibility(
  sub: SubscriberSafetyCandidate,
  actionType: CleanupActionType,
  options: {
    minDeliveredCampaigns: number;
    recentProtectionDays?: number;
    now?: Date;
  }
): EligibilityDecision {
  const now = options.now ?? new Date();
  const recentWindowMs = (options.recentProtectionDays ?? 30) * 86_400_000;

  if (actionType === 'RESTORE_SUPPRESSION') {
    if (!sub.isSuppressed) {
      return { eligible: false, reason: 'Subscriber is not currently suppressed.' };
    }
    if (
      sub.status === 'UNSUBSCRIBED' ||
      sub.status === 'BLACKLISTED' ||
      sub.status === 'UNCONFIRMED'
    ) {
      return {
        eligible: false,
        reason: `Cannot restore to active sendable state: MailWizz status is ${sub.status}.`,
      };
    }
    if (sub.complaintsCount > 0 || sub.hardBouncesCount > 0) {
      return {
        eligible: false,
        reason: 'Cannot restore: spam complaint or hard bounce recorded.',
      };
    }
    return { eligible: true, reason: 'Eligible for suppression recovery.' };
  }

  // Copy / Move into another list: never copy ineligible, complained, unsubscribed, bounced, or suppressed contacts
  if (actionType === 'COPY_SUBSCRIBERS' || actionType === 'CREATE_LIST') {
    if (sub.status !== 'CONFIRMED') {
      return {
        eligible: false,
        reason: `Never copy ${sub.status} contact into a confirmed sendable list.`,
      };
    }
    if (sub.complaintsCount > 0 || sub.hardBouncesCount > 0) {
      return {
        eligible: false,
        reason: 'Never copy contacts with spam complaints or hard bounces.',
      };
    }
    if (sub.isSuppressed) {
      return {
        eligible: false,
        reason: 'Contact is currently application-suppressed.',
      };
    }
    return { eligible: true, reason: 'Consent verified for list copy.' };
  }

  if (actionType === 'CREATE_SEGMENT') {
    return { eligible: true, reason: 'Included in segment definition.' };
  }

  // Destructive/restrictive actions: SUPPRESS, UNSUBSCRIBE, ARCHIVE, MOVE_SUBSCRIBERS
  if (sub.complaintsCount > 0 || sub.hardBouncesCount > 0) {
    return {
      eligible: false,
      reason: 'Already excluded by spam complaint or hard bounce.',
    };
  }
  if (sub.status !== 'CONFIRMED') {
    return {
      eligible: false,
      reason: `Already ${sub.status} in MailWizz (skipped to avoid redundant or invalid state changes).`,
    };
  }
  if (sub.isVip || sub.hasPaidRelationship || sub.isExcluded) {
    return {
      eligible: false,
      reason: sub.exclusionReason || 'Protected VIP, paid relationship, or excluded rule.',
    };
  }

  const mostRecentPositiveMs = Math.max(
    sub.lastClickAt?.getTime() ?? 0,
    sub.lastReplyAt?.getTime() ?? 0,
    sub.lastConversionAt?.getTime() ?? 0,
    sub.lastPurchaseAt?.getTime() ?? 0
  );
  if (mostRecentPositiveMs > 0 && now.getTime() - mostRecentPositiveMs < recentWindowMs) {
    return {
      eligible: false,
      reason: 'Protected: recent click, reply, conversion, or purchase recorded.',
    };
  }

  // Safety gate: never auto-suppress/unsubscribe/archive if history is incomplete or below minimum campaigns
  if (sub.historyCoverage !== 'VERIFIED_FULL') {
    return {
      eligible: false,
      reason: `Safety lock: engagement history coverage is ${sub.historyCoverage} (not VERIFIED_FULL).`,
    };
  }
  if (
    sub.engagementStatus === 'INSUFFICIENT_DATA' ||
    sub.deliveredCampaignsCount < options.minDeliveredCampaigns
  ) {
    return {
      eligible: false,
      reason: `Safety lock: delivered campaigns (${sub.deliveredCampaignsCount}) below minimum (${options.minDeliveredCampaigns}).`,
    };
  }
  if (sub.engagementStatus === 'ACTIVE') {
    return {
      eligible: false,
      reason: 'Protected: subscriber is currently ACTIVE.',
    };
  }

  if (actionType === 'SUPPRESS' && sub.isSuppressed) {
    return { eligible: false, reason: 'Already suppressed in application.' };
  }
  if (actionType === 'ARCHIVE' && sub.isArchived) {
    return { eligible: false, reason: 'Already logically archived.' };
  }

  return {
    eligible: true,
    reason: `Verified eligible (${sub.engagementStatus}, ${sub.deliveredCampaignsCount} delivered campaigns).`,
  };
}
