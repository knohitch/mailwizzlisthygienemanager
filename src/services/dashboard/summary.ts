import { prisma } from '@/lib/db';
import { ensureCapabilityMatrixInitialized } from '@/services/mailwizz/capability-matrix';
import { isMailWizzMutationsEnabled } from '@/services/mutations/gate';

export async function getDashboardSummary(params?: {
  periodDays?: number;
  listId?: string;
}) {
  await ensureCapabilityMatrixInitialized();

  const cfg = await prisma.appConfig.upsert({
    where: { id: 'default' },
    update: {},
    create: { id: 'default' },
  });

  const periodDays =
    params?.periodDays &&
    Number.isFinite(params.periodDays) &&
    params.periodDays >= 1 &&
    params.periodDays <= 3650
      ? Math.floor(params.periodDays)
      : cfg.reportingPeriodDays;

  const listIdFilter = params?.listId || undefined;
  const periodCutoff = new Date(Date.now() - periodDays * 86_400_000);

  const [lists, hygieneGroups, statusGroups, campaigns, capabilities, recentJobs] =
    await Promise.all([
      prisma.mailingList.findMany({
        orderBy: [{ syncedSubscriberCount: 'desc' }, { name: 'asc' }],
      }),
      prisma.subscriber.groupBy({
        by: ['hygieneStatus'],
        where: listIdFilter ? { mailingListId: listIdFilter } : undefined,
        _count: { _all: true },
      }),
      prisma.subscriber.groupBy({
        by: ['status'],
        where: listIdFilter ? { mailingListId: listIdFilter } : undefined,
        _count: { _all: true },
      }),
      prisma.campaign.findMany({
        where: {
          ...(listIdFilter ? { mailingListId: listIdFilter } : {}),
          OR: [{ sendAt: { gte: periodCutoff } }, { sendAt: null }],
        },
        orderBy: [{ sendAt: 'desc' }, { createdAt: 'desc' }],
      }),
      prisma.apiCapabilityCheck.findMany({
        orderBy: [{ category: 'asc' }, { capabilityKey: 'asc' }],
      }),
      prisma.syncJob.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
    ]);

  const hygieneCounts: Record<string, number> = {};
  for (const g of hygieneGroups) hygieneCounts[g.hygieneStatus] = g._count._all;

  const statusCounts: Record<string, number> = {};
  let totalSubscribers = 0;
  for (const g of statusGroups) {
    statusCounts[g.status] = g._count._all;
    totalSubscribers += g._count._all;
  }

  const engagedStrong = hygieneCounts['ENGAGED_STRONG'] ?? 0;
  const engagedOpenOnly = hygieneCounts['ENGAGED_OPEN_ONLY'] ?? 0;

  let totalUniqueOpens = 0;
  let totalUniqueClicks = 0;
  let totalDeliveryErrors = 0;
  let totalHardBounces = 0;
  let totalSoftBounces = 0;
  let totalInternalBounces = 0;
  let totalComplaints = 0;
  let totalDeliverySuccess = 0;

  for (const c of campaigns) {
    totalUniqueOpens += c.uniqueOpensCount;
    totalUniqueClicks += c.uniqueClicksCount;
    totalDeliveryErrors += c.deliveryErrorCount;
    totalHardBounces += c.hardBouncesCount;
    totalSoftBounces += c.softBouncesCount;
    totalInternalBounces += c.internalBouncesCount;
    totalComplaints += c.complaintsCount;
    totalDeliverySuccess += c.deliverySuccessCount;
  }

  return {
    isDemoMode:
      cfg.isDemoMode ||
      lists.some((l) => l.isDemoData) ||
      campaigns.some((c) => c.isDemoData),
    phase1ReadOnly: !isMailWizzMutationsEnabled(),
    connectionConfigured: Boolean(cfg.mailwizzApiUrl && cfg.mailwizzApiKeyEnc),
    periodDays,
    lookbackDays: cfg.lookbackDays,
    minDeliveredCampaigns: cfg.minDeliveredCampaigns,
    timezone: cfg.timezone,
    kpis: {
      totalLists: lists.length,
      totalSubscribers,
      confirmedSubscribers: statusCounts['CONFIRMED'] ?? 0,
      unconfirmedSubscribers: statusCounts['UNCONFIRMED'] ?? 0,
      unsubscribedSubscribers: statusCounts['UNSUBSCRIBED'] ?? 0,
      blacklistedSubscribers: statusCounts['BLACKLISTED'] ?? 0,
      hardBouncedSubscribers: hygieneCounts['HARD_BOUNCED'] ?? 0,
      complainedSubscribers: hygieneCounts['COMPLAINED'] ?? 0,
      recentlyEngagedTotal: engagedStrong + engagedOpenOnly,
      engagedStrong,
      engagedOpenOnly,
      potentiallyInactiveSubscribers: hygieneCounts['INACTIVE_CANDIDATE'] ?? 0,
      insufficientHistorySubscribers: hygieneCounts['INSUFFICIENT_HISTORY'] ?? 0,
      unknownHistorySubscribers: hygieneCounts['UNKNOWN'] ?? 0,
      excludedSubscribers: hygieneCounts['EXCLUDED'] ?? 0,
      campaignsSentInPeriod: campaigns.length,
      totalDeliverySuccess,
      totalDeliveryErrors,
      totalUniqueOpens,
      totalUniqueClicks,
      totalHardBounces,
      totalSoftBounces,
      totalInternalBounces,
      totalComplaints,
    },
    lists: lists.map((l) => ({
      ...l,
      lastSyncedAt: l.lastSyncedAt?.toISOString() ?? null,
    })),
    campaigns: campaigns.map((c) => ({
      ...c,
      sendAt: c.sendAt?.toISOString() ?? null,
    })),
    capabilities: capabilities.map((cap) => ({
      ...cap,
      checkedAt: cap.checkedAt.toISOString(),
    })),
    recentJobs: recentJobs.map((j) => ({
      ...j,
      createdAt: j.createdAt.toISOString(),
    })),
  };
}
