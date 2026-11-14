import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getEnv } from '@/lib/env';
import {
  decryptSecret,
  sha256Hex,
  timingSafeEqualString,
} from '@/services/security/crypto';
import { checkRateLimit, getClientIp } from '@/services/security/rate-limit';
import { logger } from '@/services/security/logger';
import type { EngagementEventType } from '@prisma/client';

function mapWebhookEventType(raw: string): EngagementEventType | null {
  const s = raw.trim().toLowerCase();
  if (s === 'open' || s === 'opened' || s === 'campaign_open') return 'OPEN';
  if (s === 'click' || s === 'clicked' || s === 'url_click') return 'CLICK';
  if (s === 'unsubscribe' || s === 'unsubscribed') return 'UNSUBSCRIBE';
  if (s === 'hard_bounce' || s === 'bounce_hard') return 'HARD_BOUNCE';
  if (s === 'soft_bounce' || s === 'bounce_soft' || s === 'bounce') return 'SOFT_BOUNCE';
  if (s === 'complaint' || s === 'complained' || s === 'spam' || s === 'abuse') {
    return 'COMPLAINT';
  }
  return null;
}

function normalizeWebhookItems(body: unknown): Array<{
  eventTypeRaw: string;
  timestamp?: string | number;
  campaignUid: string;
  subscriberUid: string;
}> {
  const list = Array.isArray(body) ? body : [body];
  const out: Array<{
    eventTypeRaw: string;
    timestamp?: string | number;
    campaignUid: string;
    subscriberUid: string;
  }> = [];

  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const eventObj =
      obj.event && typeof obj.event === 'object'
        ? (obj.event as Record<string, unknown>)
        : obj;
    const campObj =
      obj.campaign && typeof obj.campaign === 'object'
        ? (obj.campaign as Record<string, unknown>)
        : obj;
    const subObj =
      obj.subscriber && typeof obj.subscriber === 'object'
        ? (obj.subscriber as Record<string, unknown>)
        : obj;

    const eventTypeRaw = String(eventObj.type ?? obj.event_type ?? obj.type ?? '').trim();
    const campaignUid = String(
      campObj.uid ?? campObj.campaign_uid ?? obj.campaign_uid ?? ''
    ).trim();
    const subscriberUid = String(
      subObj.uid ?? subObj.subscriber_uid ?? obj.subscriber_uid ?? ''
    ).trim();

    const tsRaw = eventObj.timestamp ?? obj.timestamp ?? obj.date_added;
    const timestamp =
      typeof tsRaw === 'string' || typeof tsRaw === 'number' ? tsRaw : undefined;

    if (eventTypeRaw && campaignUid && subscriberUid) {
      out.push({ eventTypeRaw, timestamp, campaignUid, subscriberUid });
    }
  }
  return out;
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req.headers);
  const rl = checkRateLimit(`webhook:${ip}`, 300, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } }
    );
  }

  const cfg = await prisma.appConfig.findUnique({ where: { id: 'default' } });
  const env = getEnv();
  const expectedSecret = cfg?.webhookSecretEnc
    ? decryptSecret(cfg.webhookSecretEnc)
    : env.MAILWIZZ_WEBHOOK_SECRET;

  if (!expectedSecret) {
    return NextResponse.json(
      { error: 'MailWizz webhook secret is not configured.' },
      { status: 503 }
    );
  }

  const providedSecret = req.headers.get('x-hygiene-webhook-secret') ?? '';
  if (!timingSafeEqualString(expectedSecret, providedSecret)) {
    return NextResponse.json({ error: 'Invalid webhook secret.' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  const items = normalizeWebhookItems(body);
  if (items.length === 0) {
    return NextResponse.json({ error: 'Unsupported webhook payload.' }, { status: 400 });
  }

  let recordedCount = 0;
  let ignoredCount = 0;

  for (const item of items) {
    const eventType = mapWebhookEventType(item.eventTypeRaw);
    if (!eventType) {
      ignoredCount++;
      continue;
    }

    const subRecord = await prisma.subscriber.findFirst({
      where: { subscriberUid: item.subscriberUid },
      select: { id: true, mailingListId: true },
    });

    if (!subRecord) {
      ignoredCount++;
      continue;
    }

    const campRecord = await prisma.campaign.findUnique({
      where: { campaignUid: item.campaignUid },
      select: { id: true },
    });

    const occurredAt =
      item.timestamp !== undefined ? new Date(item.timestamp) : new Date();
    const safeOccurredAt = Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt;

    const dedupeKey = sha256Hex(
      `WEBHOOK_LIVE|${item.campaignUid}|${item.subscriberUid}|${eventType}|${safeOccurredAt.toISOString()}`
    );

    await prisma.engagementEvent.upsert({
      where: { dedupeKey },
      update: {},
      create: {
        subscriberId: subRecord.id,
        campaignId: campRecord?.id ?? null,
        mailingListId: subRecord.mailingListId,
        eventType,
        source: 'WEBHOOK_LIVE',
        occurredAt: safeOccurredAt,
        isHistorical: false,
        isDemoData: false,
        dedupeKey,
      },
    });
    recordedCount++;
  }

  logger.info('Processed MailWizz webhook payload', {
    recordedCount,
    ignoredCount,
  });

  return NextResponse.json({
    ok: true,
    recorded: recordedCount > 0,
    recordedCount,
    ignoredCount,
    isHistorical: false,
  });
}
