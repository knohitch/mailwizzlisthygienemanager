import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireApiAuth } from '@/lib/api-auth';
import {
  cancelCleanupOperation,
  inspectOperationSnapshot,
  pauseCleanupOperation,
  restoreSuppressedSubscribers,
  resumeCleanupOperation,
} from '@/services/cleanup/restore';

const ActionSchema = z.object({
  action: z.enum([
    'PAUSE',
    'RESUME',
    'CANCEL',
    'RESTORE_SUPPRESSION',
    'INSPECT_SNAPSHOT',
  ]),
  adminApproved: z.boolean().optional(),
  reason: z.string().max(300).optional(),
});

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ opId: string }> }
) {
  const auth = await requireApiAuth(req, {
    requireCsrf: true,
    rateLimitBucket: 'cleanup-action',
    limitPerMin: 30,
  });
  if (!auth.ok) return auth.response;

  const { opId } = await context.params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 });
  }

  const parsed = ActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid action request.', issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    switch (parsed.data.action) {
      case 'PAUSE': {
        await pauseCleanupOperation(opId, auth.session.adminEmail);
        return NextResponse.json({ ok: true, status: 'PAUSED' });
      }
      case 'RESUME': {
        const res = await resumeCleanupOperation(opId, auth.session.adminEmail);
        return NextResponse.json({
          ok: true,
          status: res.operation.status,
          syncJobId: res.job.id,
        });
      }
      case 'CANCEL': {
        const updated = await cancelCleanupOperation(opId, auth.session.adminEmail);
        return NextResponse.json({ ok: true, status: updated.status });
      }
      case 'RESTORE_SUPPRESSION': {
        const result = await restoreSuppressedSubscribers({
          operationId: opId,
          adminApproved: parsed.data.adminApproved === true,
          reason: parsed.data.reason ?? 'Administrator suppression rollback',
          actorEmail: auth.session.adminEmail,
          ipAddress: auth.ip,
        });
        return NextResponse.json({ ok: true, result });
      }
      case 'INSPECT_SNAPSHOT': {
        const snapshot = await inspectOperationSnapshot(
          opId,
          auth.session.adminEmail
        );
        return NextResponse.json({ ok: true, ...snapshot });
      }
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Action failed.' },
      { status: 400 }
    );
  }
}
