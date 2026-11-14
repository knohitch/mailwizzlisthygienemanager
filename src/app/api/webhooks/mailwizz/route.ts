import crypto from 'node:crypto';
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

const MAX_WEBHOOK_ITEMS = 500;
const MAX_WEBHOOK_BODY_BYTES = 512 * 1024;
const MAX_WEBHOOK_AGE_MS = 7 * 86_400_000; // 7 days replay tolerance
const MAX_WEBHOOK_FUTURE_SKEW_MS = 5 * 60_000; // 5 minutes clock skew

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

interface NormalizedWebhookItem {
  eventTypeRaw: string;
  timestamp?: string | number;
  campaignUid: string;
  subscriberUid: string;
  listUid?: string;
  eventId?: string;
}

function normalizeWebhookItems(body: unknown): NormalizedWebhookItem[] {
  const list = Array.isArray(body) ? body : [body];
  if (list.length > MAX_WEBHOOK_ITEMS) {
    throw new Error(`Webhook batch exceeds limit of ${MAX_WEBHOOK_ITEMS} events.`);
  }
  const out: NormalizedWebhookItem[] = [];

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
    const listObj =
      obj.list && typeof obj.list === 'object'
        ? (obj.list as Record<string, unknown>)
        : obj;

    const eventTypeRaw = String(eventObj.type ?? obj.event_type ?? obj.type ?? '').trim();
    const campaignUid = String(
      campObj.uid ?? campObj.campaign_uid ?? obj.campaign_uid ?? ''
    ).trim();
    const subscriberUid = String(
      subObj.uid ?? subObj.subscriber_uid ?? obj.subscriber_uid ?? ''
    ).trim();
    const listUid = String(
      listObj.list_uid ?? listObj.uid ?? obj.list_uid ?? subObj.list_uid ?? ''
    ).trim() || undefined;
    const eventId = String(
      eventObj.id ?? eventObj.event_id ?? obj.event_id ?? ''
    ).trim() || undefined;

    const tsRaw = eventObj.timestamp ?? obj.timestamp ?? obj.date_added;
    const timestamp =
      typeof tsRaw === 'string' || typeof tsRaw === 'number' ? tsRaw : undefined;

    if (eventTypeRaw && campaignUid && subscriberUid) {
      out.push({ eventTypeRaw, timestamp, campaignUid, subscriberUid, listUid, eventId });
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

  const rawBody = await req.text();
  if (Buffer.byteLength(rawBody, 'utf8') > MAX_WEBHOOK_BODY_BYTES) {
    return NextResponse.json({ error: 'Webhook payload too large.' }, { status: 413 });
  }

  const providedSecret = req.headers.get('x-hygiene-webhook-secret') ?? '';
  const providedSig = req.headers.get('x-hygiene-webhook-signature') ?? '';

  let authenticated = Boolean(providedSecret && timingSafeEqualString(expectedSecret, providedSecret));
  if (!authenticated && providedSig) {
    const cleanSig = providedSig.replace(/^sha256=/i, '').trim().toLowerCase();
    const expectedHmac = crypto
      .createHmac('sha256', expectedSecret)
      .update(rawBody, 'utf8')
      .digest('hex')
      .toLowerCase();
    authenticated = timingSafeEqualString(expectedHmac, cleanSig);
  }

  if (!authenticated) {
    return NextResponse.json({ error: 'Invalid webhook authentication.' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  let items: NormalizedWebhookItem[];
  try {
    items = normalizeWebhookItems(body);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Invalid webhook batch.' },
      { status: 400 }
    );
  }

  if (items.length === 0) {
    return NextResponse.json({ error: 'Unsupported webhook payload.' }, { status: 400 });
  }

  let recordedCount = 0;
  let ignoredCount = 0;
  const nowMs = Date.now();

  for (const item of items) {
    const eventType = mapWebhookEventType(item.eventTypeRaw);
    if (!eventType) {
      ignoredCount++;
      continue;
    }

    let safeOccurredAt: Date;
    let replayToken: string;
    if (item.timestamp !== undefined) {
      const occurredAt = new Date(item.timestamp);
      if (Number.isNaN(occurredAt.getTime())) {
        ignoredCount++;
        continue;
      }
      const ageMs = nowMs - occurredAt.getTime();
      if (ageMs > MAX_WEBHOOK_AGE_MS || ageMs < -MAX_WEBHOOK_FUTURE_SKEW_MS) {
        ignoredCount++;
        continue;
      }
      safeOccurredAt = occurredAt;
      replayToken = item.eventId ?? safeOccurredAt.toISOString();
    } else {
      safeOccurredAt = new Date(nowMs);
      // Deterministic dedupe token prevents duplicate inserts when unsigned/no-timestamp payloads replay
      replayToken = item.eventId ?? 'no_ts';
    }

    const campRecord = await prisma.campaign.findUnique({
      where: { campaignUid: item.campaignUid },
      select: { id: true, mailingListId: true },
    });

    const subRecord = await prisma.subscriber.findFirst({
      where: {
        subscriberUid: item.subscriberUid,
        ...(item.listUid
          ? { mailingList: { listUid: item.listUid } }
          : campRecord?.mailingListId
            ? { mailingListId: campRecord.mailingListId }
            : {}),
      },
      select: { id: true, mailingListId: true },
    });

    if (!subRecord) {
      ignoredCount++;
      continue;
    }

    const dedupeKey = sha256Hex(
      `WEBHOOK_LIVE|${subRecord.mailingListId}|${item.campaignUid}|${item.subscriberUid}|${eventType}|${replayToken}`
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
