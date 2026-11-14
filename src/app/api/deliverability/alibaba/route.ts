import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireApiAuth } from '@/lib/api-auth';
import {
  importAlibabaDirectMailCsv,
  saveAlibabaCredentials,
  syncAlibabaDirectMailReadOnly,
} from '@/services/deliverability/alibaba-directmail';

const AlibabaActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('SAVE_CREDS'),
    accessKeyId: z.string().trim().min(4).max(128).optional(),
    accessKeySecret: z.string().trim().min(4).max(128).optional(),
    region: z
      .enum(['ap-southeast-1', 'ap-southeast-2', 'cn-hangzhou', 'us-east-1', 'eu-central-1'])
      .optional(),
  }),
  z.object({
    action: z.literal('CLEAR_CREDS'),
  }),
  z.object({
    action: z.literal('SYNC_API'),
    daysBack: z.coerce.number().int().min(1).max(30).default(30),
  }),
  z.object({
    action: z.literal('IMPORT_CSV'),
    csvContent: z.string().min(5).max(5_000_000),
  }),
]);

export async function POST(req: NextRequest) {
  const auth = await requireApiAuth(req, {
    rateLimitBucket: 'deliverability-alibaba',
    limitPerMin: 20,
  });
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON request body.' }, { status: 400 });
  }

  const parsed = AlibabaActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const data = parsed.data;
    if (data.action === 'SAVE_CREDS') {
      await saveAlibabaCredentials({
        accessKeyId: data.accessKeyId,
        accessKeySecret: data.accessKeySecret,
        region: data.region,
        actorEmail: auth.session.adminEmail,
      });
      return NextResponse.json({ ok: true, message: 'Alibaba DirectMail read-only credentials saved.' });
    }

    if (data.action === 'CLEAR_CREDS') {
      await saveAlibabaCredentials({ clear: true, actorEmail: auth.session.adminEmail });
      return NextResponse.json({ ok: true, message: 'Alibaba DirectMail credentials cleared.' });
    }

    if (data.action === 'SYNC_API') {
      const result = await syncAlibabaDirectMailReadOnly({
        actorEmail: auth.session.adminEmail,
        daysBack: data.daysBack,
      });
      return NextResponse.json({ ok: true, result });
    }

    const imported = await importAlibabaDirectMailCsv({
      csvContent: data.csvContent,
      actorEmail: auth.session.adminEmail,
    });
    return NextResponse.json({ ok: true, imported }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Alibaba DirectMail action failed' },
      { status: 400 }
    );
  }
}
