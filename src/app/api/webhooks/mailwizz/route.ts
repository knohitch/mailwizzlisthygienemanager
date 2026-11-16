import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getEnv } from '@/lib/env';
import {
  sha256Hex,
  timingSafeEqualString,
} from '@/services/security/crypto';
import { checkRateLimit, getClientIp } from '@/services/security/rate-limit';
import { logger } from '@/services/security/logger';
import { mailWizzV3Adapter } from '@/services/mailwizz/adapter-v3';
import { resolveUnambiguousConnectionId } from '@/services/mailwizz/client-factory';
import { getDecryptedWebhookSecretForConnection } from '@/services/mailwizz/connections';
import type { EngagementEventType } from '@prisma/client';

const MAX_WEBHOOK_ITEMS = 500;
const MAX_WEBHOOK_BODY_BYTES = 512 * 1024;
const MAX_WEBHOOK_AGE_MS = 7 * 86_400_000; // 7 days replay tolerance
const MAX_WEBHOOK_FUTURE_SKEW_MS = 5 * 60_000; // 5 minutes clock skew

interface NormalizedWebhookItem {
  eventType: EngagementEventType | null;
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

  const parsed = mailWizzV3Adapter.normalizeWebhookPayload(body);
  if (parsed.issues.length > 0) {
    logger.warn('MailWizz webhook contract warnings/errors', {
      issueCount: parsed.issues.length,
      codes: parsed.issues.slice(0, 5).map((i) => i.code),
    });
  }

  return parsed.events.map((e) => ({
    eventType: e.eventType,
    eventTypeRaw: e.rawEventType,
    timestamp: e.timestamp,
    campaignUid: e.campaignUid,
    subscriberUid: e.subscriberUid,
    listUid: e.listUid,
    eventId: e.eventId,
  }));
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

  const sp = req.nextUrl.searchParams;
  const requestedConnId =
    sp.get('connectionId')?.trim() ||
    sp.get('customerConnectionId')?.trim() ||
    req.headers.get('x-hygiene-connection-id')?.trim() ||
    undefined;
  const requestedSlug = sp.get('connectionSlug')?.trim() || undefined;

  let connectionId: string;
  try {
    if (requestedSlug && !requestedConnId) {
      const bySlug = await prisma.mailWizzCustomerConnection.findUnique({
        where: { customerSlug: requestedSlug },
        select: { id: true },
      });
      if (!bySlug) {
        return NextResponse.json(
          { error: 'Unknown customer webhook connectionSlug.' },
          { status: 404 }
        );
      }
      connectionId = bySlug.id;
    } else {
      connectionId = await resolveUnambiguousConnectionId(requestedConnId);
    }
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : 'Webhook target customerConnectionId is required when multiple connections exist.',
      },
      { status: 400 }
    );
  }

  const conn = await prisma.mailWizzCustomerConnection.findUnique({
    where: { id: connectionId },
    select: { id: true, isEnabled: true, isQuarantine: true, status: true },
  });
  if (!conn || conn.isQuarantine || !conn.isEnabled || conn.status === 'DISABLED') {
    return NextResponse.json(
      { error: 'Customer webhook connection is disabled or unavailable.' },
      { status: 403 }
    );
  }

  const env = getEnv();
  const connSecret = await getDecryptedWebhookSecretForConnection(connectionId);
  const expectedSecret =
    connSecret ??
    (connectionId === 'conn-primary-default' ? env.MAILWIZZ_WEBHOOK_SECRET : null);

  if (!expectedSecret) {
    return NextResponse.json(
      { error: 'MailWizz webhook secret is not configured for this customer connection.' },
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
    const eventType = item.eventType;
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
      where: {
        customerConnectionId_campaignUid: {
          customerConnectionId: connectionId,
          campaignUid: item.campaignUid,
        },
      },
      select: { id: true, mailingListId: true },
    });

    const subRecord = await prisma.subscriber.findFirst({
      where: {
        customerConnectionId: connectionId,
        subscriberUid: item.subscriberUid,
        ...(item.listUid
          ? { mailingList: { customerConnectionId: connectionId, listUid: item.listUid } }
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
      `WEBHOOK_LIVE|${connectionId}|${subRecord.mailingListId}|${item.campaignUid}|${item.subscriberUid}|${eventType}|${replayToken}`
    );

    await prisma.engagementEvent.upsert({
      where: { dedupeKey },
      update: {},
      create: {
        customerConnectionId: connectionId,
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
