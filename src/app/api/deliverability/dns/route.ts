import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireApiAuth } from '@/lib/api-auth';
import { runAndSaveDomainAuthCheck } from '@/services/deliverability/dns-checker';

const DnsCheckBodySchema = z.object({
  domain: z.string().trim().min(3).max(255),
  fromDomain: z.string().trim().max(255).optional().or(z.literal('')),
  trackingDomain: z.string().trim().max(255).optional().or(z.literal('')),
  dkimSelector: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9._-]{0,64}$/, 'Invalid DKIM selector format')
    .optional()
    .or(z.literal('')),
});

export async function POST(req: NextRequest) {
  const auth = await requireApiAuth(req, {
    rateLimitBucket: 'deliverability-dns',
    limitPerMin: 30,
  });
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON request body.' }, { status: 400 });
  }

  const parsed = DnsCheckBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const check = await runAndSaveDomainAuthCheck({
      domain: parsed.data.domain,
      fromDomain: parsed.data.fromDomain || undefined,
      trackingDomain: parsed.data.trackingDomain || undefined,
      dkimSelector: parsed.data.dkimSelector || undefined,
      actorEmail: auth.session.adminEmail,
    });
    return NextResponse.json({ check }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'DNS diagnostic failed' },
      { status: 400 }
    );
  }
}
