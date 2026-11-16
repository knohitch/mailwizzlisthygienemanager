import { prisma } from '@/lib/db';
import { getEnv } from '@/lib/env';
import { decryptSecret } from '@/services/security/crypto';
import { resolveUnambiguousConnectionId } from '@/services/mailwizz/client-factory';
import { recordAuditLog } from '@/services/security/audit';
import {
  isMailWizzMutationsEnabled,
  MailWizzMutationClient,
  MutationGateLockedError,
  UnsafeOperationBlockedError,
} from './mailwizz-writer';
import { mailWizzFutureAdapterResolver } from '@/services/mailwizz/adapter-resolver';
import { mailWizzCapabilityRegistry } from '@/services/mailwizz/capability-registry';
import type { MailWizzAuthMode } from '@/services/mailwizz/compat';
import { mailWizzVersionDetector } from '@/services/mailwizz/version-detector';

import type { CapabilityKey, CompatibilityReport } from '@/services/mailwizz/contracts';

export {
  isMailWizzMutationsEnabled,
  MailWizzMutationClient,
  MutationGateLockedError,
  UnsafeOperationBlockedError,
};

export type RemoteMutationOperation =
  | 'UNSUBSCRIBE'
  | 'COPY_SUBSCRIBERS'
  | 'CREATE_LIST'
  | 'MOVE_SUBSCRIBERS'
  | 'CREATE_SEGMENT';

const OPERATION_CAPABILITY_REQUIREMENTS: Record<
  RemoteMutationOperation,
  {
    requiredVerifiedReads: CapabilityKey[];
    requiredVerifiedWrites: CapabilityKey[];
  }
> = {
  UNSUBSCRIBE: {
    requiredVerifiedReads: [
      'list_discovery',
      'subscriber_retrieval',
      'subscriber_status_retrieval',
    ],
    requiredVerifiedWrites: ['subscriber_unsubscribe'],
  },
  COPY_SUBSCRIBERS: {
    requiredVerifiedReads: [
      'list_discovery',
      'subscriber_retrieval',
      'subscriber_status_retrieval',
    ],
    requiredVerifiedWrites: ['subscriber_copying'],
  },
  CREATE_LIST: {
    requiredVerifiedReads: ['list_discovery'],
    requiredVerifiedWrites: ['list_creation'],
  },
  MOVE_SUBSCRIBERS: {
    requiredVerifiedReads: [
      'list_discovery',
      'subscriber_retrieval',
      'subscriber_status_retrieval',
    ],
    requiredVerifiedWrites: ['subscriber_copying', 'subscriber_unsubscribe'],
  },
  CREATE_SEGMENT: {
    requiredVerifiedReads: ['list_discovery', 'segment_discovery'],
    requiredVerifiedWrites: ['segment_creation'],
  },
};

export function assertOperationCapabilitiesInReport(
  report: CompatibilityReport,
  operation: RemoteMutationOperation
): void {
  const reqs = OPERATION_CAPABILITY_REQUIREMENTS[operation];
  const capMap = new Map(report.capabilities.map((c) => [c.key, c]));

  for (const key of reqs.requiredVerifiedReads) {
    const cap = capMap.get(key);
    if (!cap || cap.status !== 'VERIFIED') {
      throw new UnsafeOperationBlockedError(
        `Remote ${operation} blocked: required read capability "${cap?.label ?? key}" is ${cap?.status ?? 'UNKNOWN'} (must be VERIFIED even when the MailWizz version is approved).`
      );
    }
  }

  for (const key of reqs.requiredVerifiedWrites) {
    const cap = capMap.get(key);
    if (!cap || cap.status !== 'VERIFIED') {
      throw new UnsafeOperationBlockedError(
        `Remote ${operation} blocked: write capability "${cap?.label ?? key}" is ${cap?.status ?? 'UNKNOWN'} (must be VERIFIED through authorized disposable testing; AVAILABLE_BUT_UNTESTED and version approval alone cannot authorize remote writes).`
      );
    }
  }
}

/**
 * Verifies global mutation gate, approved compatible version, verified read contracts,
 * and verified per-operation write capability before allowing any remote subscriber mutation.
 */
export async function assertCompatibilityPermitsRemoteMutations(
  operation?: RemoteMutationOperation,
  options?: { requireConnectedReport?: boolean; customerConnectionId?: string }
): Promise<void> {
  if (!isMailWizzMutationsEnabled()) {
    throw new MutationGateLockedError(operation ?? 'REMOTE_MUTATION');
  }

  let connId: string | undefined = options?.customerConnectionId?.trim() || undefined;
  if (!connId) {
    const activeConns = await prisma.mailWizzCustomerConnection.findMany({
      where: { isQuarantine: false },
      select: { id: true },
      take: 2,
    });
    if (activeConns.length === 1) {
      connId = activeConns[0].id;
    } else if (activeConns.length > 1) {
      throw new UnsafeOperationBlockedError(
        `Remote ${operation ?? 'mutation'} blocked fail-closed: multiple customer connections exist; explicit customerConnectionId is required.`
      );
    }
  }

  if (connId) {
    const conn = await prisma.mailWizzCustomerConnection.findUnique({
      where: { id: connId },
      select: { id: true, isEnabled: true, isQuarantine: true, status: true, customerName: true },
    });
    if (!conn || conn.isQuarantine || !conn.isEnabled || conn.status === 'DISABLED') {
      throw new UnsafeOperationBlockedError(
        `Remote ${operation ?? 'mutation'} blocked fail-closed: customer connection "${conn?.customerName ?? connId}" is disabled or quarantined.`
      );
    }
  }

  const [cfg, compatCfg, latestReport] = await Promise.all([
    prisma.appConfig.findUnique({ where: { id: 'default' } }),
    mailWizzCapabilityRegistry.loadCompatibilityConfig(connId),
    mailWizzCapabilityRegistry.loadLatestCompatibilityReport(connId),
  ]);

  if (latestReport && latestReport.connectionStatus !== 'NOT_CONFIGURED') {
    if (latestReport.connectionStatus !== 'CONNECTED') {
      throw new UnsafeOperationBlockedError(
        `Remote ${operation ?? 'mutation'} blocked fail-closed: MailWizz connection status is ${latestReport.connectionStatus}.`
      );
    }
    if (
      latestReport.overallStatus === 'INCOMPATIBLE' ||
      latestReport.overallStatus === 'UNVERIFIED'
    ) {
      throw new UnsafeOperationBlockedError(
        `Remote ${operation ?? 'mutation'} blocked fail-closed: latest Compatibility Check verdict is ${latestReport.overallStatus}.`
      );
    }
    if (
      latestReport.adapterMode !== 'VERIFIED_NATIVE' ||
      !latestReport.versionInfo.approvedVersion ||
      latestReport.versionInfo.upgradeDetected
    ) {
      throw new UnsafeOperationBlockedError(
        latestReport.mutationLockReason ||
          'Remote MailWizz mutations blocked: active MailWizz version is not verified and explicitly approved.'
      );
    }
    if (!latestReport.mutationSafetyAllowed) {
      throw new UnsafeOperationBlockedError(
        latestReport.mutationLockReason ||
          'Remote MailWizz mutations are locked until the connected version passes compatibility verification and administrator approval.'
      );
    }
    if (!operation) {
      throw new UnsafeOperationBlockedError(
        'Remote MailWizz mutations require specifying an explicit operation capability to authorize.'
      );
    }
    assertOperationCapabilitiesInReport(latestReport, operation);
    return;
  }

  if (options?.requireConnectedReport ?? true) {
    throw new UnsafeOperationBlockedError(
      `Remote ${operation ?? 'mutation'} blocked fail-closed: run a live connected read-only Compatibility Check and verify the write capability on a disposable list before permitting remote MailWizz writes.`
    );
  }

  const connVersion = connId
    ? (
        await prisma.mailWizzCustomerConnection.findUnique({
          where: { id: connId },
          select: { detectedVersion: true },
        })
      )?.detectedVersion
    : null;

  const detectedOrConfigured =
    connVersion ?? cfg?.mailwizzDetectedVersion ?? compatCfg.configuredVersion;
  if (detectedOrConfigured) {
    const versionInfo = mailWizzVersionDetector.resolveVersionInfo({
      configuredVersion: compatCfg.configuredVersion,
      detectedVersion: connVersion ?? cfg?.mailwizzDetectedVersion ?? null,
      approvedVersion: compatCfg.approvedVersion,
    });
    const resolved = mailWizzFutureAdapterResolver.resolve({
      versionInfo,
      envMutationsEnabled: isMailWizzMutationsEnabled(),
      coreContractsPassed:
        versionInfo.parsed.isBaseline305 ||
        versionInfo.parsed.classification === 'PATCH_3_0_X'
          ? true
          : undefined,
    });
    if (!resolved.mutationSafetyAllowed) {
      throw new UnsafeOperationBlockedError(
        resolved.mutationLockReason ||
          `Remote mutations blocked for MailWizz version "${detectedOrConfigured}" until compatibility verification passes.`
      );
    }
  }
}

export async function createConfiguredMutationClient(
  operation?: RemoteMutationOperation,
  customerConnectionId?: string
): Promise<{
  client: MailWizzMutationClient;
  batchSize: number;
  customerConnectionId: string;
}> {
  const connId = await resolveUnambiguousConnectionId(customerConnectionId);
  await assertCompatibilityPermitsRemoteMutations(operation, {
    requireConnectedReport: true,
    customerConnectionId: connId,
  });

  const env = getEnv();
  const [cfg, conn] = await Promise.all([
    prisma.appConfig.upsert({
      where: { id: 'default' },
      update: {},
      create: { id: 'default' },
    }),
    prisma.mailWizzCustomerConnection.findUnique({
      where: { id: connId },
      include: {
        installation: true,
        credentials: {
          where: { isActive: true, status: 'ACTIVE' },
          orderBy: { version: 'desc' },
          take: 1,
        },
      },
    }),
  ]);

  if (
    !conn ||
    conn.isQuarantine ||
    !conn.isEnabled ||
    conn.status === 'DISABLED' ||
    !conn.installation.isActive
  ) {
    throw new Error(`Customer connection "${connId}" is disabled or unavailable.`);
  }

  const activeCred = conn.credentials[0];
  if (!activeCred) {
    throw new Error(
      `Customer connection "${conn.customerName}" has no active API credential.`
    );
  }

  const apiUrl = conn.installation.baseUrl;
  const apiKey = decryptSecret(activeCred.apiKeyEnc);

  return {
    client: new MailWizzMutationClient({
      apiUrl,
      apiKey,
      authMode: (conn.authMode as MailWizzAuthMode) || 'auto',
      maxRequestsPerSecond: Math.min(5, conn.maxRequestsPerSecond),
      allowInsecureHttp:
        env.ALLOW_INSECURE_MAILWIZZ_HTTP === true ||
        apiUrl.startsWith('http://127.0.0.1') ||
        apiUrl.startsWith('http://localhost'),
    }),
    batchSize: Math.min(50, Math.max(5, cfg.batchSize)),
    customerConnectionId: conn.id,
  };
}

export interface Phase2MutationService {
  unsubscribeSubscriber(params: {
    listUid: string;
    subscriberUid: string;
    actorEmail: string;
    dryRun?: boolean;
  }): Promise<never | { ok: true }>;

  createHygieneSegment(params: {
    listUid: string;
    segmentName: string;
    subscriberUids: string[];
    actorEmail: string;
  }): Promise<never | { segmentUid: string }>;

  copySubscribersToCleanList(params: {
    sourceListUid: string;
    targetListName: string;
    subscriberUids: string[];
    actorEmail: string;
  }): Promise<never | { targetListUid: string; copiedCount: number }>;
}

async function assertMutationGateOpen(
  action: string,
  actorEmail: string,
  resourceId: string
): Promise<void> {
  if (!isMailWizzMutationsEnabled()) {
    await recordAuditLog({
      actorEmail,
      action: `BLOCKED_MUTATION_${action}`,
      resourceType: 'MailWizzMutationGate',
      resourceId,
      outcome: 'DENIED',
      details: {
        reason: 'ENABLE_MAILWIZZ_MUTATIONS is false (Phase 1 read-only mode)',
      },
    });
    throw new MutationGateLockedError(action);
  }
}

/**
 * Phase 2 Mutation Interface — hard-gated off during Phase 1.
 */
export const mailWizzMutationService: Phase2MutationService = {
  async unsubscribeSubscriber(params) {
    await assertMutationGateOpen(
      'UNSUBSCRIBE_SUBSCRIBER',
      params.actorEmail,
      `${params.listUid}:${params.subscriberUid}`
    );
    throw new Error('Phase 2 mutation implementation intentionally not active in Phase 1.');
  },

  async createHygieneSegment(params) {
    await assertMutationGateOpen(
      'CREATE_SEGMENT',
      params.actorEmail,
      params.listUid
    );
    throw new Error('Phase 2 mutation implementation intentionally not active in Phase 1.');
  },

  async copySubscribersToCleanList(params) {
    await assertMutationGateOpen(
      'COPY_TO_CLEAN_LIST',
      params.actorEmail,
      params.sourceListUid
    );
    throw new Error('Phase 2 mutation implementation intentionally not active in Phase 1.');
  },
};
