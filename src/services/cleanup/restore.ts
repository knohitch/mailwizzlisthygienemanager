import { prisma } from '@/lib/db';
import { enqueueJob } from '@/services/jobs/queue';
import { recordAuditLog } from '@/services/security/audit';
import { decryptSecret } from '@/services/security/crypto';

export async function pauseCleanupOperation(operationId: string, actorEmail: string) {
  const op = await prisma.cleanupOperation.findUnique({ where: { id: operationId } });
  if (!op) throw new Error('Operation not found.');
  if (op.status !== 'RUNNING' && op.status !== 'CONFIRMED') {
    throw new Error(`Cannot pause operation in status ${op.status}.`);
  }

  if (op.syncJobId) {
    await prisma.syncJob.update({
      where: { id: op.syncJobId },
      data: { pauseRequested: true },
    });
  }
  await prisma.cleanupOperation.update({
    where: { id: op.id },
    data: { status: 'PAUSED' },
  });
  await recordAuditLog({
    actorEmail,
    action: 'CLEANUP_PAUSE_REQUESTED',
    resourceType: 'CleanupOperation',
    resourceId: op.id,
    outcome: 'SUCCESS',
  });
}

export async function resumeCleanupOperation(operationId: string, actorEmail: string) {
  const op = await prisma.cleanupOperation.findUnique({ where: { id: operationId } });
  if (!op) throw new Error('Operation not found.');
  if (op.status !== 'PAUSED' && op.status !== 'AUTO_STOPPED') {
    throw new Error(`Cannot resume operation in status ${op.status}.`);
  }

  const claimed = await prisma.cleanupOperation.updateMany({
    where: { id: op.id, status: { in: ['PAUSED', 'AUTO_STOPPED'] } },
    data: { status: 'CONFIRMED', autoStopReason: null },
  });
  if (claimed.count === 0) {
    throw new Error(
      'Operation could not be resumed because its status changed concurrently.'
    );
  }

  const job = await enqueueJob({
    type: 'HYGIENE_EXECUTION',
    payload: { operationId: op.id, actorEmail },
    maxAttempts: 2,
  });

  const updated = await prisma.cleanupOperation.update({
    where: { id: op.id },
    data: { syncJobId: job.id },
  });

  await recordAuditLog({
    actorEmail,
    action: 'CLEANUP_RESUMED',
    resourceType: 'CleanupOperation',
    resourceId: op.id,
    outcome: 'SUCCESS',
    details: { newSyncJobId: job.id },
  });

  return { operation: updated, job };
}

export async function cancelCleanupOperation(operationId: string, actorEmail: string) {
  const op = await prisma.cleanupOperation.findUnique({ where: { id: operationId } });
  if (!op) throw new Error('Operation not found.');
  if (op.status === 'COMPLETED' || op.status === 'CANCELLED') {
    throw new Error(`Operation is already ${op.status}.`);
  }

  if (op.syncJobId) {
    await prisma.syncJob.update({
      where: { id: op.syncJobId },
      data: { cancelRequested: true },
    });
  }

  const skipped = await prisma.cleanupOperationRecord.updateMany({
    where: { operationId: op.id, outcome: 'PENDING' },
    data: {
      outcome: 'SKIPPED',
      reason: 'Cancelled by administrator before execution.',
      processedAt: new Date(),
    },
  });

  const updated = await prisma.cleanupOperation.update({
    where: { id: op.id },
    data: {
      status: 'CANCELLED',
      skippedCount: op.skippedCount + skipped.count,
      completedAt: new Date(),
    },
  });

  await recordAuditLog({
    actorEmail,
    action: 'CLEANUP_CANCELLED',
    resourceType: 'CleanupOperation',
    resourceId: op.id,
    outcome: 'SUCCESS',
    details: { status: 'CANCELLED', cancelledPendingRecords: skipped.count },
  });

  return updated;
}

export async function restoreSuppressedSubscribers(params: {
  operationId?: string;
  subscriberIds?: string[];
  adminApproved: boolean;
  reason: string;
  actorEmail: string;
  ipAddress?: string;
}): Promise<{
  restoredCount: number;
  blockedCount: number;
  blockedReasons: Array<{ subscriberUid: string; maskedEmail: string; reason: string }>;
  unsubscribeAuditPreserved: boolean;
}> {
  if (!params.adminApproved) {
    throw new Error('Explicit administrator approval is required before restoring suppressions.');
  }

  let targetIds = params.subscriberIds ?? [];
  let unsubscribeAuditPreserved = false;

  if (params.operationId) {
    const op = await prisma.cleanupOperation.findUnique({
      where: { id: params.operationId },
      include: {
        records: {
          where: { outcome: { in: ['SUCCEEDED', 'RECONCILED'] } },
          select: { subscriberId: true },
        },
      },
    });
    if (!op) throw new Error('Cleanup operation not found.');

    if (op.actionType === 'UNSUBSCRIBE') {
      unsubscribeAuditPreserved = true;
      await recordAuditLog({
        actorEmail: params.actorEmail,
        action: 'UNSUBSCRIBE_ROLLBACK_BLOCKED_SAFETY',
        resourceType: 'CleanupOperation',
        resourceId: op.id,
        outcome: 'DENIED',
        ipAddress: params.ipAddress,
        details: {
          reason:
            'MailWizz unsubscribes are NEVER automatically re-subscribed. Encrypted pre-change snapshot and audit trail are preserved for compliance review.',
        },
      });
      throw new Error(
        'MailWizz unsubscribe actions cannot be automatically re-subscribed to protect consent compliance. The encrypted snapshot and audit logs remain preserved for inspection.'
      );
    }

    targetIds = op.records
      .map((r) => r.subscriberId)
      .filter((id): id is string => Boolean(id));
  }

  if (targetIds.length === 0) {
    return {
      restoredCount: 0,
      blockedCount: 0,
      blockedReasons: [],
      unsubscribeAuditPreserved,
    };
  }

  const candidates = await prisma.subscriber.findMany({
    where: { id: { in: targetIds } },
    select: {
      id: true,
      subscriberUid: true,
      email: true,
      status: true,
      isSuppressed: true,
      isArchived: true,
      complaintsCount: true,
      hardBouncesCount: true,
    },
  });

  const eligibleIds: string[] = [];
  const blockedReasons: Array<{
    subscriberUid: string;
    maskedEmail: string;
    reason: string;
  }> = [];

  for (const sub of candidates) {
    const [local, domain] = sub.email.split('@');
    const maskedEmail = `${(local ?? '').slice(0, 2)}***@${domain ?? ''}`;

    if (
      sub.status === 'UNSUBSCRIBED' ||
      sub.status === 'BLACKLISTED' ||
      sub.status === 'UNCONFIRMED'
    ) {
      blockedReasons.push({
        subscriberUid: sub.subscriberUid,
        maskedEmail,
        reason: `Blocked: subscriber MailWizz status is ${sub.status}.`,
      });
      continue;
    }
    if (sub.complaintsCount > 0 || sub.hardBouncesCount > 0) {
      blockedReasons.push({
        subscriberUid: sub.subscriberUid,
        maskedEmail,
        reason: 'Blocked: spam complaint or hard bounce recorded.',
      });
      continue;
    }
    if (!sub.isSuppressed && !sub.isArchived) {
      blockedReasons.push({
        subscriberUid: sub.subscriberUid,
        maskedEmail,
        reason: 'Already active (not suppressed or archived).',
      });
      continue;
    }
    eligibleIds.push(sub.id);
  }

  if (eligibleIds.length > 0) {
    await prisma.subscriber.updateMany({
      where: { id: { in: eligibleIds } },
      data: {
        isSuppressed: false,
        suppressionReason: null,
        suppressedAt: null,
        isArchived: false,
        archivedAt: null,
        archiveReason: null,
      },
    });
  }

  await recordAuditLog({
    actorEmail: params.actorEmail,
    action: 'SUPPRESSION_RESTORED',
    resourceType: 'SubscriberBatch',
    resourceId: params.operationId ?? 'manual_selection',
    outcome: 'SUCCESS',
    ipAddress: params.ipAddress,
    details: {
      reason: params.reason,
      restoredCount: eligibleIds.length,
      blockedCount: blockedReasons.length,
    },
  });

  return {
    restoredCount: eligibleIds.length,
    blockedCount: blockedReasons.length,
    blockedReasons,
    unsubscribeAuditPreserved,
  };
}

export async function inspectOperationSnapshot(operationId: string, actorEmail: string) {
  const op = await prisma.cleanupOperation.findUnique({
    where: { id: operationId },
    select: { id: true, actionType: true, snapshotEnc: true, snapshotSha256: true },
  });
  if (!op || !op.snapshotEnc) {
    throw new Error('Encrypted pre-change snapshot not available for this operation.');
  }
  const decrypted = decryptSecret(op.snapshotEnc);
  await recordAuditLog({
    actorEmail,
    action: 'CLEANUP_SNAPSHOT_INSPECTED',
    resourceType: 'CleanupOperation',
    resourceId: op.id,
    outcome: 'SUCCESS',
  });
  return {
    operationId: op.id,
    actionType: op.actionType,
    sha256: op.snapshotSha256,
    snapshot: JSON.parse(decrypted) as {
      capturedAt: string;
      actionType: string;
      records: Array<{
        subscriberUid: string;
        mailingListUid: string;
        maskedEmail: string;
        status: string;
        isSuppressed: boolean;
        engagementStatus: string;
      }>;
    },
  };
}
