import { prisma } from '@/lib/db';
import { maskEmail } from '@/services/cleanup/safety';

export type HygieneReportType =
  | 'ACTIVE_AUDIENCE'
  | 'INACTIVE_AUDIENCE'
  | 'NEVER_ENGAGED'
  | 'SUPPRESSION_RECOMMENDATIONS'
  | 'REENGAGEMENT'
  | 'CLEANUP_EXECUTION'
  | 'BEFORE_AFTER_COMPARISON'
  | 'DATA_QUALITY';

export async function generateAllReportsSummary(mailingListId?: string) {
  const whereList = mailingListId ? { mailingListId } : {};

  const [
    totalSubscribers,
    byEngagement,
    byConfidence,
    byCoverage,
    suppressedCount,
    archivedCount,
    vipOrPaidCount,
    openOnlyCount,
    clickNoOpenCount,
    reengagementPlans,
    cleanupOperations,
    lists,
  ] = await Promise.all([
    prisma.subscriber.count({ where: whereList }),
    prisma.subscriber.groupBy({
      by: ['engagementStatus'],
      where: whereList,
      _count: { _all: true },
    }),
    prisma.subscriber.groupBy({
      by: ['engagementConfidence'],
      where: whereList,
      _count: { _all: true },
    }),
    prisma.subscriber.groupBy({
      by: ['historyCoverage'],
      where: whereList,
      _count: { _all: true },
    }),
    prisma.subscriber.count({ where: { ...whereList, isSuppressed: true } }),
    prisma.subscriber.count({ where: { ...whereList, isArchived: true } }),
    prisma.subscriber.count({
      where: {
        ...whereList,
        OR: [{ isVip: true }, { hasPaidRelationship: true }],
      },
    }),
    prisma.subscriber.count({
      where: {
        ...whereList,
        engagementStatus: 'ACTIVE',
        opensCount: { gt: 0 },
        clicksCount: 0,
        repliesCount: 0,
        conversionsCount: 0,
      },
    }),
    prisma.subscriber.count({
      where: {
        ...whereList,
        clicksCount: { gt: 0 },
        opensCount: 0,
      },
    }),
    prisma.reengagementPlan.findMany({
      where: mailingListId ? { mailingListId } : {},
      orderBy: { createdAt: 'desc' },
      take: 25,
      include: { mailingList: { select: { name: true, listUid: true } } },
    }),
    prisma.cleanupOperation.findMany({
      where: mailingListId ? { mailingListId } : {},
      orderBy: { createdAt: 'desc' },
      take: 25,
      include: { mailingList: { select: { name: true, listUid: true } } },
    }),
    prisma.mailingList.findMany({
      where: mailingListId ? { id: mailingListId } : {},
      select: {
        id: true,
        listUid: true,
        name: true,
        syncedSubscriberCount: true,
        confirmedCount: true,
        unsubscribedCount: true,
      },
    }),
  ]);

  const engagementCounts: Record<string, number> = {};
  for (const row of byEngagement) engagementCounts[row.engagementStatus] = row._count._all;

  const confidenceCounts: Record<string, number> = {};
  for (const row of byConfidence) confidenceCounts[row.engagementConfidence] = row._count._all;

  const coverageCounts: Record<string, number> = {};
  for (const row of byCoverage) coverageCounts[row.historyCoverage] = row._count._all;

  const suppressionRecommendedCount = await prisma.subscriber.count({
    where: {
      ...whereList,
      status: 'CONFIRMED',
      isSuppressed: false,
      isExcluded: false,
      isVip: false,
      hasPaidRelationship: false,
      historyCoverage: 'VERIFIED_FULL',
      engagementStatus: { in: ['INACTIVE', 'LONG_TERM_INACTIVE', 'NEVER_ENGAGED'] },
    },
  });

  const confirmedTotal = lists.reduce((acc, l) => acc + l.confirmedCount, 0);
  const currentSendableAfterSuppression = Math.max(0, confirmedTotal - suppressedCount);

  return {
    generatedAt: new Date().toISOString(),
    totalSubscribers,
    activeAudience: {
      activeCount: engagementCounts.ACTIVE ?? 0,
      coolingCount: engagementCounts.COOLING ?? 0,
      openOnlyMppCaveatCount: openOnlyCount,
      clickWithoutOpenCount: clickNoOpenCount,
    },
    inactiveAudience: {
      inactiveCount: engagementCounts.INACTIVE ?? 0,
      longTermInactiveCount: engagementCounts.LONG_TERM_INACTIVE ?? 0,
    },
    neverEngaged: {
      neverEngagedCount: engagementCounts.NEVER_ENGAGED ?? 0,
    },
    suppressionRecommendations: {
      recommendedCount: suppressionRecommendedCount,
      currentlySuppressedCount: suppressedCount,
      currentlyArchivedCount: archivedCount,
      protectedVipOrPaidCount: vipOrPaidCount,
    },
    reengagement: {
      totalPlans: reengagementPlans.length,
      totalRecovered: reengagementPlans.reduce((a, p) => a + p.recoveredCount, 0),
      totalPersistentlyInactive: reengagementPlans.reduce(
        (a, p) => a + p.persistentlyInactiveCount,
        0
      ),
      plans: reengagementPlans.map((p) => ({
        id: p.id,
        name: p.name,
        listName: p.mailingList.name,
        status: p.status,
        eligibleCount: p.eligibleCount,
        recoveredCount: p.recoveredCount,
        persistentlyInactiveCount: p.persistentlyInactiveCount,
        mailwizzCampaignUid: p.mailwizzCampaignUid,
        windowEndsAt: p.windowEndsAt,
      })),
    },
    cleanupExecution: {
      totalOperations: cleanupOperations.length,
      operations: cleanupOperations.map((op) => ({
        id: op.id,
        actionType: op.actionType,
        status: op.status,
        listName: op.mailingList?.name ?? op.targetListName ?? 'Multi-list',
        matchedCount: op.matchedCount,
        eligibleCount: op.eligibleCount,
        succeededCount: op.succeededCount,
        skippedCount: op.skippedCount,
        failedCount: op.failedCount,
        reconciledCount: op.reconciledCount,
        autoStopReason: op.autoStopReason,
        createdAt: op.createdAt,
        completedAt: op.completedAt,
      })),
    },
    beforeAfterComparison: {
      baselineConfirmedRecipients: confirmedTotal,
      currentlySuppressedFromRoutineSends: suppressedCount,
      currentRecommendedCleanRecipients: Math.max(
        0,
        confirmedTotal - suppressedCount - suppressionRecommendedCount
      ),
      currentSendableAfterSuppression,
      estimatedRoutineSendReductionPct:
        confirmedTotal > 0
          ? Number(
              (
                ((suppressedCount + suppressionRecommendedCount) / confirmedTotal) *
                100
              ).toFixed(1)
            )
          : 0,
      alreadyUnsubscribedInMailWizz: lists.reduce(
        (acc, l) => acc + l.unsubscribedCount,
        0
      ),
    },
    dataQuality: {
      insufficientDataCount: engagementCounts.INSUFFICIENT_DATA ?? 0,
      excludedCount: engagementCounts.EXCLUDED ?? 0,
      confidenceCounts,
      coverageCounts,
      openOnlyMppCaveatCount: openOnlyCount,
      clickWithoutOpenCount: clickNoOpenCount,
    },
  };
}

export async function generateReportCsv(params: {
  reportType: HygieneReportType;
  mailingListId?: string;
  maskContacts?: boolean;
}): Promise<{ filename: string; csv: string; rowCount: number }> {
  const mask = params.maskContacts ?? false;
  const whereList = params.mailingListId ? { mailingListId: params.mailingListId } : {};

  const esc = (v: unknown) => {
    const s = String(v ?? '');
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };

  if (params.reportType === 'CLEANUP_EXECUTION') {
    const ops = await prisma.cleanupOperation.findMany({
      where: params.mailingListId ? { mailingListId: params.mailingListId } : {},
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { mailingList: { select: { name: true } } },
    });
    const header = [
      'operation_id',
      'action_type',
      'status',
      'list_name',
      'matched_count',
      'eligible_count',
      'succeeded_count',
      'skipped_count',
      'failed_count',
      'reconciled_count',
      'created_at',
      'completed_at',
    ].join(',');
    const lines = ops.map((op) =>
      [
        esc(op.id),
        esc(op.actionType),
        esc(op.status),
        esc(op.mailingList?.name ?? op.targetListName ?? ''),
        op.matchedCount,
        op.eligibleCount,
        op.succeededCount,
        op.skippedCount,
        op.failedCount,
        op.reconciledCount,
        esc(op.createdAt.toISOString()),
        esc(op.completedAt?.toISOString() ?? ''),
      ].join(',')
    );
    return {
      filename: 'cleanup-execution-report.csv',
      csv: [header, ...lines].join('\n'),
      rowCount: ops.length,
    };
  }

  if (params.reportType === 'REENGAGEMENT') {
    const plans = await prisma.reengagementPlan.findMany({
      where: params.mailingListId ? { mailingListId: params.mailingListId } : {},
      orderBy: { createdAt: 'desc' },
      include: { mailingList: { select: { name: true } } },
    });
    const header = [
      'plan_id',
      'name',
      'list_name',
      'status',
      'eligible_count',
      'excluded_count',
      'campaign_uid',
      'recovered_count',
      'persistently_inactive_count',
      'window_ends_at',
    ].join(',');
    const lines = plans.map((p) =>
      [
        esc(p.id),
        esc(p.name),
        esc(p.mailingList.name),
        esc(p.status),
        p.eligibleCount,
        p.excludedCount,
        esc(p.mailwizzCampaignUid ?? ''),
        p.recoveredCount,
        p.persistentlyInactiveCount,
        esc(p.windowEndsAt?.toISOString() ?? ''),
      ].join(',')
    );
    return {
      filename: 'reengagement-report.csv',
      csv: [header, ...lines].join('\n'),
      rowCount: plans.length,
    };
  }

  let subWhere: Record<string, unknown> = { ...whereList };
  if (params.reportType === 'ACTIVE_AUDIENCE') {
    subWhere = { ...whereList, engagementStatus: { in: ['ACTIVE', 'COOLING'] } };
  } else if (params.reportType === 'INACTIVE_AUDIENCE') {
    subWhere = {
      ...whereList,
      engagementStatus: { in: ['INACTIVE', 'LONG_TERM_INACTIVE'] },
    };
  } else if (params.reportType === 'NEVER_ENGAGED') {
    subWhere = { ...whereList, engagementStatus: 'NEVER_ENGAGED' };
  } else if (params.reportType === 'SUPPRESSION_RECOMMENDATIONS') {
    subWhere = {
      ...whereList,
      status: 'CONFIRMED',
      isSuppressed: false,
      isExcluded: false,
      isVip: false,
      hasPaidRelationship: false,
      historyCoverage: 'VERIFIED_FULL',
      engagementStatus: { in: ['INACTIVE', 'LONG_TERM_INACTIVE', 'NEVER_ENGAGED'] },
    };
  } else if (params.reportType === 'DATA_QUALITY') {
    subWhere = {
      ...whereList,
      OR: [
        { engagementStatus: 'INSUFFICIENT_DATA' },
        { engagementConfidence: { in: ['LOW', 'NONE'] } },
      ],
    };
  }

  const rows = await prisma.subscriber.findMany({
    where: subWhere,
    orderBy: [{ engagementStatus: 'asc' }, { deliveredCampaignsCount: 'desc' }],
    take: 5000,
    include: { mailingList: { select: { name: true, listUid: true } } },
  });

  const header = [
    'subscriber_uid',
    'list_name',
    'email',
    'mailwizz_status',
    'engagement_status',
    'confidence',
    'history_coverage',
    'delivered_campaigns',
    'opens',
    'clicks',
    'is_suppressed',
    'explanation',
  ].join(',');

  const lines = rows.map((s) =>
    [
      esc(s.subscriberUid),
      esc(s.mailingList.name),
      esc(mask ? maskEmail(s.email) : s.email),
      esc(s.status),
      esc(s.engagementStatus),
      esc(s.engagementConfidence),
      esc(s.historyCoverage),
      s.deliveredCampaignsCount,
      s.opensCount,
      s.clicksCount,
      s.isSuppressed ? 'true' : 'false',
      esc(s.engagementReason ?? s.hygieneReason ?? ''),
    ].join(',')
  );

  return {
    filename: `${params.reportType.toLowerCase()}.csv`,
    csv: [header, ...lines].join('\n'),
    rowCount: rows.length,
  };
}
