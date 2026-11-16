import { prisma } from '@/lib/db';
import { recomputeAllHygieneClassifications } from '@/services/analysis/classifier';
import { reconcileListsAndCampaigns } from '@/services/analysis/reconciliation';
import { executeCleanupOperation } from '@/services/cleanup/executor';
import { restoreSuppressedSubscribers } from '@/services/cleanup/restore';
import { runMailWizzSync } from '@/services/mailwizz/sync';
import { evaluateReengagementPlan } from '@/services/reengagement/workflow';
import { logger } from '@/services/security/logger';
import { completeJob, failOrRetryJob, updateJobProgress } from './queue';
import type { Prisma, SyncJob } from '@prisma/client';

export async function executeSyncJob(job: SyncJob): Promise<void> {
  try {
    const payload = (job.payloadJson ?? {}) as Record<string, unknown>;

    if (job.customerConnectionId) {
      const conn = await prisma.mailWizzCustomerConnection.findUnique({
        where: { id: job.customerConnectionId },
        include: {
          syncState: true,
          credentials: {
            where: { isActive: true, status: 'ACTIVE' },
            orderBy: { version: 'desc' },
            take: 1,
          },
        },
      });
      const activeCred = conn?.credentials[0];
      let abortReason: string | null = null;
      if (!conn || conn.isQuarantine || !conn.isEnabled || conn.status === 'DISABLED') {
        abortReason = `Cancelled: customer connection ${job.customerConnectionId} is disabled or quarantined.`;
      } else if (conn.syncState?.isPaused) {
        abortReason = `Cancelled: sync is paused for customer connection ${conn.customerName}.`;
      } else if (
        job.credentialVersion !== null &&
        job.credentialVersion !== undefined &&
        (!activeCred || activeCred.version !== job.credentialVersion)
      ) {
        abortReason = `Cancelled: API key rotated or revoked before execution (expected credential v${job.credentialVersion}, active=${activeCred?.version ?? 'none'}).`;
      }
      if (abortReason) {
        await prisma.syncJob.update({
          where: { id: job.id },
          data: {
            status: 'CANCELLED',
            lastError: abortReason,
            progressMessage: abortReason,
            finishedAt: new Date(),
            lockedBy: null,
          },
        });
        logger.warn('SyncJob aborted before execution due to connection/credential state', {
          jobId: job.id,
          customerConnectionId: job.customerConnectionId,
          reason: abortReason,
        });
        return;
      }
    }

    switch (job.type) {
      case 'FULL_SYNC': {
        const connId =
          job.customerConnectionId ??
          (typeof payload.customerConnectionId === 'string'
            ? payload.customerConnectionId
            : undefined);
        const result = await runMailWizzSync({
          customerConnectionId: connId,
          expectedCredentialVersion: job.credentialVersion ?? undefined,
          onProgress: (p) => updateJobProgress(job.id, p),
        });
        await completeJob(job.id, { ...result });
        break;
      }

      case 'LIST_SYNC': {
        const listUid = typeof payload.listUid === 'string' ? payload.listUid : undefined;
        if (!listUid) {
          throw new Error('LIST_SYNC job missing required listUid payload.');
        }
        const connId =
          job.customerConnectionId ??
          (typeof payload.customerConnectionId === 'string'
            ? payload.customerConnectionId
            : undefined);
        const result = await runMailWizzSync({
          customerConnectionId: connId,
          expectedCredentialVersion: job.credentialVersion ?? undefined,
          onlyListUid: listUid,
          onProgress: (p) => updateJobProgress(job.id, p),
        });
        await completeJob(job.id, { ...result, listUid });
        break;
      }

      case 'ANALYZE_HYGIENE': {
        await updateJobProgress(job.id, {
          current: 25,
          total: 100,
          message: 'Recomputing engagement classifications...',
        });
        const mailingListId =
          typeof payload.mailingListId === 'string' ? payload.mailingListId : undefined;
        const connId =
          job.customerConnectionId ??
          (typeof payload.customerConnectionId === 'string'
            ? payload.customerConnectionId
            : undefined);
        const result = await recomputeAllHygieneClassifications(mailingListId, connId);
        await updateJobProgress(job.id, {
          current: 80,
          total: 100,
          message: 'Reconciling list & campaign counters...',
        });
        await reconcileListsAndCampaigns(mailingListId, connId);
        await completeJob(job.id, { ...result });
        break;
      }

      case 'RETENTION_CLEANUP': {
        const cfg = await prisma.appConfig.findUnique({ where: { id: 'default' } });
        const retentionDays = cfg?.dataRetentionDays ?? 365;
        const cutoff = new Date(Date.now() - retentionDays * 86_400_000);

        const [deletedSessions, deletedEvents, deletedJobs] = await Promise.all([
          prisma.adminSession.deleteMany({
            where: {
              OR: [{ expiresAt: { lt: new Date() } }, { revokedAt: { lt: cutoff } }],
            },
          }),
          prisma.engagementEvent.deleteMany({
            where: { occurredAt: { lt: cutoff } },
          }),
          prisma.syncJob.deleteMany({
            where: {
              status: { in: ['COMPLETED', 'FAILED', 'CANCELLED'] },
              createdAt: { lt: cutoff },
            },
          }),
        ]);

        await completeJob(job.id, {
          retentionDays,
          deletedSessions: deletedSessions.count,
          deletedEvents: deletedEvents.count,
          deletedJobs: deletedJobs.count,
        });
        break;
      }

      case 'HYGIENE_EXECUTION': {
        const operationId =
          typeof payload.operationId === 'string' ? payload.operationId : '';
        if (!operationId) {
          throw new Error('HYGIENE_EXECUTION missing operationId payload.');
        }
        const actorEmail =
          typeof payload.actorEmail === 'string' ? payload.actorEmail : 'worker@system';

        const result = await executeCleanupOperation({
          operationId,
          syncJobId: job.id,
          actorEmail,
        });

        if (result.finalStatus === 'PAUSED') {
          break;
        }
        if (result.finalStatus === 'CANCELLED') {
          await prisma.syncJob.update({
            where: { id: job.id },
            data: {
              status: 'CANCELLED',
              resultJson: result as unknown as Prisma.InputJsonValue,
              finishedAt: new Date(),
              lockedBy: null,
              progressMessage: 'Cancelled',
            },
          });
          break;
        }
        if (result.finalStatus === 'AUTO_STOPPED') {
          await prisma.syncJob.update({
            where: { id: job.id },
            data: {
              status: 'FAILED',
              lastError: result.autoStopReason ?? 'Auto-stopped on safety discrepancy threshold',
              resultJson: result as unknown as Prisma.InputJsonValue,
              finishedAt: new Date(),
              lockedBy: null,
            },
          });
          break;
        }
        await completeJob(job.id, { ...result });
        break;
      }

      case 'SUPPRESSION_RESTORE': {
        const result = await restoreSuppressedSubscribers({
          customerConnectionId:
            job.customerConnectionId ??
            (typeof payload.customerConnectionId === 'string'
              ? payload.customerConnectionId
              : undefined),
          operationId:
            typeof payload.operationId === 'string' ? payload.operationId : undefined,
          subscriberIds: Array.isArray(payload.subscriberIds)
            ? payload.subscriberIds.map(String)
            : undefined,
          adminApproved: payload.adminApproved === true,
          reason:
            typeof payload.reason === 'string'
              ? payload.reason
              : 'Administrator suppression restore',
          actorEmail:
            typeof payload.actorEmail === 'string' ? payload.actorEmail : 'admin@system',
        });
        await completeJob(job.id, { ...result });
        break;
      }

      case 'REENGAGEMENT_EVALUATION': {
        const planId = typeof payload.planId === 'string' ? payload.planId : '';
        if (!planId) throw new Error('REENGAGEMENT_EVALUATION missing planId.');
        const actorEmail =
          typeof payload.actorEmail === 'string' ? payload.actorEmail : 'admin@system';
        const updated = await evaluateReengagementPlan({
          planId,
          actorEmail,
          createSuppressionDryRun: payload.createSuppressionDryRun === true,
        });
        await completeJob(job.id, {
          planId: updated.id,
          recoveredCount: updated.recoveredCount,
          persistentlyInactiveCount: updated.persistentlyInactiveCount,
        });
        break;
      }

      default:
        throw new Error(`Unsupported job type: ${String(job.type)}`);
    }
  } catch (err) {
    logger.error('SyncJob execution failed', {
      jobId: job.id,
      type: job.type,
      attempt: job.attempts,
      error: err instanceof Error ? err.message : 'unknown',
    });
    await failOrRetryJob(job, err);
  }
}
