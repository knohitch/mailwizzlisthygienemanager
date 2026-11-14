import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireApiAuth } from '@/lib/api-auth';
import {
  approveReengagementCampaignManually,
  createSegmentForReengagementPlan,
  evaluateReengagementPlan,
} from '@/services/reengagement/workflow';

const PlanActionSchema = z.object({
  action: z.enum(['CREATE_SEGMENT', 'APPROVE_CAMPAIGN', 'EVALUATE']),
  mailwizzCampaignUid: z.string().trim().optional(),
  responseWindowDays: z.coerce.number().int().min(3).max(90).optional(),
  createSuppressionDryRun: z.boolean().optional(),
});

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireApiAuth(req, {
    requireCsrf: true,
    rateLimitBucket: 'reengagement-action',
    limitPerMin: 20,
  });
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 });
  }

  const parsed = PlanActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed.', issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    if (parsed.data.action === 'CREATE_SEGMENT') {
      const plan = await createSegmentForReengagementPlan({
        planId: id,
        actorEmail: auth.session.adminEmail,
      });
      return NextResponse.json({ ok: true, plan });
    }
    if (parsed.data.action === 'APPROVE_CAMPAIGN') {
      const plan = await approveReengagementCampaignManually({
        planId: id,
        mailwizzCampaignUid: parsed.data.mailwizzCampaignUid ?? '',
        responseWindowDays: parsed.data.responseWindowDays,
        actorEmail: auth.session.adminEmail,
      });
      return NextResponse.json({ ok: true, plan });
    }
    const plan = await evaluateReengagementPlan({
      planId: id,
      actorEmail: auth.session.adminEmail,
      createSuppressionDryRun: parsed.data.createSuppressionDryRun ?? true,
    });
    return NextResponse.json({ ok: true, plan });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Re-engagement action failed.' },
      { status: 400 }
    );
  }
}
