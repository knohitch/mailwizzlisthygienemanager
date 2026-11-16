import { prisma } from '@/lib/db';
import type { JobType, Prisma, SyncJob } from '@prisma/client';

export async function enqueueJob(params: {
  type: JobType;
  customerConnectionId?: string | null;
  credentialVersion?: number | null;
  payload?: Record<string, unknown>;
  runAt?: Date;
  maxAttempts?: number;
}): Promise<SyncJob> {
  const connId = params.customerConnectionId?.trim() || null;
  let credVer = params.credentialVersion ?? null;

  if (connId) {
    const conn = await prisma.mailWizzCustomerConnection.findUnique({
      where: { id: connId },
      include: {
        syncState: true,
        credentials: {
          where: { isActive: true, status: 'ACTIVE' },
          orderBy: { version: 'desc' },
          take: 1,
        },
      },
    });
    if (!conn || conn.isQuarantine || !conn.isEnabled || conn.status === 'DISABLED') {
      throw new Error(
        `Cannot enqueue job: customer connection "${conn?.customerName ?? connId}" is disabled or quarantined.`
      );
    }
    if (conn.syncState?.isPaused) {
      throw new Error(
        `Cannot enqueue job: sync is paused for customer "${conn.customerName}".`
      );
    }
    if (credVer === null) {
      credVer = conn.credentials[0]?.version ?? null;
    }
  }

  return prisma.syncJob.create({
    data: {
      customerConnectionId: connId,
      credentialVersion: credVer,
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
    // Fair scheduling across customers + per-connection/per-installation concurrency bounds:
    // - Exclude jobs on disabled/quarantined connections or paused sync states
    // - Enforce at most 1 active RUNNING job per customerConnectionId
    // - Enforce running jobs per installation < MailWizzInstallation.maxConcurrentJobs
    // - Order fairly across customers using ROW_NUMBER() OVER (PARTITION BY customerConnectionId)
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      WITH eligible AS (
        SELECT
          j.id,
          j."customerConnectionId",
          j."runAt",
          j."createdAt",
          ROW_NUMBER() OVER (
            PARTITION BY COALESCE(j."customerConnectionId", '__global__')
            ORDER BY j."runAt" ASC, j."createdAt" ASC
          ) AS conn_rank
        FROM "SyncJob" j
        LEFT JOIN "MailWizzCustomerConnection" c ON c.id = j."customerConnectionId"
        LEFT JOIN "MailWizzInstallation" inst ON inst.id = c."installationId"
        LEFT JOIN "ConnectionSyncState" ss ON ss."customerConnectionId" = c.id
        WHERE j.status = 'PENDING'
          AND j."runAt" <= (NOW() AT TIME ZONE 'UTC')
          AND (
            j."customerConnectionId" IS NULL
            OR (
              c.id IS NOT NULL
              AND c."isEnabled" = true
              AND c."isQuarantine" = false
              AND c.status <> 'DISABLED'
              AND COALESCE(inst."isActive", true) = true
              AND COALESCE(ss."isPaused", false) = false
              AND NOT EXISTS (
                SELECT 1 FROM "SyncJob" r
                WHERE r.status = 'RUNNING'
                  AND r."customerConnectionId" = j."customerConnectionId"
              )
              AND (
                SELECT COUNT(*)::int
                FROM "SyncJob" ir
                JOIN "MailWizzCustomerConnection" ic ON ic.id = ir."customerConnectionId"
                WHERE ir.status = 'RUNNING'
                  AND ic."installationId" = c."installationId"
              ) < COALESCE(inst."maxConcurrentJobs", 2)
            )
          )
      )
      SELECT id
      FROM eligible
      ORDER BY conn_rank ASC, "runAt" ASC, "createdAt" ASC
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
