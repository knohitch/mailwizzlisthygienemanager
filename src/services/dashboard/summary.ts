import { prisma } from '@/lib/db';
import { ensureCapabilityMatrixInitialized } from '@/services/mailwizz/capability-matrix';
import { isMailWizzMutationsEnabled } from '@/services/mutations/gate';

export async function getDashboardSummary(params?: {
  periodDays?: number;
  listId?: string;
  customerConnectionId?: string;
}) {
  const customerConnectionId = params?.customerConnectionId?.trim() || undefined;
  await ensureCapabilityMatrixInitialized(customerConnectionId);

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

  const subWhere = {
    ...(listIdFilter ? { mailingListId: listIdFilter } : {}),
    ...(customerConnectionId ? { customerConnectionId } : {}),
  };

  const [lists, hygieneGroups, statusGroups, campaigns, capabilities, recentJobs, connections] =
    await Promise.all([
      prisma.mailingList.findMany({
        where: customerConnectionId ? { customerConnectionId } : undefined,
        include: {
          customerConnection: {
            select: { id: true, customerName: true, customerSlug: true, status: true },
          },
        },
        orderBy: [{ syncedSubscriberCount: 'desc' }, { name: 'asc' }],
      }),
      prisma.subscriber.groupBy({
        by: ['hygieneStatus'],
        where: Object.keys(subWhere).length > 0 ? subWhere : undefined,
        _count: { _all: true },
      }),
      prisma.subscriber.groupBy({
        by: ['status'],
        where: Object.keys(subWhere).length > 0 ? subWhere : undefined,
        _count: { _all: true },
      }),
      prisma.campaign.findMany({
        where: {
          ...(listIdFilter ? { mailingListId: listIdFilter } : {}),
          ...(customerConnectionId ? { customerConnectionId } : {}),
          OR: [{ sendAt: { gte: periodCutoff } }, { sendAt: null }],
        },
        include: {
          customerConnection: {
            select: { id: true, customerName: true, customerSlug: true },
          },
        },
        orderBy: [{ sendAt: 'desc' }, { createdAt: 'desc' }],
      }),
      prisma.apiCapabilityCheck.findMany({
        where: customerConnectionId ? { customerConnectionId } : undefined,
        orderBy: [{ category: 'asc' }, { capabilityKey: 'asc' }],
      }),
      prisma.syncJob.findMany({
        where: customerConnectionId ? { customerConnectionId } : undefined,
        include: {
          customerConnection: {
            select: { id: true, customerName: true, customerSlug: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 15,
      }),
      prisma.mailWizzCustomerConnection.findMany({
        orderBy: [{ isQuarantine: 'asc' }, { isPrimary: 'desc' }, { customerName: 'asc' }],
        include: {
          installation: { select: { id: true, name: true, baseUrl: true, hostname: true } },
          health: { select: { lastCheckedAt: true, lastSuccessAt: true, lastErrorSafe: true, consecutiveFailures: true } },
          syncState: { select: { isPaused: true, lastFullSyncCompletedAt: true, lastSyncStatus: true } },
          credentials: { where: { isActive: true, status: 'ACTIVE' }, select: { apiKeyLast4: true }, take: 1 },
          _count: { select: { mailingLists: true, subscribers: true, campaigns: true } },
        },
      }),
    ]);

  const perConnEngaged = await prisma.subscriber.groupBy({
    by: ['customerConnectionId', 'hygieneStatus'],
    where: { hygieneStatus: { in: ['ENGAGED_STRONG', 'ENGAGED_OPEN_ONLY', 'INACTIVE_CANDIDATE'] } },
    _count: { _all: true },
  });
  const engagedByConn = new Map<string, { engaged: number; inactive: number }>();
  for (const row of perConnEngaged) {
    const cur = engagedByConn.get(row.customerConnectionId) ?? { engaged: 0, inactive: 0 };
    if (row.hygieneStatus === 'ENGAGED_STRONG' || row.hygieneStatus === 'ENGAGED_OPEN_ONLY') {
      cur.engaged += row._count._all;
    } else if (row.hygieneStatus === 'INACTIVE_CANDIDATE') {
      cur.inactive += row._count._all;
    }
    engagedByConn.set(row.customerConnectionId, cur);
  }

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

  const dedupedCapabilities = customerConnectionId
    ? capabilities
    : Array.from(
        capabilities
          .reduce((map, cap) => {
            const existing = map.get(cap.capabilityKey);
            if (!existing || (!existing.customerConnectionId && cap.customerConnectionId)) {
              map.set(cap.capabilityKey, cap);
            }
            return map;
          }, new Map<string, (typeof capabilities)[number]>())
          .values()
      );

  return {
    scope: customerConnectionId ? ('CUSTOMER' as const) : ('GLOBAL' as const),
    selectedCustomerConnectionId: customerConnectionId ?? null,
    isDemoMode:
      cfg.isDemoMode ||
      lists.some((l) => l.isDemoData) ||
      campaigns.some((c) => c.isDemoData),
    phase1ReadOnly: !isMailWizzMutationsEnabled(),
    connectionConfigured:
      connections.some((c) => !c.isQuarantine && c.isEnabled && c.credentials.length > 0) ||
      Boolean(cfg.mailwizzApiUrl && cfg.mailwizzApiKeyEnc),
    customerAccounts: connections.map((c) => {
      const counts = engagedByConn.get(c.id) ?? { engaged: 0, inactive: 0 };
      return {
        id: c.id,
        customerName: c.customerName,
        customerSlug: c.customerSlug,
        baseUrl: c.installation.baseUrl,
        hostname: c.installation.hostname,
        status: c.status,
        isEnabled: c.isEnabled,
        isQuarantine: c.isQuarantine,
        isDemoData: c.isDemoData,
        apiKeyMasked: c.credentials[0]?.apiKeyLast4
          ? `****${c.credentials[0].apiKeyLast4}`
          : null,
        detectedVersion: c.detectedVersion,
        isPaused: c.syncState?.isPaused ?? false,
        lastSyncStatus: c.syncState?.lastSyncStatus ?? null,
        lastSyncAt: c.syncState?.lastFullSyncCompletedAt?.toISOString() ?? null,
        lastErrorSafe: c.health?.lastErrorSafe ?? null,
        listsCount: c._count.mailingLists,
        subscribersCount: c._count.subscribers,
        campaignsCount: c._count.campaigns,
        engagedSubscribersCount: counts.engaged,
        inactiveSubscribersCount: counts.inactive,
      };
    }),
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
    capabilities: dedupedCapabilities.map((cap) => ({
      ...cap,
      checkedAt: cap.checkedAt.toISOString(),
    })),
    recentJobs: recentJobs.map((j) => ({
      ...j,
      createdAt: j.createdAt.toISOString(),
    })),
  };
}
