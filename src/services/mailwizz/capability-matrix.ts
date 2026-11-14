import { prisma } from '@/lib/db';
import type { CapabilityStatus } from '@prisma/client';

export interface CapabilityDefinition {
  capabilityKey: string;
  category: string;
  endpointOrFeature: string;
  defaultStatus: CapabilityStatus;
  notes: string;
}

export const MAILWIZZ_CAPABILITY_BASELINE: CapabilityDefinition[] = [
  {
    capabilityKey: 'auth_x_api_key',
    category: 'Authentication',
    endpointOrFeature: 'X-Api-Key / 1.x HMAC / Bearer (Auto-Negotiated)',
    defaultStatus: 'NOT_YET_TESTED',
    notes:
      'Supports MailWizz 2.x/3.x/4.x X-Api-Key, legacy 1.x public:private HMAC-SHA1 signing (X-MW-* headers), and Bearer token gateways via auto-detection.',
  },
  {
    capabilityKey: 'lists_discovery',
    category: 'Lists & Subscribers',
    endpointOrFeature: 'GET /lists & GET /lists/{list_uid}',
    defaultStatus: 'NOT_YET_TESTED',
    notes:
      'Auto-discovers all mailing lists with pagination without manual list ID entry.',
  },
  {
    capabilityKey: 'subscribers_paginated',
    category: 'Lists & Subscribers',
    endpointOrFeature: 'GET /lists/{list_uid}/subscribers?page=&per_page=&status=',
    defaultStatus: 'NOT_YET_TESTED',
    notes:
      'Paginated retrieval of subscribers and statuses (confirmed, unconfirmed, unsubscribed, blacklisted).',
  },
  {
    capabilityKey: 'segments_discovery',
    category: 'Segments',
    endpointOrFeature:
      'GET /lists/{list_uid}/segments, GET /lists/{list_uid}/segments/{seg_uid}, .../subscribers',
    defaultStatus: 'NOT_YET_TESTED',
    notes:
      'Discovers existing MailWizz segments, including campaign_conditions metadata and matching subscribers.',
  },
  {
    capabilityKey: 'campaigns_discovery',
    category: 'Campaigns',
    endpointOrFeature: 'GET /campaigns & GET /campaigns/{campaign_uid}',
    defaultStatus: 'NOT_YET_TESTED',
    notes:
      'Discovers historical campaigns, status, send_at timestamp, target list_uid, and segment.',
  },
  {
    capabilityKey: 'campaign_aggregate_stats',
    category: 'Campaigns',
    endpointOrFeature: 'GET /campaigns/{campaign_uid}/stats',
    defaultStatus: 'NOT_YET_TESTED',
    notes:
      'Returns aggregate counts & rates: delivery_success_count, delivery_error_count, opens_count, unique_opens_count, clicks_count, unique_clicks_count, unsubscribes_count, complaints_count, hard/soft/internal_bounces_count.',
  },
  {
    capabilityKey: 'campaign_bounce_logs',
    category: 'Bounces',
    endpointOrFeature: 'GET /campaigns/{campaign_uid}/bounces',
    defaultStatus: 'NOT_YET_TESTED',
    notes:
      'Returns subscriber-level hard, soft, and internal bounce logs per campaign.',
  },
  {
    capabilityKey: 'subscriber_open_history_api',
    category: 'Historical Subscriber Engagement',
    endpointOrFeature: 'Per-subscriber historical open log endpoint',
    defaultStatus: 'UNAVAILABLE',
    notes:
      'Absent in MailWizz 1.x–3.0.x REST APIs (auto-probed read-only on /campaigns/{uid}/opens for future releases). Tracking pixel triggers (/track-opening) are permanently blocked.',
  },
  {
    capabilityKey: 'subscriber_click_history_api',
    category: 'Historical Subscriber Engagement',
    endpointOrFeature: 'Per-subscriber historical URL click log endpoint',
    defaultStatus: 'UNAVAILABLE',
    notes:
      'Absent in MailWizz 1.x–3.0.x REST APIs (auto-probed read-only on /campaigns/{uid}/clicks for future releases). Tracking URLs (/track-url) are permanently blocked.',
  },
  {
    capabilityKey: 'subscriber_delivery_history_api',
    category: 'Historical Subscriber Engagement',
    endpointOrFeature: 'Per-subscriber historical delivery log endpoint',
    defaultStatus: 'UNAVAILABLE',
    notes:
      'Absent in MailWizz 1.x–3.0.x REST APIs (auto-probed read-only on /campaigns/{uid}/delivery-logs for future releases). Falls back cleanly to Priority B/C/D.',
  },
  {
    capabilityKey: 'subscriber_complaint_log_api',
    category: 'Historical Subscriber Engagement',
    endpointOrFeature: 'Per-subscriber spam complaint log endpoint',
    defaultStatus: 'UNAVAILABLE',
    notes:
      'Aggregate complaints_count is available on GET /campaigns/{uid}/stats, but per-subscriber complaint list is not exposed via public 3.x REST API. Note: Alibaba Cloud DirectMail SMTP does not provide standard ISP FBL headers unless configured separately.',
  },
  {
    capabilityKey: 'verified_campaign_report_import',
    category: 'Workaround Priority B',
    endpointOrFeature: 'POST /api/reports/import (CSV/JSON MailWizz Export)',
    defaultStatus: 'VERIFIED',
    notes:
      'Implemented in application. Accepts verified MailWizz campaign delivery/open/click/complaint reports exported from customer UI.',
  },
  {
    capabilityKey: 'readonly_reporting_db',
    category: 'Workaround Priority C',
    endpointOrFeature: 'Optional MySQL SELECT-only connector (schema-verified)',
    defaultStatus: 'NOT_YET_TESTED',
    notes:
      'Inspects INFORMATION_SCHEMA on installed MailWizz DB (1.x/2.x/3.x/future schemas) before querying delivery/open/click/bounce/complaint tables. Requires SELECT-only credentials.',
  },
  {
    capabilityKey: 'campaign_webhooks_live',
    category: 'Workaround Priority D',
    endpointOrFeature: 'POST /api/webhooks/mailwizz (Future Events Only)',
    defaultStatus: 'VERIFIED',
    notes:
      'Implemented in application for collecting future opens/clicks going forward. Never backdated or represented as historical engagement.',
  },
  {
    capabilityKey: 'phase2_mutations_gate',
    category: 'Safety Gate',
    endpointOrFeature: 'Unsubscribe / Segment creation / Move subscribers',
    defaultStatus: 'UNAVAILABLE',
    notes:
      'Disabled by default via ENABLE_MAILWIZZ_MUTATIONS=false in Phase 1 (read-only mode).',
  },
];

export async function ensureCapabilityMatrixInitialized(): Promise<void> {
  for (const item of MAILWIZZ_CAPABILITY_BASELINE) {
    await prisma.apiCapabilityCheck.upsert({
      where: { capabilityKey: item.capabilityKey },
      update: {},
      create: {
        capabilityKey: item.capabilityKey,
        category: item.category,
        endpointOrFeature: item.endpointOrFeature,
        status: item.defaultStatus,
        notes: item.notes,
      },
    });
  }
}

export async function updateCapabilityStatus(
  capabilityKey: string,
  status: CapabilityStatus,
  notes?: string
): Promise<void> {
  const baseline = MAILWIZZ_CAPABILITY_BASELINE.find(
    (b) => b.capabilityKey === capabilityKey
  );
  await prisma.apiCapabilityCheck.upsert({
    where: { capabilityKey },
    update: {
      status,
      ...(notes ? { notes } : {}),
      checkedAt: new Date(),
    },
    create: {
      capabilityKey,
      category: baseline?.category ?? 'Other',
      endpointOrFeature: baseline?.endpointOrFeature ?? capabilityKey,
      status,
      notes: notes ?? baseline?.notes ?? '',
    },
  });
}
