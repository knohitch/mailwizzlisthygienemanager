import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getEnv } from '@/lib/env';
import { requireApiAuth } from '@/lib/api-auth';
import { encryptSecret, maskSecretLast4 } from '@/services/security/crypto';
import { recordAuditLog } from '@/services/security/audit';
import { normalizeMailWizzBaseUrl } from '@/services/mailwizz/client';
import { recomputeAllHygieneClassifications } from '@/services/analysis/classifier';
import { isMailWizzMutationsEnabled } from '@/services/mutations/gate';

const SettingsUpdateSchema = z.object({
  mailwizzApiUrl: z.string().trim().optional().nullable(),
  mailwizzApiKey: z.string().trim().optional(),
  clearMailwizzApiKey: z.boolean().optional(),
  mailwizzAuthMode: z.enum(['auto', 'x-api-key', 'legacy-hmac', 'bearer']).optional(),
  reportingDbUrl: z.string().trim().optional(),
  clearReportingDbUrl: z.boolean().optional(),
  reportingDbPrefix: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9_]{0,20}$/)
    .optional(),
  webhookSecret: z.string().trim().optional(),
  clearWebhookSecret: z.boolean().optional(),
  lookbackDays: z.coerce.number().int().min(1).max(3650),
  coolingDays: z.coerce.number().int().min(1).max(3650).optional(),
  inactiveDays: z.coerce.number().int().min(1).max(3650).optional(),
  longTermInactiveDays: z.coerce.number().int().min(30).max(3650).optional(),
  customRangeStart: z.string().datetime().nullable().optional(),
  customRangeEnd: z.string().datetime().nullable().optional(),
  largeChangeThreshold: z.coerce.number().int().min(10).max(100000).optional(),
  reengagementWindowDays: z.coerce.number().int().min(3).max(90).optional(),
  minDeliveredCampaigns: z.coerce.number().int().min(1).max(200),
  countOpensAsEngaged: z.boolean(),
  countClicksAsEngaged: z.boolean(),
  countRepliesAsEngaged: z.boolean(),
  countConversionsAsEngaged: z.boolean(),
  excludedDomains: z.array(z.string().trim().min(1)).max(500),
  excludedSources: z.array(z.string().trim().min(1)).max(100),
  excludeRecentSubscribersDays: z.coerce.number().int().min(0).max(365),
  maxApiRequestsPerSecond: z.coerce.number().int().min(1).max(50),
  batchSize: z.coerce.number().int().min(10).max(500),
  syncScheduleCron: z.string().trim().min(1).max(64),
  syncScheduleEnabled: z.boolean(),
  timezone: z.string().trim().min(1).max(64),
  reportingPeriodDays: z.coerce.number().int().min(1).max(3650),
  dataRetentionDays: z.coerce.number().int().min(30).max(3650),
});

export async function GET(req: NextRequest) {
  const auth = await requireApiAuth(req, { rateLimitBucket: 'settings-read' });
  if (!auth.ok) return auth.response;

  const cfg = await prisma.appConfig.upsert({
    where: { id: 'default' },
    update: {},
    create: { id: 'default' },
  });

  return NextResponse.json({
    mailwizzApiUrl: cfg.mailwizzApiUrl ?? '',
    hasMailwizzApiKey: Boolean(cfg.mailwizzApiKeyEnc),
    mailwizzApiKeyMasked: cfg.mailwizzApiKeyLast4,
    mailwizzAuthMode: cfg.mailwizzAuthMode,
    mailwizzDetectedVersion: cfg.mailwizzDetectedVersion,
    hasReportingDbUrl: Boolean(cfg.reportingDbUrlEnc),
    reportingDbPrefix: cfg.reportingDbPrefix,
    hasWebhookSecret: Boolean(cfg.webhookSecretEnc),
    lookbackDays: cfg.lookbackDays,
    coolingDays: cfg.coolingDays,
    inactiveDays: cfg.inactiveDays,
    longTermInactiveDays: cfg.longTermInactiveDays,
    customRangeStart: cfg.customRangeStart,
    customRangeEnd: cfg.customRangeEnd,
    largeChangeThreshold: cfg.largeChangeThreshold,
    reengagementWindowDays: cfg.reengagementWindowDays,
    minDeliveredCampaigns: cfg.minDeliveredCampaigns,
    countOpensAsEngaged: cfg.countOpensAsEngaged,
    countClicksAsEngaged: cfg.countClicksAsEngaged,
    countRepliesAsEngaged: cfg.countRepliesAsEngaged,
    countConversionsAsEngaged: cfg.countConversionsAsEngaged,
    excludedDomains: Array.isArray(cfg.excludedDomainsJson)
      ? cfg.excludedDomainsJson
      : [],
    excludedSources: Array.isArray(cfg.excludedSourcesJson)
      ? cfg.excludedSourcesJson
      : [],
    excludeRecentSubscribersDays: cfg.excludeRecentSubscribersDays,
    maxApiRequestsPerSecond: cfg.maxApiRequestsPerSecond,
    batchSize: cfg.batchSize,
    syncScheduleCron: cfg.syncScheduleCron,
    syncScheduleEnabled: cfg.syncScheduleEnabled,
    timezone: cfg.timezone,
    reportingPeriodDays: cfg.reportingPeriodDays,
    dataRetentionDays: cfg.dataRetentionDays,
    isDemoMode: cfg.isDemoMode,
    lastValidatedAt: cfg.lastValidatedAt,
    lastValidationStatus: cfg.lastValidationStatus,
    lastValidationMessage: cfg.lastValidationMessage,
    phase1ReadOnly: !isMailWizzMutationsEnabled(),
  });
}

export async function PUT(req: NextRequest) {
  const auth = await requireApiAuth(req, {
    requireCsrf: true,
    rateLimitBucket: 'settings-write',
    limitPerMin: 30,
  });
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 });
  }

  const parsed = SettingsUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed.', issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const d = parsed.data;
  const env = getEnv();

  let normalizedUrl: string | null = null;
  if (d.mailwizzApiUrl && d.mailwizzApiUrl.length > 0) {
    try {
      normalizedUrl = normalizeMailWizzBaseUrl(
        d.mailwizzApiUrl,
        env.ALLOW_INSECURE_MAILWIZZ_HTTP
      );
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Invalid MailWizz API URL.' },
        { status: 400 }
      );
    }
  }

  const updateData: Record<string, unknown> = {
    mailwizzApiUrl: normalizedUrl,
    ...(d.mailwizzAuthMode ? { mailwizzAuthMode: d.mailwizzAuthMode } : {}),
    ...(d.reportingDbPrefix !== undefined
      ? { reportingDbPrefix: d.reportingDbPrefix }
      : {}),
    lookbackDays: d.lookbackDays,
    coolingDays: d.coolingDays ?? Math.min(60, d.lookbackDays),
    inactiveDays: d.inactiveDays ?? d.lookbackDays,
    ...(d.longTermInactiveDays !== undefined
      ? { longTermInactiveDays: d.longTermInactiveDays }
      : {}),
    ...(d.customRangeStart !== undefined
      ? { customRangeStart: d.customRangeStart ? new Date(d.customRangeStart) : null }
      : {}),
    ...(d.customRangeEnd !== undefined
      ? { customRangeEnd: d.customRangeEnd ? new Date(d.customRangeEnd) : null }
      : {}),
    ...(d.largeChangeThreshold !== undefined
      ? { largeChangeThreshold: d.largeChangeThreshold }
      : {}),
    ...(d.reengagementWindowDays !== undefined
      ? { reengagementWindowDays: d.reengagementWindowDays }
      : {}),
    minDeliveredCampaigns: d.minDeliveredCampaigns,
    countOpensAsEngaged: d.countOpensAsEngaged,
    countClicksAsEngaged: d.countClicksAsEngaged,
    countRepliesAsEngaged: d.countRepliesAsEngaged,
    countConversionsAsEngaged: d.countConversionsAsEngaged,
    excludedDomainsJson: d.excludedDomains.map((x) => x.toLowerCase()),
    excludedSourcesJson: d.excludedSources.map((x) => x.toLowerCase()),
    excludeRecentSubscribersDays: d.excludeRecentSubscribersDays,
    maxApiRequestsPerSecond: d.maxApiRequestsPerSecond,
    batchSize: d.batchSize,
    syncScheduleCron: d.syncScheduleCron,
    syncScheduleEnabled: d.syncScheduleEnabled,
    timezone: d.timezone,
    reportingPeriodDays: d.reportingPeriodDays,
    dataRetentionDays: d.dataRetentionDays,
  };

  if (d.clearMailwizzApiKey) {
    updateData.mailwizzApiKeyEnc = null;
    updateData.mailwizzApiKeyLast4 = null;
  } else if (d.mailwizzApiKey && d.mailwizzApiKey.length > 0) {
    updateData.mailwizzApiKeyEnc = encryptSecret(d.mailwizzApiKey);
    updateData.mailwizzApiKeyLast4 = maskSecretLast4(d.mailwizzApiKey);
  }

  if (d.clearReportingDbUrl) {
    updateData.reportingDbUrlEnc = null;
  } else if (d.reportingDbUrl && d.reportingDbUrl.length > 0) {
    updateData.reportingDbUrlEnc = encryptSecret(d.reportingDbUrl);
  }

  if (d.clearWebhookSecret) {
    updateData.webhookSecretEnc = null;
  } else if (d.webhookSecret && d.webhookSecret.length > 0) {
    updateData.webhookSecretEnc = encryptSecret(d.webhookSecret);
  }

  await prisma.appConfig.upsert({
    where: { id: 'default' },
    update: updateData,
    create: { id: 'default', ...updateData },
  });

  // Immediately re-run classification when rules change
  const recomputed = await recomputeAllHygieneClassifications();

  await recordAuditLog({
    actorEmail: auth.session.adminEmail,
    action: 'UPDATE_SETTINGS',
    resourceType: 'AppConfig',
    resourceId: 'default',
    outcome: 'SUCCESS',
    ipAddress: auth.ip,
    details: {
      lookbackDays: d.lookbackDays,
      minDeliveredCampaigns: d.minDeliveredCampaigns,
      maxApiRequestsPerSecond: d.maxApiRequestsPerSecond,
      batchSize: d.batchSize,
      updatedApiKey: Boolean(d.mailwizzApiKey),
      updatedReportingDb: Boolean(d.reportingDbUrl),
      updatedWebhookSecret: Boolean(d.webhookSecret),
      recomputedSubscribers: recomputed.updatedSubscribers,
    },
  });

  return NextResponse.json({
    ok: true,
    recomputedSubscribers: recomputed.updatedSubscribers,
  });
}
