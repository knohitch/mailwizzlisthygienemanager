import type { CapabilityStatus, Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { isMailWizzMutationsEnabled } from '@/services/mutations/mailwizz-writer';
import type {
  CapabilityCheckEntry,
  CapabilityKey,
  CompatibilityCapabilityStatus,
  CompatibilityReport,
} from './contracts';

export const WRITABLE_CAPABILITY_KEYS = [
  'list_creation',
  'subscriber_copying',
  'subscriber_unsubscribe',
  'segment_creation',
] as const;

export type WritableCapabilityKey = (typeof WRITABLE_CAPABILITY_KEYS)[number];

export interface CapabilityDefinitionMeta {
  key: CapabilityKey;
  legacyKey?: string;
  label: string;
  category: CapabilityCheckEntry['category'];
  endpointOrFeature: string;
  defaultStatus: CompatibilityCapabilityStatus;
  criticalForSync: boolean;
  criticalForMutations: boolean;
  defaultReason: string;
}

export const MAILWIZZ_CAPABILITY_DEFINITIONS: CapabilityDefinitionMeta[] = [
  {
    key: 'list_discovery',
    legacyKey: 'lists_discovery',
    label: 'List discovery',
    category: 'READ_CORE',
    endpointOrFeature: 'GET /lists & GET /lists/{list_uid}',
    defaultStatus: 'UNKNOWN',
    criticalForSync: true,
    criticalForMutations: true,
    defaultReason: 'Awaiting live read-only contract check against MailWizz /lists endpoint.',
  },
  {
    key: 'subscriber_retrieval',
    legacyKey: 'subscribers_paginated',
    label: 'Subscriber retrieval',
    category: 'READ_CORE',
    endpointOrFeature: 'GET /lists/{list_uid}/subscribers & GET .../subscribers/{uid}',
    defaultStatus: 'UNKNOWN',
    criticalForSync: true,
    criticalForMutations: true,
    defaultReason: 'Awaiting read-only subscriber payload and identifier contract check.',
  },
  {
    key: 'subscriber_pagination',
    label: 'Subscriber pagination',
    category: 'READ_CORE',
    endpointOrFeature: 'page / per_page / total_pages / next_page invariants',
    defaultStatus: 'UNKNOWN',
    criticalForSync: true,
    criticalForMutations: false,
    defaultReason: 'Pagination envelope consistency has not yet been tested against the target server.',
  },
  {
    key: 'subscriber_status_retrieval',
    label: 'Subscriber status retrieval',
    category: 'SAFETY',
    endpointOrFeature: 'Canonical status values (confirmed / unconfirmed / unsubscribed / blacklisted / moved)',
    defaultStatus: 'UNKNOWN',
    criticalForSync: true,
    criticalForMutations: true,
    defaultReason: 'Subscriber status semantics not yet verified; unknown statuses map fail-safe to UNKNOWN.',
  },
  {
    key: 'campaign_discovery',
    legacyKey: 'campaigns_discovery',
    label: 'Campaign discovery',
    category: 'READ_CORE',
    endpointOrFeature: 'GET /campaigns & GET /campaigns/{campaign_uid}',
    defaultStatus: 'UNKNOWN',
    criticalForSync: false,
    criticalForMutations: false,
    defaultReason: 'Awaiting read-only /campaigns contract validation.',
  },
  {
    key: 'campaign_statistics',
    legacyKey: 'campaign_aggregate_stats',
    label: 'Campaign statistics',
    category: 'READ_CORE',
    endpointOrFeature: 'GET /campaigns/{campaign_uid}/stats',
    defaultStatus: 'UNKNOWN',
    criticalForSync: false,
    criticalForMutations: false,
    defaultReason: 'Awaiting aggregate campaign stats structure validation.',
  },
  {
    key: 'historical_engagement_retrieval',
    legacyKey: 'verified_campaign_report_import',
    label: 'Historical engagement retrieval',
    category: 'HISTORICAL_ENGAGEMENT',
    endpointOrFeature: 'Future API /campaigns/{uid}/{opens|clicks|delivery-logs} or Priority B CSV / Priority C SELECT-only DB',
    defaultStatus: 'AVAILABLE_BUT_UNTESTED',
    criticalForSync: false,
    criticalForMutations: true,
    defaultReason:
      'MailWizz 3.0.5 REST API lacks per-subscriber historical engagement endpoints (tracking triggers remain blocked); verified exports (Priority B) or SELECT-only Reporting DB (Priority C) remain available.',
  },
  {
    key: 'bounce_reporting',
    legacyKey: 'campaign_bounce_logs',
    label: 'Bounce reporting',
    category: 'READ_CORE',
    endpointOrFeature: 'GET /campaigns/{campaign_uid}/bounces',
    defaultStatus: 'UNKNOWN',
    criticalForSync: false,
    criticalForMutations: false,
    defaultReason: 'Awaiting read-only campaign bounce log structure check.',
  },
  {
    key: 'segment_discovery',
    legacyKey: 'segments_discovery',
    label: 'Segment discovery',
    category: 'SEGMENTS',
    endpointOrFeature: 'GET /lists/{list_uid}/segments, .../segments/{seg_uid}, .../subscribers',
    defaultStatus: 'UNKNOWN',
    criticalForSync: false,
    criticalForMutations: false,
    defaultReason: 'Awaiting read-only segment list and detail schema check.',
  },
  {
    key: 'segment_creation',
    label: 'Segment creation',
    category: 'MUTATIONS',
    endpointOrFeature: 'POST/PUT /lists/{list_uid}/segments (verified via GET fields & condition-operators)',
    defaultStatus: 'BLOCKED',
    criticalForSync: false,
    criticalForMutations: true,
    defaultReason: 'Write-gated behind ENABLE_MAILWIZZ_MUTATIONS=false and read-only prerequisite checks.',
  },
  {
    key: 'list_creation',
    label: 'List creation',
    category: 'MUTATIONS',
    endpointOrFeature: 'POST /lists (write-gated; never probe-written)',
    defaultStatus: 'BLOCKED',
    criticalForSync: false,
    criticalForMutations: true,
    defaultReason: 'Write-gated behind ENABLE_MAILWIZZ_MUTATIONS=false; no write requests executed during verification.',
  },
  {
    key: 'subscriber_copying',
    label: 'Subscriber copying',
    category: 'MUTATIONS',
    endpointOrFeature: 'POST /lists/{list_uid}/subscribers/bulk (single opt-in enforced)',
    defaultStatus: 'BLOCKED',
    criticalForSync: false,
    criticalForMutations: true,
    defaultReason: 'Write-gated behind ENABLE_MAILWIZZ_MUTATIONS=false and single opt-in list verification.',
  },
  {
    key: 'subscriber_suppression',
    label: 'Subscriber suppression (Local)',
    category: 'SAFETY',
    endpointOrFeature: 'Local PostgreSQL suppression list (never modifies MailWizz remotely)',
    defaultStatus: 'VERIFIED',
    criticalForSync: false,
    criticalForMutations: false,
    defaultReason: 'Local application suppression operates solely inside PostgreSQL and is verified.',
  },
  {
    key: 'subscriber_unsubscribe',
    legacyKey: 'phase2_mutations_gate',
    label: 'Subscriber unsubscribe (Remote)',
    category: 'MUTATIONS',
    endpointOrFeature: 'PUT /lists/{list_uid}/subscribers/{uid}/unsubscribe (with single-list identity recheck)',
    defaultStatus: 'BLOCKED',
    criticalForSync: false,
    criticalForMutations: true,
    defaultReason: 'Write-gated behind ENABLE_MAILWIZZ_MUTATIONS=false, dry-run confirmation, and live pre-mutation safety recheck.',
  },
  {
    key: 'webhook_event_processing',
    legacyKey: 'campaign_webhooks_live',
    label: 'Webhook event processing',
    category: 'WEBHOOKS',
    endpointOrFeature: 'POST /api/webhooks/mailwizz (HMAC/secret + replay window + schema adapter)',
    defaultStatus: 'VERIFIED',
    criticalForSync: false,
    criticalForMutations: false,
    defaultReason: 'Webhook ingress validates signatures, timestamps, list scope, and forward event formats without backdating history.',
  },
];

export function mapToPrismaCapabilityStatus(
  status: CompatibilityCapabilityStatus
): CapabilityStatus {
  if (status === 'VERIFIED') return 'VERIFIED';
  if (status === 'UNSUPPORTED' || status === 'BLOCKED') return 'UNAVAILABLE';
  return 'NOT_YET_TESTED';
}

export function buildDefaultCapabilities(): CapabilityCheckEntry[] {
  return MAILWIZZ_CAPABILITY_DEFINITIONS.map((def) => ({
    key: def.key,
    label: def.label,
    category: def.category,
    endpointOrFeature: def.endpointOrFeature,
    status: def.defaultStatus,
    testedReadOnly: def.key === 'subscriber_suppression' || def.key === 'webhook_event_processing',
    criticalForSync: def.criticalForSync,
    criticalForMutations: def.criticalForMutations,
    reason: def.defaultReason,
    contractErrors: [],
    additiveFieldsObserved: [],
    lastCheckedAt: null,
  }));
}

export interface PersistedCompatibilityConfig {
  configuredVersion: string | null;
  approvedVersion: string | null;
  approvedAt: string | null;
  approvedByEmail: string | null;
  notes: string | null;
}

export class MailWizzCapabilityRegistry {
  buildBaselineEntries(): CapabilityCheckEntry[] {
    return buildDefaultCapabilities();
  }

  private async resolveTargetConnectionId(
    customerConnectionId?: string | null
  ): Promise<string | null> {
    if (customerConnectionId?.trim()) return customerConnectionId.trim();
    const candidates = await prisma.mailWizzCustomerConnection.findMany({
      where: { isQuarantine: false },
      select: { id: true },
      take: 2,
    });
    return candidates.length === 1 ? candidates[0].id : null;
  }

  async syncEntriesToDatabase(
    entries: CapabilityCheckEntry[],
    customerConnectionId?: string
  ): Promise<void> {
    const connId = await this.resolveTargetConnectionId(customerConnectionId);
    if (!connId) return;

    const defMap = new Map(MAILWIZZ_CAPABILITY_DEFINITIONS.map((d) => [d.key, d]));
    for (const entry of entries) {
      const def = defMap.get(entry.key);
      const dbStatus = mapToPrismaCapabilityStatus(entry.status);
      const formattedNote = `[${entry.status}] ${entry.reason}`;
      await prisma.apiCapabilityCheck.upsert({
        where: {
          customerConnectionId_capabilityKey: {
            customerConnectionId: connId,
            capabilityKey: entry.key,
          },
        },
        update: {
          category: entry.category,
          endpointOrFeature: entry.endpointOrFeature,
          status: dbStatus,
          notes: formattedNote.slice(0, 1000),
          checkedAt: entry.lastCheckedAt ? new Date(entry.lastCheckedAt) : new Date(),
        },
        create: {
          customerConnectionId: connId,
          capabilityKey: entry.key,
          category: entry.category,
          endpointOrFeature: entry.endpointOrFeature,
          status: dbStatus,
          notes: formattedNote.slice(0, 1000),
        },
      });

      if (def?.legacyKey) {
        await prisma.apiCapabilityCheck.upsert({
          where: {
            customerConnectionId_capabilityKey: {
              customerConnectionId: connId,
              capabilityKey: def.legacyKey,
            },
          },
          update: {
            status: dbStatus,
            notes: formattedNote.slice(0, 1000),
            checkedAt: entry.lastCheckedAt ? new Date(entry.lastCheckedAt) : new Date(),
          },
          create: {
            customerConnectionId: connId,
            capabilityKey: def.legacyKey,
            category: def.category,
            endpointOrFeature: def.endpointOrFeature,
            status: dbStatus,
            notes: formattedNote.slice(0, 1000),
          },
        });
      }
    }
  }

  async getLatestCompatibilityResetAt(
    customerConnectionId?: string
  ): Promise<Date | null> {
    const connId = await this.resolveTargetConnectionId(customerConnectionId);
    const latestReset = await prisma.auditLog.findFirst({
      where: {
        action: 'MAILWIZZ_COMPATIBILITY_RESET',
        resourceType: 'MailWizzCompatibility',
        ...(connId ? { customerConnectionId: connId } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
    return latestReset?.createdAt ?? null;
  }

  async invalidateCachedCompatibility(params: {
    customerConnectionId?: string;
    actorEmail: string;
    ipAddress?: string | null;
    reason: string;
  }): Promise<void> {
    const connId = await this.resolveTargetConnectionId(params.customerConnectionId);
    await prisma.auditLog.create({
      data: {
        customerConnectionId: connId,
        actorEmail: params.actorEmail,
        action: 'MAILWIZZ_COMPATIBILITY_RESET',
        resourceType: 'MailWizzCompatibility',
        resourceId: connId ?? 'default',
        outcome: 'SUCCESS',
        ipAddress: params.ipAddress ?? null,
        detailsJson: {
          reason: params.reason,
          customerConnectionId: connId,
          resetAt: new Date().toISOString(),
        } as Prisma.InputJsonValue,
      },
    });
  }

  async loadCompatibilityConfig(
    customerConnectionId?: string
  ): Promise<PersistedCompatibilityConfig> {
    const connId = await this.resolveTargetConnectionId(customerConnectionId);
    const resetAt = await this.getLatestCompatibilityResetAt(connId ?? undefined);
    const latestConfig = await prisma.auditLog.findFirst({
      where: {
        action: 'MAILWIZZ_COMPATIBILITY_CONFIG',
        resourceType: 'MailWizzCompatibility',
        ...(connId ? { customerConnectionId: connId } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });

    const latestApproval = await prisma.auditLog.findFirst({
      where: {
        action: 'MAILWIZZ_VERSION_APPROVED',
        resourceType: 'MailWizzCompatibility',
        outcome: 'SUCCESS',
        ...(connId ? { customerConnectionId: connId } : {}),
        ...(resetAt ? { createdAt: { gt: resetAt } } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });

    const connRecord = connId
      ? await prisma.mailWizzCustomerConnection.findUnique({
          where: { id: connId },
          select: { approvedVersion: true },
        })
      : null;

    const cfgJson =
      latestConfig?.detailsJson && typeof latestConfig.detailsJson === 'object'
        ? (latestConfig.detailsJson as Record<string, unknown>)
        : {};
    const appJson =
      latestApproval?.detailsJson && typeof latestApproval.detailsJson === 'object'
        ? (latestApproval.detailsJson as Record<string, unknown>)
        : {};

    return {
      configuredVersion:
        typeof cfgJson.configuredVersion === 'string' && cfgJson.configuredVersion.trim()
          ? cfgJson.configuredVersion.trim()
          : null,
      approvedVersion:
        connRecord?.approvedVersion ||
        (typeof appJson.approvedVersion === 'string' && appJson.approvedVersion.trim()
          ? appJson.approvedVersion.trim()
          : '3.0.5'),
      approvedAt:
        typeof appJson.approvedAt === 'string' ? appJson.approvedAt : null,
      approvedByEmail:
        typeof appJson.approvedByEmail === 'string' ? appJson.approvedByEmail : null,
      notes: typeof cfgJson.notes === 'string' ? cfgJson.notes : null,
    };
  }

  async saveConfiguredVersion(params: {
    customerConnectionId?: string;
    configuredVersion: string | null;
    notes?: string | null;
    actorEmail: string;
    ipAddress?: string | null;
  }): Promise<void> {
    const connId = await this.resolveTargetConnectionId(params.customerConnectionId);
    await prisma.auditLog.create({
      data: {
        customerConnectionId: connId,
        actorEmail: params.actorEmail,
        action: 'MAILWIZZ_COMPATIBILITY_CONFIG',
        resourceType: 'MailWizzCompatibility',
        resourceId: params.configuredVersion ?? 'auto',
        outcome: 'SUCCESS',
        ipAddress: params.ipAddress ?? null,
        detailsJson: {
          customerConnectionId: connId,
          configuredVersion: params.configuredVersion,
          notes: params.notes ?? null,
          verified: false,
          source: 'ADMIN_SUPPLIED',
        } as Prisma.InputJsonValue,
      },
    });
  }

  async saveCompatibilityReport(params: {
    customerConnectionId?: string;
    report: CompatibilityReport;
    actorEmail: string;
    ipAddress?: string | null;
  }): Promise<void> {
    const connId = await this.resolveTargetConnectionId(params.customerConnectionId);
    await this.syncEntriesToDatabase(params.report.capabilities, connId ?? undefined);

    if (connId) {
      await prisma.connectionCapabilityReport.create({
        data: {
          customerConnectionId: connId,
          detectedVersion: params.report.versionInfo.detectedVersion,
          adapterMode: params.report.adapterMode,
          overallStatus: params.report.overallStatus,
          readOnlySafe: true,
          autoCleanupAllowed: params.report.adapterMode === 'VERIFIED_NATIVE',
          mutationSafetyAllowed: params.report.mutationSafetyAllowed,
          mutationLockReason: params.report.mutationLockReason,
          approvedVersion: params.report.versionInfo.approvedVersion,
          warningsJson: params.report.warnings as Prisma.InputJsonValue,
          reportJson: params.report as unknown as Prisma.InputJsonValue,
        },
      });
    }

    await prisma.auditLog.create({
      data: {
        customerConnectionId: connId,
        actorEmail: params.actorEmail,
        action: 'MAILWIZZ_COMPATIBILITY_CHECK',
        resourceType: 'MailWizzCompatibility',
        resourceId: params.report.versionInfo.effectiveVersion ?? 'unverified',
        outcome: params.report.overallStatus,
        ipAddress: params.ipAddress ?? null,
        detailsJson: params.report as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async loadLatestCompatibilityReport(
    customerConnectionId?: string
  ): Promise<CompatibilityReport | null> {
    const connId = await this.resolveTargetConnectionId(customerConnectionId);
    const resetAt = await this.getLatestCompatibilityResetAt(connId ?? undefined);

    if (connId) {
      const latestConnReport = await prisma.connectionCapabilityReport.findFirst({
        where: {
          customerConnectionId: connId,
          ...(resetAt ? { checkedAt: { gt: resetAt } } : {}),
        },
        orderBy: { checkedAt: 'desc' },
      });
      if (latestConnReport?.reportJson && typeof latestConnReport.reportJson === 'object') {
        return latestConnReport.reportJson as unknown as CompatibilityReport;
      }
    }

    const latest = await prisma.auditLog.findFirst({
      where: {
        action: 'MAILWIZZ_COMPATIBILITY_CHECK',
        resourceType: 'MailWizzCompatibility',
        ...(connId ? { customerConnectionId: connId } : {}),
        ...(resetAt ? { createdAt: { gt: resetAt } } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!latest?.detailsJson || typeof latest.detailsJson !== 'object') {
      return null;
    }

    return latest.detailsJson as unknown as CompatibilityReport;
  }

  async recordDisposableWriteVerification(params: {
    customerConnectionId?: string;
    capabilityKey: WritableCapabilityKey;
    approvedVersion: string;
    disposableListUid: string;
    evidence: string;
    actorEmail: string;
    ipAddress?: string | null;
  }): Promise<void> {
    if (!isMailWizzMutationsEnabled()) {
      throw new Error(
        'Cannot verify live write capability while ENABLE_MAILWIZZ_MUTATIONS=false.'
      );
    }
    const cleanUid = params.disposableListUid.trim();
    if (!cleanUid || cleanUid.startsWith('demo-')) {
      throw new Error(
        'A valid non-demo disposable test list UID is required for write capability verification.'
      );
    }
    const connId = await this.resolveTargetConnectionId(params.customerConnectionId);
    if (!connId) {
      throw new Error(
        'Explicit customerConnectionId is required for write capability verification.'
      );
    }
    const demoListMatch = await prisma.mailingList.findFirst({
      where: { customerConnectionId: connId, listUid: cleanUid, isDemoData: true },
      select: { id: true },
    });
    if (demoListMatch) {
      throw new Error(
        `List "${cleanUid}" belongs to synthetic demo data and cannot be used to verify live MailWizz write capabilities.`
      );
    }

    await prisma.auditLog.create({
      data: {
        customerConnectionId: connId,
        actorEmail: params.actorEmail,
        action: 'MAILWIZZ_WRITE_CAPABILITY_VERIFIED',
        resourceType: 'MailWizzCompatibility',
        resourceId: params.capabilityKey,
        outcome: 'SUCCESS',
        ipAddress: params.ipAddress ?? null,
        detailsJson: {
          customerConnectionId: connId,
          capabilityKey: params.capabilityKey,
          verifiedVersion: params.approvedVersion,
          disposableListUid: cleanUid,
          evidence: params.evidence.trim(),
          verifiedAt: new Date().toISOString(),
          verifiedByEmail: params.actorEmail,
        } as Prisma.InputJsonValue,
      },
    });

    await prisma.apiCapabilityCheck.upsert({
      where: {
        customerConnectionId_capabilityKey: {
          customerConnectionId: connId,
          capabilityKey: params.capabilityKey,
        },
      },
      update: {
        status: 'VERIFIED',
        checkedAt: new Date(),
        notes: `[VERIFIED] Authorized disposable write test passed on list ${cleanUid} for v${params.approvedVersion}: ${params.evidence.trim()}`.slice(
          0,
          1000
        ),
      },
      create: {
        customerConnectionId: connId,
        capabilityKey: params.capabilityKey,
        category: 'MUTATIONS',
        endpointOrFeature: params.capabilityKey,
        status: 'VERIFIED',
        notes: `[VERIFIED] Authorized disposable write test passed on list ${cleanUid} for v${params.approvedVersion}`.slice(
          0,
          1000
        ),
      },
    });
  }

  async loadVerifiedWriteCapabilities(
    version: string | null | undefined,
    customerConnectionId?: string
  ): Promise<Set<WritableCapabilityKey>> {
    const out = new Set<WritableCapabilityKey>();
    if (!version || !isMailWizzMutationsEnabled()) return out;

    const connId = await this.resolveTargetConnectionId(customerConnectionId);
    if (!connId) return out;

    const resetAt = await this.getLatestCompatibilityResetAt(connId);
    const rows = await prisma.auditLog.findMany({
      where: {
        action: 'MAILWIZZ_WRITE_CAPABILITY_VERIFIED',
        resourceType: 'MailWizzCompatibility',
        outcome: 'SUCCESS',
        customerConnectionId: connId,
        ...(resetAt ? { createdAt: { gt: resetAt } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 40,
    });

    for (const r of rows) {
      const details =
        r.detailsJson && typeof r.detailsJson === 'object'
          ? (r.detailsJson as Record<string, unknown>)
          : null;
      if (
        details &&
        details.verifiedVersion === version &&
        typeof details.capabilityKey === 'string' &&
        (WRITABLE_CAPABILITY_KEYS as readonly string[]).includes(details.capabilityKey)
      ) {
        out.add(details.capabilityKey as WritableCapabilityKey);
      }
    }
    return out;
  }

  async approveVersion(params: {
    customerConnectionId?: string;
    version: string;
    actorEmail: string;
    ipAddress?: string | null;
    report: CompatibilityReport;
  }): Promise<void> {
    const connId = await this.resolveTargetConnectionId(params.customerConnectionId);
    if (connId) {
      await prisma.mailWizzCustomerConnection.update({
        where: { id: connId },
        data: { approvedVersion: params.version },
      });
    }
    await prisma.auditLog.create({
      data: {
        customerConnectionId: connId,
        actorEmail: params.actorEmail,
        action: 'MAILWIZZ_VERSION_APPROVED',
        resourceType: 'MailWizzCompatibility',
        resourceId: params.version,
        outcome: 'SUCCESS',
        ipAddress: params.ipAddress ?? null,
        detailsJson: {
          customerConnectionId: connId,
          approvedVersion: params.version,
          approvedAt: new Date().toISOString(),
          approvedByEmail: params.actorEmail,
          overallStatusAtApproval: params.report.overallStatus,
          adapterInUse: params.report.adapterInUse,
        } as Prisma.InputJsonValue,
      },
    });
  }
}

export const mailWizzCapabilityRegistry = new MailWizzCapabilityRegistry();
