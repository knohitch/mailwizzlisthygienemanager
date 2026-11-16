import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireApiAuth } from '@/lib/api-auth';
import { enqueueJob } from '@/services/jobs/queue';
import { resolveUnambiguousConnectionId } from '@/services/mailwizz/client-factory';
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
  customerConnectionId: z.string().trim().optional(),
  listUid: z.string().trim().optional(),
});

export async function GET(req: NextRequest) {
  const auth = await requireApiAuth(req, { rateLimitBucket: 'sync-read' });
  if (!auth.ok) return auth.response;

  const customerConnectionId =
    req.nextUrl.searchParams.get('customerConnectionId')?.trim() || undefined;

  const jobs = await prisma.syncJob.findMany({
    where: customerConnectionId ? { customerConnectionId } : undefined,
    orderBy: { createdAt: 'desc' },
    take: 25,
    include: {
      customerConnection: {
        select: { id: true, customerName: true, customerSlug: true },
      },
    },
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

  const { action, listUid, customerConnectionId } = parsed.data;

  if (action === 'SEED_DEMO_DATA') {
    if (
      process.env.NODE_ENV === 'production' &&
      process.env.ALLOW_DEMO_SEED_IN_PROD !== 'true'
    ) {
      return NextResponse.json(
        {
          error:
            'Seeding synthetic demo data is disabled in production deployments (NODE_ENV=production).',
        },
        { status: 403 }
      );
    }
    try {
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
    } catch (err) {
      return NextResponse.json(
        {
          error:
            err instanceof Error
              ? err.message
              : 'Refused to seed synthetic demo data alongside real data.',
        },
        { status: 409 }
      );
    }
  }

  if (action === 'CLEAR_DEMO_DATA') {
    await prisma.engagementEvent.deleteMany({ where: { isDemoData: true } });
    await prisma.subscriber.deleteMany({ where: { isDemoData: true } });
    await prisma.listSegment.deleteMany({ where: { isDemoData: true } });
    await prisma.campaign.deleteMany({ where: { isDemoData: true } });
    await prisma.mailingList.deleteMany({ where: { isDemoData: true } });
    await prisma.directMailDailyMetric.deleteMany({ where: { isDemoData: true } });
    await prisma.inboxPlacementTest.deleteMany({ where: { isDemoData: true } });
    await prisma.postmasterStat.deleteMany({ where: { isDemoData: true } });
    await prisma.mailWizzCustomerConnection.deleteMany({ where: { isDemoData: true } });
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

  let resolvedConnId: string | undefined = customerConnectionId;
  if (action === 'FULL_SYNC' || action === 'LIST_SYNC') {
    try {
      resolvedConnId = await resolveUnambiguousConnectionId(customerConnectionId);
      const credCount = await prisma.mailWizzConnectionCredential.count({
        where: {
          customerConnectionId: resolvedConnId,
          isActive: true,
          status: 'ACTIVE',
        },
      });
      if (credCount === 0) {
        return NextResponse.json(
          {
            error:
              'Selected MailWizz customer connection has no active API key. Configure one in Customer Connections before queueing a sync.',
          },
          { status: 400 }
        );
      }
    } catch (err) {
      return NextResponse.json(
        {
          error:
            err instanceof Error
              ? err.message
              : 'MailWizz customer connection must be configured before queueing a MailWizz sync.',
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

  try {
    const job = await enqueueJob({
      type: action,
      customerConnectionId: resolvedConnId,
      payload: {
        triggeredBy: auth.session.adminEmail,
        ...(resolvedConnId ? { customerConnectionId: resolvedConnId } : {}),
        ...(listUid ? { listUid } : {}),
      },
    });

    await recordAuditLog({
      customerConnectionId: resolvedConnId,
      actorEmail: auth.session.adminEmail,
      action: `ENQUEUE_${action}`,
      resourceType: 'SyncJob',
      resourceId: job.id,
      outcome: 'SUCCESS',
      ipAddress: auth.ip,
      details: { customerConnectionId: resolvedConnId ?? null, listUid: listUid ?? null },
    });

    return NextResponse.json({ ok: true, job }, { status: 202 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to enqueue job.' },
      { status: 400 }
    );
  }
}
