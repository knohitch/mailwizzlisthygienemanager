import { NextRequest, NextResponse } from 'next/server';
import { requireApiAuth } from '@/lib/api-auth';
import { prisma } from '@/lib/db';
import { buildDryRunCsvReport } from '@/services/cleanup/planner';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ opId: string }> }
) {
  const auth = await requireApiAuth(req, { rateLimitBucket: 'cleanup-detail' });
  if (!auth.ok) return auth.response;

  const { opId } = await context.params;
  const op = await prisma.cleanupOperation.findUnique({
    where: { id: opId },
    include: { mailingList: { select: { id: true, name: true, listUid: true } } },
  });
  if (!op) {
    return NextResponse.json({ error: 'Operation not found.' }, { status: 404 });
  }

  const format = new URL(req.url).searchParams.get('format');
  if (format === 'csv') {
    const csv = await buildDryRunCsvReport(op.id);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="cleanup-report-${op.id}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  }

  const records = await prisma.cleanupOperationRecord.findMany({
    where: { operationId: op.id },
    orderBy: [{ outcome: 'asc' }, { subscriberUid: 'asc' }],
    take: 100,
  });

  return NextResponse.json({
    operation: {
      id: op.id,
      actionType: op.actionType,
      status: op.status,
      dryRunOnly: op.dryRunOnly,
      mailingList: op.mailingList,
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
      createdAt: op.createdAt,
      confirmedAt: op.confirmedAt,
      completedAt: op.completedAt,
    },
    records,
  });
}
