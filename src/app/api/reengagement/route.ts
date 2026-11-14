import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireApiAuth } from '@/lib/api-auth';
import { prisma } from '@/lib/db';
import { FilterGroupSchema } from '@/services/analysis/filter-engine';
import { createReengagementPlan } from '@/services/reengagement/workflow';

const CreatePlanSchema = z.object({
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

  const [plans, lists] = await Promise.all([
    prisma.reengagementPlan.findMany({
      orderBy: { createdAt: 'desc' },
      take: 30,
      include: { mailingList: { select: { id: true, name: true, listUid: true } } },
    }),
    prisma.mailingList.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, listUid: true, syncedSubscriberCount: true },
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
    const plan = await createReengagementPlan({
      ...parsed.data,
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
