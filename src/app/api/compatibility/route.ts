import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireApiAuth } from '@/lib/api-auth';
import {
  getCompatibilityDashboardData,
  runReadOnlyCompatibilityCheck,
} from '@/services/mailwizz/compatibility-validator';
import { mailWizzCapabilityRegistry } from '@/services/mailwizz/capability-registry';

const CompatibilityActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('RUN_CHECK'),
  }),
  z.object({
    action: z.literal('SET_CONFIGURED_VERSION'),
    configuredVersion: z.string().trim().max(40).nullable(),
    notes: z.string().trim().max(500).optional(),
  }),
  z.object({
    action: z.literal('APPROVE_VERSION'),
    version: z.string().trim().min(1).max(40),
  }),
]);

export async function GET(req: NextRequest) {
  const auth = await requireApiAuth(req, { rateLimitBucket: 'compatibility-read' });
  if (!auth.ok) return auth.response;

  const data = await getCompatibilityDashboardData();
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const auth = await requireApiAuth(req, {
    requireCsrf: true,
    rateLimitBucket: 'compatibility-write',
    limitPerMin: 20,
  });
  if (!auth.ok) return auth.response;

  try {
    const body: unknown = await req.json();
    const parsed = CompatibilityActionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid compatibility action payload.' },
        { status: 400 }
      );
    }

    if (parsed.data.action === 'RUN_CHECK') {
      const report = await runReadOnlyCompatibilityCheck({
        actorEmail: auth.session.adminEmail,
        ipAddress: auth.ip,
      });
      const updated = await getCompatibilityDashboardData();
      return NextResponse.json({
        ok: true,
        report,
        data: updated,
      });
    }

    if (parsed.data.action === 'SET_CONFIGURED_VERSION') {
      await mailWizzCapabilityRegistry.saveConfiguredVersion({
        configuredVersion: parsed.data.configuredVersion?.trim() || null,
        notes: parsed.data.notes ?? null,
        actorEmail: auth.session.adminEmail,
        ipAddress: auth.ip,
      });
      const updated = await getCompatibilityDashboardData();
      return NextResponse.json({
        ok: true,
        data: updated,
      });
    }

    // APPROVE_VERSION — allowed ONLY after latest read-only verification passed critical contracts
    const current = await getCompatibilityDashboardData();
    const latestReport = current.report;
    const criticalSyncOk = latestReport.capabilities
      .filter((c) => c.criticalForSync)
      .every((c) => c.status === 'VERIFIED');

    if (
      latestReport.connectionStatus !== 'CONNECTED' ||
      latestReport.overallStatus === 'INCOMPATIBLE' ||
      latestReport.overallStatus === 'UNVERIFIED' ||
      !criticalSyncOk
    ) {
      return NextResponse.json(
        {
          error:
            'Cannot approve MailWizz version before a connected read-only Compatibility Check passes all critical contracts (List Discovery, Subscriber Retrieval, Subscriber Pagination, Subscriber Status Retrieval).',
        },
        { status: 400 }
      );
    }

    await mailWizzCapabilityRegistry.approveVersion({
      version: parsed.data.version,
      actorEmail: auth.session.adminEmail,
      ipAddress: auth.ip,
      report: latestReport,
    });

    const refreshed = await getCompatibilityDashboardData();
    return NextResponse.json({
      ok: true,
      data: refreshed,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Compatibility action failed.' },
      { status: 400 }
    );
  }
}
