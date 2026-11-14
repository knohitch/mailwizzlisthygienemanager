import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireApiAuth } from '@/lib/api-auth';
import { isMailWizzMutationsEnabled } from '@/services/mutations/gate';

export async function GET(req: NextRequest) {
  const auth = await requireApiAuth(req, { rateLimitBucket: 'audit-read' });
  if (!auth.ok) return auth.response;

  const logs = await prisma.auditLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  return NextResponse.json({
    phase1ReadOnly: !isMailWizzMutationsEnabled(),
    logs,
  });
}
