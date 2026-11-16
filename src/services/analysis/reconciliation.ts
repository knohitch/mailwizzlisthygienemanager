import { prisma } from '@/lib/db';
import type { ReconciliationStatus } from '@prisma/client';

export interface ListReconciliationResult {
  mailingListId: string;
  listUid: string;
  syncedSubscriberCount: number;
  apiReportedCount: number | null;
  status: ReconciliationStatus;
  note: string;
}

export async function reconcileListsAndCampaigns(
  mailingListId?: string,
  customerConnectionId?: string
): Promise<ListReconciliationResult[]> {
  const lists = await prisma.mailingList.findMany({
    where: {
      ...(mailingListId ? { id: mailingListId } : {}),
      ...(customerConnectionId ? { customerConnectionId } : {}),
    },
  });

  const results: ListReconciliationResult[] = [];

  for (const list of lists) {
    const [
      totalCount,
      confirmedCount,
      unconfirmedCount,
      unsubscribedCount,
      blacklistedCount,
      hardBouncedCount,
      complaintCount,
    ] = await Promise.all([
      prisma.subscriber.count({ where: { mailingListId: list.id } }),
      prisma.subscriber.count({
        where: { mailingListId: list.id, status: 'CONFIRMED' },
      }),
      prisma.subscriber.count({
        where: { mailingListId: list.id, status: 'UNCONFIRMED' },
      }),
      prisma.subscriber.count({
        where: { mailingListId: list.id, status: 'UNSUBSCRIBED' },
      }),
      prisma.subscriber.count({
        where: { mailingListId: list.id, status: 'BLACKLISTED' },
      }),
      prisma.subscriber.count({
        where: { mailingListId: list.id, hygieneStatus: 'HARD_BOUNCED' },
      }),
      prisma.subscriber.count({
        where: { mailingListId: list.id, hygieneStatus: 'COMPLAINED' },
      }),
    ]);

    let reconciliationStatus: ReconciliationStatus = 'UNVERIFIED';
    let note = 'API list total count not provided by MailWizz /lists metadata.';

    if (list.apiReportedCount !== null) {
      const diff = totalCount - list.apiReportedCount;
      if (diff === 0) {
        reconciliationStatus = 'MATCHED';
        note = `Synced ${totalCount} subscribers; matches API reported count (${list.apiReportedCount}).`;
      } else {
        reconciliationStatus = 'DISCREPANCY';
        note = `Synced ${totalCount} subscribers vs API reported ${list.apiReportedCount} (delta ${diff > 0 ? `+${diff}` : diff}).`;
      }
    }

    await prisma.mailingList.update({
      where: { id: list.id },
      data: {
        syncedSubscriberCount: totalCount,
        confirmedCount,
        unconfirmedCount,
        unsubscribedCount,
        blacklistedCount,
        hardBouncedCount,
        complaintCount,
        reconciliationStatus,
        reconciliationNote: note,
      },
    });

    results.push({
      mailingListId: list.id,
      listUid: list.listUid,
      syncedSubscriberCount: totalCount,
      apiReportedCount: list.apiReportedCount,
      status: reconciliationStatus,
      note,
    });
  }

  // Reconcile campaign stats bounces vs synced bounce log rows
  const campaigns = await prisma.campaign.findMany({
    where: {
      ...(mailingListId ? { mailingListId } : {}),
      ...(customerConnectionId ? { customerConnectionId } : {}),
    },
  });

  for (const camp of campaigns) {
    const bounceLogRows = await prisma.engagementEvent.count({
      where: {
        campaignId: camp.id,
        eventType: { in: ['HARD_BOUNCE', 'SOFT_BOUNCE', 'INTERNAL_BOUNCE'] },
      },
    });

    const statsBounces = camp.bouncesCount;
    let campStatus: ReconciliationStatus = 'UNVERIFIED';
    let campNote = '';

    if (statsBounces === bounceLogRows) {
      campStatus = 'MATCHED';
      campNote = `Campaign stats bounces (${statsBounces}) match synced bounce log records (${bounceLogRows}).`;
    } else {
      campStatus = 'DISCREPANCY';
      campNote = `Campaign stats report ${statsBounces} bounce(s); bounce endpoint returned ${bounceLogRows} record(s).`;
    }

    await prisma.campaign.update({
      where: { id: camp.id },
      data: {
        bounceRecordsSyncedCount: bounceLogRows,
        reconciliationStatus: campStatus,
        reconciliationNote: campNote,
      },
    });
  }

  return results;
}
