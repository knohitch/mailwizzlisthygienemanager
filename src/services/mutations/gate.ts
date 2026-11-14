import { prisma } from '@/lib/db';
import { getEnv } from '@/lib/env';
import { decryptSecret } from '@/services/security/crypto';
import { recordAuditLog } from '@/services/security/audit';
import {
  isMailWizzMutationsEnabled,
  MailWizzMutationClient,
  MutationGateLockedError,
} from './mailwizz-writer';
import type { MailWizzAuthMode } from '@/services/mailwizz/compat';

export { isMailWizzMutationsEnabled, MailWizzMutationClient, MutationGateLockedError };

export async function createConfiguredMutationClient(): Promise<{
  client: MailWizzMutationClient;
  batchSize: number;
}> {
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
