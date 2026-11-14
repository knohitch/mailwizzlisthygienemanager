import { prisma } from '@/lib/db';
import { getEnv } from '@/lib/env';
import { decryptSecret, hashEmail, sha256Hex } from '@/services/security/crypto';
import { logger } from '@/services/security/logger';
import { recomputeAllHygieneClassifications } from '@/services/analysis/classifier';
import { reconcileListsAndCampaigns } from '@/services/analysis/reconciliation';
import { MailWizzClient } from './client';
import type { MailWizzAuthMode } from './compat';
import { mapStrictMailWizzSubscriberStatus } from './adapter-v3';
import { mailWizzCapabilityRegistry } from './capability-registry';
import {
  ensureCapabilityMatrixInitialized,
  updateCapabilityStatus,
} from './capability-matrix';
import { fetchEngagementEventsFromReportingDb } from './reporting-db';
import type { EngagementEventType, Prisma } from '@prisma/client';

function parseMailWizzDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function createConfiguredMailWizzClient(): Promise<{
  client: MailWizzClient;
  batchSize: number;
  lookbackDays: number;
  reportingDbUri: string | null;
  reportingDbPrefix: string;
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
      'MailWizz API URL and API key are not configured yet. Configure them in Settings before syncing.'
    );
  }

  const reportingDbUri = cfg.reportingDbUrlEnc
    ? decryptSecret(cfg.reportingDbUrlEnc)
    : env.MAILWIZZ_REPORTING_DB_URL || null;

  return {
    client: new MailWizzClient({
      apiUrl,
      apiKey,
      authMode: (cfg.mailwizzAuthMode as MailWizzAuthMode) || 'auto',
      maxRequestsPerSecond: cfg.maxApiRequestsPerSecond,
      allowInsecureHttp: env.ALLOW_INSECURE_MAILWIZZ_HTTP,
    }),
    batchSize: cfg.batchSize,
    lookbackDays: cfg.lookbackDays,
    reportingDbUri,
    reportingDbPrefix: cfg.reportingDbPrefix || env.MAILWIZZ_REPORTING_DB_PREFIX,
  };
}

export interface SyncProgressCallback {
  (progress: { current: number; total: number; message: string }): Promise<void> | void;
}

export interface SyncResultSummary {
  listsSynced: number;
  subscribersSynced: number;
  segmentsSynced: number;
  campaignsSynced: number;
  bounceEventsRecorded: number;
  reportingDbEventsRecorded: number;
  classifiedSubscribers: number;
}

export async function runMailWizzSync(options?: {
  onlyListUid?: string;
  onProgress?: SyncProgressCallback;
  client?: MailWizzClient;
}): Promise<SyncResultSummary> {
  await ensureCapabilityMatrixInitialized();

  const { client, batchSize, lookbackDays, reportingDbUri, reportingDbPrefix } = options?.client
    ? {
        client: options.client,
        batchSize: 50,
        lookbackDays: 90,
        reportingDbUri: null,
        reportingDbPrefix: 'mw_',
      }
    : await createConfiguredMailWizzClient();

  const reportProgress = async (current: number, total: number, message: string) => {
    if (options?.onProgress) {
      await options.onProgress({ current, total, message });
    }
  };

  await reportProgress(5, 100, 'Discovering mailing lists from MailWizz API...');

  // 1. Discover lists
  const listsRes = await client.getLists(batchSize);
  await updateCapabilityStatus('auth_x_api_key', 'VERIFIED');
  await updateCapabilityStatus('lists_discovery', 'VERIFIED');
  await updateCapabilityStatus('list_discovery', 'VERIFIED');

  if (client.getDetectedServerVersion()) {
    await prisma.appConfig.update({
      where: { id: 'default' },
      data: { mailwizzDetectedVersion: client.getDetectedServerVersion() },
    });
  }

  const targetLists = options?.onlyListUid
    ? listsRes.records.filter((l) => l.general.list_uid === options.onlyListUid)
    : listsRes.records;

  // Switching from synthetic demo mode to real synced data clears demo flag
  await prisma.appConfig.update({
    where: { id: 'default' },
    data: { isDemoMode: false },
  });

  let listsSynced = 0;
  let subscribersSynced = 0;
  let segmentsSynced = 0;
  let campaignsSynced = 0;
  let bounceEventsRecorded = 0;
  let reportingDbEventsRecorded = 0;
  const unknownStatusesObserved = new Set<string>();

  const listIdByUid = new Map<string, string>();
  const subscriberIdByUid = new Map<string, { id: string; mailingListId: string }>();

  // 2. Sync each list, its subscribers, and its native segments
  for (let idx = 0; idx < targetLists.length; idx++) {
    const mwList = targetLists[idx];
    const listUid = mwList.general.list_uid;
    await reportProgress(
      10 + Math.round(((idx + 0.2) / Math.max(1, targetLists.length)) * 45),
      100,
      `Syncing subscribers for list "${mwList.general.name}"...`
    );

    const subsRes = await client.getSubscribers(listUid, { perPage: batchSize });
    await updateCapabilityStatus('subscribers_paginated', 'VERIFIED');
    await updateCapabilityStatus('subscriber_retrieval', 'VERIFIED');
    await updateCapabilityStatus('subscriber_pagination', 'VERIFIED');

    const dbList = await prisma.mailingList.upsert({
      where: { listUid },
      update: {
        name: mwList.general.name,
        displayName: mwList.general.display_name || null,
        description: mwList.general.description || null,
        fromName: mwList.defaults?.from_name || null,
        fromEmail: mwList.defaults?.from_email || null,
        replyTo: mwList.defaults?.reply_to || null,
        optIn: mwList.general.opt_in || null,
        optOut: mwList.general.opt_out || null,
        apiReportedCount: subsRes.totalReportedCount,
        isDemoData: false,
        lastSyncedAt: new Date(),
      },
      create: {
        listUid,
        name: mwList.general.name,
        displayName: mwList.general.display_name || null,
        description: mwList.general.description || null,
        fromName: mwList.defaults?.from_name || null,
        fromEmail: mwList.defaults?.from_email || null,
        replyTo: mwList.defaults?.reply_to || null,
        optIn: mwList.general.opt_in || null,
        optOut: mwList.general.opt_out || null,
        apiReportedCount: subsRes.totalReportedCount,
        isDemoData: false,
        lastSyncedAt: new Date(),
      },
    });
    listIdByUid.set(listUid, dbList.id);
    listsSynced++;

    for (const sub of subsRes.records) {
      const email = (sub.EMAIL ?? sub.email ?? '').trim().toLowerCase();
      if (!email) continue;

      const { status: mappedStatus, unknownStatusDetected } =
        mapStrictMailWizzSubscriberStatus(sub.status);
      if (unknownStatusDetected && sub.status) {
        unknownStatusesObserved.add(sub.status);
      }
      const savedSub = await prisma.subscriber.upsert({
        where: {
          mailingListId_subscriberUid: {
            mailingListId: dbList.id,
            subscriberUid: sub.subscriber_uid,
          },
        },
        update: {
          email,
          emailHash: hashEmail(email),
          firstName: sub.FNAME ?? null,
          lastName: sub.LNAME ?? null,
          status: mappedStatus,
          rawStatus: sub.status,
          source: sub.source ?? null,
          dateAddedMailwizz: parseMailWizzDate(sub.date_added),
          isDemoData: false,
          lastSyncedAt: new Date(),
        },
        create: {
          mailingListId: dbList.id,
          subscriberUid: sub.subscriber_uid,
          email,
          emailHash: hashEmail(email),
          firstName: sub.FNAME ?? null,
          lastName: sub.LNAME ?? null,
          status: mappedStatus,
          rawStatus: sub.status,
          source: sub.source ?? null,
          dateAddedMailwizz: parseMailWizzDate(sub.date_added),
          isDemoData: false,
          lastSyncedAt: new Date(),
        },
      });
      subscriberIdByUid.set(sub.subscriber_uid, {
        id: savedSub.id,
        mailingListId: dbList.id,
      });
      subscribersSynced++;
    }

    // Native segments discovery
    try {
      const segsRes = await client.getSegments(listUid, batchSize);
      await updateCapabilityStatus('segments_discovery', 'VERIFIED');

      for (const seg of segsRes.records) {
        let operatorMatch: string | null = null;
        let conditions: Prisma.InputJsonValue = [];
        let campaignConditions: Prisma.InputJsonValue = [];
        try {
          const detail = await client.getSegmentDetails(listUid, seg.segment_uid);
          if (detail.data?.record) {
            operatorMatch = detail.data.record.operator_match ?? null;
            conditions = detail.data.record.conditions as Prisma.InputJsonValue;
            campaignConditions =
              detail.data.record.campaign_conditions as Prisma.InputJsonValue;
          }
        } catch (err) {
          logger.warn('Failed fetching segment detail', {
            listUid,
            segmentUid: seg.segment_uid,
            error: err instanceof Error ? err.message : 'unknown',
          });
        }

        const savedSeg = await prisma.listSegment.upsert({
          where: {
            mailingListId_segmentUid: {
              mailingListId: dbList.id,
              segmentUid: seg.segment_uid,
            },
          },
          update: {
            name: seg.name,
            operatorMatch,
            apiSubscribersCount: seg.subscribers_count,
            conditionsJson: conditions,
            campaignConditionsJson: campaignConditions,
            isDemoData: false,
            lastSyncedAt: new Date(),
          },
          create: {
            mailingListId: dbList.id,
            segmentUid: seg.segment_uid,
            name: seg.name,
            operatorMatch,
            apiSubscribersCount: seg.subscribers_count,
            conditionsJson: conditions,
            campaignConditionsJson: campaignConditions,
            isDemoData: false,
            lastSyncedAt: new Date(),
          },
        });
        segmentsSynced++;

        // Sync segment memberships
        try {
          const segSubs = await client.getSegmentSubscribers(
            listUid,
            seg.segment_uid,
            batchSize
          );
          await prisma.segmentMembership.deleteMany({
            where: { segmentId: savedSeg.id },
          });
          for (const segSub of segSubs.records) {
            const subRef = subscriberIdByUid.get(segSub.subscriber_uid);
            if (subRef) {
              await prisma.segmentMembership.create({
                data: {
                  segmentId: savedSeg.id,
                  subscriberId: subRef.id,
                },
              });
            }
          }
        } catch {
          // Non-fatal if a particular segment membership endpoint errors
        }
      }
    } catch (err) {
      logger.warn('Segment sync skipped for list', {
        listUid,
        error: err instanceof Error ? err.message : 'unknown',
      });
    }
  }

  // 3. Sync historical campaigns, aggregate stats, bounce logs, and probe read-only activity logs
  await reportProgress(60, 100, 'Discovering campaigns and aggregate statistics...');
  const campaignsRes = await client.getCampaigns(batchSize);
  await updateCapabilityStatus('campaigns_discovery', 'VERIFIED');

  const activityEndpointSupport: Record<
    'delivery-logs' | 'opens' | 'clicks' | 'complaints',
    boolean | null
  > = {
    'delivery-logs': null,
    opens: null,
    clicks: null,
    complaints: null,
  };

  for (let idx = 0; idx < campaignsRes.records.length; idx++) {
    const campSummary = campaignsRes.records[idx];
    const campDetail = await client.getCampaign(campSummary.campaign_uid);
    const rec = campDetail.data?.record;
    const listUid = rec?.list?.list_uid ?? null;

    if (options?.onlyListUid && listUid !== options.onlyListUid) {
      continue;
    }

    const mailingListId = listUid ? (listIdByUid.get(listUid) ?? null) : null;
    let stats = null;
    try {
      const statsRes = await client.getCampaignStats(campSummary.campaign_uid);
      stats = statsRes.data ?? null;
      await updateCapabilityStatus('campaign_aggregate_stats', 'VERIFIED');
    } catch (err) {
      logger.warn('Failed fetching campaign stats', {
        campaignUid: campSummary.campaign_uid,
        error: err instanceof Error ? err.message : 'unknown',
      });
    }

    const segmentObj =
      rec?.segment && !Array.isArray(rec.segment) ? rec.segment : null;

    const savedCamp = await prisma.campaign.upsert({
      where: { campaignUid: campSummary.campaign_uid },
      update: {
        campaignIdMailwizz: campSummary.campaign_id
          ? String(campSummary.campaign_id)
          : null,
        mailingListId,
        listUid,
        segmentUid: segmentObj?.segment_uid ?? null,
        name: rec?.name ?? campSummary.name,
        subject: rec?.subject ?? null,
        type: rec?.type ?? null,
        status: rec?.status ?? campSummary.status,
        sendAt: parseMailWizzDate(rec?.send_at),
        dateAddedMailwizz: parseMailWizzDate(rec?.date_added),
        ...(stats
          ? {
              subscribersCount: stats.subscribers_count,
              processedCount: stats.processed_count,
              deliverySuccessCount: stats.delivery_success_count,
              deliverySuccessRate: stats.delivery_success_rate,
              deliveryErrorCount: stats.delivery_error_count,
              deliveryErrorRate: stats.delivery_error_rate,
              opensCount: stats.opens_count,
              opensRate: stats.opens_rate,
              uniqueOpensCount: stats.unique_opens_count,
              uniqueOpensRate: stats.unique_opens_rate,
              clicksCount: stats.clicks_count,
              clicksRate: stats.clicks_rate,
              uniqueClicksCount: stats.unique_clicks_count,
              uniqueClicksRate: stats.unique_clicks_rate,
              unsubscribesCount: stats.unsubscribes_count,
              unsubscribesRate: stats.unsubscribes_rate,
              complaintsCount: stats.complaints_count,
              complaintsRate: stats.complaints_rate,
              bouncesCount: stats.bounces_count,
              bouncesRate: stats.bounces_rate,
              hardBouncesCount: stats.hard_bounces_count,
              hardBouncesRate: stats.hard_bounces_rate,
              softBouncesCount: stats.soft_bounces_count,
              softBouncesRate: stats.soft_bounces_rate,
              internalBouncesCount: stats.internal_bounces_count,
              internalBouncesRate: stats.internal_bounces_rate,
            }
          : {}),
        isDemoData: false,
        lastSyncedAt: new Date(),
      },
      create: {
        campaignUid: campSummary.campaign_uid,
        campaignIdMailwizz: campSummary.campaign_id
          ? String(campSummary.campaign_id)
          : null,
        mailingListId,
        listUid,
        segmentUid: segmentObj?.segment_uid ?? null,
        name: rec?.name ?? campSummary.name,
        subject: rec?.subject ?? null,
        type: rec?.type ?? null,
        status: rec?.status ?? campSummary.status,
        sendAt: parseMailWizzDate(rec?.send_at),
        dateAddedMailwizz: parseMailWizzDate(rec?.date_added),
        ...(stats
          ? {
              subscribersCount: stats.subscribers_count,
              processedCount: stats.processed_count,
              deliverySuccessCount: stats.delivery_success_count,
              deliverySuccessRate: stats.delivery_success_rate,
              deliveryErrorCount: stats.delivery_error_count,
              deliveryErrorRate: stats.delivery_error_rate,
              opensCount: stats.opens_count,
              opensRate: stats.opens_rate,
              uniqueOpensCount: stats.unique_opens_count,
              uniqueOpensRate: stats.unique_opens_rate,
              clicksCount: stats.clicks_count,
              clicksRate: stats.clicks_rate,
              uniqueClicksCount: stats.unique_clicks_count,
              uniqueClicksRate: stats.unique_clicks_rate,
              unsubscribesCount: stats.unsubscribes_count,
              unsubscribesRate: stats.unsubscribes_rate,
              complaintsCount: stats.complaints_count,
              complaintsRate: stats.complaints_rate,
              bouncesCount: stats.bounces_count,
              bouncesRate: stats.bounces_rate,
              hardBouncesCount: stats.hard_bounces_count,
              hardBouncesRate: stats.hard_bounces_rate,
              softBouncesCount: stats.soft_bounces_count,
              softBouncesRate: stats.soft_bounces_rate,
              internalBouncesCount: stats.internal_bounces_count,
              internalBouncesRate: stats.internal_bounces_rate,
            }
          : {}),
        isDemoData: false,
        lastSyncedAt: new Date(),
      },
    });
    campaignsSynced++;

    // Sync subscriber-level bounce logs for this campaign
    try {
      const bouncesRes = await client.getCampaignBounces(
        campSummary.campaign_uid,
        batchSize
      );
      await updateCapabilityStatus('campaign_bounce_logs', 'VERIFIED');

      const bounceTime = savedCamp.sendAt ?? new Date();
      for (const b of bouncesRes.records) {
        const subRef = subscriberIdByUid.get(b.subscriber.subscriber_uid);
        if (!subRef) continue;
        if (b.bounce_type === 'unknown') {
          logger.warn('Skipped unrecognized bounce_type without coercing to HARD_BOUNCE', {
            campaignUid: savedCamp.campaignUid,
            subscriberUid: b.subscriber.subscriber_uid,
          });
          continue;
        }
        const eventType =
          b.bounce_type === 'hard'
            ? 'HARD_BOUNCE'
            : b.bounce_type === 'soft'
              ? 'SOFT_BOUNCE'
              : 'INTERNAL_BOUNCE';

        const dedupeKey = sha256Hex(
          `API_BOUNCE_LOG|${savedCamp.campaignUid}|${b.subscriber.subscriber_uid}|${eventType}`
        );

        await prisma.engagementEvent.upsert({
          where: { dedupeKey },
          update: {},
          create: {
            subscriberId: subRef.id,
            campaignId: savedCamp.id,
            mailingListId: subRef.mailingListId,
            eventType,
            source: 'API_BOUNCE_LOG',
            occurredAt: bounceTime,
            isHistorical: true,
            isDemoData: false,
            dedupeKey,
            metadataJson: {
              bounceType: b.bounce_type,
              processed: b.processed,
              message: b.message.slice(0, 250),
            },
          },
        });
        bounceEventsRecorded++;
      }
    } catch (err) {
      logger.warn('Failed fetching campaign bounces', {
        campaignUid: campSummary.campaign_uid,
        error: err instanceof Error ? err.message : 'unknown',
      });
    }

    // Forward-compatible probe for MailWizz 3.1+/4.x native read-only activity endpoints
    const activityProbeDefs: Array<{
      subpath: 'delivery-logs' | 'opens' | 'clicks' | 'complaints';
      eventType: EngagementEventType;
      capKey: string;
    }> = [
      { subpath: 'delivery-logs', eventType: 'DELIVERED', capKey: 'subscriber_delivery_history_api' },
      { subpath: 'opens', eventType: 'OPEN', capKey: 'subscriber_open_history_api' },
      { subpath: 'clicks', eventType: 'CLICK', capKey: 'subscriber_click_history_api' },
      { subpath: 'complaints', eventType: 'COMPLAINT', capKey: 'subscriber_complaint_log_api' },
    ];

    for (const def of activityProbeDefs) {
      if (activityEndpointSupport[def.subpath] === false) continue;
      const probe = await client.tryReadOnlyCampaignActivityEndpoint(
        campSummary.campaign_uid,
        def.subpath,
        batchSize
      );
      if (probe.status === 'VERIFIED') {
        if (activityEndpointSupport[def.subpath] !== true) {
          activityEndpointSupport[def.subpath] = true;
          await updateCapabilityStatus(
            def.capKey,
            'VERIFIED',
            `Natively supported by connected MailWizz API via /campaigns/{uid}/${def.subpath}.`
          );
        }
      } else if (probe.status === 'UNSUPPORTED') {
        // Cache negative result only on definitive 404/405/501 and downgrade any stale VERIFIED status
        activityEndpointSupport[def.subpath] = false;
        await updateCapabilityStatus(
          def.capKey,
          'UNAVAILABLE',
          probe.reason || `Endpoint /campaigns/{uid}/${def.subpath} returned unsupported status.`
        );
        continue;
      } else {
        // Transient timeout/429/schema or 401/403 permission error: do not mark endpoint permanently unsupported
        if (probe.status === 'BLOCKED') {
          await updateCapabilityStatus(
            def.capKey,
            'UNAVAILABLE',
            `Permission denied (${probe.reason ?? 'HTTP 401/403'}) probing /campaigns/{uid}/${def.subpath}.`
          );
        }
        continue;
      }

      for (const act of probe.records) {
        if (def.subpath === 'delivery-logs') {
          const actStatus = (act.status ?? '').trim().toLowerCase();
          if (!['delivered', 'success', 'sent', 'ok'].includes(actStatus)) {
            // Require positive delivery evidence; never count failed/giveup/unknown rows as DELIVERED
            continue;
          }
        }
        const subUid = act.subscriber_uid ?? act.subscriber?.subscriber_uid ?? act.subscriber?.uid;
        if (!subUid) continue;
        const subRef = subscriberIdByUid.get(subUid);
        if (!subRef) continue;
        const occurredAt =
          parseMailWizzDate(act.date_added ?? act.created_at) ?? savedCamp.sendAt ?? new Date();
        const dedupeKey = sha256Hex(
          `API_ACTIVITY_LOG|${savedCamp.campaignUid}|${subUid}|${def.eventType}|${occurredAt.toISOString()}`
        );
        await prisma.engagementEvent.upsert({
          where: { dedupeKey },
          update: {},
          create: {
            subscriberId: subRef.id,
            campaignId: savedCamp.id,
            mailingListId: subRef.mailingListId,
            eventType: def.eventType,
            source: 'API_ACTIVITY_LOG',
            occurredAt,
            isHistorical: true,
            isDemoData: false,
            dedupeKey,
          },
        });
      }
    }
  }

  // 4. Optional Priority C strictly read-only MailWizz Reporting DB
  if (reportingDbUri) {
    await reportProgress(
      80,
      100,
      'Querying strictly read-only MailWizz reporting database...'
    );
    try {
      const dbResult = await fetchEngagementEventsFromReportingDb({
        connectionUri: reportingDbUri,
        prefix: reportingDbPrefix,
        lookbackDays: Math.max(lookbackDays, 365),
      });

      if (dbResult.verification.ok && dbResult.verification.isReadOnlyVerified) {
        await updateCapabilityStatus(
          'readonly_reporting_db',
          'VERIFIED',
          `Verified SELECT-only access with prefix "${reportingDbPrefix}".`
        );
      } else {
        await updateCapabilityStatus(
          'readonly_reporting_db',
          'UNAVAILABLE',
          dbResult.verification.notes.join(' ') || 'Schema verification failed.'
        );
      }

      const allCampaigns = await prisma.campaign.findMany({
        select: { id: true, campaignUid: true },
      });
      const campIdMap = new Map(allCampaigns.map((c) => [c.campaignUid, c.id]));

      for (const ev of dbResult.events) {
        const subRef = subscriberIdByUid.get(ev.subscriberUid);
        if (!subRef) continue;
        const campaignId = campIdMap.get(ev.campaignUid) ?? null;
        const dedupeKey = sha256Hex(
          `READONLY_REPORTING_DB|${ev.campaignUid}|${ev.subscriberUid}|${ev.eventType}|${ev.occurredAt.toISOString()}`
        );
        await prisma.engagementEvent.upsert({
          where: { dedupeKey },
          update: {},
          create: {
            subscriberId: subRef.id,
            campaignId,
            mailingListId: subRef.mailingListId,
            eventType: ev.eventType,
            source: 'READONLY_REPORTING_DB',
            occurredAt: ev.occurredAt,
            isHistorical: true,
            isDemoData: false,
            dedupeKey,
          },
        });
        reportingDbEventsRecorded++;
      }
    } catch (err) {
      await updateCapabilityStatus(
        'readonly_reporting_db',
        'UNAVAILABLE',
        err instanceof Error ? err.message : 'Reporting DB connection error'
      );
      logger.warn('Reporting DB sync failed', {
        error: err instanceof Error ? err.message : 'unknown',
      });
    }
  }

  // Record strict subscriber status compatibility outcome
  if (unknownStatusesObserved.size > 0) {
    const unknownList = Array.from(unknownStatusesObserved).slice(0, 10).join(', ');
    await updateCapabilityStatus(
      'subscriber_status_retrieval',
      'UNAVAILABLE',
      `Detected unrecognized MailWizz subscriber statuses (${unknownList}); safely mapped to UNKNOWN without altering consent interpretation.`
    );
    logger.warn('Unrecognized MailWizz subscriber statuses detected during sync', {
      statuses: unknownList,
    });
  } else if (subscribersSynced > 0) {
    await updateCapabilityStatus('subscriber_status_retrieval', 'VERIFIED');
  }

  // Recompute hygiene classification & reconciliation (existing historical events preserved intact)
  await reportProgress(90, 100, 'Analyzing engagement classifications and reconciling totals...');
  const classification = await recomputeAllHygieneClassifications();
  await reconcileListsAndCampaigns();
  await mailWizzCapabilityRegistry.loadCompatibilityConfig();

  await reportProgress(100, 100, 'Synchronization complete.');

  return {
    listsSynced,
    subscribersSynced,
    segmentsSynced,
    campaignsSynced,
    bounceEventsRecorded,
    reportingDbEventsRecorded,
    classifiedSubscribers: classification.updatedSubscribers,
  };
}
