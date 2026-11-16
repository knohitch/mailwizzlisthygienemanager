import { prisma } from '@/lib/db';
import { sanitizeCsvCell } from './csv';
import { encryptExportBuffer } from './crypto';
import { recordAuditLog } from './audit';
import type { HygieneStatus, SubscriberStatus } from '@prisma/client';

export interface ExportSubscribersOptions {
  customerConnectionId?: string;
  mailingListId?: string;
  hygieneStatus?: HygieneStatus;
  status?: SubscriberStatus;
  format: 'csv' | 'json';
  encrypted: boolean;
  actorEmail: string;
  ipAddress?: string | null;
}

const escapeCsvCell = sanitizeCsvCell;

export async function generateSubscriberExport(options: ExportSubscribersOptions): Promise<{
  filename: string;
  contentType: string;
  body: Buffer;
  rowCount: number;
}> {
  let connId = options.customerConnectionId?.trim() || undefined;
  if (options.mailingListId) {
    const ml = await prisma.mailingList.findUnique({
      where: { id: options.mailingListId },
      select: { id: true, customerConnectionId: true },
    });
    if (!ml) {
      throw new Error(`Mailing list "${options.mailingListId}" not found.`);
    }
    if (connId && ml.customerConnectionId !== connId) {
      throw new Error(
        `Cross-customer export blocked: mailing list "${options.mailingListId}" does not belong to customerConnectionId "${connId}".`
      );
    }
    connId = ml.customerConnectionId;
  } else if (!connId) {
    const activeConns = await prisma.mailWizzCustomerConnection.findMany({
      where: { isQuarantine: false },
      select: { id: true },
      take: 2,
    });
    if (activeConns.length > 1) {
      throw new Error(
        'Customer connection selection is required for subscriber export when multiple customer accounts exist.'
      );
    }
    connId = activeConns[0]?.id;
  }

  const subscribers = await prisma.subscriber.findMany({
    where: {
      ...(connId ? { customerConnectionId: connId } : {}),
      ...(options.mailingListId ? { mailingListId: options.mailingListId } : {}),
      ...(options.hygieneStatus ? { hygieneStatus: options.hygieneStatus } : {}),
      ...(options.status ? { status: options.status } : {}),
    },
    include: {
      mailingList: {
        select: { listUid: true, name: true },
      },
    },
    orderBy: [{ mailingListId: 'asc' }, { email: 'asc' }],
  });

  const rows = subscribers.map((s) => ({
    listUid: s.mailingList.listUid,
    listName: s.mailingList.name,
    subscriberUid: s.subscriberUid,
    email: s.email,
    firstName: s.firstName ?? '',
    lastName: s.lastName ?? '',
    mailwizzStatus: s.status,
    hygieneStatus: s.hygieneStatus,
    historyCoverage: s.historyCoverage,
    deliveredCampaignsCount: s.deliveredCampaignsCount,
    opensCount: s.opensCount,
    clicksCount: s.clicksCount,
    repliesCount: s.repliesCount,
    conversionsCount: s.conversionsCount,
    hardBouncesCount: s.hardBouncesCount,
    softBouncesCount: s.softBouncesCount,
    complaintsCount: s.complaintsCount,
    lastOpenAt: s.lastOpenAt?.toISOString() ?? '',
    lastClickAt: s.lastClickAt?.toISOString() ?? '',
    lastStrongEngagementAt: s.lastStrongEngagementAt?.toISOString() ?? '',
    hygieneReason: s.hygieneReason ?? '',
    isDemoData: s.isDemoData,
  }));

  let plainBuffer: Buffer;
  let baseExt: string;
  let baseContentType: string;

  if (options.format === 'csv') {
    const headers = [
      'listUid',
      'listName',
      'subscriberUid',
      'email',
      'firstName',
      'lastName',
      'mailwizzStatus',
      'hygieneStatus',
      'historyCoverage',
      'deliveredCampaignsCount',
      'opensCount',
      'clicksCount',
      'repliesCount',
      'conversionsCount',
      'hardBouncesCount',
      'softBouncesCount',
      'complaintsCount',
      'lastOpenAt',
      'lastClickAt',
      'lastStrongEngagementAt',
      'hygieneReason',
      'isDemoData',
    ] as const;

    const lines = [
      headers.join(','),
      ...rows.map((r) => headers.map((h) => escapeCsvCell(r[h])).join(',')),
    ];
    plainBuffer = Buffer.from(lines.join('\r\n'), 'utf8');
    baseExt = 'csv';
    baseContentType = 'text/csv; charset=utf-8';
  } else {
    plainBuffer = Buffer.from(
      JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          rowCount: rows.length,
          rows,
        },
        null,
        2
      ),
      'utf8'
    );
    baseExt = 'json';
    baseContentType = 'application/json; charset=utf-8';
  }

  await recordAuditLog({
    actorEmail: options.actorEmail,
    action: 'EXPORT_SUBSCRIBERS',
    resourceType: 'MailingList',
    resourceId: options.mailingListId ?? 'ALL',
    outcome: 'SUCCESS',
    ipAddress: options.ipAddress,
    details: {
      format: options.format,
      encrypted: options.encrypted,
      rowCount: rows.length,
      hygieneFilter: options.hygieneStatus ?? 'ALL',
    },
  });

  const dateTag = new Date().toISOString().slice(0, 10);

  if (options.encrypted) {
    const envelope = encryptExportBuffer(plainBuffer);
    return {
      filename: `mailwizz-hygiene-export-${dateTag}.${baseExt}.enc.json`,
      contentType: 'application/json; charset=utf-8',
      body: Buffer.from(JSON.stringify(envelope, null, 2), 'utf8'),
      rowCount: rows.length,
    };
  }

  return {
    filename: `mailwizz-hygiene-export-${dateTag}.${baseExt}`,
    contentType: baseContentType,
    body: plainBuffer,
    rowCount: rows.length,
  };
}
