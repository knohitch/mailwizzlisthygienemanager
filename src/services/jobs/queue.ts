import { prisma } from '@/lib/db';
import type { JobType, Prisma, SyncJob } from '@prisma/client';

export async function enqueueJob(params: {
  type: JobType;
  payload?: Record<string, unknown>;
  runAt?: Date;
  maxAttempts?: number;
}): Promise<SyncJob> {
  return prisma.syncJob.create({
    data: {
      type: params.type,
      status: 'PENDING',
      payloadJson: (params.payload ?? {}) as Prisma.InputJsonValue,
      runAt: params.runAt ?? new Date(),
      maxAttempts: params.maxAttempts ?? 3,
      progressCurrent: 0,
      progressTotal: 100,
      progressMessage: 'Queued for background worker',
    },
  });
}

export async function claimNextJob(workerId: string): Promise<SyncJob | null> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM "SyncJob"
      WHERE status = 'PENDING'
        AND "runAt" <= (NOW() AT TIME ZONE 'UTC')
      ORDER BY "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `;
    const nextId = rows[0]?.id;
    if (!nextId) return null;

    const existing = await tx.syncJob.findUnique({ where: { id: nextId } });
    if (!existing) return null;

    const now = new Date();
    return tx.syncJob.update({
      where: { id: nextId },
      data: {
        status: 'RUNNING',
        attempts: { increment: 1 },
        startedAt: existing.startedAt ?? now,
        heartbeatAt: now,
        lockedBy: workerId,
      },
    });
  });
}

export async function updateJobProgress(
  jobId: string,
  progress: { current: number; total: number; message: string }
): Promise<void> {
  await prisma.syncJob.update({
    where: { id: jobId },
    data: {
      progressCurrent: progress.current,
      progressTotal: progress.total,
      progressMessage: progress.message,
      heartbeatAt: new Date(),
    },
  });
}

export async function completeJob(
  jobId: string,
  result: Record<string, unknown>
): Promise<void> {
  await prisma.syncJob.update({
    where: { id: jobId },
    data: {
      status: 'COMPLETED',
      resultJson: result as Prisma.InputJsonValue,
      progressCurrent: 100,
      progressTotal: 100,
      progressMessage: 'Completed',
      finishedAt: new Date(),
      heartbeatAt: new Date(),
      lockedBy: null,
    },
  });
}

export async function failOrRetryJob(job: SyncJob, error: unknown): Promise<void> {
  const message =
    error instanceof Error ? error.message.slice(0, 1000) : 'Unknown worker error';

  if (job.attempts < job.maxAttempts) {
    const delayMs = Math.min(300_000, 5_000 * 2 ** Math.max(0, job.attempts - 1));
    await prisma.syncJob.update({
      where: { id: job.id },
      data: {
        status: 'PENDING',
        runAt: new Date(Date.now() + delayMs),
        lastError: message,
        progressMessage: `Retry scheduled in ${Math.round(delayMs / 1000)}s`,
        lockedBy: null,
      },
    });
  } else {
    await prisma.syncJob.update({
      where: { id: job.id },
      data: {
        status: 'FAILED',
        lastError: message,
        progressMessage: 'Failed after max attempts',
        finishedAt: new Date(),
        lockedBy: null,
      },
    });
  }
}

export async function recoverStaleJobs(staleThresholdMs = 5 * 60_000): Promise<number> {
  const cutoff = new Date(Date.now() - staleThresholdMs);
  const stale = await prisma.syncJob.findMany({
    where: {
      status: 'RUNNING',
      heartbeatAt: { lt: cutoff },
    },
  });

  for (const job of stale) {
    await failOrRetryJob(job, new Error('Worker heartbeat timed out; recovered stale job.'));
  }

  return stale.length;
}
