import { NextRequest, NextResponse } from 'next/server';
import { requireApiAuth } from '@/lib/api-auth';
import { getDashboardSummary } from '@/services/dashboard/summary';

export async function GET(req: NextRequest) {
  const auth = await requireApiAuth(req, { rateLimitBucket: 'dashboard' });
  if (!auth.ok) return auth.response;

  const periodParam = Number(req.nextUrl.searchParams.get('periodDays'));
  const listId = req.nextUrl.searchParams.get('listId') || undefined;

  const summary = await getDashboardSummary({
    periodDays: Number.isFinite(periodParam) ? periodParam : undefined,
    listId,
  });

  return NextResponse.json(summary);
}
