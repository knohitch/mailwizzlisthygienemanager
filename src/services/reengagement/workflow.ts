import { prisma } from '@/lib/db';
import { buildPrismaWhereFromFilter, type FilterGroup } from '@/services/analysis/filter-engine';
import { recomputeAllHygieneClassifications } from '@/services/analysis/classifier';
import { createConfiguredMutationClient, isMailWizzMutationsEnabled } from '@/services/mutations/gate';
import { previewCleanupOperation } from '@/services/cleanup/planner';
import { maskEmail } from '@/services/cleanup/safety';
import { recordAuditLog } from '@/services/security/audit';
import type { Prisma } from '@prisma/client';

export interface CreateReengagementPlanInput {
  name: string;
  mailingListId: string;
  filter?: FilterGroup;
  responseWindowDays?: number;
  suggestedSubject?: string;
  suggestedPreviewText?: string;
  suggestedBodyMarkdown?: string;
  actorEmail: string;
}

export async function createReengagementPlan(input: CreateReengagementPlanInput) {
  const list = await prisma.mailingList.findUnique({
    where: { id: input.mailingListId },
  });
  if (!list) throw new Error('Mailing list not found.');

  const defaultFilter: FilterGroup = input.filter ?? {
    combinator: 'AND',
    conditions: [
      {
        field: 'engagementStatus',
        op: 'in',
        value: ['INACTIVE', 'LONG_TERM_INACTIVE', 'NEVER_ENGAGED'],
      },
      { field: 'status', op: 'eq', value: 'CONFIRMED' },
      { field: 'isProtectedOrVip', op: 'eq', value: false },
    ],
  };

  const whereFilter = buildPrismaWhereFromFilter(defaultFilter);
  const candidates = await prisma.subscriber.findMany({
    where: {
      AND: [{ mailingListId: list.id }, whereFilter],
    },
    select: {
      id: true,
      status: true,
      complaintsCount: true,
      hardBouncesCount: true,
      isVip: true,
      hasPaidRelationship: true,
      isExcluded: true,
      historyCoverage: true,
    },
  });

  // Strict safety exclusions: never re-engagement mail opt-outs, complaints, hard bounces, VIPs, or paid customers
  const eligible = candidates.filter(
    (s) =>
      s.status === 'CONFIRMED' &&
      s.complaintsCount === 0 &&
      s.hardBouncesCount === 0 &&
      !s.isVip &&
      !s.hasPaidRelationship &&
      !s.isExcluded &&
      s.historyCoverage === 'VERIFIED_FULL'
  );
  const excludedCount = candidates.length - eligible.length;

  const subject =
    input.suggestedSubject?.trim() ||
    `Quick check-in from ${list.fromName || list.name}: still want our emails?`;
  const previewText =
    input.suggestedPreviewText?.trim() ||
    'Click to stay on our active list, or update preferences anytime.';
  const bodyMarkdown =
    input.suggestedBodyMarkdown?.trim() ||
    [
      `Hi {{FNAME}},`,
      '',
      `We noticed you haven't interacted with our recent emails from **${list.fromName || list.name}**.`,
      `To keep our updates relevant and avoid cluttering your inbox, let us know if you'd like to continue receiving messages:`,
      '',
      `- **[Yes, keep me subscribed](#confirm-interest-url)**`,
      `- **[Manage frequency or unsubscribe]({{UNSUBSCRIBE_URL}})**`,
      '',
      `If we don't hear back within ${input.responseWindowDays ?? 14} days, we will pause routine campaigns so you only receive essential notices.`,
    ].join('\n');

  const plan = await prisma.reengagementPlan.create({
    data: {
      name: input.name.trim(),
      mailingListId: list.id,
      filterSpecJson: defaultFilter as unknown as Prisma.InputJsonValue,
      eligibleCount: eligible.length,
      excludedCount,
      suggestedSubject: subject,
      suggestedPreviewText: previewText,
      suggestedBodyMarkdown: bodyMarkdown,
      responseWindowDays: Math.min(90, Math.max(3, input.responseWindowDays ?? 14)),
      status: 'DRAFT',
      createdByEmail: input.actorEmail,
    },
  });

  await recordAuditLog({
    actorEmail: input.actorEmail,
    action: 'REENGAGEMENT_PLAN_CREATED',
    resourceType: 'ReengagementPlan',
    resourceId: plan.id,
    outcome: 'SUCCESS',
    details: {
      mailingListId: list.id,
      eligibleCount: eligible.length,
      excludedCount,
    },
  });

  return plan;
}

export async function createSegmentForReengagementPlan(params: {
  planId: string;
  actorEmail: string;
}) {
  const plan = await prisma.reengagementPlan.findUnique({
    where: { id: params.planId },
    include: { mailingList: true },
  });
  if (!plan) throw new Error('Re-engagement plan not found.');

  if (!isMailWizzMutationsEnabled()) {
    throw new Error(
      'Remote MailWizz segment creation requires ENABLE_MAILWIZZ_MUTATIONS=true. Create the segment manually in MailWizz or enable mutations in server config.'
    );
  }

  const { client } = await createConfiguredMutationClient();
  const res = await client.createOrUpdateSegment({
    listUid: plan.mailingList.listUid,
    segmentUid: plan.segmentUid ?? undefined,
    name: `Re-engage: ${plan.name}`.slice(0, 60),
    operatorMatch: 'all',
    actorEmail: params.actorEmail,
  });

  const updated = await prisma.reengagementPlan.update({
    where: { id: plan.id },
    data: {
      segmentUid: res.segmentUid,
      status: 'SEGMENT_CREATED',
    },
  });

  await recordAuditLog({
    actorEmail: params.actorEmail,
    action: 'REENGAGEMENT_SEGMENT_CREATED',
    resourceType: 'ReengagementPlan',
    resourceId: plan.id,
    outcome: 'SUCCESS',
    details: { segmentUid: res.segmentUid },
  });

  return updated;
}

export async function approveReengagementCampaignManually(params: {
  planId: string;
  mailwizzCampaignUid: string;
  responseWindowDays?: number;
  actorEmail: string;
}) {
  const plan = await prisma.reengagementPlan.findUnique({
    where: { id: params.planId },
  });
  if (!plan) throw new Error('Re-engagement plan not found.');
  if (!params.mailwizzCampaignUid.trim()) {
    throw new Error('MailWizz Campaign UID is required to link a manually approved campaign.');
  }

  const windowDays = params.responseWindowDays ?? plan.responseWindowDays;
  const now = new Date();
  const endsAt = new Date(now.getTime() + windowDays * 86_400_000);

  const updated = await prisma.reengagementPlan.update({
    where: { id: plan.id },
    data: {
      mailwizzCampaignUid: params.mailwizzCampaignUid.trim(),
      manualCampaignApproved: true,
      approvedByEmail: params.actorEmail,
      approvedAt: now,
      responseWindowDays: windowDays,
      windowStartedAt: now,
      windowEndsAt: endsAt,
      status: 'AWAITING_RESPONSE',
    },
  });

  await recordAuditLog({
    actorEmail: params.actorEmail,
    action: 'REENGAGEMENT_CAMPAIGN_MANUALLY_APPROVED',
    resourceType: 'ReengagementPlan',
    resourceId: plan.id,
    outcome: 'SUCCESS',
    details: {
      mailwizzCampaignUid: params.mailwizzCampaignUid.trim(),
      responseWindowDays: windowDays,
      note: 'Manual approval recorded; application never auto-sends emails.',
    },
  });

  return updated;
}

export async function evaluateReengagementPlan(params: {
  planId: string;
  actorEmail: string;
  createSuppressionDryRun?: boolean;
}) {
  const plan = await prisma.reengagementPlan.findUnique({
    where: { id: params.planId },
    include: { mailingList: true },
  });
  if (!plan) throw new Error('Re-engagement plan not found.');

  const cfg = await prisma.appConfig.upsert({
    where: { id: 'default' },
    update: {},
    create: { id: 'default' },
  });

  const filter = plan.filterSpecJson as unknown as FilterGroup;
  const whereFilter = buildPrismaWhereFromFilter(filter);
  const windowStart = plan.windowStartedAt ?? plan.createdAt;

  const cohort = await prisma.subscriber.findMany({
    where: {
      AND: [{ mailingListId: plan.mailingListId }, whereFilter],
    },
    include: {
      engagementEvents: {
        where: {
          occurredAt: { gte: windowStart },
          eventType: { in: ['OPEN', 'CLICK', 'REPLY', 'CONVERSION'] },
        },
        select: { eventType: true, occurredAt: true, source: true },
      },
    },
  });

  const recoveredIds: string[] = [];
  const persistentlyInactiveIds: string[] = [];
  const recoveredSamples: Array<{ subscriberUid: string; maskedEmail: string; eventTypes: string[] }> = [];

  for (const sub of cohort) {
    if (
      sub.status !== 'CONFIRMED' ||
      sub.complaintsCount > 0 ||
      sub.hardBouncesCount > 0 ||
      sub.isVip ||
      sub.hasPaidRelationship
    ) {
      continue;
    }

    const renewed = sub.engagementEvents.filter((ev) => {
      if (ev.eventType === 'CLICK' || ev.eventType === 'REPLY' || ev.eventType === 'CONVERSION') {
        return true;
      }
      return ev.eventType === 'OPEN' && cfg.countOpensAsEngaged;
    });

    if (renewed.length > 0) {
      recoveredIds.push(sub.id);
      if (recoveredSamples.length < 15) {
        recoveredSamples.push({
          subscriberUid: sub.subscriberUid,
          maskedEmail: maskEmail(sub.email),
          eventTypes: Array.from(new Set(renewed.map((e) => e.eventType))),
        });
      }
    } else {
      persistentlyInactiveIds.push(sub.id);
    }
  }

  // Restore newly engaged contacts back to ACTIVE segment/state
  if (recoveredIds.length > 0) {
    await prisma.subscriber.updateMany({
      where: { id: { in: recoveredIds } },
      data: {
        isSuppressed: false,
        suppressionReason: null,
        suppressedAt: null,
      },
    });
    await recomputeAllHygieneClassifications(plan.mailingListId);
  }

  let suppressionOpId: string | null = null;
  if (params.createSuppressionDryRun && persistentlyInactiveIds.length > 0) {
    const op = await previewCleanupOperation({
      actionType: 'SUPPRESS',
      mailingListId: plan.mailingListId,
      explicitSubscriberIds: persistentlyInactiveIds,
      filter: { combinator: 'AND', conditions: [] },
      actorEmail: params.actorEmail,
    });
    suppressionOpId = op.id;
  }

  const summary = {
    evaluatedAt: new Date().toISOString(),
    windowStartedAt: windowStart.toISOString(),
    recoveredCount: recoveredIds.length,
    persistentlyInactiveCount: persistentlyInactiveIds.length,
    recoveredSamples,
    recommendedNextStep:
      persistentlyInactiveIds.length > 0
        ? 'Suppress persistently inactive contacts from routine campaigns (recommended default).'
        : 'All responsive contacts restored; no suppression required.',
    suppressionDryRunOperationId: suppressionOpId,
  };

  const updated = await prisma.reengagementPlan.update({
    where: { id: plan.id },
    data: {
      status: 'EVALUATED',
      recoveredCount: recoveredIds.length,
      persistentlyInactiveCount: persistentlyInactiveIds.length,
      suppressedOperationId: suppressionOpId,
      evaluationSummaryJson: summary as unknown as Prisma.InputJsonValue,
    },
  });

  await recordAuditLog({
    actorEmail: params.actorEmail,
    action: 'REENGAGEMENT_PLAN_EVALUATED',
    resourceType: 'ReengagementPlan',
    resourceId: plan.id,
    outcome: 'SUCCESS',
    details: summary,
  });

  return updated;
}
