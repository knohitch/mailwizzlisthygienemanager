import { NextRequest, NextResponse } from 'next/server';
import { requireApiAuth } from '@/lib/api-auth';
import { generateSubscriberExport } from '@/services/security/export';
import type { HygieneStatus, SubscriberStatus } from '@prisma/client';

export async function GET(req: NextRequest) {
  const auth = await requireApiAuth(req, {
    rateLimitBucket: 'export',
    limitPerMin: 15,
  });
  if (!auth.ok) return auth.response;

  const sp = req.nextUrl.searchParams;
  const format = sp.get('format') === 'json' ? 'json' : 'csv';
  const encrypted = sp.get('encrypted') !== 'false'; // encrypted by default!
  const customerConnectionId =
    sp.get('customerConnectionId')?.trim() ||
    sp.get('connectionId')?.trim() ||
    undefined;
  const mailingListId = sp.get('listId')?.trim() || undefined;
  const hygieneStatus = (sp.get('hygieneStatus')?.trim() || undefined) as
    | HygieneStatus
    | undefined;
  const status = (sp.get('status')?.trim() || undefined) as
    | SubscriberStatus
    | undefined;

  const exported = await generateSubscriberExport({
    customerConnectionId,
    mailingListId,
    hygieneStatus,
    status,
    format,
    encrypted,
    actorEmail: auth.session.adminEmail,
    ipAddress: auth.ip,
  });

  return new NextResponse(new Uint8Array(exported.body), {
    status: 200,
    headers: {
      'Content-Type': exported.contentType,
      'Content-Disposition': `attachment; filename="${exported.filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
