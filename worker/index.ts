import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/db';
import { getEnv } from '@/lib/env';
import { logger } from '@/services/security/logger';
import { claimNextJob, enqueueJob, recoverStaleJobs } from '@/services/jobs/queue';
import { executeSyncJob } from '@/services/jobs/handlers';

const WORKER_ID = `worker-${process.pid}-${randomUUID().slice(0, 8)}`;

let shuttingDown = false;

function parseScheduleIntervalMs(cronOrLabel: string): number {
  const s = cronOrLabel.trim();
  if (s === 'hourly' || s === '0 * * * *') return 60 * 60_000;
  if (s === '0 */6 * * *' || s === 'every_6_hours') return 6 * 60 * 60_000;
  if (s === '0 */12 * * *' || s === 'every_12_hours') return 12 * 60 * 60_000;
  return 24 * 60 * 60_000; // default daily
}

async function maybeEnqueueScheduledSync(): Promise<void> {
  const connections = await prisma.mailWizzCustomerConnection.findMany({
    where: {
      syncScheduleEnabled: true,
      isEnabled: true,
      isQuarantine: false,
      status: { not: 'DISABLED' },
      installation: { isActive: true },
      credentials: { some: { isActive: true, status: 'ACTIVE' } },
      OR: [
        { syncState: null },
        { syncState: { isPaused: false } },
      ],
    },
    include: {
      credentials: {
        where: { isActive: true, status: 'ACTIVE' },
        orderBy: { version: 'desc' },
        take: 1,
      },
    },
  });

  for (const conn of connections) {
    const activeOrPending = await prisma.syncJob.count({
      where: {
        customerConnectionId: conn.id,
        type: 'FULL_SYNC',
        status: { in: ['PENDING', 'RUNNING'] },
      },
    });
    if (activeOrPending > 0) continue;

    const lastCompleted = await prisma.syncJob.findFirst({
      where: {
        customerConnectionId: conn.id,
        type: 'FULL_SYNC',
        status: 'COMPLETED',
      },
      orderBy: { finishedAt: 'desc' },
    });

    const intervalMs = parseScheduleIntervalMs(conn.syncScheduleCron);
    const lastFinishedMs = lastCompleted?.finishedAt?.getTime() ?? 0;

    if (Date.now() - lastFinishedMs >= intervalMs) {
      await enqueueJob({
        type: 'FULL_SYNC',
        customerConnectionId: conn.id,
        credentialVersion: conn.credentials[0]?.version ?? null,
        payload: {
          customerConnectionId: conn.id,
          triggeredBy: 'scheduler',
          schedule: conn.syncScheduleCron,
        },
      });
      logger.info('Enqueued scheduled FULL_SYNC job for customer connection', {
        customerConnectionId: conn.id,
        customerSlug: conn.customerSlug,
        schedule: conn.syncScheduleCron,
      });
    }
  }
}

async function runWorkerLoop(): Promise<void> {
  const env = getEnv();
  const pollMs = env.WORKER_POLL_INTERVAL_MS;

  logger.info('Background worker started', {
    workerId: WORKER_ID,
    pollIntervalMs: pollMs,
  });

  let lastRecoveryCheck = 0;

  while (!shuttingDown) {
    try {
      if (Date.now() - lastRecoveryCheck > 60_000) {
        const recovered = await recoverStaleJobs();
        if (recovered > 0) {
          logger.warn('Recovered stale background jobs', { count: recovered });
        }
        await maybeEnqueueScheduledSync();
        lastRecoveryCheck = Date.now();
      }

      const job = await claimNextJob(WORKER_ID);
      if (job) {
        logger.info('Worker claimed job', {
          workerId: WORKER_ID,
          jobId: job.id,
          type: job.type,
          attempt: job.attempts,
        });
        await executeSyncJob(job);
        continue; // Immediately check for next queued job
      }
    } catch (err) {
      logger.error('Worker loop iteration error', {
        workerId: WORKER_ID,
        error: err instanceof Error ? err.message : 'unknown',
      });
    }

    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  logger.info('Background worker exiting cleanly', { workerId: WORKER_ID });
  await prisma.$disconnect();
}

process.on('SIGINT', () => {
  shuttingDown = true;
});
process.on('SIGTERM', () => {
  shuttingDown = true;
});

runWorkerLoop().catch(async (err) => {
  logger.error('Fatal worker error', {
    error: err instanceof Error ? err.message : 'unknown',
  });
  await prisma.$disconnect();
  process.exit(1);
});
