import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireApiAuth } from '@/lib/api-auth';
import type { HygieneStatus, Prisma, SubscriberStatus } from '@prisma/client';

const ALLOWED_SORT_FIELDS = new Set([
  'email',
  'status',
  'hygieneStatus',
  'deliveredCampaignsCount',
  'opensCount',
  'clicksCount',
  'hardBouncesCount',
  'lastOpenAt',
  'lastStrongEngagementAt',
  'dateAddedMailwizz',
]);

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ listId: string }> }
) {
  const auth = await requireApiAuth(req, { rateLimitBucket: 'list-detail' });
  if (!auth.ok) return auth.response;

  const { listId } = await context.params;
  const list = await prisma.mailingList.findFirst({
    where: { OR: [{ id: listId }, { listUid: listId }] },
    include: {
      segments: {
        orderBy: { name: 'asc' },
      },
    },
  });

  if (!list) {
    return NextResponse.json({ error: 'Mailing list not found.' }, { status: 404 });
  }

  const sp = req.nextUrl.searchParams;
  const q = sp.get('q')?.trim() ?? '';
  const statusFilter = sp.get('status')?.trim() || undefined;
  const hygieneFilter = sp.get('hygiene')?.trim() || undefined;
  const sortByRaw = sp.get('sortBy')?.trim() || 'hygieneStatus';
  const sortBy = ALLOWED_SORT_FIELDS.has(sortByRaw) ? sortByRaw : 'hygieneStatus';
  const sortDir = sp.get('sortDir') === 'desc' ? 'desc' : 'asc';
  const page = Math.max(1, Number(sp.get('page')) || 1);
  const pageSize = Math.min(100, Math.max(10, Number(sp.get('pageSize')) || 25));

  const where: Prisma.SubscriberWhereInput = {
    mailingListId: list.id,
    ...(q
      ? {
          OR: [
            { email: { contains: q, mode: 'insensitive' } },
            { firstName: { contains: q, mode: 'insensitive' } },
            { lastName: { contains: q, mode: 'insensitive' } },
            { subscriberUid: { contains: q, mode: 'insensitive' } },
          ],
        }
      : {}),
    ...(statusFilter && statusFilter !== 'ALL'
      ? { status: statusFilter as SubscriberStatus }
      : {}),
    ...(hygieneFilter && hygieneFilter !== 'ALL'
      ? { hygieneStatus: hygieneFilter as HygieneStatus }
      : {}),
  };

  const [totalMatched, subscribers, hygieneBreakdown, campaigns] = await Promise.all([
    prisma.subscriber.count({ where }),
    prisma.subscriber.findMany({
      where,
      orderBy: { [sortBy]: sortDir },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.subscriber.groupBy({
      by: ['hygieneStatus'],
      where: { mailingListId: list.id },
      _count: { _all: true },
    }),
    prisma.campaign.findMany({
      where: { mailingListId: list.id },
      orderBy: { sendAt: 'desc' },
    }),
  ]);

  const hygieneCounts: Record<string, number> = {};
  for (const h of hygieneBreakdown) {
    hygieneCounts[h.hygieneStatus] = h._count._all;
  }

  return NextResponse.json({
    list,
    hygieneCounts,
    campaigns,
    pagination: {
      page,
      pageSize,
      totalMatched,
      totalPages: Math.max(1, Math.ceil(totalMatched / pageSize)),
    },
    subscribers,
  });
}
