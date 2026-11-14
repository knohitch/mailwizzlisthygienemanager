import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { sha256Hex } from '@/services/security/crypto';
import type { EngagementEventType } from '@prisma/client';

const ImportRowSchema = z.object({
  email: z.string().email().optional(),
  subscriber_uid: z.string().optional(),
  campaign_uid: z.string().optional(),
  event_type: z
    .enum([
      'DELIVERED',
      'OPEN',
      'CLICK',
      'REPLY',
      'CONVERSION',
      'HARD_BOUNCE',
      'SOFT_BOUNCE',
      'COMPLAINT',
      'UNSUBSCRIBE',
    ])
    .transform((v) => v as EngagementEventType),
  occurred_at: z.string().min(4),
});

export interface ReportImportSummary {
  totalRows: number;
  importedCount: number;
  skippedUnmatchedCount: number;
  duplicateCount: number;
}

export async function importVerifiedCampaignReport(params: {
  format: 'csv' | 'json';
  content: string;
  defaultCampaignUid?: string;
  mailingListId?: string;
}): Promise<ReportImportSummary> {
  let rawRows: Array<Record<string, unknown>>;

  if (params.format === 'csv') {
    rawRows = parse(params.content, {
      columns: (header: string[]) => header.map((h) => h.trim().toLowerCase()),
      skip_empty_lines: true,
      trim: true,
    }) as Array<Record<string, unknown>>;
  } else {
    const parsedJson: unknown = JSON.parse(params.content);
    if (!Array.isArray(parsedJson)) {
      throw new Error('JSON report import must be an array of engagement records.');
    }
    rawRows = parsedJson as Array<Record<string, unknown>>;
  }

  let importedCount = 0;
  let skippedUnmatchedCount = 0;
  let duplicateCount = 0;

  const campaigns = await prisma.campaign.findMany({
    select: { id: true, campaignUid: true, mailingListId: true },
  });
  const campaignByUid = new Map(campaigns.map((c) => [c.campaignUid, c]));

  for (const raw of rawRows) {
    const normalized = {
      email: typeof raw.email === 'string' ? raw.email.trim().toLowerCase() : undefined,
      subscriber_uid:
        typeof raw.subscriber_uid === 'string' ? raw.subscriber_uid.trim() : undefined,
      campaign_uid:
        (typeof raw.campaign_uid === 'string' && raw.campaign_uid.trim()) ||
        params.defaultCampaignUid,
      event_type: String(raw.event_type ?? '').trim().toUpperCase(),
      occurred_at: String(raw.occurred_at ?? '').trim(),
    };

    const parsed = ImportRowSchema.safeParse(normalized);
    if (!parsed.success) {
      skippedUnmatchedCount++;
      continue;
    }

    const occurredAt = new Date(parsed.data.occurred_at);
    if (Number.isNaN(occurredAt.getTime())) {
      skippedUnmatchedCount++;
      continue;
    }

    const subscriber = await prisma.subscriber.findFirst({
      where: {
        ...(params.mailingListId ? { mailingListId: params.mailingListId } : {}),
        ...(parsed.data.subscriber_uid
          ? { subscriberUid: parsed.data.subscriber_uid }
          : parsed.data.email
            ? { email: parsed.data.email }
            : { id: '__never__' }),
      },
      select: { id: true, mailingListId: true, subscriberUid: true },
    });

    if (!subscriber) {
      skippedUnmatchedCount++;
      continue;
    }

    const campaign = parsed.data.campaign_uid
      ? campaignByUid.get(parsed.data.campaign_uid)
      : undefined;

    const dedupeKey = sha256Hex(
      `VERIFIED_EXPORT|${subscriber.id}|${campaign?.campaignUid ?? 'NONE'}|${parsed.data.event_type}|${occurredAt.toISOString()}`
    );

    try {
      await prisma.engagementEvent.create({
        data: {
          subscriberId: subscriber.id,
          campaignId: campaign?.id ?? null,
          mailingListId: subscriber.mailingListId,
          eventType: parsed.data.event_type,
          source: 'VERIFIED_EXPORT',
          occurredAt,
          isHistorical: true,
          isDemoData: false,
          dedupeKey,
          metadataJson: {
            importedCampaignUid: parsed.data.campaign_uid ?? null,
          },
        },
      });
      importedCount++;
    } catch {
      duplicateCount++;
    }
  }

  return {
    totalRows: rawRows.length,
    importedCount,
    skippedUnmatchedCount,
    duplicateCount,
  };
}
