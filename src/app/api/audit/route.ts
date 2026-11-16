import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireApiAuth } from '@/lib/api-auth';
import { isMailWizzMutationsEnabled } from '@/services/mutations/gate';

export async function GET(req: NextRequest) {
  const auth = await requireApiAuth(req, { rateLimitBucket: 'audit-read' });
  if (!auth.ok) return auth.response;

  const customerConnectionId =
    req.nextUrl.searchParams.get('customerConnectionId')?.trim() || undefined;

  const logs = await prisma.auditLog.findMany({
    where: customerConnectionId ? { customerConnectionId } : undefined,
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: {
      customerConnection: {
        select: { id: true, customerName: true, customerSlug: true },
      },
    },
  });

  return NextResponse.json({
    phase1ReadOnly: !isMailWizzMutationsEnabled(),
    logs,
  });
}
