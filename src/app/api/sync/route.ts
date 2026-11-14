import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireApiAuth } from '@/lib/api-auth';
import { enqueueJob } from '@/services/jobs/queue';
import { recordAuditLog } from '@/services/security/audit';
import { seedSyntheticDemoData } from '@/services/demo/seed-demo';

const SyncActionSchema = z.object({
  action: z.enum([
    'FULL_SYNC',
    'LIST_SYNC',
    'ANALYZE_HYGIENE',
    'RETENTION_CLEANUP',
    'SEED_DEMO_DATA',
    'CLEAR_DEMO_DATA',
  ]),
  listUid: z.string().trim().optional(),
});

export async function GET(req: NextRequest) {
  const auth = await requireApiAuth(req, { rateLimitBucket: 'sync-read' });
  if (!auth.ok) return auth.response;

  const jobs = await prisma.syncJob.findMany({
    orderBy: { createdAt: 'desc' },
    take: 25,
  });

  return NextResponse.json({ jobs });
}

export async function POST(req: NextRequest) {
  const auth = await requireApiAuth(req, {
    requireCsrf: true,
    rateLimitBucket: 'sync-trigger',
    limitPerMin: 20,
  });
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 });
  }

  const parsed = SyncActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid sync action.' }, { status: 400 });
  }

  const { action, listUid } = parsed.data;

  if (action === 'SEED_DEMO_DATA') {
    const seeded = await seedSyntheticDemoData();
    await recordAuditLog({
      actorEmail: auth.session.adminEmail,
      action: 'SEED_DEMO_DATA',
      resourceType: 'MailingList',
      outcome: 'SUCCESS',
      ipAddress: auth.ip,
      details: seeded,
    });
    return NextResponse.json({ ok: true, seeded });
  }

  if (action === 'CLEAR_DEMO_DATA') {
    await prisma.engagementEvent.deleteMany({ where: { isDemoData: true } });
    await prisma.subscriber.deleteMany({ where: { isDemoData: true } });
    await prisma.listSegment.deleteMany({ where: { isDemoData: true } });
    await prisma.campaign.deleteMany({ where: { isDemoData: true } });
    await prisma.mailingList.deleteMany({ where: { isDemoData: true } });
    await prisma.appConfig.update({
      where: { id: 'default' },
      data: { isDemoMode: false },
    });
    await recordAuditLog({
      actorEmail: auth.session.adminEmail,
      action: 'CLEAR_DEMO_DATA',
      resourceType: 'MailingList',
      outcome: 'SUCCESS',
      ipAddress: auth.ip,
    });
    return NextResponse.json({ ok: true });
  }

  if (action === 'FULL_SYNC' || action === 'LIST_SYNC') {
    const cfg = await prisma.appConfig.findUnique({ where: { id: 'default' } });
    if (!cfg?.mailwizzApiUrl || !cfg?.mailwizzApiKeyEnc) {
      return NextResponse.json(
        {
          error:
            'MailWizz API URL and API key must be configured in Settings before queueing a MailWizz sync.',
        },
        { status: 400 }
      );
    }
  }

  if (action === 'LIST_SYNC' && !listUid) {
    return NextResponse.json(
      { error: 'listUid is required for LIST_SYNC.' },
      { status: 400 }
    );
  }

  const job = await enqueueJob({
    type: action,
    payload: {
      triggeredBy: auth.session.adminEmail,
      ...(listUid ? { listUid } : {}),
    },
  });

  await recordAuditLog({
    actorEmail: auth.session.adminEmail,
    action: `ENQUEUE_${action}`,
    resourceType: 'SyncJob',
    resourceId: job.id,
    outcome: 'SUCCESS',
    ipAddress: auth.ip,
    details: { listUid: listUid ?? null },
  });

  return NextResponse.json({ ok: true, job }, { status: 202 });
}
