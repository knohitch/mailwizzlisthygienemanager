import { NextRequest, NextResponse } from 'next/server';
import { requireApiAuth } from '@/lib/api-auth';
import { getDeliverabilityDashboardData } from '@/services/deliverability/metrics';

export async function GET(req: NextRequest) {
  const auth = await requireApiAuth(req, { rateLimitBucket: 'deliverability-read' });
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(req.url);
  const rawDays = searchParams.get('days');
  const startRaw = searchParams.get('startDate');
  const endRaw = searchParams.get('endDate');

  let days: number | 'ALL' = 365;
  if (rawDays === 'ALL') {
    days = 'ALL';
  } else if (rawDays) {
    const num = Number(rawDays);
    if (Number.isFinite(num) && num >= 1 && num <= 3650) {
      days = Math.floor(num);
    }
  }

  const startDate = startRaw ? new Date(startRaw) : undefined;
  const endDate = endRaw ? new Date(endRaw) : undefined;

  const data = await getDeliverabilityDashboardData({
    days,
    startDate: startDate && !Number.isNaN(startDate.getTime()) ? startDate : undefined,
    endDate: endDate && !Number.isNaN(endDate.getTime()) ? endDate : undefined,
  });

  return NextResponse.json(data);
}
