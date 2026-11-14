import { prisma } from '@/lib/db';
import {
  loadHygieneRuleConfig,
  classifySubscriber,
} from '@/services/analysis/classifier';
import { updateJobProgress } from '@/services/jobs/queue';
import {
  createConfiguredMutationClient,
  type MailWizzMutationClient,
} from '@/services/mutations/gate';
import { recordAuditLog } from '@/services/security/audit';
import { logger } from '@/services/security/logger';
import type { Prisma } from '@prisma/client';

export interface CleanupExecutionResult {
  operationId: string;
  finalStatus: 'COMPLETED' | 'PAUSED' | 'CANCELLED' | 'AUTO_STOPPED';
  succeededCount: number;
  skippedCount: number;
  failedCount: number;
  reconciledCount: number;
  autoStopReason?: string;
}

export async function executeCleanupOperation(params: {
  operationId: string;
  syncJobId?: string;
  mutationClient?: MailWizzMutationClient;
  actorEmail?: string;
}): Promise<CleanupExecutionResult> {
  const op = await prisma.cleanupOperation.findUnique({
    where: { id: params.operationId },
    include: { mailingList: true },
  });
  if (!op) throw new Error(`CleanupOperation ${params.operationId} not found.`);
  if (op.dryRunOnly) {
    throw new Error('Cannot execute a DRY RUN operation without explicit confirmation.');
  }

  const actor = params.actorEmail ?? op.confirmedByEmail ?? op.createdByEmail;
  const ruleConfig = await loadHygieneRuleConfig();

  const needsRemoteClient =
    op.actionType === 'UNSUBSCRIBE' ||
    op.actionType === 'CREATE_LIST' ||
    op.actionType === 'CREATE_SEGMENT' ||
    op.actionType === 'COPY_SUBSCRIBERS' ||
    op.actionType === 'MOVE_SUBSCRIBERS';

  let client = params.mutationClient;
  if (needsRemoteClient && !client) {
    const configured = await createConfiguredMutationClient();
    client = configured.client;
  }

  await prisma.cleanupOperation.update({
    where: { id: op.id },
    data: { status: 'RUNNING' },
  });

  // Handle single-shot CREATE_LIST / CREATE_SEGMENT setup if needed
  const ruleSnapshot = op.ruleConfigSnapshotJson as {
    newListConfig?: {
      name: string;
      description: string;
      fromName: string;
      fromEmail: string;
      replyTo: string;
      subject?: string;
    };
  };

  if (op.actionType === 'CREATE_LIST' && client) {
    const listCfg = ruleSnapshot.newListConfig;
    const fromName = listCfg?.fromName ?? op.mailingList?.fromName ?? 'Admin';
    const fromEmail = listCfg?.fromEmail ?? op.mailingList?.fromEmail ?? '';
    const replyTo = listCfg?.replyTo ?? op.mailingList?.replyTo ?? fromEmail;
    if (!fromEmail) {
      throw new Error('CREATE_LIST requires verified sender fromEmail metadata.');
    }
    const created = await client.createList({
      name: listCfg?.name ?? op.targetListName ?? 'Clean Segment List',
      description: listCfg?.description ?? 'Created safely by MailWizz List Hygiene Manager',
      fromName,
      fromEmail,
      replyTo,
      subject: listCfg?.subject,
      optIn: 'single',
      optOut: 'single',
      actorEmail: actor,
    });
    await prisma.cleanupOperation.update({
      where: { id: op.id },
      data: { targetListUid: created.listUid },
    });
    await prisma.mailingList.upsert({
      where: { listUid: created.listUid },
      update: {
        name: listCfg?.name ?? op.targetListName ?? 'Clean Segment List',
        fromName,
        fromEmail,
        replyTo,
        optIn: 'single',
        optOut: 'single',
        lastSyncedAt: new Date(),
      },
      create: {
        listUid: created.listUid,
        name: listCfg?.name ?? op.targetListName ?? 'Clean Segment List',
        fromName,
        fromEmail,
        replyTo,
        optIn: 'single',
        optOut: 'single',
        lastSyncedAt: new Date(),
      },
    });
  }

  if (op.actionType === 'CREATE_SEGMENT' && client && op.mailingList) {
    const segRes = await client.createOrUpdateSegment({
      listUid: op.mailingList.listUid,
      segmentUid: op.targetSegmentUid ?? undefined,
      name: op.targetSegmentName ?? `Hygiene Segment ${new Date().toISOString().slice(0, 10)}`,
      operatorMatch: 'all',
      actorEmail: actor,
    });
    await prisma.cleanupOperation.update({
      where: { id: op.id },
      data: { targetSegmentUid: segRes.segmentUid },
    });
    await prisma.listSegment.upsert({
      where: {
        mailingListId_segmentUid: {
          mailingListId: op.mailingList.id,
          segmentUid: segRes.segmentUid,
        },
      },
      update: {
        name: op.targetSegmentName ?? 'Hygiene Segment',
        lastSyncedAt: new Date(),
      },
      create: {
        mailingListId: op.mailingList.id,
        segmentUid: segRes.segmentUid,
        name: op.targetSegmentName ?? 'Hygiene Segment',
        operatorMatch: 'all',
        apiSubscribersCount: op.eligibleCount,
        lastSyncedAt: new Date(),
      },
    });
  }

  const totalPendingAtStart = await prisma.cleanupOperationRecord.count({
    where: { operationId: op.id, outcome: 'PENDING' },
  });

  let succeededCount = op.succeededCount;
  let skippedCount = op.skippedCount;
  let failedCount = op.failedCount;
  let reconciledCount = op.reconciledCount;
  let processedInRun = 0;

  const batchSize = Math.max(1, Math.min(50, op.batchSize));

  while (true) {
    // Check pause or cancel requests before starting next batch
    if (params.syncJobId) {
      const jobState = await prisma.syncJob.findUnique({
        where: { id: params.syncJobId },
        select: { pauseRequested: true, cancelRequested: true },
      });

      if (jobState?.cancelRequested) {
        const remaining = await prisma.cleanupOperationRecord.updateMany({
          where: { operationId: op.id, outcome: 'PENDING' },
          data: {
            outcome: 'SKIPPED',
            reason: 'Cancelled by administrator before pending batch.',
            processedAt: new Date(),
          },
        });
        skippedCount += remaining.count;
        await prisma.cleanupOperation.update({
          where: { id: op.id },
          data: {
            status: 'CANCELLED',
            succeededCount,
            skippedCount,
            failedCount,
            reconciledCount,
            completedAt: new Date(),
          },
        });
        await recordAuditLog({
          actorEmail: actor,
          action: 'CLEANUP_OPERATION_CANCELLED',
          resourceType: 'CleanupOperation',
          resourceId: op.id,
          outcome: 'SUCCESS',
          details: { status: 'CANCELLED', succeededCount, skippedCount, failedCount, reconciledCount },
        });
        return {
          operationId: op.id,
          finalStatus: 'CANCELLED',
          succeededCount,
          skippedCount,
          failedCount,
          reconciledCount,
        };
      }

      if (jobState?.pauseRequested) {
        await prisma.cleanupOperation.update({
          where: { id: op.id },
          data: {
            status: 'PAUSED',
            succeededCount,
            skippedCount,
            failedCount,
            reconciledCount,
          },
        });
        await prisma.syncJob.update({
          where: { id: params.syncJobId },
          data: {
            status: 'PAUSED',
            pauseRequested: false,
            lockedBy: null,
            progressMessage: `Paused at checkpoint (${succeededCount + reconciledCount} done).`,
          },
        });
        await recordAuditLog({
          actorEmail: actor,
          action: 'CLEANUP_OPERATION_PAUSED',
          resourceType: 'CleanupOperation',
          resourceId: op.id,
          outcome: 'SUCCESS',
          details: { status: 'PAUSED', succeededCount, skippedCount, failedCount, reconciledCount },
        });
        return {
          operationId: op.id,
          finalStatus: 'PAUSED',
          succeededCount,
          skippedCount,
          failedCount,
          reconciledCount,
        };
      }
    }

    const batch = await prisma.cleanupOperationRecord.findMany({
      where: { operationId: op.id, outcome: 'PENDING' },
      take: batchSize,
      orderBy: { createdAt: 'asc' },
    });

    if (batch.length === 0) break;

    for (const rec of batch) {
      processedInRun++;
      if (!rec.subscriberId) {
        await prisma.cleanupOperationRecord.update({
          where: { id: rec.id },
          data: {
            outcome: 'SKIPPED',
            reason: 'Local subscriber record missing.',
            processedAt: new Date(),
          },
        });
        skippedCount++;
        continue;
      }

      const freshSub = await prisma.subscriber.findUnique({
        where: { id: rec.subscriberId },
        include: {
          engagementEvents: {
            where: { occurredAt: { gt: op.createdAt } },
            select: { eventType: true, occurredAt: true, source: true },
          },
        },
      });

      if (!freshSub) {
        await prisma.cleanupOperationRecord.update({
          where: { id: rec.id },
          data: {
            outcome: 'SKIPPED',
            reason: 'Subscriber removed locally before processing.',
            processedAt: new Date(),
          },
        });
        skippedCount++;
        continue;
      }

      // Mid-job safety re-verification: check for renewed engagement or protection changes since dry run
      const hasMidJobEngagement = freshSub.engagementEvents.some((ev) => {
        if (ev.eventType === 'CLICK' || ev.eventType === 'REPLY' || ev.eventType === 'CONVERSION') {
          return true;
        }
        if (ev.eventType === 'OPEN' && ruleConfig.countOpensAsEngaged) {
          return true;
        }
        return false;
      });

      if (
        hasMidJobEngagement ||
        (op.actionType !== 'COPY_SUBSCRIBERS' &&
          op.actionType !== 'CREATE_LIST' &&
          (freshSub.isVip || freshSub.hasPaidRelationship || freshSub.status !== 'CONFIRMED'))
      ) {
        const skipReason = hasMidJobEngagement
          ? 'Skipped mid-job: renewed engagement event occurred after dry-run preview.'
          : `Skipped mid-job: subscriber became ${freshSub.status} or protected.`;

        if (hasMidJobEngagement) {
          // Reclassify immediately if renewed engagement occurred mid-job
          const fullEvents = await prisma.engagementEvent.findMany({
            where: { subscriberId: freshSub.id },
            select: {
              eventType: true,
              source: true,
              occurredAt: true,
              isHistorical: true,
              campaignId: true,
            },
          });
          const reclassified = classifySubscriber(
            {
              email: freshSub.email,
              status: freshSub.status,
              source: freshSub.source,
              dateAddedMailwizz: freshSub.dateAddedMailwizz,
              isVip: freshSub.isVip,
              hasPaidRelationship: freshSub.hasPaidRelationship,
              lastPurchaseAt: freshSub.lastPurchaseAt,
              events: fullEvents,
            },
            ruleConfig
          );
          await prisma.subscriber.update({
            where: { id: freshSub.id },
            data: {
              engagementStatus: reclassified.engagementStatus,
              engagementReason: reclassified.engagementReason,
              hygieneStatus: reclassified.hygieneStatus,
              hygieneReason: reclassified.hygieneReason,
            },
          });
        }

        await prisma.cleanupOperationRecord.update({
          where: { id: rec.id },
          data: {
            outcome: 'SKIPPED',
            reason: skipReason,
            processedAt: new Date(),
          },
        });
        skippedCount++;
        continue;
      }

      const now = new Date();
      try {
        if (op.actionType === 'SUPPRESS') {
          await prisma.subscriber.update({
            where: { id: freshSub.id },
            data: {
              isSuppressed: true,
              suppressionReason:
                rec.reason ?? `Suppressed by hygiene operation ${op.id}`,
              suppressedAt: now,
            },
          });
          await prisma.cleanupOperationRecord.update({
            where: { id: rec.id },
            data: {
              outcome: 'SUCCEEDED',
              attemptCount: { increment: 1 },
              processedAt: now,
            },
          });
          succeededCount++;
        } else if (op.actionType === 'ARCHIVE') {
          await prisma.subscriber.update({
            where: { id: freshSub.id },
            data: {
              isArchived: true,
              archivedAt: now,
              archiveReason:
                rec.reason ?? `Archived logically by operation ${op.id}`,
              isSuppressed: true,
              suppressionReason:
                freshSub.suppressionReason ?? 'Suppressed via logical archive',
              suppressedAt: freshSub.suppressedAt ?? now,
            },
          });
          await prisma.cleanupOperationRecord.update({
            where: { id: rec.id },
            data: {
              outcome: 'SUCCEEDED',
              attemptCount: { increment: 1 },
              processedAt: now,
            },
          });
          succeededCount++;
        } else if (op.actionType === 'UNSUBSCRIBE' && client) {
          // Verify remote status first to detect discrepancies
          const remoteBefore = await client.getRemoteSubscriber(
            rec.mailingListUid,
            rec.subscriberUid
          );
          const remoteStatus = remoteBefore.data?.record?.status?.toLowerCase();

          if (remoteStatus && remoteStatus !== 'confirmed') {
            await prisma.subscriber.update({
              where: { id: freshSub.id },
              data: {
                rawStatus: remoteStatus,
                status: remoteStatus === 'unsubscribed' ? 'UNSUBSCRIBED' : freshSub.status,
              },
            });
            await prisma.cleanupOperationRecord.update({
              where: { id: rec.id },
              data: {
                outcome: 'RECONCILED',
                remoteStatusBefore: remoteStatus,
                remoteStatusAfter: remoteStatus,
                reason: `Reconciled: remote MailWizz status was already "${remoteStatus}".`,
                attemptCount: { increment: 1 },
                processedAt: now,
              },
            });
            reconciledCount++;
          } else {
            await client.unsubscribeSubscriber({
              listUid: rec.mailingListUid,
              subscriberUid: rec.subscriberUid,
              actorEmail: actor,
            });
            await prisma.subscriber.update({
              where: { id: freshSub.id },
              data: {
                status: 'UNSUBSCRIBED',
                rawStatus: 'unsubscribed',
                hygieneStatus: 'UNSUBSCRIBED',
                engagementStatus: 'EXCLUDED',
                engagementReason: `Unsubscribed in MailWizz by hygiene operation ${op.id}.`,
              },
            });
            await prisma.cleanupOperationRecord.update({
              where: { id: rec.id },
              data: {
                outcome: 'SUCCEEDED',
                remoteStatusBefore: remoteStatus ?? 'confirmed',
                remoteStatusAfter: 'unsubscribed',
                attemptCount: { increment: 1 },
                processedAt: now,
              },
            });
            succeededCount++;
          }
        } else if (
          (op.actionType === 'COPY_SUBSCRIBERS' || op.actionType === 'CREATE_LIST') &&
          client
        ) {
          const updatedOp = await prisma.cleanupOperation.findUnique({
            where: { id: op.id },
            select: { targetListUid: true },
          });
          const targetUid = updatedOp?.targetListUid ?? op.targetListUid;
          if (!targetUid) {
            throw new Error('Missing targetListUid for subscriber copy.');
          }
          const targetListMeta = await client.getRemoteList(targetUid);
          await client.createSubscribersBulk({
            targetListUid: targetUid,
            targetListOptIn: targetListMeta.data?.record?.general?.opt_in,
            subscribers: [
              {
                EMAIL: freshSub.email,
                ...(freshSub.firstName ? { FNAME: freshSub.firstName } : {}),
                ...(freshSub.lastName ? { LNAME: freshSub.lastName } : {}),
              },
            ],
            actorEmail: actor,
          });
          await prisma.cleanupOperationRecord.update({
            where: { id: rec.id },
            data: {
              outcome: 'SUCCEEDED',
              attemptCount: { increment: 1 },
              reason: `Copied cleanly to list ${targetUid}; original list untouched.`,
              processedAt: now,
            },
          });
          succeededCount++;
        } else {
          await prisma.cleanupOperationRecord.update({
            where: { id: rec.id },
            data: {
              outcome: 'SUCCEEDED',
              attemptCount: { increment: 1 },
              processedAt: now,
            },
          });
          succeededCount++;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        logger.warn('Cleanup record execution error', {
          operationId: op.id,
          subscriberUid: rec.subscriberUid,
          error: message,
        });

        // Reconcile ambiguous failures on UNSUBSCRIBE by querying remote status before giving up
        if (op.actionType === 'UNSUBSCRIBE' && client) {
          try {
            const checkRemote = await client.getRemoteSubscriber(
              rec.mailingListUid,
              rec.subscriberUid
            );
            const postStatus = checkRemote.data?.record?.status?.toLowerCase();
            if (postStatus === 'unsubscribed') {
              await prisma.subscriber.update({
                where: { id: freshSub.id },
                data: {
                  status: 'UNSUBSCRIBED',
                  rawStatus: 'unsubscribed',
                  hygieneStatus: 'UNSUBSCRIBED',
                  engagementStatus: 'EXCLUDED',
                },
              });
              await prisma.cleanupOperationRecord.update({
                where: { id: rec.id },
                data: {
                  outcome: 'RECONCILED',
                  remoteStatusAfter: 'unsubscribed',
                  reason: `Reconciled after ambiguous error (${message}): remote status confirmed unsubscribed.`,
                  attemptCount: { increment: 1 },
                  processedAt: now,
                },
              });
              reconciledCount++;
              continue;
            }
          } catch {
            // Fall through to mark FAILED if reconciliation query also failed
          }
        }

        await prisma.cleanupOperationRecord.update({
          where: { id: rec.id },
          data: {
            outcome: 'FAILED',
            attemptCount: { increment: 1 },
            errorMessage: message.slice(0, 500),
            processedAt: now,
          },
        });
        failedCount++;

        // Discrepancy / unexpected failure auto-stop protection
        const processedTotal = succeededCount + failedCount + reconciledCount;
        if (
          failedCount >= 5 ||
          (processedTotal >= 4 && failedCount / processedTotal >= 0.25)
        ) {
          const autoStopReason = `Auto-stopped after ${failedCount} failure(s) out of ${processedTotal} processed record(s). Last error: ${message}`;
          await prisma.cleanupOperation.update({
            where: { id: op.id },
            data: {
              status: 'AUTO_STOPPED',
              autoStopReason,
              checkpointIndex: op.checkpointIndex + processedInRun,
              succeededCount,
              skippedCount,
              failedCount,
              reconciledCount,
            },
          });
          await recordAuditLog({
            actorEmail: actor,
            action: 'CLEANUP_OPERATION_AUTO_STOPPED',
            resourceType: 'CleanupOperation',
            resourceId: op.id,
            outcome: 'FAILED',
            details: {
              status: 'AUTO_STOPPED',
              autoStopReason,
              succeededCount,
              skippedCount,
              failedCount,
              reconciledCount,
            },
          });
          return {
            operationId: op.id,
            finalStatus: 'AUTO_STOPPED',
            succeededCount,
            skippedCount,
            failedCount,
            reconciledCount,
            autoStopReason,
          };
        }
      }
    }

    // Persist checkpoint after each batch
    await prisma.cleanupOperation.update({
      where: { id: op.id },
      data: {
        checkpointIndex: op.checkpointIndex + processedInRun,
        succeededCount,
        skippedCount,
        failedCount,
        reconciledCount,
      },
    });

    if (params.syncJobId && totalPendingAtStart > 0) {
      await updateJobProgress(params.syncJobId, {
        current: Math.min(processedInRun, totalPendingAtStart),
        total: totalPendingAtStart,
        message: `Processed ${succeededCount + reconciledCount} succeeded, ${skippedCount} skipped, ${failedCount} failed`,
      });
    }
  }

  const reconciliationSummary = {
    intendedCount: op.eligibleCount,
    succeededCount,
    skippedCount,
    failedCount,
    reconciledCount,
    discrepancyCount: failedCount,
    completedAt: new Date().toISOString(),
  };

  await prisma.cleanupOperation.update({
    where: { id: op.id },
    data: {
      status: 'COMPLETED',
      succeededCount,
      skippedCount,
      failedCount,
      reconciledCount,
      reconciliationSummaryJson:
        reconciliationSummary as unknown as Prisma.InputJsonValue,
      afterSnapshotJson: reconciliationSummary as unknown as Prisma.InputJsonValue,
      completedAt: new Date(),
    },
  });

  await recordAuditLog({
    actorEmail: actor,
    action: 'CLEANUP_OPERATION_COMPLETED',
    resourceType: 'CleanupOperation',
    resourceId: op.id,
    outcome: failedCount > 0 ? 'FAILED' : 'SUCCESS',
    details: reconciliationSummary,
  });

  return {
    operationId: op.id,
    finalStatus: 'COMPLETED',
    succeededCount,
    skippedCount,
    failedCount,
    reconciledCount,
  };
}
