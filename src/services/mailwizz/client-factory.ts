import { prisma } from '@/lib/db';
import { getEnv } from '@/lib/env';
import { decryptSecret } from '@/services/security/crypto';
import { logger } from '@/services/security/logger';
import { MailWizzClient } from './client';
import type { MailWizzAuthMode } from './compat';
import {
  MailWizzListRecordSchema,
  MailWizzPaginatedEnvelopeSchema,
} from './types';
import {
  normalizeAuthMode,
  redactErrorMessage,
  validateAndNormalizeConnectionUrl,
} from './connections';

export interface ResolvedMailWizzClientContext {
  client: MailWizzClient;
  connectionId: string;
  installationId: string;
  customerName: string;
  customerSlug: string;
  baseUrl: string;
  authMode: MailWizzAuthMode;
  credentialId: string;
  credentialVersion: number;
  apiKeyLast4: string;
}

// Per-scope request pacing (ONLY timestamps & RPS, NEVER stores decrypted API keys)
const installationSlots = new Map<string, number>();
const connectionSlots = new Map<string, number>();

async function acquireRateLimitSlot(
  map: Map<string, number>,
  scopeId: string,
  maxRps: number
): Promise<void> {
  const safeRps = Math.max(1, Math.min(50, maxRps));
  const minIntervalMs = Math.ceil(1000 / safeRps);
  const now = Date.now();
  const nextAt = map.get(scopeId) ?? 0;
  const waitMs = Math.max(0, nextAt - now);
  map.set(scopeId, Math.max(now, nextAt) + minIntervalMs);
  if (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

export function clearConnectionRateLimitersForTests(): void {
  installationSlots.clear();
  connectionSlots.clear();
}

function buildRateLimitedFetch(params: {
  installationId: string;
  installationRps: number;
  connectionId: string;
  connectionRps: number;
  fetchImpl?: typeof fetch;
}): typeof fetch {
  const inner = params.fetchImpl ?? fetch;
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    await acquireRateLimitSlot(
      connectionSlots,
      params.connectionId,
      params.connectionRps
    );
    await acquireRateLimitSlot(
      installationSlots,
      params.installationId,
      params.installationRps
    );
    return inner(input, init);
  };
}

/**
 * Resolves a fresh, connection-scoped MailWizzClient for the given customerConnectionId.
 * Plaintext API keys are decrypted strictly on demand and NEVER cached in memory.
 * Fails closed if the connection or installation is disabled, quarantined, missing active key,
 * or if the credential version rotated since the caller queued work.
 */
export async function getMailWizzClientWithContext(
  connectionId: string,
  options?: {
    expectedCredentialVersion?: number;
    fetchImpl?: typeof fetch;
    remoteAddr?: string;
  }
): Promise<ResolvedMailWizzClientContext> {
  if (!connectionId || !connectionId.trim()) {
    throw new Error('customerConnectionId is required to resolve a MailWizz client.');
  }

  const conn = await prisma.mailWizzCustomerConnection.findUnique({
    where: { id: connectionId },
    include: {
      installation: true,
      credentials: {
        where: { isActive: true, status: 'ACTIVE' },
        orderBy: { version: 'desc' },
        take: 1,
      },
    },
  });

  if (!conn) {
    throw new Error(`MailWizz customer connection "${connectionId}" not found.`);
  }
  if (conn.isQuarantine || conn.status === 'LEGACY_QUARANTINE') {
    throw new Error(
      `Customer connection "${conn.customerName}" is quarantined and cannot call the MailWizz API.`
    );
  }
  if (!conn.isEnabled || conn.status === 'DISABLED') {
    throw new Error(
      `Customer connection "${conn.customerName}" (${conn.id}) is disabled.`
    );
  }
  if (!conn.installation.isActive) {
    throw new Error(
      `MailWizz installation "${conn.installation.baseUrl}" is disabled.`
    );
  }

  const activeCred = conn.credentials[0];
  if (!activeCred) {
    throw new Error(
      `Customer connection "${conn.customerName}" (${conn.id}) has no active API credential.`
    );
  }

  if (
    options?.expectedCredentialVersion !== undefined &&
    activeCred.version !== options.expectedCredentialVersion
  ) {
    throw new Error(
      `Credential version mismatch for connection "${conn.customerName}": expected v${options.expectedCredentialVersion}, active is v${activeCred.version}.`
    );
  }

  const env = getEnv();
  const { baseUrl } = validateAndNormalizeConnectionUrl(conn.installation.baseUrl);
  const plaintextApiKey = decryptSecret(activeCred.apiKeyEnc);
  const authMode = normalizeAuthMode(conn.authMode);

  const client = new MailWizzClient({
    apiUrl: baseUrl,
    apiKey: plaintextApiKey,
    authMode,
    maxRequestsPerSecond: conn.maxRequestsPerSecond,
    allowInsecureHttp: env.ALLOW_INSECURE_MAILWIZZ_HTTP || baseUrl.startsWith('http://127.0.0.1') || baseUrl.startsWith('http://localhost'),
    remoteAddr: options?.remoteAddr,
    fetchImpl: buildRateLimitedFetch({
      installationId: conn.installationId,
      installationRps: conn.installation.maxRequestsPerSecond,
      connectionId: conn.id,
      connectionRps: conn.maxRequestsPerSecond,
      fetchImpl: options?.fetchImpl,
    }),
  });

  // Update lastUsedAt asynchronously without blocking or risking failures if transient
  prisma.mailWizzConnectionCredential
    .update({
      where: { id: activeCred.id },
      data: { lastUsedAt: new Date() },
    })
    .catch(() => {});

  return {
    client,
    connectionId: conn.id,
    installationId: conn.installationId,
    customerName: conn.customerName,
    customerSlug: conn.customerSlug,
    baseUrl,
    authMode,
    credentialId: activeCred.id,
    credentialVersion: activeCred.version,
    apiKeyLast4: activeCred.apiKeyLast4,
  };
}

export async function getMailWizzClient(
  connectionId: string,
  options?: {
    expectedCredentialVersion?: number;
    fetchImpl?: typeof fetch;
    remoteAddr?: string;
  }
): Promise<MailWizzClient> {
  const ctx = await getMailWizzClientWithContext(connectionId, options);
  return ctx.client;
}

/**
 * Legacy helper for explicit single-tenant calls: resolves ONLY if there is an unambiguous
 * single active non-quarantined connection (or explicitly marked primary connection when only one active connection exists).
 * If 0 or >= 2 active customer connections exist, fails closed and requires explicit connectionId!
 */
export async function resolveUnambiguousConnectionId(
  explicitConnectionId?: string | null
): Promise<string> {
  if (explicitConnectionId && explicitConnectionId.trim()) {
    return explicitConnectionId.trim();
  }

  const active = await prisma.mailWizzCustomerConnection.findMany({
    where: {
      isQuarantine: false,
      isEnabled: true,
      status: { not: 'DISABLED' },
    },
    select: { id: true, customerName: true, isPrimary: true },
    take: 3,
  });

  if (active.length === 1) {
    return active[0].id;
  }

  if (active.length > 1) {
    throw new Error(
      'Multiple customer connections exist. Explicit customerConnectionId is required to prevent cross-customer data access.'
    );
  }

  throw new Error('No active MailWizz customer connection is configured.');
}

/**
 * Live-tests a stored customer connection using read-only GET /lists and records health & detected version.
 */
export async function validateStoredCustomerConnection(params: {
  connectionId: string;
  fetchImpl?: typeof fetch;
}): Promise<{
  ok: boolean;
  connectionId: string;
  detectedVersion: string | null;
  verifiedAuthMode: MailWizzAuthMode | null;
  totalListsFound: number;
  latencyMs: number;
  message: string;
}> {
  const startedAt = Date.now();
  const conn = await prisma.mailWizzCustomerConnection.findUnique({
    where: { id: params.connectionId },
    include: {
      installation: true,
      credentials: {
        where: { isActive: true, status: 'ACTIVE' },
        orderBy: { version: 'desc' },
        take: 1,
      },
    },
  });

  if (!conn) {
    throw new Error(`Customer connection "${params.connectionId}" not found.`);
  }
  if (conn.isQuarantine) {
    throw new Error('Quarantined legacy connection cannot be validated.');
  }
  if (conn.isDemoData && !params.fetchImpl) {
    return {
      ok: false,
      connectionId: conn.id,
      detectedVersion: conn.detectedVersion ?? null,
      verifiedAuthMode: null,
      totalListsFound: 0,
      latencyMs: Date.now() - startedAt,
      message: 'Synthetic demo customer account does not perform external network checks.',
    };
  }
  const activeCred = conn.credentials[0];
  if (!activeCred) {
    throw new Error('Customer connection has no active API key to validate.');
  }

  const env = getEnv();
  const { baseUrl } = validateAndNormalizeConnectionUrl(conn.installation.baseUrl);
  const apiKey = decryptSecret(activeCred.apiKeyEnc);
  const preferredAuth = normalizeAuthMode(conn.authMode);

  const modesToTry: MailWizzAuthMode[] =
    preferredAuth === 'auto'
      ? ['auto', 'x-api-key', 'legacy-hmac', 'bearer']
      : [preferredAuth];

  let lastErrorSafe = 'Validation failed.';
  let lastStatusCode: number | null = null;
  const lastVersion = conn.detectedVersion ?? null;

  for (const mode of modesToTry) {
    try {
      const client = new MailWizzClient({
        apiUrl: baseUrl,
        apiKey,
        authMode: mode,
        maxRequestsPerSecond: conn.maxRequestsPerSecond,
        allowInsecureHttp:
          env.ALLOW_INSECURE_MAILWIZZ_HTTP ||
          baseUrl.startsWith('http://127.0.0.1') ||
          baseUrl.startsWith('http://localhost'),
        fetchImpl: params.fetchImpl,
      });

      const res = await client.getJson(
        '/lists',
        MailWizzPaginatedEnvelopeSchema(MailWizzListRecordSchema),
        { page: 1, per_page: 5 }
      );
      const detectedVersion = client.getDetectedServerVersion() ?? conn.detectedVersion ?? null;
      const totalListsFound = res.data?.count ?? res.data?.records.length ?? 0;
      const latencyMs = Date.now() - startedAt;

      await prisma.$transaction([
        prisma.mailWizzCustomerConnection.update({
          where: { id: conn.id },
          data: {
            status: conn.isEnabled ? 'CONNECTED' : 'DISABLED',
            detectedVersion,
          },
        }),
        prisma.mailWizzInstallation.update({
          where: { id: conn.installationId },
          data: {
            ...(detectedVersion ? { detectedVersion } : {}),
          },
        }),
        prisma.mailWizzConnectionHealth.upsert({
          where: { customerConnectionId: conn.id },
          create: {
            customerConnectionId: conn.id,
            lastCheckedAt: new Date(),
            lastSuccessAt: new Date(),
            lastStatusCode: 200,
            lastLatencyMs: latencyMs,
            lastEndpointTested: 'GET /lists?page=1&per_page=5',
            lastErrorSafe: null,
            detectedVersion,
            verifiedAuthMode: mode,
            consecutiveFailures: 0,
            totalRequestsCount: 1,
            totalErrorsCount: 0,
          },
          update: {
            lastCheckedAt: new Date(),
            lastSuccessAt: new Date(),
            lastStatusCode: 200,
            lastLatencyMs: latencyMs,
            lastEndpointTested: 'GET /lists?page=1&per_page=5',
            lastErrorSafe: null,
            detectedVersion,
            verifiedAuthMode: mode,
            consecutiveFailures: 0,
            totalRequestsCount: { increment: 1 },
          },
        }),
      ]);

      return {
        ok: true,
        connectionId: conn.id,
        detectedVersion,
        verifiedAuthMode: mode,
        totalListsFound,
        latencyMs,
        message: `Connected cleanly to ${conn.customerName} (${totalListsFound} lists visible, mode=${mode}).`,
      };
    } catch (err) {
      lastErrorSafe = redactErrorMessage(err);
      lastStatusCode =
        typeof (err as { statusCode?: unknown })?.statusCode === 'number'
          ? (err as { statusCode: number }).statusCode
          : null;
      if (lastStatusCode !== 401 && lastStatusCode !== 403 && preferredAuth === 'auto') {
        break;
      }
    }
  }

  const latencyMs = Date.now() - startedAt;
  await prisma.$transaction([
    prisma.mailWizzCustomerConnection.update({
      where: { id: conn.id },
      data: {
        status: conn.isEnabled ? 'AUTH_FAILED' : 'DISABLED',
      },
    }),
    prisma.mailWizzConnectionHealth.upsert({
      where: { customerConnectionId: conn.id },
      create: {
        customerConnectionId: conn.id,
        lastCheckedAt: new Date(),
        lastErrorAt: new Date(),
        lastStatusCode,
        lastLatencyMs: latencyMs,
        lastEndpointTested: 'GET /lists?page=1&per_page=5',
        lastErrorSafe,
        detectedVersion: lastVersion,
        consecutiveFailures: 1,
        totalRequestsCount: 1,
        totalErrorsCount: 1,
      },
      update: {
        lastCheckedAt: new Date(),
        lastErrorAt: new Date(),
        lastStatusCode,
        lastLatencyMs: latencyMs,
        lastEndpointTested: 'GET /lists?page=1&per_page=5',
        lastErrorSafe,
        consecutiveFailures: { increment: 1 },
        totalRequestsCount: { increment: 1 },
        totalErrorsCount: { increment: 1 },
      },
    }),
  ]);

  logger.warn('MailWizz customer connection validation failed', {
    connectionId: conn.id,
    statusCode: lastStatusCode,
    error: lastErrorSafe,
  });

  return {
    ok: false,
    connectionId: conn.id,
    detectedVersion: lastVersion,
    verifiedAuthMode: null,
    totalListsFound: 0,
    latencyMs,
    message: lastErrorSafe,
  };
}
