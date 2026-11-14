import { prisma } from '@/lib/db';
import {
  loadHygieneRuleConfig,
  classifySubscriber,
} from '@/services/analysis/classifier';
import { updateJobProgress } from '@/services/jobs/queue';
import {
  assertCompatibilityPermitsRemoteMutations,
  createConfiguredMutationClient,
  type MailWizzMutationClient,
  type RemoteMutationOperation,
} from '@/services/mutations/gate';
import { mapStrictMailWizzSubscriberStatus } from '@/services/mailwizz/adapter-v3';
import { recordAuditLog } from '@/services/security/audit';
import { logger } from '@/services/security/logger';
import {
  evaluateActionEligibility,
  type SubscriberSafetyCandidate,
} from './safety';
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
  if (op.status === 'COMPLETED' || op.status === 'CANCELLED') {
    return {
      operationId: op.id,
      finalStatus: op.status,
      succeededCount: op.succeededCount,
      skippedCount: op.skippedCount,
      failedCount: op.failedCount,
      reconciledCount: op.reconciledCount,
    };
  }
  if (params.syncJobId && op.syncJobId && op.syncJobId !== params.syncJobId) {
    logger.warn('Skipping stale duplicate cleanup job', {
      operationId: op.id,
      expectedJobId: op.syncJobId,
      actualJobId: params.syncJobId,
    });
    return {
      operationId: op.id,
      finalStatus: op.status === 'PAUSED' ? 'PAUSED' : 'CANCELLED',
      succeededCount: op.succeededCount,
      skippedCount: op.skippedCount,
      failedCount: op.failedCount,
      reconciledCount: op.reconciledCount,
    };
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
  if (needsRemoteClient) {
    if (op.mailingList?.isDemoData) {
      throw new Error(
        `Safety lock: remote MailWizz action "${op.actionType}" cannot execute against synthetic demo mailing list data.`
      );
    }
    const remoteOp = op.actionType as RemoteMutationOperation;
    await assertCompatibilityPermitsRemoteMutations(remoteOp, {
      requireConnectedReport: !client,
    });
    if (!client) {
      const configured = await createConfiguredMutationClient(remoteOp);
      client = configured.client;
    }
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
          mailingList: {
            select: { id: true, listUid: true },
          },
          engagementEvents: {
            select: {
              eventType: true,
              source: true,
              occurredAt: true,
              isHistorical: true,
              campaignId: true,
            },
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

      // Enforce list-scoping integrity so subscriber UIDs cannot be substituted across lists
      if (
        freshSub.mailingList.listUid !== rec.mailingListUid ||
        freshSub.subscriberUid !== rec.subscriberUid ||
        (op.mailingListId && freshSub.mailingListId !== op.mailingListId)
      ) {
        await prisma.cleanupOperationRecord.update({
          where: { id: rec.id },
          data: {
            outcome: 'SKIPPED',
            reason: 'Blocked: subscriber/mailing-list scoping mismatch.',
            processedAt: new Date(),
          },
        });
        await recordAuditLog({
          actorEmail: actor,
          action: 'CLEANUP_LIST_SCOPING_BLOCKED',
          resourceType: 'CleanupOperationRecord',
          resourceId: rec.id,
          outcome: 'DENIED',
          details: {
            operationId: op.id,
            expectedListUid: rec.mailingListUid,
            actualListUid: freshSub.mailingList.listUid,
          },
        });
        skippedCount++;
        continue;
      }

      // Live pre-mutation re-verification: reclassify engagement and verify eligibility right before acting
      const hasMidJobEngagement = freshSub.engagementEvents.some((ev) => {
        if (ev.occurredAt.getTime() <= op.createdAt.getTime()) return false;
        if (ev.eventType === 'CLICK' || ev.eventType === 'REPLY' || ev.eventType === 'CONVERSION') {
          return true;
        }
        if (ev.eventType === 'OPEN' && ruleConfig.countOpensAsEngaged) {
          return true;
        }
        return false;
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
          isSuppressed: freshSub.isSuppressed,
          isArchived: freshSub.isArchived,
          events: freshSub.engagementEvents,
        },
        ruleConfig
      );

      if (
        reclassified.engagementStatus !== freshSub.engagementStatus ||
        reclassified.historyCoverage !== freshSub.historyCoverage ||
        reclassified.complaintsCount !== freshSub.complaintsCount ||
        reclassified.hardBouncesCount !== freshSub.hardBouncesCount
      ) {
        await prisma.subscriber.update({
          where: { id: freshSub.id },
          data: {
            isExcluded: reclassified.isExcluded,
            exclusionReason: reclassified.exclusionReason,
            engagementStatus: reclassified.engagementStatus,
            engagementReason: reclassified.engagementReason,
            hygieneStatus: reclassified.hygieneStatus,
            hygieneReason: reclassified.hygieneReason,
            historyCoverage: reclassified.historyCoverage,
            deliveredCampaignsCount: reclassified.deliveredCampaignsCount,
            complaintsCount: reclassified.complaintsCount,
            hardBouncesCount: reclassified.hardBouncesCount,
            lastClickAt: reclassified.lastClickAt,
            lastReplyAt: reclassified.lastReplyAt,
            lastConversionAt: reclassified.lastConversionAt,
          },
        });
      }

      const freshCandidate: SubscriberSafetyCandidate = {
        id: freshSub.id,
        subscriberUid: freshSub.subscriberUid,
        mailingListId: freshSub.mailingListId,
        mailingListUid: freshSub.mailingList.listUid,
        email: freshSub.email,
        firstName: freshSub.firstName,
        lastName: freshSub.lastName,
        status: freshSub.status,
        engagementStatus: reclassified.engagementStatus,
        historyCoverage: reclassified.historyCoverage,
        deliveredCampaignsCount: reclassified.deliveredCampaignsCount,
        clicksCount: reclassified.clicksCount,
        repliesCount: reclassified.repliesCount,
        conversionsCount: reclassified.conversionsCount,
        hardBouncesCount: reclassified.hardBouncesCount,
        complaintsCount: reclassified.complaintsCount,
        lastClickAt: reclassified.lastClickAt,
        lastReplyAt: reclassified.lastReplyAt,
        lastConversionAt: reclassified.lastConversionAt,
        lastPurchaseAt: freshSub.lastPurchaseAt,
        isExcluded: reclassified.isExcluded,
        exclusionReason: reclassified.exclusionReason,
        isVip: freshSub.isVip,
        hasPaidRelationship: freshSub.hasPaidRelationship,
        isSuppressed: freshSub.isSuppressed,
        isArchived: freshSub.isArchived,
      };

      const recheckDecision = evaluateActionEligibility(
        freshCandidate,
        op.actionType,
        { minDeliveredCampaigns: ruleConfig.minDeliveredCampaigns }
      );

      if (hasMidJobEngagement || !recheckDecision.eligible) {
        const skipReason = hasMidJobEngagement
          ? 'Skipped mid-job: renewed engagement event occurred after dry-run preview.'
          : `Skipped at pre-mutation recheck: ${recheckDecision.reason}`;

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
          if (freshSub.isDemoData) {
            throw new Error(
              'Safety lock: remote MailWizz unsubscribe is forbidden for synthetic demo records.'
            );
          }
          // Verify remote status & subscriber identity first to detect discrepancies or UID mismatch
          const remoteBefore = await client.getRemoteSubscriber(
            rec.mailingListUid,
            rec.subscriberUid
          );
          const remoteRecord = remoteBefore.data?.record;
          if (
            remoteRecord?.subscriber_uid &&
            remoteRecord.subscriber_uid !== rec.subscriberUid
          ) {
            throw new Error(
              `Remote subscriber UID mismatch (expected ${rec.subscriberUid}, got ${remoteRecord.subscriber_uid}); aborting unsubscribe.`
            );
          }
          if (
            remoteRecord?.email &&
            remoteRecord.email.trim().toLowerCase() !== freshSub.email.trim().toLowerCase()
          ) {
            throw new Error(
              'Remote subscriber email mismatch against local snapshot; aborting unsubscribe.'
            );
          }
          const remoteStatus = remoteRecord?.status?.toLowerCase();
          if (remoteStatus) {
            const mappedRemote = mapStrictMailWizzSubscriberStatus(remoteStatus);
            if (mappedRemote.unknownStatusDetected) {
              throw new Error(
                `Unknown remote MailWizz subscriber status "${remoteStatus}" — refusing to assume consent or unsubscribe.`
              );
            }
          }

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
          if (freshSub.isDemoData) {
            throw new Error(
              'Safety lock: remote MailWizz list/subscriber copy is forbidden for synthetic demo records.'
            );
          }
          const updatedOp = await prisma.cleanupOperation.findUnique({
            where: { id: op.id },
            select: { targetListUid: true },
          });
          const targetUid = updatedOp?.targetListUid ?? op.targetListUid;
          if (!targetUid) {
            throw new Error('Missing targetListUid for subscriber copy.');
          }
          const targetListMeta = await client.getRemoteList(targetUid);
          const bulkCopyRes = await client.createSubscribersBulk({
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
          if (bulkCopyRes.acceptedCount < 1) {
            throw new Error(
              `MailWizz bulk copy into list ${targetUid} did not accept subscriber ${freshSub.email} (acceptedCount=${bulkCopyRes.acceptedCount}).`
            );
          }
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
        } else if (op.actionType === 'MOVE_SUBSCRIBERS' && client) {
          if (freshSub.isDemoData) {
            throw new Error(
              'Safety lock: remote MailWizz MOVE_SUBSCRIBERS is forbidden for synthetic demo records.'
            );
          }
          const updatedOp = await prisma.cleanupOperation.findUnique({
            where: { id: op.id },
            select: { targetListUid: true },
          });
          const targetUid = updatedOp?.targetListUid ?? op.targetListUid;
          if (!targetUid) {
            throw new Error('MOVE_SUBSCRIBERS requires targetListUid.');
          }
          const targetListMeta = await client.getRemoteList(targetUid);
          const bulkCopyRes = await client.createSubscribersBulk({
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
          if (bulkCopyRes.acceptedCount < 1) {
            throw new Error(
              `MOVE_SUBSCRIBERS aborted before source unsubscribe: bulk copy into ${targetUid} accepted ${bulkCopyRes.acceptedCount} record(s).`
            );
          }
          const membership = await client.verifySubscriberMembershipInList({
            listUid: targetUid,
            subscriberUid: bulkCopyRes.subscriberUids[0],
            email: freshSub.email,
          });
          if (!membership.confirmedPresent) {
            throw new Error(
              `MOVE_SUBSCRIBERS aborted before source unsubscribe: subscriber ${freshSub.email} could not be confirmed in target list ${targetUid}.`
            );
          }
          // Only unsubscribe source list after verified copy AND target membership confirmation succeed
          await client.unsubscribeSubscriber({
            listUid: rec.mailingListUid,
            subscriberUid: rec.subscriberUid,
            actorEmail: actor,
          });
          await prisma.subscriber.update({
            where: { id: freshSub.id },
            data: {
              status: 'MOVED',
              rawStatus: 'moved',
              hygieneStatus: 'EXCLUDED',
              engagementStatus: 'EXCLUDED',
              engagementReason: `Moved safely to list ${targetUid} by hygiene operation ${op.id}.`,
            },
          });
          await prisma.cleanupOperationRecord.update({
            where: { id: rec.id },
            data: {
              outcome: 'SUCCEEDED',
              remoteStatusBefore: freshSub.rawStatus ?? 'confirmed',
              remoteStatusAfter: 'moved',
              attemptCount: { increment: 1 },
              reason: `Copied cleanly to list ${targetUid} and unsubscribed from ${rec.mailingListUid}.`,
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
