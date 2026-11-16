import crypto from 'node:crypto';
import type { ConnectionStatus, Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { getEnv } from '@/lib/env';
import { encryptSecret, decryptSecret, sha256Hex } from '@/services/security/crypto';
import { recordAuditLog } from '@/services/security/audit';
import { sanitizeForLog } from '@/services/security/logger';
import { normalizeMailWizzBaseUrl } from './client';
import type { MailWizzAuthMode } from './compat';

export interface SafeCustomerConnectionDto {
  id: string;
  installationId: string;
  installationName: string;
  baseUrl: string;
  hostname: string;
  customerName: string;
  customerSlug: string;
  mailwizzCustomerUid: string | null;
  authMode: string;
  hasActiveCredential: boolean;
  apiKeyMasked: string | null;
  credentialVersion: number | null;
  hasWebhookSecret: boolean;
  webhookSecretLast4: string | null;
  hasReportingDb: boolean;
  reportingDbPrefix: string;
  isEnabled: boolean;
  isPrimary: boolean;
  isQuarantine: boolean;
  isDemoData: boolean;
  status: ConnectionStatus;
  detectedVersion: string | null;
  approvedVersion: string | null;
  maxRequestsPerSecond: number;
  syncScheduleCron: string;
  syncScheduleEnabled: boolean;
  notes: string | null;
  health: {
    lastCheckedAt: Date | null;
    lastSuccessAt: Date | null;
    lastErrorAt: Date | null;
    lastStatusCode: number | null;
    lastLatencyMs: number | null;
    lastEndpointTested: string | null;
    lastErrorSafe: string | null;
    detectedVersion: string | null;
    verifiedAuthMode: string | null;
    consecutiveFailures: number;
    totalRequestsCount: number;
    totalErrorsCount: number;
  } | null;
  syncState: {
    isPaused: boolean;
    pauseReason: string | null;
    pausedAt: Date | null;
    lastFullSyncStartedAt: Date | null;
    lastFullSyncCompletedAt: Date | null;
    lastSyncStatus: string | null;
    lastSyncErrorSafe: string | null;
    totalListsSynced: number;
    totalSubscribersSynced: number;
    totalCampaignsSynced: number;
    activeWorkerCount: number;
  } | null;
  counts: {
    mailingLists: number;
    subscribers: number;
    campaigns: number;
    cleanupOperations: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

const AUTH_MODE_ALIASES: Record<string, MailWizzAuthMode> = {
  auto: 'auto',
  'x-api-key': 'x-api-key',
  x_api_key_only: 'x-api-key',
  'legacy-hmac': 'legacy-hmac',
  legacy_hmac: 'legacy-hmac',
  bearer: 'bearer',
};

function isPrivateOrMetadataIp(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (
    lower === 'metadata.google.internal' ||
    lower === '169.254.169.254' ||
    lower.endsWith('.internal')
  ) {
    return true;
  }
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(lower);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 127) return false; // loopback allowed for local test mocks when HTTP allowed
  if (a === 10 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function isLoopbackHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return lower === 'localhost' || lower === '127.0.0.1' || lower === '::1' || lower === '[::1]';
}

export function validateAndNormalizeConnectionUrl(rawUrl: string): {
  baseUrl: string;
  hostname: string;
} {
  const trimmed = rawUrl.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Invalid MailWizz API URL format.');
  }
  if (isPrivateOrMetadataIp(parsed.hostname)) {
    throw new Error('MailWizz API URL points to a blocked internal/metadata IP range.');
  }
  const env = getEnv();
  const allowHttp =
    env.ALLOW_INSECURE_MAILWIZZ_HTTP ||
    (env.NODE_ENV !== 'production' && isLoopbackHostname(parsed.hostname));
  const baseUrl = normalizeMailWizzBaseUrl(trimmed, allowHttp);
  return {
    baseUrl,
    hostname: parsed.hostname.toLowerCase(),
  };
}

export function normalizeSlug(raw: string): string {
  const base = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return base || `customer-${crypto.randomBytes(3).toString('hex')}`;
}

export function computeApiKeyFingerprint(apiKey: string): string {
  return sha256Hex(`mw-key-v1:${apiKey.trim()}`);
}

export function maskApiKey(last4: string | null | undefined): string | null {
  if (!last4) return null;
  const clean = last4.slice(-4);
  return clean ? `****${clean}` : '****';
}

export function redactErrorMessage(raw: unknown): string {
  const msg = raw instanceof Error ? raw.message : String(raw ?? 'Unknown error');
  const redacted = sanitizeForLog(msg);
  const str = typeof redacted === 'string' ? redacted : JSON.stringify(redacted);
  return str.slice(0, 400);
}

export function normalizeAuthMode(mode?: string | null): MailWizzAuthMode {
  if (!mode) return 'auto';
  return AUTH_MODE_ALIASES[mode.trim()] ?? 'auto';
}

type ConnectionWithIncludes = Prisma.MailWizzCustomerConnectionGetPayload<{
  include: {
    installation: true;
    credentials: { where: { isActive: true; status: 'ACTIVE' }; take: 1 };
    health: true;
    syncState: true;
    _count: {
      select: {
        mailingLists: true;
        subscribers: true;
        campaigns: true;
        cleanupOperations: true;
      };
    };
  };
}>;

export function toSafeConnectionDto(
  row: ConnectionWithIncludes
): SafeCustomerConnectionDto {
  const activeCred =
    row.credentials.find((c) => c.isActive && c.status === 'ACTIVE') ?? null;
  return {
    id: row.id,
    installationId: row.installationId,
    installationName: row.installation.name,
    baseUrl: row.installation.baseUrl,
    hostname: row.installation.hostname,
    customerName: row.customerName,
    customerSlug: row.customerSlug,
    mailwizzCustomerUid: row.mailwizzCustomerUid,
    authMode: row.authMode,
    hasActiveCredential: Boolean(activeCred),
    apiKeyMasked: activeCred ? maskApiKey(activeCred.apiKeyLast4) : null,
    credentialVersion: activeCred?.version ?? null,
    hasWebhookSecret: Boolean(row.webhookSecretEnc),
    webhookSecretLast4: row.webhookSecretLast4,
    hasReportingDb: Boolean(row.reportingDbUrlEnc),
    reportingDbPrefix: row.reportingDbPrefix,
    isEnabled: row.isEnabled,
    isPrimary: row.isPrimary,
    isQuarantine: row.isQuarantine,
    isDemoData: row.isDemoData,
    status: row.status,
    detectedVersion: row.detectedVersion,
    approvedVersion: row.approvedVersion,
    maxRequestsPerSecond: row.maxRequestsPerSecond,
    syncScheduleCron: row.syncScheduleCron,
    syncScheduleEnabled: row.syncScheduleEnabled,
    notes: row.notes,
    health: row.health
      ? {
          lastCheckedAt: row.health.lastCheckedAt,
          lastSuccessAt: row.health.lastSuccessAt,
          lastErrorAt: row.health.lastErrorAt,
          lastStatusCode: row.health.lastStatusCode,
          lastLatencyMs: row.health.lastLatencyMs,
          lastEndpointTested: row.health.lastEndpointTested,
          lastErrorSafe: row.health.lastErrorSafe,
          detectedVersion: row.health.detectedVersion,
          verifiedAuthMode: row.health.verifiedAuthMode,
          consecutiveFailures: row.health.consecutiveFailures,
          totalRequestsCount: row.health.totalRequestsCount,
          totalErrorsCount: row.health.totalErrorsCount,
        }
      : null,
    syncState: row.syncState
      ? {
          isPaused: row.syncState.isPaused,
          pauseReason: row.syncState.pauseReason,
          pausedAt: row.syncState.pausedAt,
          lastFullSyncStartedAt: row.syncState.lastFullSyncStartedAt,
          lastFullSyncCompletedAt: row.syncState.lastFullSyncCompletedAt,
          lastSyncStatus: row.syncState.lastSyncStatus,
          lastSyncErrorSafe: row.syncState.lastSyncErrorSafe,
          totalListsSynced: row.syncState.totalListsSynced,
          totalSubscribersSynced: row.syncState.totalSubscribersSynced,
          totalCampaignsSynced: row.syncState.totalCampaignsSynced,
          activeWorkerCount: row.syncState.activeWorkerCount,
        }
      : null,
    counts: {
      mailingLists: row._count.mailingLists,
      subscribers: row._count.subscribers,
      campaigns: row._count.campaigns,
      cleanupOperations: row._count.cleanupOperations,
    },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function resolveUniqueSlug(
  tx: Prisma.TransactionClient,
  desired: string
): Promise<string> {
  const base = normalizeSlug(desired);
  let candidate = base;
  for (let i = 0; i < 20; i++) {
    const existing = await tx.mailWizzCustomerConnection.findUnique({
      where: { customerSlug: candidate },
      select: { id: true },
    });
    if (!existing) return candidate;
    candidate = `${base}-${crypto.randomBytes(2).toString('hex')}`;
  }
  return `${base}-${crypto.randomUUID().slice(0, 6)}`;
}

export async function createCustomerConnection(input: {
  customerName: string;
  customerSlug?: string;
  baseUrl: string;
  installationName?: string;
  apiKey: string;
  authMode?: string;
  mailwizzCustomerUid?: string;
  webhookSecret?: string;
  reportingDbUrl?: string;
  reportingDbPrefix?: string;
  maxRequestsPerSecond?: number;
  syncScheduleCron?: string;
  syncScheduleEnabled?: boolean;
  notes?: string;
  isPrimary?: boolean;
  isDemoData?: boolean;
  actorEmail: string;
  ipAddress?: string;
}): Promise<SafeCustomerConnectionDto> {
  const trimmedKey = input.apiKey.trim();
  if (trimmedKey.length < 8) {
    throw new Error('MailWizz API key must be at least 8 characters.');
  }
  if (!input.customerName.trim() || input.customerName.trim().length < 2) {
    throw new Error('Customer name is required.');
  }

  const { baseUrl, hostname } = validateAndNormalizeConnectionUrl(input.baseUrl);
  const authMode = normalizeAuthMode(input.authMode);
  const maxRps = Math.max(1, Math.min(25, input.maxRequestsPerSecond ?? 5));
  const apiKeyEnc = encryptSecret(trimmedKey);
  const apiKeyLast4 = trimmedKey.slice(-4);
  const apiKeyFingerprint = computeApiKeyFingerprint(trimmedKey);

  const webhookSecretTrimmed = input.webhookSecret?.trim();
  const webhookSecretEnc = webhookSecretTrimmed
    ? encryptSecret(webhookSecretTrimmed)
    : null;
  const webhookSecretLast4 = webhookSecretTrimmed
    ? webhookSecretTrimmed.slice(-4)
    : null;

  const reportingDbUrlEnc = input.reportingDbUrl?.trim()
    ? encryptSecret(input.reportingDbUrl.trim())
    : null;

  const created = await prisma.$transaction(async (tx) => {
    const installation = await tx.mailWizzInstallation.upsert({
      where: { baseUrl },
      create: {
        name: input.installationName?.trim() || hostname,
        baseUrl,
        hostname,
        maxRequestsPerSecond: maxRps,
      },
      update: {
        isActive: true,
        ...(input.installationName?.trim() ? { name: input.installationName.trim() } : {}),
      },
    });

    const slug = await resolveUniqueSlug(
      tx,
      input.customerSlug?.trim() || input.customerName
    );

    const conn = await tx.mailWizzCustomerConnection.create({
      data: {
        installationId: installation.id,
        customerName: input.customerName.trim(),
        customerSlug: slug,
        mailwizzCustomerUid: input.mailwizzCustomerUid?.trim() || null,
        authMode,
        webhookSecretEnc,
        webhookSecretLast4,
        reportingDbUrlEnc,
        reportingDbPrefix: input.reportingDbPrefix?.trim() || 'mw_',
        isEnabled: true,
        isPrimary: input.isPrimary ?? false,
        isQuarantine: false,
        isDemoData: input.isDemoData ?? false,
        status: 'PENDING',
        maxRequestsPerSecond: maxRps,
        syncScheduleCron: input.syncScheduleCron?.trim() || '0 2 * * *',
        syncScheduleEnabled: input.syncScheduleEnabled ?? false,
        notes: input.notes?.trim() || null,
      },
    });

    await tx.mailWizzConnectionCredential.create({
      data: {
        customerConnectionId: conn.id,
        apiKeyEnc,
        apiKeyLast4,
        apiKeyFingerprint,
        status: 'ACTIVE',
        isActive: true,
        version: 1,
        createdByEmail: input.actorEmail,
      },
    });

    await tx.mailWizzConnectionHealth.create({
      data: { customerConnectionId: conn.id },
    });

    await tx.connectionSyncState.create({
      data: { customerConnectionId: conn.id },
    });

    return tx.mailWizzCustomerConnection.findUniqueOrThrow({
      where: { id: conn.id },
      include: {
        installation: true,
        credentials: { where: { isActive: true, status: 'ACTIVE' }, take: 1 },
        health: true,
        syncState: true,
        _count: {
          select: {
            mailingLists: true,
            subscribers: true,
            campaigns: true,
            cleanupOperations: true,
          },
        },
      },
    });
  });

  await recordAuditLog({
    customerConnectionId: created.id,
    actorEmail: input.actorEmail,
    action: 'CREATE_CUSTOMER_CONNECTION',
    resourceType: 'MailWizzCustomerConnection',
    resourceId: created.id,
    outcome: 'SUCCESS',
    ipAddress: input.ipAddress,
    details: {
      customerName: created.customerName,
      customerSlug: created.customerSlug,
      baseUrl: created.installation.baseUrl,
      apiKeyLast4,
      authMode: created.authMode,
    },
  });

  return toSafeConnectionDto(created);
}

export async function listCustomerConnections(filters?: {
  search?: string;
  status?: ConnectionStatus;
  installationId?: string;
  includeQuarantine?: boolean;
  page?: number;
  pageSize?: number;
}): Promise<{
  items: SafeCustomerConnectionDto[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  installations: Array<{
    id: string;
    name: string;
    baseUrl: string;
    hostname: string;
    detectedVersion: string | null;
    maxRequestsPerSecond: number;
    maxConcurrentJobs: number;
    connectionCount: number;
  }>;
}> {
  const page = Math.max(1, filters?.page ?? 1);
  const pageSize = Math.max(1, Math.min(100, filters?.pageSize ?? 25));
  const where: Prisma.MailWizzCustomerConnectionWhereInput = {};

  if (filters?.search?.trim()) {
    const q = filters.search.trim();
    where.OR = [
      { customerName: { contains: q, mode: 'insensitive' } },
      { customerSlug: { contains: q, mode: 'insensitive' } },
      { mailwizzCustomerUid: { contains: q, mode: 'insensitive' } },
      { installation: { baseUrl: { contains: q, mode: 'insensitive' } } },
    ];
  }
  if (filters?.status) {
    where.status = filters.status;
  }
  if (filters?.installationId) {
    where.installationId = filters.installationId;
  }
  if (filters?.includeQuarantine === false) {
    where.isQuarantine = false;
  }

  const [total, rows, installations] = await Promise.all([
    prisma.mailWizzCustomerConnection.count({ where }),
    prisma.mailWizzCustomerConnection.findMany({
      where,
      orderBy: [{ isQuarantine: 'asc' }, { isPrimary: 'desc' }, { customerName: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        installation: true,
        credentials: { where: { isActive: true, status: 'ACTIVE' }, take: 1 },
        health: true,
        syncState: true,
        _count: {
          select: {
            mailingLists: true,
            subscribers: true,
            campaigns: true,
            cleanupOperations: true,
          },
        },
      },
    }),
    prisma.mailWizzInstallation.findMany({
      orderBy: { hostname: 'asc' },
      include: { _count: { select: { customerConnections: true } } },
    }),
  ]);

  return {
    items: rows.map(toSafeConnectionDto),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    installations: installations.map((inst) => ({
      id: inst.id,
      name: inst.name,
      baseUrl: inst.baseUrl,
      hostname: inst.hostname,
      detectedVersion: inst.detectedVersion,
      maxRequestsPerSecond: inst.maxRequestsPerSecond,
      maxConcurrentJobs: inst.maxConcurrentJobs,
      connectionCount: inst._count.customerConnections,
    })),
  };
}

export async function getCustomerConnectionById(
  connectionId: string
): Promise<SafeCustomerConnectionDto | null> {
  const row = await prisma.mailWizzCustomerConnection.findUnique({
    where: { id: connectionId },
    include: {
      installation: true,
      credentials: { where: { isActive: true, status: 'ACTIVE' }, take: 1 },
      health: true,
      syncState: true,
      _count: {
        select: {
          mailingLists: true,
          subscribers: true,
          campaigns: true,
          cleanupOperations: true,
        },
      },
    },
  });
  return row ? toSafeConnectionDto(row) : null;
}

export async function updateCustomerConnection(
  connectionId: string,
  input: {
    customerName?: string;
    baseUrl?: string;
    authMode?: string;
    mailwizzCustomerUid?: string | null;
    webhookSecret?: string | null;
    reportingDbUrl?: string | null;
    reportingDbPrefix?: string;
    maxRequestsPerSecond?: number;
    syncScheduleCron?: string;
    syncScheduleEnabled?: boolean;
    notes?: string | null;
    isEnabled?: boolean;
    actorEmail: string;
    ipAddress?: string;
  }
): Promise<SafeCustomerConnectionDto> {
  const existing = await prisma.mailWizzCustomerConnection.findUnique({
    where: { id: connectionId },
    include: {
      credentials: { where: { isActive: true, status: 'ACTIVE' }, take: 1 },
      health: true,
    },
  });
  if (!existing) {
    throw new Error(`Customer connection "${connectionId}" not found.`);
  }

  let nextInstallationId = existing.installationId;
  if (input.baseUrl !== undefined) {
    const { baseUrl, hostname } = validateAndNormalizeConnectionUrl(input.baseUrl);
    const inst = await prisma.mailWizzInstallation.upsert({
      where: { baseUrl },
      create: {
        name: hostname,
        baseUrl,
        hostname,
        maxRequestsPerSecond: existing.maxRequestsPerSecond,
      },
      update: { isActive: true },
    });
    nextInstallationId = inst.id;
  }

  if (input.isEnabled === true && existing.isQuarantine) {
    throw new Error(
      'Quarantined legacy connections cannot be enabled directly. Configure a new verified customer connection and reassign data safely.'
    );
  }

  const webhookUpdate: Partial<Prisma.MailWizzCustomerConnectionUpdateInput> = {};
  if (input.webhookSecret !== undefined) {
    const trimmed = input.webhookSecret?.trim() || '';
    webhookUpdate.webhookSecretEnc = trimmed ? encryptSecret(trimmed) : null;
    webhookUpdate.webhookSecretLast4 = trimmed ? trimmed.slice(-4) : null;
  }

  const reportingUpdate: Partial<Prisma.MailWizzCustomerConnectionUpdateInput> = {};
  if (input.reportingDbUrl !== undefined) {
    const trimmed = input.reportingDbUrl?.trim() || '';
    reportingUpdate.reportingDbUrlEnc = trimmed ? encryptSecret(trimmed) : null;
  }

  let nextStatus = existing.status;
  if (input.isEnabled === false) {
    nextStatus = 'DISABLED';
  } else if (input.isEnabled === true) {
    nextStatus =
      existing.credentials.length > 0 && existing.health?.lastSuccessAt
        ? 'CONNECTED'
        : 'PENDING';
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (input.isEnabled === false) {
      await tx.connectionSyncState.upsert({
        where: { customerConnectionId: connectionId },
        create: {
          customerConnectionId: connectionId,
          isPaused: true,
          pauseReason: 'Connection disabled by administrator',
          pausedByEmail: input.actorEmail,
          pausedAt: new Date(),
        },
        update: {
          isPaused: true,
          pauseReason: 'Connection disabled by administrator',
          pausedByEmail: input.actorEmail,
          pausedAt: new Date(),
        },
      });
      await tx.syncJob.updateMany({
        where: { customerConnectionId: connectionId, status: 'PENDING' },
        data: {
          status: 'CANCELLED',
          finishedAt: new Date(),
          lastError: 'Cancelled because customer connection was disabled.',
        },
      });
    }

    return tx.mailWizzCustomerConnection.update({
      where: { id: connectionId },
      data: {
        installation: { connect: { id: nextInstallationId } },
        ...(input.customerName !== undefined
          ? { customerName: input.customerName.trim() }
          : {}),
        ...(input.authMode !== undefined
          ? { authMode: normalizeAuthMode(input.authMode) }
          : {}),
        ...(input.mailwizzCustomerUid !== undefined
          ? { mailwizzCustomerUid: input.mailwizzCustomerUid?.trim() || null }
          : {}),
        ...(input.reportingDbPrefix !== undefined
          ? { reportingDbPrefix: input.reportingDbPrefix.trim() || 'mw_' }
          : {}),
        ...(input.maxRequestsPerSecond !== undefined
          ? {
              maxRequestsPerSecond: Math.max(
                1,
                Math.min(25, input.maxRequestsPerSecond)
              ),
            }
          : {}),
        ...(input.syncScheduleCron !== undefined
          ? { syncScheduleCron: input.syncScheduleCron.trim() || '0 2 * * *' }
          : {}),
        ...(input.syncScheduleEnabled !== undefined
          ? { syncScheduleEnabled: input.syncScheduleEnabled }
          : {}),
        ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
        ...(input.isEnabled !== undefined ? { isEnabled: input.isEnabled } : {}),
        status: nextStatus,
        ...webhookUpdate,
        ...reportingUpdate,
      },
      include: {
        installation: true,
        credentials: { where: { isActive: true, status: 'ACTIVE' }, take: 1 },
        health: true,
        syncState: true,
        _count: {
          select: {
            mailingLists: true,
            subscribers: true,
            campaigns: true,
            cleanupOperations: true,
          },
        },
      },
    });
  });

  await recordAuditLog({
    customerConnectionId: connectionId,
    actorEmail: input.actorEmail,
    action:
      input.isEnabled !== undefined
        ? input.isEnabled
          ? 'ENABLE_CUSTOMER_CONNECTION'
          : 'DISABLE_CUSTOMER_CONNECTION'
        : 'UPDATE_CUSTOMER_CONNECTION',
    resourceType: 'MailWizzCustomerConnection',
    resourceId: connectionId,
    outcome: 'SUCCESS',
    ipAddress: input.ipAddress,
    details: {
      customerName: updated.customerName,
      isEnabled: updated.isEnabled,
      status: updated.status,
      authMode: updated.authMode,
    },
  });

  return toSafeConnectionDto(updated);
}

export async function rotateCustomerConnectionApiKey(params: {
  connectionId: string;
  newApiKey: string;
  actorEmail: string;
  ipAddress?: string;
}): Promise<SafeCustomerConnectionDto> {
  const trimmedKey = params.newApiKey.trim();
  if (trimmedKey.length < 8) {
    throw new Error('Replacement MailWizz API key must be at least 8 characters.');
  }

  const apiKeyEnc = encryptSecret(trimmedKey);
  const apiKeyLast4 = trimmedKey.slice(-4);
  const apiKeyFingerprint = computeApiKeyFingerprint(trimmedKey);

  const result = await prisma.$transaction(async (tx) => {
    const conn = await tx.mailWizzCustomerConnection.findUnique({
      where: { id: params.connectionId },
    });
    if (!conn) {
      throw new Error(`Customer connection "${params.connectionId}" not found.`);
    }
    if (conn.isQuarantine) {
      throw new Error(
        'Cannot attach or rotate API keys directly on a quarantined legacy connection.'
      );
    }

    const previousActive = await tx.mailWizzConnectionCredential.findFirst({
      where: { customerConnectionId: params.connectionId, isActive: true },
      orderBy: { version: 'desc' },
    });
    const maxVersionAgg = await tx.mailWizzConnectionCredential.aggregate({
      where: { customerConnectionId: params.connectionId },
      _max: { version: true },
    });
    const nextVersion = (maxVersionAgg._max.version ?? 0) + 1;
    const now = new Date();

    await tx.mailWizzConnectionCredential.updateMany({
      where: { customerConnectionId: params.connectionId, isActive: true },
      data: {
        isActive: false,
        status: 'ROTATED',
        rotatedAt: now,
      },
    });

    await tx.mailWizzConnectionCredential.create({
      data: {
        customerConnectionId: params.connectionId,
        apiKeyEnc,
        apiKeyLast4,
        apiKeyFingerprint,
        status: 'ACTIVE',
        isActive: true,
        version: nextVersion,
        rotatedFromId: previousActive?.id ?? null,
        createdByEmail: params.actorEmail,
      },
    });

    // Cancel any queued jobs using stale credential versions so old credentials never execute
    await tx.syncJob.updateMany({
      where: {
        customerConnectionId: params.connectionId,
        status: 'PENDING',
        OR: [{ credentialVersion: null }, { credentialVersion: { lt: nextVersion } }],
      },
      data: {
        status: 'CANCELLED',
        finishedAt: now,
        lastError: 'Cancelled due to customer API key rotation.',
      },
    });

    await tx.mailWizzCustomerConnection.update({
      where: { id: params.connectionId },
      data: {
        status: conn.isEnabled ? 'PENDING' : 'DISABLED',
      },
    });

    return tx.mailWizzCustomerConnection.findUniqueOrThrow({
      where: { id: params.connectionId },
      include: {
        installation: true,
        credentials: { where: { isActive: true, status: 'ACTIVE' }, take: 1 },
        health: true,
        syncState: true,
        _count: {
          select: {
            mailingLists: true,
            subscribers: true,
            campaigns: true,
            cleanupOperations: true,
          },
        },
      },
    });
  });

  await recordAuditLog({
    customerConnectionId: params.connectionId,
    actorEmail: params.actorEmail,
    action: 'ROTATE_CONNECTION_API_KEY',
    resourceType: 'MailWizzCustomerConnection',
    resourceId: params.connectionId,
    outcome: 'SUCCESS',
    ipAddress: params.ipAddress,
    details: {
      newVersion: result.credentials[0]?.version,
      apiKeyLast4,
    },
  });

  return toSafeConnectionDto(result);
}

export async function revokeCustomerConnectionCredential(params: {
  connectionId: string;
  reason?: string;
  actorEmail: string;
  ipAddress?: string;
}): Promise<SafeCustomerConnectionDto> {
  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    const conn = await tx.mailWizzCustomerConnection.findUnique({
      where: { id: params.connectionId },
    });
    if (!conn) {
      throw new Error(`Customer connection "${params.connectionId}" not found.`);
    }

    await tx.mailWizzConnectionCredential.updateMany({
      where: { customerConnectionId: params.connectionId, isActive: true },
      data: {
        isActive: false,
        status: 'REVOKED',
        revokedAt: now,
        revokedReason: params.reason?.trim() || 'Revoked by administrator',
      },
    });

    await tx.syncJob.updateMany({
      where: { customerConnectionId: params.connectionId, status: 'PENDING' },
      data: {
        status: 'CANCELLED',
        finishedAt: now,
        lastError: 'Cancelled because customer API credential was revoked.',
      },
    });

    return tx.mailWizzCustomerConnection.update({
      where: { id: params.connectionId },
      data: {
        isEnabled: false,
        status: 'DISABLED',
      },
      include: {
        installation: true,
        credentials: { where: { isActive: true, status: 'ACTIVE' }, take: 1 },
        health: true,
        syncState: true,
        _count: {
          select: {
            mailingLists: true,
            subscribers: true,
            campaigns: true,
            cleanupOperations: true,
          },
        },
      },
    });
  });

  await recordAuditLog({
    customerConnectionId: params.connectionId,
    actorEmail: params.actorEmail,
    action: 'REVOKE_CONNECTION_CREDENTIAL',
    resourceType: 'MailWizzCustomerConnection',
    resourceId: params.connectionId,
    outcome: 'SUCCESS',
    ipAddress: params.ipAddress,
    details: { reason: params.reason ?? 'Revoked by administrator' },
  });

  return toSafeConnectionDto(updated);
}

export async function setConnectionSyncPaused(params: {
  connectionId: string;
  isPaused: boolean;
  reason?: string;
  actorEmail: string;
  ipAddress?: string;
}): Promise<void> {
  await prisma.connectionSyncState.upsert({
    where: { customerConnectionId: params.connectionId },
    create: {
      customerConnectionId: params.connectionId,
      isPaused: params.isPaused,
      pauseReason: params.isPaused ? params.reason?.trim() || 'Paused by administrator' : null,
      pausedByEmail: params.isPaused ? params.actorEmail : null,
      pausedAt: params.isPaused ? new Date() : null,
    },
    update: {
      isPaused: params.isPaused,
      pauseReason: params.isPaused ? params.reason?.trim() || 'Paused by administrator' : null,
      pausedByEmail: params.isPaused ? params.actorEmail : null,
      pausedAt: params.isPaused ? new Date() : null,
    },
  });

  await recordAuditLog({
    customerConnectionId: params.connectionId,
    actorEmail: params.actorEmail,
    action: params.isPaused ? 'PAUSE_CONNECTION_SYNC' : 'RESUME_CONNECTION_SYNC',
    resourceType: 'ConnectionSyncState',
    resourceId: params.connectionId,
    outcome: 'SUCCESS',
    ipAddress: params.ipAddress,
    details: { isPaused: params.isPaused, reason: params.reason ?? null },
  });
}

export async function archiveCustomerConnection(params: {
  connectionId: string;
  confirmationPhrase: string;
  reason?: string;
  actorEmail: string;
  ipAddress?: string;
}): Promise<{
  archivedConnectionId: string;
  customerName: string;
  connection: SafeCustomerConnectionDto;
  preservedCounts: {
    mailingLists: number;
    subscribers: number;
    campaigns: number;
    engagementEvents: number;
    cleanupOperations: number;
    cleanupOperationRecords: number;
    reengagementPlans: number;
  };
}> {
  const conn = await prisma.mailWizzCustomerConnection.findUnique({
    where: { id: params.connectionId },
  });
  if (!conn) {
    throw new Error(`Customer connection "${params.connectionId}" not found.`);
  }

  const trimmedConfirm = params.confirmationPhrase.trim();
  if (
    trimmedConfirm !== conn.customerName &&
    trimmedConfirm !== conn.customerSlug
  ) {
    throw new Error(
      `Typed confirmation does not match customer name "${conn.customerName}" or slug "${conn.customerSlug}".`
    );
  }

  const activeJobs = await prisma.syncJob.count({
    where: {
      customerConnectionId: params.connectionId,
      status: 'RUNNING',
    },
  });
  if (activeJobs > 0) {
    throw new Error(
      'Cannot archive a customer connection while background jobs are RUNNING. Wait for running jobs to finish first.'
    );
  }

  const archiveReason = params.reason?.trim() || 'Archived by administrator (history preserved)';
  const now = new Date();
  const archivedNoteLine = `[ARCHIVED ${now.toISOString()} by ${params.actorEmail}]: ${archiveReason}`;
  const updatedNotes = conn.notes ? `${conn.notes}\n${archivedNoteLine}` : archivedNoteLine;

  const [
    mailingLists,
    subscribers,
    campaigns,
    engagementEvents,
    cleanupOperations,
    cleanupOperationRecords,
    reengagementPlans,
  ] = await Promise.all([
    prisma.mailingList.count({ where: { customerConnectionId: conn.id } }),
    prisma.subscriber.count({ where: { customerConnectionId: conn.id } }),
    prisma.campaign.count({ where: { customerConnectionId: conn.id } }),
    prisma.engagementEvent.count({ where: { customerConnectionId: conn.id } }),
    prisma.cleanupOperation.count({ where: { customerConnectionId: conn.id } }),
    prisma.cleanupOperationRecord.count({ where: { customerConnectionId: conn.id } }),
    prisma.reengagementPlan.count({ where: { customerConnectionId: conn.id } }),
  ]);

  const updated = await prisma.$transaction(async (tx) => {
    await tx.syncJob.updateMany({
      where: {
        customerConnectionId: params.connectionId,
        status: 'PENDING',
      },
      data: {
        status: 'CANCELLED',
        finishedAt: now,
        lastError: 'Cancelled because customer connection was disabled and archived.',
      },
    });

    await tx.mailWizzConnectionCredential.updateMany({
      where: {
        customerConnectionId: params.connectionId,
        status: { not: 'REVOKED' },
      },
      data: {
        status: 'REVOKED',
        isActive: false,
        revokedAt: now,
        revokedReason: archiveReason,
      },
    });

    await tx.connectionSyncState.upsert({
      where: { customerConnectionId: params.connectionId },
      create: {
        customerConnectionId: params.connectionId,
        isPaused: true,
        pauseReason: archiveReason,
        pausedByEmail: params.actorEmail,
        pausedAt: now,
      },
      update: {
        isPaused: true,
        pauseReason: archiveReason,
        pausedByEmail: params.actorEmail,
        pausedAt: now,
      },
    });

    return tx.mailWizzCustomerConnection.update({
      where: { id: params.connectionId },
      data: {
        isEnabled: false,
        isPrimary: false,
        status: conn.isQuarantine ? 'LEGACY_QUARANTINE' : 'DISABLED',
        syncScheduleEnabled: false,
        webhookSecretEnc: null,
        webhookSecretLast4: null,
        reportingDbUrlEnc: null,
        notes: updatedNotes,
      },
      include: {
        installation: true,
        credentials: {
          where: { isActive: true, status: 'ACTIVE' },
          orderBy: { version: 'desc' },
          take: 1,
        },
        health: true,
        syncState: true,
        _count: {
          select: {
            mailingLists: true,
            subscribers: true,
            campaigns: true,
            cleanupOperations: true,
          },
        },
      },
    });
  });

  const preservedCounts = {
    mailingLists,
    subscribers,
    campaigns,
    engagementEvents,
    cleanupOperations,
    cleanupOperationRecords,
    reengagementPlans,
  };

  await recordAuditLog({
    customerConnectionId: params.connectionId,
    actorEmail: params.actorEmail,
    action: 'ARCHIVE_CUSTOMER_CONNECTION',
    resourceType: 'MailWizzCustomerConnection',
    resourceId: params.connectionId,
    outcome: 'SUCCESS',
    ipAddress: params.ipAddress,
    details: {
      customerName: conn.customerName,
      customerSlug: conn.customerSlug,
      reason: archiveReason,
      preservedCounts,
    },
  });

  return {
    archivedConnectionId: conn.id,
    customerName: conn.customerName,
    connection: toSafeConnectionDto(updated),
    preservedCounts,
  };
}

export async function deleteCustomerConnection(params: {
  connectionId: string;
  confirmationPhrase: string;
  actorEmail: string;
  ipAddress?: string;
}): Promise<{ deletedConnectionId: string; customerName: string }> {
  const conn = await prisma.mailWizzCustomerConnection.findUnique({
    where: { id: params.connectionId },
  });
  if (!conn) {
    throw new Error(`Customer connection "${params.connectionId}" not found.`);
  }

  const trimmedConfirm = params.confirmationPhrase.trim();
  if (
    trimmedConfirm !== conn.customerName &&
    trimmedConfirm !== conn.customerSlug
  ) {
    throw new Error(
      `Typed confirmation does not match customer name "${conn.customerName}" or slug "${conn.customerSlug}".`
    );
  }

  const activeJobs = await prisma.syncJob.count({
    where: {
      customerConnectionId: params.connectionId,
      status: 'RUNNING',
    },
  });
  if (activeJobs > 0) {
    throw new Error(
      'Cannot delete a customer connection while background jobs are RUNNING. Cancel/pause jobs first.'
    );
  }

  const [
    mailingLists,
    listSegments,
    subscribers,
    campaigns,
    engagementEvents,
    cleanupOperations,
    cleanupOperationRecords,
    reengagementPlans,
  ] = await Promise.all([
    prisma.mailingList.count({ where: { customerConnectionId: params.connectionId } }),
    prisma.listSegment.count({ where: { customerConnectionId: params.connectionId } }),
    prisma.subscriber.count({ where: { customerConnectionId: params.connectionId } }),
    prisma.campaign.count({ where: { customerConnectionId: params.connectionId } }),
    prisma.engagementEvent.count({ where: { customerConnectionId: params.connectionId } }),
    prisma.cleanupOperation.count({ where: { customerConnectionId: params.connectionId } }),
    prisma.cleanupOperationRecord.count({ where: { customerConnectionId: params.connectionId } }),
    prisma.reengagementPlan.count({ where: { customerConnectionId: params.connectionId } }),
  ]);

  const retainedTotal =
    mailingLists +
    listSegments +
    subscribers +
    campaigns +
    engagementEvents +
    cleanupOperations +
    cleanupOperationRecords +
    reengagementPlans;

  if (retainedTotal > 0) {
    await recordAuditLog({
      customerConnectionId: params.connectionId,
      actorEmail: params.actorEmail,
      action: 'DELETE_CUSTOMER_CONNECTION_BLOCKED',
      resourceType: 'MailWizzCustomerConnection',
      resourceId: params.connectionId,
      outcome: 'DENIED',
      ipAddress: params.ipAddress,
      details: {
        customerName: conn.customerName,
        retainedTotal,
        mailingLists,
        subscribers,
        campaigns,
        engagementEvents,
        cleanupOperations,
        cleanupOperationRecords,
        reengagementPlans,
      },
    });
    throw new Error(
      `Refusing destructive delete for "${conn.customerName}": ${retainedTotal} historical/recovery record(s) exist (subscribers=${subscribers}, events=${engagementEvents}, cleanupSnapshots=${cleanupOperationRecords}, cleanupOps=${cleanupOperations}). Use Disable & Archive instead to revoke credentials while preserving consent, recovery, and audit history.`
    );
  }

  await recordAuditLog({
    customerConnectionId: params.connectionId,
    actorEmail: params.actorEmail,
    action: 'DELETE_CUSTOMER_CONNECTION',
    resourceType: 'MailWizzCustomerConnection',
    resourceId: params.connectionId,
    outcome: 'SUCCESS',
    ipAddress: params.ipAddress,
    details: {
      customerName: conn.customerName,
      customerSlug: conn.customerSlug,
    },
  });

  await prisma.$transaction(async (tx) => {
    await tx.syncJob.updateMany({
      where: {
        customerConnectionId: params.connectionId,
        status: 'PENDING',
      },
      data: {
        status: 'CANCELLED',
        finishedAt: new Date(),
        lastError: 'Cancelled because empty customer connection was deleted.',
      },
    });
    await tx.mailWizzCustomerConnection.delete({
      where: { id: params.connectionId },
    });
  });

  return {
    deletedConnectionId: conn.id,
    customerName: conn.customerName,
  };
}

export async function getDecryptedWebhookSecretForConnection(
  connectionId: string
): Promise<string | null> {
  const conn = await prisma.mailWizzCustomerConnection.findUnique({
    where: { id: connectionId },
    select: { webhookSecretEnc: true, isEnabled: true, isQuarantine: true },
  });
  if (!conn || !conn.isEnabled || conn.isQuarantine || !conn.webhookSecretEnc) {
    return null;
  }
  return decryptSecret(conn.webhookSecretEnc);
}
