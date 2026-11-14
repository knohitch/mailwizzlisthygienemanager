import crypto from 'node:crypto';
import { prisma } from '@/lib/db';
import { buildPrismaWhereFromFilter, type FilterGroup } from '@/services/analysis/filter-engine';
import { isMailWizzMutationsEnabled } from '@/services/mutations/mailwizz-writer';
import { recordAuditLog } from '@/services/security/audit';
import { sanitizeCsvCell } from '@/services/security/csv';
import { encryptSecret, sha256Hex } from '@/services/security/crypto';
import { enqueueJob } from '@/services/jobs/queue';
import {
  evaluateActionEligibility,
  maskEmail,
  type SubscriberSafetyCandidate,
} from './safety';
import type { CleanupActionType, Prisma } from '@prisma/client';

const REMOTE_ACTIONS = new Set<CleanupActionType>([
  'UNSUBSCRIBE',
  'CREATE_LIST',
  'CREATE_SEGMENT',
  'COPY_SUBSCRIBERS',
  'MOVE_SUBSCRIBERS',
]);

export interface PreviewCleanupInput {
  actionType: CleanupActionType;
  filter: FilterGroup;
  mailingListId?: string;
  explicitSubscriberIds?: string[];
  targetListUid?: string;
  targetListName?: string;
  targetSegmentName?: string;
  newListConfig?: {
    name: string;
    description: string;
    fromName: string;
    fromEmail: string;
    replyTo: string;
    subject?: string;
  };
  allowMultiList?: boolean;
  batchSize?: number;
  actorEmail: string;
  ipAddress?: string;
}

export async function previewCleanupOperation(input: PreviewCleanupInput) {
  const cfg = await prisma.appConfig.upsert({
    where: { id: 'default' },
    update: {},
    create: { id: 'default' },
  });

  if (input.mailingListId && input.explicitSubscriberIds && input.explicitSubscriberIds.length > 0) {
    const crossListCount = await prisma.subscriber.count({
      where: {
        id: { in: input.explicitSubscriberIds },
        mailingListId: { not: input.mailingListId },
      },
    });
    if (crossListCount > 0) {
      throw new Error(
        `Subscriber list scoping violation: ${crossListCount} explicit subscriber ID(s) do not belong to the selected mailing list and cannot be substituted across lists.`
      );
    }
  }

  const filterWhere = buildPrismaWhereFromFilter(input.filter);
  const clauses: Prisma.SubscriberWhereInput[] = [];
  if (Object.keys(filterWhere).length > 0) clauses.push(filterWhere);
  if (input.mailingListId) clauses.push({ mailingListId: input.mailingListId });
  if (input.explicitSubscriberIds && input.explicitSubscriberIds.length > 0) {
    clauses.push({ id: { in: input.explicitSubscriberIds } });
  }
  const where: Prisma.SubscriberWhereInput =
    clauses.length === 0 ? {} : clauses.length === 1 ? clauses[0] : { AND: clauses };

  const matchedSubscribers = await prisma.subscriber.findMany({
    where,
    include: {
      mailingList: {
        select: {
          id: true,
          listUid: true,
          name: true,
          optIn: true,
          fromName: true,
          fromEmail: true,
          replyTo: true,
        },
      },
    },
    orderBy: [{ mailingListId: 'asc' }, { email: 'asc' }],
  });

  // Deduplicate by (mailingListUid, subscriberUid)
  const seenKeys = new Set<string>();
  const uniqueSubs = matchedSubscribers.filter((s) => {
    const key = `${s.mailingList.listUid}:${s.subscriberUid}`;
    if (seenKeys.has(key)) return false;
    seenKeys.add(key);
    return true;
  });

  const distinctLists = new Map<string, { id: string; uid: string; name: string }>();
  for (const s of uniqueSubs) {
    distinctLists.set(s.mailingList.id, {
      id: s.mailingList.id,
      uid: s.mailingList.listUid,
      name: s.mailingList.name,
    });
  }

  const warnings: string[] = [];
  if (
    distinctLists.size > 1 &&
    input.actionType === 'UNSUBSCRIBE' &&
    !input.allowMultiList
  ) {
    throw new Error(
      `Multi-list protection: selection spans ${distinctLists.size} lists. Filter to a single list or set explicit multi-list authorization (never auto-unsubscribe across all lists from single-list inactivity).`
    );
  }
  if (input.actionType === 'CREATE_SEGMENT' && distinctLists.size > 1) {
    throw new Error(
      `Segment scoping violation: selection spans ${distinctLists.size} lists. MailWizz segments must belong to a single list.`
    );
  }
  if (input.actionType === 'MOVE_SUBSCRIBERS' && !input.targetListUid) {
    throw new Error('MOVE_SUBSCRIBERS requires an explicit targetListUid.');
  }
  if (distinctLists.size > 1 && input.actionType === 'UNSUBSCRIBE') {
    warnings.push(
      `Multi-list selection (${distinctLists.size} lists): unsubscribes will only call single-list PUT /unsubscribe per explicit matched list_uid/subscriber_uid, never global unsubscribe-by-email.`
    );
  }

  if (
    input.actionType === 'COPY_SUBSCRIBERS' &&
    input.targetListUid
  ) {
    const targetList = await prisma.mailingList.findUnique({
      where: { listUid: input.targetListUid },
    });
    if (targetList && targetList.optIn?.toLowerCase() === 'double') {
      warnings.push(
        `Target list "${targetList.name}" is configured with double opt-in. Remote bulk subscriber creation is blocked to prevent triggering confirmation emails.`
      );
    }
  }

  if (REMOTE_ACTIONS.has(input.actionType) && !isMailWizzMutationsEnabled()) {
    warnings.push(
      'ENABLE_MAILWIZZ_MUTATIONS is currently false. Dry-run preview and local reports work, while remote execution on MailWizz remains locked until enabled.'
    );
  }

  const now = new Date();
  const eligibleCandidates: Array<{
    sub: (typeof uniqueSubs)[number];
    decisionReason: string;
  }> = [];
  const excludedRecords: Array<{
    sub: (typeof uniqueSubs)[number];
    reason: string;
  }> = [];
  const exclusionBreakdown: Record<string, number> = {};

  for (const sub of uniqueSubs) {
    const candidate: SubscriberSafetyCandidate = {
      id: sub.id,
      subscriberUid: sub.subscriberUid,
      mailingListId: sub.mailingListId,
      mailingListUid: sub.mailingList.listUid,
      email: sub.email,
      firstName: sub.firstName,
      lastName: sub.lastName,
      status: sub.status,
      engagementStatus: sub.engagementStatus,
      historyCoverage: sub.historyCoverage,
      deliveredCampaignsCount: sub.deliveredCampaignsCount,
      clicksCount: sub.clicksCount,
      repliesCount: sub.repliesCount,
      conversionsCount: sub.conversionsCount,
      hardBouncesCount: sub.hardBouncesCount,
      complaintsCount: sub.complaintsCount,
      lastClickAt: sub.lastClickAt,
      lastReplyAt: sub.lastReplyAt,
      lastConversionAt: sub.lastConversionAt,
      lastPurchaseAt: sub.lastPurchaseAt,
      isExcluded: sub.isExcluded,
      exclusionReason: sub.exclusionReason,
      isVip: sub.isVip,
      hasPaidRelationship: sub.hasPaidRelationship,
      isSuppressed: sub.isSuppressed,
      isArchived: sub.isArchived,
    };

    const decision = evaluateActionEligibility(candidate, input.actionType, {
      minDeliveredCampaigns: cfg.minDeliveredCampaigns,
      now,
    });

    if (decision.eligible) {
      eligibleCandidates.push({ sub, decisionReason: decision.reason });
    } else {
      excludedRecords.push({ sub, reason: decision.reason });
      exclusionBreakdown[decision.reason] =
        (exclusionBreakdown[decision.reason] ?? 0) + 1;
    }
  }

  const sourceList = input.mailingListId
    ? await prisma.mailingList.findUnique({ where: { id: input.mailingListId } })
    : distinctLists.size === 1
      ? await prisma.mailingList.findUnique({
          where: { id: Array.from(distinctLists.keys())[0] },
        })
      : null;

  const expectedConfirmListName =
    sourceList?.name ??
    (distinctLists.size > 1 ? 'ALL SELECTED LISTS' : input.newListConfig?.name ?? 'DEFAULT');

  const requiresLargeBatchApproval =
    eligibleCandidates.length >= cfg.largeChangeThreshold;

  const preChangeSnapshot = eligibleCandidates.map(({ sub }) => ({
    subscriberId: sub.id,
    subscriberUid: sub.subscriberUid,
    mailingListId: sub.mailingListId,
    mailingListUid: sub.mailingList.listUid,
    emailHash: sub.emailHash,
    maskedEmail: maskEmail(sub.email),
    status: sub.status,
    rawStatus: sub.rawStatus,
    isSuppressed: sub.isSuppressed,
    isArchived: sub.isArchived,
    engagementStatus: sub.engagementStatus,
    deliveredCampaignsCount: sub.deliveredCampaignsCount,
  }));

  const snapshotJson = JSON.stringify({
    capturedAt: now.toISOString(),
    actionType: input.actionType,
    records: preChangeSnapshot,
  });
  const snapshotEnc = encryptSecret(snapshotJson);
  const snapshotSha256 = sha256Hex(snapshotJson);

  const beforeSummary = {
    capturedAt: now.toISOString(),
    matchedCount: uniqueSubs.length,
    eligibleCount: eligibleCandidates.length,
    excludedCount: excludedRecords.length,
    suppressedInSelection: uniqueSubs.filter((s) => s.isSuppressed).length,
    confirmedInSelection: uniqueSubs.filter((s) => s.status === 'CONFIRMED').length,
    listCount: distinctLists.size,
  };

  const dryRunReport = {
    actionType: input.actionType,
    expectedConfirmListName,
    requiresLargeBatchApproval,
    largeChangeThreshold: cfg.largeChangeThreshold,
    remoteMutationsEnabled: isMailWizzMutationsEnabled(),
    isRemoteAction: REMOTE_ACTIONS.has(input.actionType),
    warnings,
    beforeSummary,
    exclusionBreakdown,
    batchSize: Math.min(50, Math.max(5, input.batchSize ?? cfg.batchSize)),
    estimatedBatches: Math.ceil(
      Math.max(1, eligibleCandidates.length) /
        Math.min(50, Math.max(5, input.batchSize ?? cfg.batchSize))
    ),
    newListConfig: input.newListConfig ?? null,
    targetSegmentName: input.targetSegmentName ?? null,
    targetListUid: input.targetListUid ?? null,
    sampleEligible: eligibleCandidates.slice(0, 20).map(({ sub, decisionReason }) => ({
      subscriberUid: sub.subscriberUid,
      maskedEmail: maskEmail(sub.email),
      engagementStatus: sub.engagementStatus,
      status: sub.status,
      reason: decisionReason,
    })),
    sampleExcluded: excludedRecords.slice(0, 20).map(({ sub, reason }) => ({
      subscriberUid: sub.subscriberUid,
      maskedEmail: maskEmail(sub.email),
      engagementStatus: sub.engagementStatus,
      status: sub.status,
      reason,
    })),
  };

  const operationId = crypto.randomUUID();
  const operationKey = `op_${crypto.randomBytes(12).toString('hex')}`;

  const operation = await prisma.cleanupOperation.create({
    data: {
      id: operationId,
      operationKey,
      actionType: input.actionType,
      mailingListId: sourceList?.id ?? input.mailingListId ?? null,
      targetListUid: input.targetListUid ?? null,
      targetListName: input.targetListName ?? input.newListConfig?.name ?? null,
      targetSegmentName: input.targetSegmentName ?? null,
      dryRunOnly: true,
      filterSpecJson: input.filter as unknown as Prisma.InputJsonValue,
      ruleConfigSnapshotJson: {
        lookbackDays: cfg.lookbackDays,
        coolingDays: cfg.coolingDays,
        inactiveDays: cfg.inactiveDays,
        longTermInactiveDays: cfg.longTermInactiveDays,
        minDeliveredCampaigns: cfg.minDeliveredCampaigns,
        largeChangeThreshold: cfg.largeChangeThreshold,
        newListConfig: input.newListConfig ?? null,
      } as unknown as Prisma.InputJsonValue,
      matchedCount: uniqueSubs.length,
      eligibleCount: eligibleCandidates.length,
      excludedCount: excludedRecords.length,
      dryRunReportJson: dryRunReport as unknown as Prisma.InputJsonValue,
      snapshotEnc,
      snapshotSha256,
      status: 'DRY_RUN_READY',
      batchSize: dryRunReport.batchSize,
      beforeSnapshotJson: beforeSummary as unknown as Prisma.InputJsonValue,
      createdByEmail: input.actorEmail,
    },
  });

  // Persist per-subscriber records in chunks
  const allRecordRows: Prisma.CleanupOperationRecordCreateManyInput[] = [
    ...eligibleCandidates.map(({ sub, decisionReason }) => ({
      operationId: operation.id,
      idempotencyKey: `${operation.id}:${sub.id}`,
      subscriberId: sub.id,
      subscriberUid: sub.subscriberUid,
      mailingListUid: sub.mailingList.listUid,
      emailHash: sub.emailHash,
      maskedEmail: maskEmail(sub.email),
      previousStatus: sub.status,
      previousSuppressed: sub.isSuppressed,
      previousEngagement: sub.engagementStatus,
      intendedAction: input.actionType,
      outcome: 'PENDING' as const,
      reason: decisionReason,
    })),
    ...excludedRecords.map(({ sub, reason }) => ({
      operationId: operation.id,
      idempotencyKey: `${operation.id}:${sub.id}`,
      subscriberId: sub.id,
      subscriberUid: sub.subscriberUid,
      mailingListUid: sub.mailingList.listUid,
      emailHash: sub.emailHash,
      maskedEmail: maskEmail(sub.email),
      previousStatus: sub.status,
      previousSuppressed: sub.isSuppressed,
      previousEngagement: sub.engagementStatus,
      intendedAction: input.actionType,
      outcome: 'SKIPPED' as const,
      reason,
      processedAt: now,
    })),
  ];

  for (let i = 0; i < allRecordRows.length; i += 500) {
    await prisma.cleanupOperationRecord.createMany({
      data: allRecordRows.slice(i, i + 500),
      skipDuplicates: true,
    });
  }

  await recordAuditLog({
    actorEmail: input.actorEmail,
    action: 'CLEANUP_DRY_RUN_CREATED',
    resourceType: 'CleanupOperation',
    resourceId: operation.id,
    outcome: 'SUCCESS',
    ipAddress: input.ipAddress,
    details: {
      actionType: input.actionType,
      matchedCount: uniqueSubs.length,
      eligibleCount: eligibleCandidates.length,
      excludedCount: excludedRecords.length,
    },
  });

  return operation;
}

export interface ConfirmCleanupInput {
  operationId: string;
  confirmedListName: string;
  confirmedCount: number;
  largeBatchApproved?: boolean;
  actorEmail: string;
  ipAddress?: string;
}

export async function confirmAndEnqueueCleanup(input: ConfirmCleanupInput) {
  const op = await prisma.cleanupOperation.findUnique({
    where: { id: input.operationId },
    include: { mailingList: { select: { name: true } } },
  });
  if (!op) throw new Error('Cleanup operation not found.');
  if (op.status !== 'DRY_RUN_READY') {
    throw new Error(`Operation cannot be confirmed from status ${op.status}.`);
  }

  const report = op.dryRunReportJson as {
    expectedConfirmListName?: string;
    requiresLargeBatchApproval?: boolean;
    isRemoteAction?: boolean;
  };

  if (op.eligibleCount === 0 && op.actionType !== 'CREATE_LIST' && op.actionType !== 'CREATE_SEGMENT') {
    throw new Error('Zero eligible subscribers in dry-run preview; nothing safe to execute.');
  }

  const expectedName = (report.expectedConfirmListName ?? op.mailingList?.name ?? '').trim();
  if (expectedName && input.confirmedListName.trim() !== expectedName) {
    throw new Error(
      `Confirmation list name mismatch. Expected exact name "${expectedName}".`
    );
  }

  if (input.confirmedCount !== op.eligibleCount) {
    throw new Error(
      `Confirmation count mismatch. Expected exact eligible count ${op.eligibleCount}.`
    );
  }

  if (report.requiresLargeBatchApproval && !input.largeBatchApproved) {
    throw new Error(
      `Large-change protection: operations affecting >= threshold (${op.eligibleCount} subscribers) require explicit large-batch approval checkbox.`
    );
  }

  if (REMOTE_ACTIONS.has(op.actionType) && !isMailWizzMutationsEnabled()) {
    await recordAuditLog({
      actorEmail: input.actorEmail,
      action: 'CLEANUP_CONFIRM_BLOCKED_READONLY',
      resourceType: 'CleanupOperation',
      resourceId: op.id,
      outcome: 'DENIED',
      ipAddress: input.ipAddress,
      details: { actionType: op.actionType, reason: 'ENABLE_MAILWIZZ_MUTATIONS=false' },
    });
    throw new Error(
      `Remote MailWizz action "${op.actionType}" is disabled because ENABLE_MAILWIZZ_MUTATIONS=false. Use application suppression (SUPPRESS), CSV export, or enable remote mutations explicitly in server environment.`
    );
  }

  const claimed = await prisma.cleanupOperation.updateMany({
    where: { id: op.id, status: 'DRY_RUN_READY', dryRunOnly: true },
    data: {
      dryRunOnly: false,
      status: 'CONFIRMED',
      confirmedByEmail: input.actorEmail,
      confirmedListName: input.confirmedListName.trim(),
      confirmedCount: input.confirmedCount,
      largeBatchApprovedBy: input.largeBatchApproved ? input.actorEmail : null,
      confirmedAt: new Date(),
    },
  });
  if (claimed.count === 0) {
    throw new Error(
      'Operation could not be confirmed because it was already confirmed or modified concurrently.'
    );
  }

  const job = await enqueueJob({
    type: 'HYGIENE_EXECUTION',
    payload: { operationId: op.id, actorEmail: input.actorEmail },
    maxAttempts: 2,
  });

  const updated = await prisma.cleanupOperation.update({
    where: { id: op.id },
    data: {
      syncJobId: job.id,
    },
  });

  await recordAuditLog({
    actorEmail: input.actorEmail,
    action: 'CLEANUP_OPERATION_CONFIRMED',
    resourceType: 'CleanupOperation',
    resourceId: op.id,
    outcome: 'SUCCESS',
    ipAddress: input.ipAddress,
    details: {
      actionType: op.actionType,
      confirmedCount: input.confirmedCount,
      syncJobId: job.id,
      snapshotSha256: op.snapshotSha256,
    },
  });

  return { operation: updated, job };
}

export async function buildDryRunCsvReport(operationId: string): Promise<string> {
  const records = await prisma.cleanupOperationRecord.findMany({
    where: { operationId },
    orderBy: [{ outcome: 'asc' }, { subscriberUid: 'asc' }],
  });

  const lines = [
    ['subscriber_uid', 'list_uid', 'masked_email', 'current_status', 'engagement_status', 'intended_action', 'dry_run_eligibility', 'reason'].join(','),
  ];

  const esc = sanitizeCsvCell;

  for (const r of records) {
    lines.push(
      [
        esc(r.subscriberUid),
        esc(r.mailingListUid),
        esc(r.maskedEmail),
        esc(r.previousStatus),
        esc(r.previousEngagement),
        esc(r.intendedAction),
        esc(r.outcome === 'PENDING' ? 'ELIGIBLE' : 'EXCLUDED'),
        esc(r.reason ?? ''),
      ].join(',')
    );
  }

  return lines.join('\n');
}
