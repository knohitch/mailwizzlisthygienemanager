import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { isMailWizzMutationsEnabled } from '@/services/mutations/gate';

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const activeWorkerJob = await prisma.syncJob.findFirst({
      where: { status: 'RUNNING' },
      orderBy: { heartbeatAt: 'desc' },
      select: { id: true, type: true, heartbeatAt: true },
    });
    const staleThresholdMs = 90_000;
    const workerHealthy =
      !activeWorkerJob ||
      !activeWorkerJob.heartbeatAt ||
      Date.now() - activeWorkerJob.heartbeatAt.getTime() < staleThresholdMs;

    return NextResponse.json({
      status: 'ok',
      database: 'connected',
      worker: workerHealthy ? 'healthy' : 'stale-heartbeat',
      phase: 'phase-3-deliverability-ready',
      mailwizzMutationsEnabled: isMailWizzMutationsEnabled(),
      timestamp: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json(
      {
        status: 'degraded',
        database: 'unreachable',
        phase: 'phase-1-readonly',
      },
      { status: 503 }
    );
  }
}
