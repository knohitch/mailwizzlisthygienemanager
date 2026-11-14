import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireApiAuth } from '@/lib/api-auth';
import {
  recordInboxPlacementTest,
  recordManualPostmasterStat,
  saveGooglePostmasterConfig,
  syncGooglePostmasterTrafficStats,
} from '@/services/deliverability/postmaster';

const SeedTestsActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('RECORD_PLACEMENT_TEST'),
    testDomain: z.string().trim().min(3).max(255),
    sendingProvider: z.string().trim().min(2).max(120).default('Alibaba Cloud DirectMail (SMTP)'),
    campaignUid: z.string().trim().max(100).optional().or(z.literal('')),
    recipientProvider: z.enum(['GMAIL', 'OUTLOOK', 'YAHOO', 'OTHER']),
    customProviderName: z.string().trim().max(100).optional().or(z.literal('')),
    testedAt: z.string().optional(),
    placement: z.enum(['PRIMARY', 'PROMOTIONS', 'OTHER', 'SPAM', 'MISSING']),
    spfPass: z.boolean().nullable().optional(),
    dkimPass: z.boolean().nullable().optional(),
    dmarcPass: z.boolean().nullable().optional(),
    postmasterReputation: z.string().trim().max(64).optional().or(z.literal('')),
    notes: z.string().trim().max(1000).optional().or(z.literal('')),
  }),
  z.object({
    action: z.literal('SAVE_POSTMASTER_CONFIG'),
    domain: z.string().trim().min(3).max(255).optional(),
    oauthAccessToken: z.string().trim().min(10).max(4096).optional(),
  }),
  z.object({
    action: z.literal('SYNC_POSTMASTER_API'),
    domain: z.string().trim().min(3).max(255).optional(),
    daysBack: z.coerce.number().int().min(1).max(120).default(14),
  }),
  z.object({
    action: z.literal('RECORD_MANUAL_POSTMASTER'),
    domain: z.string().trim().min(3).max(255),
    statDate: z.string().min(8),
    domainReputation: z.enum(['HIGH', 'MEDIUM', 'LOW', 'BAD', 'UNKNOWN']).optional(),
    userReportedSpamRatio: z.coerce.number().min(0).max(1).nullable().optional(),
    dkimSuccessRatio: z.coerce.number().min(0).max(1).nullable().optional(),
    dmarcSuccessRatio: z.coerce.number().min(0).max(1).nullable().optional(),
    spfSuccessRatio: z.coerce.number().min(0).max(1).nullable().optional(),
    inboundEncryptionRatio: z.coerce.number().min(0).max(1).nullable().optional(),
    notes: z.string().trim().max(1000).optional().or(z.literal('')),
  }),
]);

export async function POST(req: NextRequest) {
  const auth = await requireApiAuth(req, {
    rateLimitBucket: 'deliverability-seed-tests',
    limitPerMin: 30,
  });
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON request body.' }, { status: 400 });
  }

  const parsed = SeedTestsActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const data = parsed.data;
    if (data.action === 'RECORD_PLACEMENT_TEST') {
      const testedAt = data.testedAt ? new Date(data.testedAt) : new Date();
      if (Number.isNaN(testedAt.getTime())) {
        return NextResponse.json({ error: 'Invalid test date.' }, { status: 400 });
      }
      const created = await recordInboxPlacementTest({
        testDomain: data.testDomain,
        sendingProvider: data.sendingProvider,
        campaignUid: data.campaignUid || undefined,
        recipientProvider: data.recipientProvider,
        customProviderName: data.customProviderName || undefined,
        testedAt,
        placement: data.placement,
        spfPass: data.spfPass ?? null,
        dkimPass: data.dkimPass ?? null,
        dmarcPass: data.dmarcPass ?? null,
        postmasterReputation: data.postmasterReputation || undefined,
        notes: data.notes || undefined,
        actorEmail: auth.session.adminEmail,
      });
      return NextResponse.json({ ok: true, test: created }, { status: 201 });
    }

    if (data.action === 'SAVE_POSTMASTER_CONFIG') {
      await saveGooglePostmasterConfig({
        domain: data.domain,
        oauthAccessToken: data.oauthAccessToken,
        actorEmail: auth.session.adminEmail,
      });
      return NextResponse.json({ ok: true });
    }

    if (data.action === 'SYNC_POSTMASTER_API') {
      const result = await syncGooglePostmasterTrafficStats({
        domain: data.domain,
        daysBack: data.daysBack,
        actorEmail: auth.session.adminEmail,
      });
      return NextResponse.json({ ok: true, result });
    }

    const statDate = new Date(data.statDate);
    if (Number.isNaN(statDate.getTime())) {
      return NextResponse.json({ error: 'Invalid Postmaster stat date.' }, { status: 400 });
    }

    const stat = await recordManualPostmasterStat({
      domain: data.domain,
      statDate,
      domainReputation: data.domainReputation,
      userReportedSpamRatio: data.userReportedSpamRatio ?? null,
      dkimSuccessRatio: data.dkimSuccessRatio ?? null,
      dmarcSuccessRatio: data.dmarcSuccessRatio ?? null,
      spfSuccessRatio: data.spfSuccessRatio ?? null,
      inboundEncryptionRatio: data.inboundEncryptionRatio ?? null,
      notes: data.notes || undefined,
      actorEmail: auth.session.adminEmail,
    });
    return NextResponse.json({ ok: true, stat }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Seed test / Postmaster operation failed' },
      { status: 400 }
    );
  }
}
