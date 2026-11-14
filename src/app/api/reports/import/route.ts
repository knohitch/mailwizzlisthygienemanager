import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireApiAuth } from '@/lib/api-auth';
import { importVerifiedCampaignReport } from '@/services/mailwizz/report-import';
import { recomputeAllHygieneClassifications } from '@/services/analysis/classifier';
import { recordAuditLog } from '@/services/security/audit';

const ImportSchema = z.object({
  format: z.enum(['csv', 'json']),
  content: z.string().min(1).max(10_000_000),
  defaultCampaignUid: z.string().trim().optional(),
  mailingListId: z.string().trim().optional(),
});

export async function POST(req: NextRequest) {
  const auth = await requireApiAuth(req, {
    requireCsrf: true,
    rateLimitBucket: 'report-import',
    limitPerMin: 15,
  });
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 });
  }

  const parsed = ImportSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid report import payload.', issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const summary = await importVerifiedCampaignReport(parsed.data);
    const recomputed = await recomputeAllHygieneClassifications(
      parsed.data.mailingListId
    );

    await recordAuditLog({
      actorEmail: auth.session.adminEmail,
      action: 'IMPORT_VERIFIED_REPORT',
      resourceType: 'EngagementEvent',
      resourceId: parsed.data.mailingListId ?? 'ALL',
      outcome: 'SUCCESS',
      ipAddress: auth.ip,
      details: {
        format: parsed.data.format,
        ...summary,
        recomputedSubscribers: recomputed.updatedSubscribers,
      },
    });

    return NextResponse.json({
      ok: true,
      summary,
      recomputedSubscribers: recomputed.updatedSubscribers,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Report import failed.' },
      { status: 400 }
    );
  }
}
