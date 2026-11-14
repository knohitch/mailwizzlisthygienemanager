import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireApiAuth } from '@/lib/api-auth';
import { confirmAndEnqueueCleanup } from '@/services/cleanup/planner';

const ExecuteSchema = z.object({
  operationId: z.string().min(1),
  confirmedListName: z.string().min(1),
  confirmedCount: z.coerce.number().int().min(0),
  largeBatchApproved: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const auth = await requireApiAuth(req, {
    requireCsrf: true,
    rateLimitBucket: 'cleanup-execute',
    limitPerMin: 20,
  });
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 });
  }

  const parsed = ExecuteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid confirmation inputs.', issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const res = await confirmAndEnqueueCleanup({
      ...parsed.data,
      actorEmail: auth.session.adminEmail,
      ipAddress: auth.ip,
    });

    return NextResponse.json({
      ok: true,
      operationId: res.operation.id,
      status: res.operation.status,
      syncJobId: res.job.id,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Execution confirmation rejected.' },
      { status: 400 }
    );
  }
}
