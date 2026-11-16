import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireApiAuth } from '@/lib/api-auth';
import { enqueueJob } from '@/services/jobs/queue';
import { getCustomerConnectionById } from '@/services/mailwizz/connections';
import { recordAuditLog } from '@/services/security/audit';

const ConnectionSyncSchema = z.object({
  action: z.enum(['FULL_SYNC', 'LIST_SYNC', 'ANALYZE_HYGIENE']),
  listUid: z.string().trim().optional(),
});

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireApiAuth(req, {
    requireCsrf: true,
    rateLimitBucket: 'sync-trigger',
    limitPerMin: 20,
  });
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const conn = await getCustomerConnectionById(id);
  if (!conn) {
    return NextResponse.json({ error: 'Customer connection not found.' }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 });
  }

  const parsed = ConnectionSyncSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid sync action.' }, { status: 400 });
  }

  const { action, listUid } = parsed.data;
  if (action === 'LIST_SYNC' && !listUid) {
    return NextResponse.json(
      { error: 'listUid is required for LIST_SYNC.' },
      { status: 400 }
    );
  }

  if ((action === 'FULL_SYNC' || action === 'LIST_SYNC') && !conn.hasActiveCredential) {
    return NextResponse.json(
      { error: 'Customer connection has no active API credential.' },
      { status: 400 }
    );
  }

  try {
    const job = await enqueueJob({
      type: action,
      customerConnectionId: id,
      payload: {
        customerConnectionId: id,
        triggeredBy: auth.session.adminEmail,
        ...(listUid ? { listUid } : {}),
      },
    });

    await recordAuditLog({
      customerConnectionId: id,
      actorEmail: auth.session.adminEmail,
      action: `ENQUEUE_${action}`,
      resourceType: 'SyncJob',
      resourceId: job.id,
      outcome: 'SUCCESS',
      ipAddress: auth.ip,
      details: { customerConnectionId: id, listUid: listUid ?? null },
    });

    return NextResponse.json({ ok: true, job }, { status: 202 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to enqueue sync job.' },
      { status: 400 }
    );
  }
}
