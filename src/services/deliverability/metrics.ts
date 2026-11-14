import { prisma } from '@/lib/db';

export interface DeliverabilityQueryOptions {
  days?: number | 'ALL';
  startDate?: Date;
  endDate?: Date;
}

export async function getDeliverabilityDashboardData(
  opts: DeliverabilityQueryOptions = {}
) {
  const now = new Date();
  const days = opts.days ?? 365;
  const startCutoff =
    opts.startDate ??
    (days === 'ALL' ? null : new Date(now.getTime() - days * 86_400_000));
  const endCutoff = opts.endDate ?? now;

  const campaignWhere = startCutoff
    ? {
        OR: [
          { sendAt: { gte: startCutoff, lte: endCutoff } },
          { sendAt: null, dateAddedMailwizz: { gte: startCutoff, lte: endCutoff } },
        ],
      }
    : {};

  const [
    cfg,
    campaigns,
    lists,
    listEngagementCounts,
    subscribersForDomain,
    directMailMetrics,
    dnsChecks,
    inboxTests,
    postmasterStats,
  ] = await Promise.all([
    prisma.appConfig.upsert({
      where: { id: 'default' },
      update: {},
      create: { id: 'default' },
    }),
    prisma.campaign.findMany({
      where: campaignWhere,
      orderBy: [{ sendAt: 'asc' }, { dateAddedMailwizz: 'asc' }],
      include: {
        mailingList: { select: { id: true, name: true, listUid: true } },
      },
    }),
    prisma.mailingList.findMany({
      orderBy: { syncedSubscriberCount: 'desc' },
      select: {
        id: true,
        listUid: true,
        name: true,
        fromEmail: true,
        syncedSubscriberCount: true,
        confirmedCount: true,
        unsubscribedCount: true,
        hardBouncedCount: true,
        complaintCount: true,
        isDemoData: true,
      },
    }),
    prisma.subscriber.groupBy({
      by: ['mailingListId', 'engagementStatus'],
      _count: { _all: true },
    }),
    prisma.subscriber.findMany({
      select: {
        email: true,
        status: true,
        engagementStatus: true,
        hardBouncesCount: true,
        complaintsCount: true,
        opensCount: true,
        clicksCount: true,
        isSuppressed: true,
      },
    }),
    prisma.directMailDailyMetric.findMany({
      where: startCutoff ? { metricDate: { gte: startCutoff, lte: endCutoff } } : {},
      orderBy: { metricDate: 'asc' },
      take: 180,
    }),
    prisma.domainAuthCheck.findMany({
      orderBy: { checkedAt: 'desc' },
      take: 15,
    }),
    prisma.inboxPlacementTest.findMany({
      orderBy: { testedAt: 'desc' },
      take: 50,
    }),
    prisma.postmasterStat.findMany({
      orderBy: { statDate: 'desc' },
      take: 30,
    }),
  ]);

  let processedCount = 0;
  let smtpAcceptedCount = 0;
  let deliveryFailuresCount = 0;
  let hardBouncesCount = 0;
  let softBouncesCount = 0;
  let complaintsCount = 0;
  let uniqueOpensCount = 0;
  let uniqueClicksCount = 0;
  let unsubscribesCount = 0;

  const byListAgg = new Map<
    string,
    {
      listId: string;
      listName: string;
      campaigns: number;
      processed: number;
      accepted: number;
      failures: number;
      hardBounces: number;
      softBounces: number;
      complaints: number;
      uniqueOpens: number;
      uniqueClicks: number;
      unsubscribes: number;
    }
  >();

  for (const l of lists) {
    byListAgg.set(l.id, {
      listId: l.id,
      listName: l.name,
      campaigns: 0,
      processed: 0,
      accepted: 0,
      failures: 0,
      hardBounces: 0,
      softBounces: 0,
      complaints: 0,
      uniqueOpens: 0,
      uniqueClicks: 0,
      unsubscribes: 0,
    });
  }

  for (const c of campaigns) {
    processedCount += c.processedCount;
    smtpAcceptedCount += c.deliverySuccessCount;
    deliveryFailuresCount += c.deliveryErrorCount;
    hardBouncesCount += c.hardBouncesCount;
    softBouncesCount += c.softBouncesCount;
    complaintsCount += c.complaintsCount;
    uniqueOpensCount += c.uniqueOpensCount;
    uniqueClicksCount += c.uniqueClicksCount;
    unsubscribesCount += c.unsubscribesCount;

    if (c.mailingListId) {
      const agg = byListAgg.get(c.mailingListId);
      if (agg) {
        agg.campaigns++;
        agg.processed += c.processedCount;
        agg.accepted += c.deliverySuccessCount;
        agg.failures += c.deliveryErrorCount;
        agg.hardBounces += c.hardBouncesCount;
        agg.softBounces += c.softBouncesCount;
        agg.complaints += c.complaintsCount;
        agg.uniqueOpens += c.uniqueOpensCount;
        agg.uniqueClicks += c.uniqueClicksCount;
        agg.unsubscribes += c.unsubscribesCount;
      }
    }
  }

  const pct = (num: number, denom: number) =>
    denom > 0 ? Number(((num / denom) * 100).toFixed(2)) : 0;

  const kpis = {
    sourceLabel: 'MailWizz 3.0.5 Campaign Stats',
    campaignsCount: campaigns.length,
    processedCount,
    smtpAcceptedCount,
    smtpAcceptanceRatePct: pct(smtpAcceptedCount, processedCount),
    deliveryFailuresCount,
    deliveryFailureRatePct: pct(deliveryFailuresCount, processedCount),
    hardBouncesCount,
    softBouncesCount,
    bounceRatePct: pct(hardBouncesCount + softBouncesCount, processedCount),
    complaintsCount,
    complaintRatePct: pct(complaintsCount, smtpAcceptedCount),
    uniqueOpensCount,
    openRatePct: pct(uniqueOpensCount, smtpAcceptedCount),
    uniqueClicksCount,
    clickThroughRatePct: pct(uniqueClicksCount, smtpAcceptedCount),
    unsubscribesCount,
    unsubscribeRatePct: pct(unsubscribesCount, smtpAcceptedCount),
    acceptanceCaveat:
      'MailWizz delivery_success_count measures SMTP relay acceptance by Alibaba Cloud DirectMail / receiving MTA — it NEVER proves recipient inbox vs. spam placement.',
  };

  const campaignHistory = campaigns
    .slice()
    .reverse()
    .map((c) => ({
      id: c.id,
      campaignUid: c.campaignUid,
      name: c.name,
      listName: c.mailingList?.name ?? 'Unknown',
      sendAt: (c.sendAt ?? c.dateAddedMailwizz)?.toISOString() ?? null,
      processedCount: c.processedCount,
      smtpAcceptedCount: c.deliverySuccessCount,
      deliveryFailuresCount: c.deliveryErrorCount,
      hardBouncesCount: c.hardBouncesCount,
      softBouncesCount: c.softBouncesCount,
      complaintsCount: c.complaintsCount,
      uniqueOpensCount: c.uniqueOpensCount,
      openRatePct: pct(c.uniqueOpensCount, c.deliverySuccessCount),
      uniqueClicksCount: c.uniqueClicksCount,
      ctrPct: pct(c.uniqueClicksCount, c.deliverySuccessCount),
      unsubscribesCount: c.unsubscribesCount,
      unsubRatePct: pct(c.unsubscribesCount, c.deliverySuccessCount),
      sourceLabel: c.isDemoData ? 'Demo (MailWizz Schema)' : 'MailWizz API',
    }));

  const campaignTrends = campaigns.map((c) => ({
    label: c.name.slice(0, 22),
    date: (c.sendAt ?? c.dateAddedMailwizz)?.toISOString().slice(0, 10) ?? 'Unknown',
    volume: c.processedCount,
    openRatePct: pct(c.uniqueOpensCount, c.deliverySuccessCount),
    clickRatePct: pct(c.uniqueClicksCount, c.deliverySuccessCount),
    bounceRatePct: pct(c.bouncesCount, c.processedCount),
    complaintRatePct: pct(c.complaintsCount, c.deliverySuccessCount),
    source: c.isDemoData ? 'Demo (MailWizz)' : 'MailWizz',
  }));

  const engagementByListMap = new Map<string, Record<string, number>>();
  for (const row of listEngagementCounts) {
    const bucket = engagementByListMap.get(row.mailingListId) ?? {};
    bucket[row.engagementStatus] = row._count._all;
    engagementByListMap.set(row.mailingListId, bucket);
  }

  const listPerformance = Array.from(byListAgg.values()).map((agg) => ({
    ...agg,
    openRatePct: pct(agg.uniqueOpens, agg.accepted),
    ctrPct: pct(agg.uniqueClicks, agg.accepted),
    unsubRatePct: pct(agg.unsubscribes, agg.accepted),
    engagementBreakdown: engagementByListMap.get(agg.listId) ?? {},
  }));

  // Engagement by recipient email domain
  const domainMap = new Map<
    string,
    {
      domain: string;
      total: number;
      active: number;
      cooling: number;
      inactive: number;
      hardBounced: number;
      complained: number;
      totalClicks: number;
    }
  >();

  let suppressedNow = 0;
  let recommendedSuppress = 0;
  let confirmedTotal = 0;

  for (const s of subscribersForDomain) {
    if (s.status === 'CONFIRMED') confirmedTotal++;
    if (s.isSuppressed) suppressedNow++;
    if (
      s.status === 'CONFIRMED' &&
      !s.isSuppressed &&
      (s.engagementStatus === 'INACTIVE' ||
        s.engagementStatus === 'LONG_TERM_INACTIVE' ||
        s.engagementStatus === 'NEVER_ENGAGED')
    ) {
      recommendedSuppress++;
    }

    const domain = s.email.split('@')[1]?.toLowerCase() ?? 'unknown';
    const dAgg = domainMap.get(domain) ?? {
      domain,
      total: 0,
      active: 0,
      cooling: 0,
      inactive: 0,
      hardBounced: 0,
      complained: 0,
      totalClicks: 0,
    };
    dAgg.total++;
    if (s.engagementStatus === 'ACTIVE') dAgg.active++;
    if (s.engagementStatus === 'COOLING') dAgg.cooling++;
    if (
      s.engagementStatus === 'INACTIVE' ||
      s.engagementStatus === 'LONG_TERM_INACTIVE' ||
      s.engagementStatus === 'NEVER_ENGAGED'
    ) {
      dAgg.inactive++;
    }
    if (s.hardBouncesCount > 0) dAgg.hardBounced++;
    if (s.complaintsCount > 0) dAgg.complained++;
    dAgg.totalClicks += s.clicksCount;
    domainMap.set(domain, dAgg);
  }

  const engagementByRecipientDomain = Array.from(domainMap.values())
    .sort((a, b) => b.total - a.total)
    .slice(0, 10)
    .map((d) => ({
      ...d,
      activeRatePct: pct(d.active, d.total),
      inactiveRatePct: pct(d.inactive, d.total),
      bounceRatePct: pct(d.hardBounced, d.total),
    }));

  return {
    generatedAt: now.toISOString(),
    isDemoMode: cfg.isDemoMode,
    hasAlibabaCreds: Boolean(
      cfg.alibabaAccessKeyIdEnc && cfg.alibabaAccessKeySecretEnc
    ),
    alibabaRegion: cfg.alibabaRegion,
    alibabaAccountStatus: cfg.alibabaAccountStatus,
    alibabaLastSyncedAt: cfg.alibabaLastSyncedAt?.toISOString() ?? null,
    hasGooglePostmasterToken: Boolean(cfg.googlePostmasterTokenEnc),
    googlePostmasterDomain: cfg.googlePostmasterDomain ?? '',
    kpis,
    campaignHistory,
    listPerformance,
    campaignTrends,
    engagementByRecipientDomain,
    beforeAfterCleaning: {
      baselineConfirmedRecipients: confirmedTotal,
      alreadySuppressedCount: suppressedNow,
      recommendedSuppressionCount: recommendedSuppress,
      projectedCleanAudience: Math.max(
        0,
        confirmedTotal - suppressedNow - recommendedSuppress
      ),
      projectedVolumeReductionPct: pct(
        suppressedNow + recommendedSuppress,
        confirmedTotal
      ),
      sourceLabel: 'List Hygiene Analysis Engine',
    },
    alibabaMetrics: directMailMetrics.map((m) => ({
      id: m.id,
      date: m.metricDate.toISOString().slice(0, 10),
      domainName: m.domainName,
      source: m.source,
      requestsCount: m.requestsCount,
      deliveredCount: m.deliveredCount,
      failedCount: m.failedCount,
      invalidAddressCount: m.invalidAddressCount,
      complaintCount: m.complaintCount,
      accountStatus: m.accountStatus,
      notes: m.notes,
    })),
    dnsChecks: dnsChecks.map((d) => ({
      ...d,
      checkedAt: d.checkedAt.toISOString(),
    })),
    inboxTests: inboxTests.map((t) => ({
      ...t,
      testedAt: t.testedAt.toISOString(),
      createdAt: t.createdAt.toISOString(),
    })),
    postmasterStats: postmasterStats.map((p) => ({
      ...p,
      statDate: p.statDate.toISOString().slice(0, 10),
      createdAt: p.createdAt.toISOString(),
    })),
  };
}
