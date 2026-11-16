import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireApiAuth } from '@/lib/api-auth';
import { prisma } from '@/lib/db';
import {
  FilterGroupSchema,
  queryFilteredSubscribers,
} from '@/services/analysis/filter-engine';
import { recomputeAllHygieneClassifications } from '@/services/analysis/classifier';
import { recordAuditLog } from '@/services/security/audit';

const FilterRequestSchema = z.object({
  filter: FilterGroupSchema,
  customerConnectionId: z.string().trim().optional(),
  mailingListId: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});

const ProtectionUpdateSchema = z.object({
  subscriberId: z.string().min(1),
  customerConnectionId: z.string().trim().optional(),
  isVip: z.boolean().optional(),
  hasPaidRelationship: z.boolean().optional(),
  protectionNote: z.string().max(300).optional().nullable(),
});

export async function POST(req: NextRequest) {
  const auth = await requireApiAuth(req, {
    requireCsrf: true,
    rateLimitBucket: 'subscribers-filter',
    limitPerMin: 120,
  });
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 });
  }

  const parsed = FilterRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid filter query.', issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const result = await queryFilteredSubscribers({
    filter: parsed.data.filter,
    customerConnectionId: parsed.data.customerConnectionId,
    mailingListId: parsed.data.mailingListId,
    page: parsed.data.page,
    pageSize: parsed.data.pageSize,
  });

  return NextResponse.json({
    totalMatched: result.totalMatched,
    page: result.page,
    pageSize: result.pageSize,
    byEngagementStatus: result.byEngagementStatus,
    subscribers: result.subscribers.map((s) => ({
      id: s.id,
      customerConnectionId: s.customerConnectionId,
      subscriberUid: s.subscriberUid,
      mailingListId: s.mailingListId,
      listName: s.mailingList.name,
      listUid: s.mailingList.listUid,
      email: s.email,
      firstName: s.firstName,
      lastName: s.lastName,
      status: s.status,
      source: s.source,
      engagementStatus: s.engagementStatus,
      engagementReason: s.engagementReason,
      descriptiveTags: s.descriptiveTagsJson,
      engagementConfidence: s.engagementConfidence,
      historyCoverage: s.historyCoverage,
      deliveredCampaignsCount: s.deliveredCampaignsCount,
      opensCount: s.opensCount,
      clicksCount: s.clicksCount,
      lastDeliveredAt: s.lastDeliveredAt,
      lastOpenAt: s.lastOpenAt,
      lastClickAt: s.lastClickAt,
      lastReplyAt: s.lastReplyAt,
      lastConversionAt: s.lastConversionAt,
      dateAddedMailwizz: s.dateAddedMailwizz,
      isSuppressed: s.isSuppressed,
      suppressionReason: s.suppressionReason,
      isArchived: s.isArchived,
      isVip: s.isVip,
      hasPaidRelationship: s.hasPaidRelationship,
      isExcluded: s.isExcluded,
      exclusionReason: s.exclusionReason,
    })),
  });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireApiAuth(req, {
    requireCsrf: true,
    rateLimitBucket: 'subscriber-protection',
    limitPerMin: 60,
  });
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 });
  }

  const parsed = ProtectionUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed.', issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  if (parsed.data.customerConnectionId) {
    const existing = await prisma.subscriber.findUnique({
      where: { id: parsed.data.subscriberId },
      select: { customerConnectionId: true },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Subscriber not found.' }, { status: 404 });
    }
    if (existing.customerConnectionId !== parsed.data.customerConnectionId) {
      return NextResponse.json(
        { error: 'Subscriber does not belong to the specified customer connection.' },
        { status: 403 }
      );
    }
  }

  const updated = await prisma.subscriber.update({
    where: { id: parsed.data.subscriberId },
    data: {
      ...(parsed.data.isVip !== undefined ? { isVip: parsed.data.isVip } : {}),
      ...(parsed.data.hasPaidRelationship !== undefined
        ? { hasPaidRelationship: parsed.data.hasPaidRelationship }
        : {}),
      ...(parsed.data.protectionNote !== undefined
        ? { protectionNote: parsed.data.protectionNote }
        : {}),
    },
  });

  await recomputeAllHygieneClassifications(
    updated.mailingListId,
    updated.customerConnectionId
  );

  await recordAuditLog({
    customerConnectionId: updated.customerConnectionId,
    actorEmail: auth.session.adminEmail,
    action: 'UPDATE_SUBSCRIBER_PROTECTION',
    resourceType: 'Subscriber',
    resourceId: updated.id,
    outcome: 'SUCCESS',
    ipAddress: auth.ip,
    details: {
      isVip: updated.isVip,
      hasPaidRelationship: updated.hasPaidRelationship,
    },
  });

  return NextResponse.json({ ok: true, subscriberId: updated.id });
}
