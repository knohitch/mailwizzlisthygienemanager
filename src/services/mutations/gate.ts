import { prisma } from '@/lib/db';
import { getEnv } from '@/lib/env';
import { decryptSecret } from '@/services/security/crypto';
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
    requiredVerified: CapabilityKey[];
    requiredAvailable: CapabilityKey[];
  }
> = {
  UNSUBSCRIBE: {
    requiredVerified: [
      'list_discovery',
      'subscriber_retrieval',
      'subscriber_status_retrieval',
    ],
    requiredAvailable: ['subscriber_unsubscribe'],
  },
  COPY_SUBSCRIBERS: {
    requiredVerified: [
      'list_discovery',
      'subscriber_retrieval',
      'subscriber_status_retrieval',
    ],
    requiredAvailable: ['subscriber_copying'],
  },
  CREATE_LIST: {
    requiredVerified: ['list_discovery'],
    requiredAvailable: ['list_creation'],
  },
  MOVE_SUBSCRIBERS: {
    requiredVerified: [
      'list_discovery',
      'subscriber_retrieval',
      'subscriber_status_retrieval',
    ],
    requiredAvailable: ['subscriber_copying', 'subscriber_unsubscribe'],
  },
  CREATE_SEGMENT: {
    requiredVerified: ['list_discovery', 'segment_discovery'],
    requiredAvailable: ['segment_creation'],
  },
};

export function assertOperationCapabilitiesInReport(
  report: CompatibilityReport,
  operation: RemoteMutationOperation
): void {
  const reqs = OPERATION_CAPABILITY_REQUIREMENTS[operation];
  const capMap = new Map(report.capabilities.map((c) => [c.key, c]));

  for (const key of reqs.requiredVerified) {
    const cap = capMap.get(key);
    if (!cap || cap.status !== 'VERIFIED') {
      throw new UnsafeOperationBlockedError(
        `Remote ${operation} blocked: required prerequisite capability "${cap?.label ?? key}" is ${cap?.status ?? 'UNKNOWN'} (must be VERIFIED even when the MailWizz version is approved).`
      );
    }
  }

  for (const key of reqs.requiredAvailable) {
    const cap = capMap.get(key);
    if (
      !cap ||
      cap.status === 'UNSUPPORTED' ||
      cap.status === 'UNKNOWN' ||
      cap.status === 'BLOCKED'
    ) {
      throw new UnsafeOperationBlockedError(
        `Remote ${operation} blocked: operation capability "${cap?.label ?? key}" is ${cap?.status ?? 'UNKNOWN'} (${cap?.reason ?? 'per-operation verification failed'}).`
      );
    }
  }
}

/**
 * Verifies version compatibility AND per-operation capability contracts allow remote mutations
 * (fail-closed on unverified major releases, custom versions, missing per-op capabilities, or failed contracts).
 */
export async function assertCompatibilityPermitsRemoteMutations(
  operation?: RemoteMutationOperation,
  options?: { requireConnectedReport?: boolean }
): Promise<void> {
  const [cfg, compatCfg, latestReport] = await Promise.all([
    prisma.appConfig.findUnique({ where: { id: 'default' } }),
    mailWizzCapabilityRegistry.loadCompatibilityConfig(),
    mailWizzCapabilityRegistry.loadLatestCompatibilityReport(),
  ]);

  if (latestReport && latestReport.connectionStatus !== 'NOT_CONFIGURED') {
    if (latestReport.overallStatus === 'INCOMPATIBLE') {
      throw new UnsafeOperationBlockedError(
        'Remote MailWizz mutations blocked fail-closed: latest Compatibility Check reported INCOMPATIBLE contracts.'
      );
    }
    if (!latestReport.mutationSafetyAllowed) {
      throw new UnsafeOperationBlockedError(
        latestReport.mutationLockReason ||
          'Remote MailWizz mutations are locked until the connected version passes compatibility verification and administrator approval.'
      );
    }
    if (operation) {
      assertOperationCapabilitiesInReport(latestReport, operation);
    }
    return;
  }

  if (options?.requireConnectedReport) {
    throw new UnsafeOperationBlockedError(
      `Remote ${operation ?? 'mutation'} blocked fail-closed: run a live connected read-only Compatibility Check before permitting remote MailWizz writes.`
    );
  }

  const detectedOrConfigured =
    cfg?.mailwizzDetectedVersion ?? compatCfg.configuredVersion;
  if (detectedOrConfigured) {
    const versionInfo = mailWizzVersionDetector.resolveVersionInfo({
      configuredVersion: compatCfg.configuredVersion,
      detectedVersion: cfg?.mailwizzDetectedVersion ?? null,
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
  operation?: RemoteMutationOperation
): Promise<{
  client: MailWizzMutationClient;
  batchSize: number;
}> {
  await assertCompatibilityPermitsRemoteMutations(operation, {
    requireConnectedReport: true,
  });

  const env = getEnv();
  const cfg = await prisma.appConfig.upsert({
    where: { id: 'default' },
    update: {},
    create: { id: 'default' },
  });

  const apiUrl = cfg.mailwizzApiUrl || env.MAILWIZZ_API_URL;
  const apiKey = cfg.mailwizzApiKeyEnc
    ? decryptSecret(cfg.mailwizzApiKeyEnc)
    : env.MAILWIZZ_API_KEY;

  if (!apiUrl || !apiKey) {
    throw new Error(
      'MailWizz API URL and API key are not configured yet. Configure them in Settings before running remote MailWizz operations.'
    );
  }

  return {
    client: new MailWizzMutationClient({
      apiUrl,
      apiKey,
      authMode: (cfg.mailwizzAuthMode as MailWizzAuthMode) || 'auto',
      maxRequestsPerSecond: Math.min(5, cfg.maxApiRequestsPerSecond),
      allowInsecureHttp: env.ALLOW_INSECURE_MAILWIZZ_HTTP === true,
    }),
    batchSize: Math.min(50, Math.max(5, cfg.batchSize)),
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
