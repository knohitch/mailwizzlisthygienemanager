import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireApiAuth } from '@/lib/api-auth';
import { prisma } from '@/lib/db';
import { FilterGroupSchema } from '@/services/analysis/filter-engine';
import { previewCleanupOperation } from '@/services/cleanup/planner';

const PreviewRequestSchema = z.object({
  actionType: z.enum([
    'SUPPRESS',
    'UNSUBSCRIBE',
    'CREATE_LIST',
    'CREATE_SEGMENT',
    'COPY_SUBSCRIBERS',
    'MOVE_SUBSCRIBERS',
    'ARCHIVE',
  ]),
  filter: FilterGroupSchema,
  mailingListId: z.string().optional(),
  explicitSubscriberIds: z.array(z.string()).max(10000).optional(),
  targetListUid: z.string().optional(),
  targetListName: z.string().optional(),
  targetSegmentName: z.string().optional(),
  newListConfig: z
    .object({
      name: z.string().min(2).max(120),
      description: z.string().min(2).max(300),
      fromName: z.string().min(2).max(120),
      fromEmail: z.string().email(),
      replyTo: z.string().email(),
      subject: z.string().max(200).optional(),
    })
    .optional(),
  allowMultiList: z.boolean().optional(),
  batchSize: z.coerce.number().int().min(5).max(50).optional(),
});

export async function GET(req: NextRequest) {
  const auth = await requireApiAuth(req, { rateLimitBucket: 'cleanup-list' });
  if (!auth.ok) return auth.response;

  const operations = await prisma.cleanupOperation.findMany({
    orderBy: { createdAt: 'desc' },
    take: 30,
    include: {
      mailingList: { select: { id: true, name: true, listUid: true } },
    },
  });

  return NextResponse.json({
    operations: operations.map((op) => ({
      id: op.id,
      actionType: op.actionType,
      status: op.status,
      dryRunOnly: op.dryRunOnly,
      mailingList: op.mailingList,
      targetListUid: op.targetListUid,
      targetListName: op.targetListName,
      targetSegmentUid: op.targetSegmentUid,
      targetSegmentName: op.targetSegmentName,
      matchedCount: op.matchedCount,
      eligibleCount: op.eligibleCount,
      excludedCount: op.excludedCount,
      succeededCount: op.succeededCount,
      skippedCount: op.skippedCount,
      failedCount: op.failedCount,
      reconciledCount: op.reconciledCount,
      autoStopReason: op.autoStopReason,
      dryRunReport: op.dryRunReportJson,
      reconciliationSummary: op.reconciliationSummaryJson,
      createdByEmail: op.createdByEmail,
      createdAt: op.createdAt,
      confirmedAt: op.confirmedAt,
      completedAt: op.completedAt,
    })),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireApiAuth(req, {
    requireCsrf: true,
    rateLimitBucket: 'cleanup-preview',
    limitPerMin: 30,
  });
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 });
  }

  const parsed = PreviewRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed.', issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const operation = await previewCleanupOperation({
      ...parsed.data,
      actorEmail: auth.session.adminEmail,
      ipAddress: auth.ip,
    });

    return NextResponse.json({
      ok: true,
      operationId: operation.id,
      status: operation.status,
      dryRunOnly: operation.dryRunOnly,
      matchedCount: operation.matchedCount,
      eligibleCount: operation.eligibleCount,
      excludedCount: operation.excludedCount,
      dryRunReport: operation.dryRunReportJson,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Preview creation failed.' },
      { status: 400 }
    );
  }
}
