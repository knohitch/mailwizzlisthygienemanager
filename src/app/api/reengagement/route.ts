import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireApiAuth } from '@/lib/api-auth';
import { prisma } from '@/lib/db';
import { FilterGroupSchema } from '@/services/analysis/filter-engine';
import { createReengagementPlan } from '@/services/reengagement/workflow';

const CreatePlanSchema = z.object({
  customerConnectionId: z.string().trim().optional(),
  name: z.string().trim().min(3).max(120),
  mailingListId: z.string().min(1),
  filter: FilterGroupSchema.optional(),
  responseWindowDays: z.coerce.number().int().min(3).max(90).default(14),
  suggestedSubject: z.string().trim().max(200).optional(),
  suggestedPreviewText: z.string().trim().max(250).optional(),
  suggestedBodyMarkdown: z.string().trim().max(4000).optional(),
});

export async function GET(req: NextRequest) {
  const auth = await requireApiAuth(req, { rateLimitBucket: 'reengagement-read' });
  if (!auth.ok) return auth.response;

  const customerConnectionId =
    req.nextUrl.searchParams.get('customerConnectionId')?.trim() || undefined;

  const [plans, lists] = await Promise.all([
    prisma.reengagementPlan.findMany({
      where: customerConnectionId ? { customerConnectionId } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 30,
      include: {
        customerConnection: { select: { id: true, customerName: true, customerSlug: true } },
        mailingList: { select: { id: true, name: true, listUid: true } },
      },
    }),
    prisma.mailingList.findMany({
      where: customerConnectionId ? { customerConnectionId } : undefined,
      orderBy: { name: 'asc' },
      select: {
        id: true,
        customerConnectionId: true,
        name: true,
        listUid: true,
        syncedSubscriberCount: true,
        customerConnection: { select: { id: true, customerName: true, customerSlug: true } },
      },
    }),
  ]);

  return NextResponse.json({ plans, lists });
}

export async function POST(req: NextRequest) {
  const auth = await requireApiAuth(req, {
    requireCsrf: true,
    rateLimitBucket: 'reengagement-write',
    limitPerMin: 20,
  });
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 });
  }

  const parsed = CreatePlanSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed.', issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    if (parsed.data.customerConnectionId) {
      const ml = await prisma.mailingList.findUnique({
        where: { id: parsed.data.mailingListId },
        select: { customerConnectionId: true },
      });
      if (!ml) {
        return NextResponse.json({ error: 'Mailing list not found.' }, { status: 404 });
      }
      if (ml.customerConnectionId !== parsed.data.customerConnectionId) {
        return NextResponse.json(
          { error: 'Mailing list does not belong to the selected customer connection.' },
          { status: 403 }
        );
      }
    }
    const { customerConnectionId: _cid, ...createData } = parsed.data;
    void _cid;
    const plan = await createReengagementPlan({
      ...createData,
      actorEmail: auth.session.adminEmail,
    });
    return NextResponse.json({ ok: true, plan });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create plan.' },
      { status: 400 }
    );
  }
}
