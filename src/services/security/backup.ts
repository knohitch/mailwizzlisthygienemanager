import { z } from 'zod';
import { prisma } from '@/lib/db';
import {
  decryptExportBuffer,
  encryptExportBuffer,
  sha256Hex,
  type EncryptedEnvelope,
} from './crypto';
import { recordAuditLog } from './audit';
import type { Prisma } from '@prisma/client';

const BackupAppConfigSchema = z.object({
  mailwizzApiUrl: z.string().nullable(),
  reportingDbPrefix: z.string(),
  alibabaRegion: z.string(),
  googlePostmasterDomain: z.string().nullable(),
  lookbackDays: z.number().int(),
  coolingDays: z.number().int(),
  inactiveDays: z.number().int(),
  longTermInactiveDays: z.number().int(),
  minDeliveredCampaigns: z.number().int(),
  countOpensAsEngaged: z.boolean(),
  countClicksAsEngaged: z.boolean(),
  countRepliesAsEngaged: z.boolean(),
  countConversionsAsEngaged: z.boolean(),
  excludedDomainsJson: z.unknown(),
  excludedSourcesJson: z.unknown(),
  excludeRecentSubscribersDays: z.number().int(),
  largeChangeThreshold: z.number().int(),
  reengagementWindowDays: z.number().int(),
  maxApiRequestsPerSecond: z.number().int(),
  batchSize: z.number().int(),
  syncScheduleCron: z.string(),
  syncScheduleEnabled: z.boolean(),
  timezone: z.string(),
  reportingPeriodDays: z.number().int(),
  dataRetentionDays: z.number().int(),
  isDemoMode: z.boolean(),
});

const BackupBundlePayloadSchema = z.object({
  version: z.literal('mailwizz-hygiene-backup-v1'),
  exportedAt: z.string().datetime(),
  checksumSha256: z.string().length(64),
  data: z.object({
    appConfig: BackupAppConfigSchema.nullable(),
    domainAuthChecks: z.array(
      z.object({
        id: z.string(),
        domain: z.string(),
        fromDomain: z.string().nullable(),
        trackingDomain: z.string().nullable(),
        dkimSelector: z.string().nullable(),
        spfStatus: z.enum(['PASS', 'WARN', 'FAIL', 'UNKNOWN']),
        spfRecord: z.string().nullable(),
        spfDetail: z.string(),
        dkimStatus: z.enum(['PASS', 'WARN', 'FAIL', 'UNKNOWN']),
        dkimRecord: z.string().nullable(),
        dkimDetail: z.string(),
        dmarcStatus: z.enum(['PASS', 'WARN', 'FAIL', 'UNKNOWN']),
        dmarcPolicy: z.string().nullable(),
        dmarcAlignmentOk: z.boolean().nullable(),
        dmarcRecord: z.string().nullable(),
        dmarcDetail: z.string(),
        mxStatus: z.enum(['PASS', 'WARN', 'FAIL', 'UNKNOWN']),
        mxRecordsJson: z.unknown(),
        trackingStatus: z.enum(['PASS', 'WARN', 'FAIL', 'UNKNOWN']),
        trackingDetail: z.string(),
        recommendationsJson: z.unknown(),
        checkedByEmail: z.string(),
        checkedAt: z.string().datetime(),
      })
    ),
    directMailMetrics: z.array(
      z.object({
        metricDate: z.string().datetime(),
        domainName: z.string(),
        source: z.enum(['ALIBABA_API', 'ALIBABA_CSV_IMPORT', 'SYNTHETIC_DEMO']),
        requestsCount: z.number().int(),
        deliveredCount: z.number().int(),
        failedCount: z.number().int(),
        invalidAddressCount: z.number().int(),
        complaintCount: z.number().int().nullable(),
        accountStatus: z.string().nullable(),
        notes: z.string().nullable(),
        isDemoData: z.boolean(),
      })
    ),
    inboxPlacementTests: z.array(
      z.object({
        id: z.string(),
        testDomain: z.string(),
        sendingProvider: z.string(),
        campaignUid: z.string().nullable(),
        recipientProvider: z.enum(['GMAIL', 'OUTLOOK', 'YAHOO', 'OTHER']),
        customProviderName: z.string().nullable(),
        testedAt: z.string().datetime(),
        placement: z.enum(['PRIMARY', 'PROMOTIONS', 'OTHER', 'SPAM', 'MISSING']),
        spfPass: z.boolean().nullable(),
        dkimPass: z.boolean().nullable(),
        dmarcPass: z.boolean().nullable(),
        postmasterReputation: z.string().nullable(),
        notes: z.string().nullable(),
        recordedByEmail: z.string(),
        isDemoData: z.boolean(),
      })
    ),
    postmasterStats: z.array(
      z.object({
        domain: z.string(),
        statDate: z.string().datetime(),
        domainReputation: z.string().nullable(),
        userReportedSpamRatio: z.number().nullable(),
        dkimSuccessRatio: z.number().nullable(),
        dmarcSuccessRatio: z.number().nullable(),
        spfSuccessRatio: z.number().nullable(),
        inboundEncryptionRatio: z.number().nullable(),
        source: z.string(),
        notes: z.string().nullable(),
        isDemoData: z.boolean(),
      })
    ),
  }),
});

export type AppBackupBundle = z.infer<typeof BackupBundlePayloadSchema>;

/**
 * Exports an integrity-checked application backup containing settings (excluding raw API secrets),
 * saved filter presets, and Phase 3 deliverability diagnostic history (no raw subscriber PII).
 */
export async function exportEncryptedAppBackup(params: {
  actorEmail: string;
  encryptionKeyOverride?: string;
}): Promise<{
  envelope: EncryptedEnvelope;
  summary: {
    checksumSha256: string;
    dnsChecksCount: number;
    directMailRowsCount: number;
    inboxTestsCount: number;
    postmasterStatsCount: number;
  };
}> {
  const [
    appConfig,
    domainAuthChecks,
    directMailMetrics,
    inboxPlacementTests,
    postmasterStats,
  ] = await Promise.all([
    prisma.appConfig.findUnique({ where: { id: 'default' } }),
    prisma.domainAuthCheck.findMany({ orderBy: { checkedAt: 'asc' } }),
    prisma.directMailDailyMetric.findMany({ orderBy: { metricDate: 'asc' } }),
    prisma.inboxPlacementTest.findMany({ orderBy: { testedAt: 'asc' } }),
    prisma.postmasterStat.findMany({ orderBy: { statDate: 'asc' } }),
  ]);

  const data: AppBackupBundle['data'] = {
    appConfig: appConfig
      ? {
          mailwizzApiUrl: appConfig.mailwizzApiUrl,
          reportingDbPrefix: appConfig.reportingDbPrefix,
          alibabaRegion: appConfig.alibabaRegion,
          googlePostmasterDomain: appConfig.googlePostmasterDomain,
          lookbackDays: appConfig.lookbackDays,
          coolingDays: appConfig.coolingDays,
          inactiveDays: appConfig.inactiveDays,
          longTermInactiveDays: appConfig.longTermInactiveDays,
          minDeliveredCampaigns: appConfig.minDeliveredCampaigns,
          countOpensAsEngaged: appConfig.countOpensAsEngaged,
          countClicksAsEngaged: appConfig.countClicksAsEngaged,
          countRepliesAsEngaged: appConfig.countRepliesAsEngaged,
          countConversionsAsEngaged: appConfig.countConversionsAsEngaged,
          excludedDomainsJson: appConfig.excludedDomainsJson,
          excludedSourcesJson: appConfig.excludedSourcesJson,
          excludeRecentSubscribersDays: appConfig.excludeRecentSubscribersDays,
          largeChangeThreshold: appConfig.largeChangeThreshold,
          reengagementWindowDays: appConfig.reengagementWindowDays,
          maxApiRequestsPerSecond: appConfig.maxApiRequestsPerSecond,
          batchSize: appConfig.batchSize,
          syncScheduleCron: appConfig.syncScheduleCron,
          syncScheduleEnabled: appConfig.syncScheduleEnabled,
          timezone: appConfig.timezone,
          reportingPeriodDays: appConfig.reportingPeriodDays,
          dataRetentionDays: appConfig.dataRetentionDays,
          isDemoMode: appConfig.isDemoMode,
        }
      : null,
    domainAuthChecks: domainAuthChecks.map((d) => ({
      id: d.id,
      domain: d.domain,
      fromDomain: d.fromDomain,
      trackingDomain: d.trackingDomain,
      dkimSelector: d.dkimSelector,
      spfStatus: d.spfStatus,
      spfRecord: d.spfRecord,
      spfDetail: d.spfDetail,
      dkimStatus: d.dkimStatus,
      dkimRecord: d.dkimRecord,
      dkimDetail: d.dkimDetail,
      dmarcStatus: d.dmarcStatus,
      dmarcPolicy: d.dmarcPolicy,
      dmarcAlignmentOk: d.dmarcAlignmentOk,
      dmarcRecord: d.dmarcRecord,
      dmarcDetail: d.dmarcDetail,
      mxStatus: d.mxStatus,
      mxRecordsJson: d.mxRecordsJson,
      trackingStatus: d.trackingStatus,
      trackingDetail: d.trackingDetail,
      recommendationsJson: d.recommendationsJson,
      checkedByEmail: d.checkedByEmail,
      checkedAt: d.checkedAt.toISOString(),
    })),
    directMailMetrics: directMailMetrics.map((m) => ({
      metricDate: m.metricDate.toISOString(),
      domainName: m.domainName,
      source: m.source,
      requestsCount: m.requestsCount,
      deliveredCount: m.deliveredCount,
      failedCount: m.failedCount,
      invalidAddressCount: m.invalidAddressCount,
      complaintCount: m.complaintCount,
      accountStatus: m.accountStatus,
      notes: m.notes,
      isDemoData: m.isDemoData,
    })),
    inboxPlacementTests: inboxPlacementTests.map((t) => ({
      id: t.id,
      testDomain: t.testDomain,
      sendingProvider: t.sendingProvider,
      campaignUid: t.campaignUid,
      recipientProvider: t.recipientProvider,
      customProviderName: t.customProviderName,
      testedAt: t.testedAt.toISOString(),
      placement: t.placement,
      spfPass: t.spfPass,
      dkimPass: t.dkimPass,
      dmarcPass: t.dmarcPass,
      postmasterReputation: t.postmasterReputation,
      notes: t.notes,
      recordedByEmail: t.recordedByEmail,
      isDemoData: t.isDemoData,
    })),
    postmasterStats: postmasterStats.map((s) => ({
      domain: s.domain,
      statDate: s.statDate.toISOString(),
      domainReputation: s.domainReputation,
      userReportedSpamRatio: s.userReportedSpamRatio,
      dkimSuccessRatio: s.dkimSuccessRatio,
      dmarcSuccessRatio: s.dmarcSuccessRatio,
      spfSuccessRatio: s.spfSuccessRatio,
      inboundEncryptionRatio: s.inboundEncryptionRatio,
      source: s.source,
      notes: s.notes,
      isDemoData: s.isDemoData,
    })),
  };

  const checksumSha256 = sha256Hex(JSON.stringify(data));
  const payload: AppBackupBundle = {
    version: 'mailwizz-hygiene-backup-v1',
    exportedAt: new Date().toISOString(),
    checksumSha256,
    data,
  };

  const envelope = encryptExportBuffer(
    Buffer.from(JSON.stringify(payload), 'utf8'),
    params.encryptionKeyOverride
  );

  await recordAuditLog({
    actorEmail: params.actorEmail,
    action: 'APP_BACKUP_EXPORTED',
    resourceType: 'AppBackup',
    outcome: 'SUCCESS',
    details: { checksumSha256 },
  });

  return {
    envelope,
    summary: {
      checksumSha256,
      dnsChecksCount: data.domainAuthChecks.length,
      directMailRowsCount: data.directMailMetrics.length,
      inboxTestsCount: data.inboxPlacementTests.length,
      postmasterStatsCount: data.postmasterStats.length,
    },
  };
}

/**
 * Decrypts, verifies SHA-256 integrity, and restores an application backup transactionally.
 */
export async function restoreEncryptedAppBackup(params: {
  envelope: EncryptedEnvelope;
  actorEmail: string;
  encryptionKeyOverride?: string;
}): Promise<{
  restoredConfig: boolean;
  dnsChecksRestored: number;
  directMailRowsRestored: number;
  inboxTestsRestored: number;
  postmasterStatsRestored: number;
}> {
  const buf = decryptExportBuffer(params.envelope, params.encryptionKeyOverride);
  const parsed = BackupBundlePayloadSchema.parse(JSON.parse(buf.toString('utf8')));

  const actualChecksum = sha256Hex(JSON.stringify(parsed.data));
  if (actualChecksum !== parsed.checksumSha256) {
    throw new Error('Backup integrity check failed: SHA-256 mismatch.');
  }

  const { data } = parsed;

  await prisma.$transaction(async (tx) => {
    if (data.appConfig) {
      const cfg = data.appConfig;
      await tx.appConfig.upsert({
        where: { id: 'default' },
        update: {
          mailwizzApiUrl: cfg.mailwizzApiUrl,
          reportingDbPrefix: cfg.reportingDbPrefix,
          alibabaRegion: cfg.alibabaRegion,
          googlePostmasterDomain: cfg.googlePostmasterDomain,
          lookbackDays: cfg.lookbackDays,
          coolingDays: cfg.coolingDays,
          inactiveDays: cfg.inactiveDays,
          longTermInactiveDays: cfg.longTermInactiveDays,
          minDeliveredCampaigns: cfg.minDeliveredCampaigns,
          countOpensAsEngaged: cfg.countOpensAsEngaged,
          countClicksAsEngaged: cfg.countClicksAsEngaged,
          countRepliesAsEngaged: cfg.countRepliesAsEngaged,
          countConversionsAsEngaged: cfg.countConversionsAsEngaged,
          excludedDomainsJson: cfg.excludedDomainsJson as Prisma.InputJsonValue,
          excludedSourcesJson: cfg.excludedSourcesJson as Prisma.InputJsonValue,
          excludeRecentSubscribersDays: cfg.excludeRecentSubscribersDays,
          largeChangeThreshold: cfg.largeChangeThreshold,
          reengagementWindowDays: cfg.reengagementWindowDays,
          maxApiRequestsPerSecond: cfg.maxApiRequestsPerSecond,
          batchSize: cfg.batchSize,
          syncScheduleCron: cfg.syncScheduleCron,
          syncScheduleEnabled: cfg.syncScheduleEnabled,
          timezone: cfg.timezone,
          reportingPeriodDays: cfg.reportingPeriodDays,
          dataRetentionDays: cfg.dataRetentionDays,
          isDemoMode: cfg.isDemoMode,
        },
        create: {
          id: 'default',
          mailwizzApiUrl: cfg.mailwizzApiUrl,
          reportingDbPrefix: cfg.reportingDbPrefix,
          alibabaRegion: cfg.alibabaRegion,
          googlePostmasterDomain: cfg.googlePostmasterDomain,
          lookbackDays: cfg.lookbackDays,
          coolingDays: cfg.coolingDays,
          inactiveDays: cfg.inactiveDays,
          longTermInactiveDays: cfg.longTermInactiveDays,
          minDeliveredCampaigns: cfg.minDeliveredCampaigns,
          countOpensAsEngaged: cfg.countOpensAsEngaged,
          countClicksAsEngaged: cfg.countClicksAsEngaged,
          countRepliesAsEngaged: cfg.countRepliesAsEngaged,
          countConversionsAsEngaged: cfg.countConversionsAsEngaged,
          excludedDomainsJson: cfg.excludedDomainsJson as Prisma.InputJsonValue,
          excludedSourcesJson: cfg.excludedSourcesJson as Prisma.InputJsonValue,
          excludeRecentSubscribersDays: cfg.excludeRecentSubscribersDays,
          largeChangeThreshold: cfg.largeChangeThreshold,
          reengagementWindowDays: cfg.reengagementWindowDays,
          maxApiRequestsPerSecond: cfg.maxApiRequestsPerSecond,
          batchSize: cfg.batchSize,
          syncScheduleCron: cfg.syncScheduleCron,
          syncScheduleEnabled: cfg.syncScheduleEnabled,
          timezone: cfg.timezone,
          reportingPeriodDays: cfg.reportingPeriodDays,
          dataRetentionDays: cfg.dataRetentionDays,
          isDemoMode: cfg.isDemoMode,
        },
      });
    }

    for (const d of data.domainAuthChecks) {
      await tx.domainAuthCheck.upsert({
        where: { id: d.id },
        update: {},
        create: {
          id: d.id,
          domain: d.domain,
          fromDomain: d.fromDomain,
          trackingDomain: d.trackingDomain,
          dkimSelector: d.dkimSelector,
          spfStatus: d.spfStatus,
          spfRecord: d.spfRecord,
          spfDetail: d.spfDetail,
          dkimStatus: d.dkimStatus,
          dkimRecord: d.dkimRecord,
          dkimDetail: d.dkimDetail,
          dmarcStatus: d.dmarcStatus,
          dmarcPolicy: d.dmarcPolicy,
          dmarcAlignmentOk: d.dmarcAlignmentOk,
          dmarcRecord: d.dmarcRecord,
          dmarcDetail: d.dmarcDetail,
          mxStatus: d.mxStatus,
          mxRecordsJson: d.mxRecordsJson as Prisma.InputJsonValue,
          trackingStatus: d.trackingStatus,
          trackingDetail: d.trackingDetail,
          recommendationsJson: d.recommendationsJson as Prisma.InputJsonValue,
          checkedByEmail: d.checkedByEmail,
          checkedAt: new Date(d.checkedAt),
        },
      });
    }

    for (const m of data.directMailMetrics) {
      const metricDate = new Date(m.metricDate);
      await tx.directMailDailyMetric.upsert({
        where: {
          metricDate_domainName_source: {
            metricDate,
            domainName: m.domainName,
            source: m.source,
          },
        },
        update: {
          requestsCount: m.requestsCount,
          deliveredCount: m.deliveredCount,
          failedCount: m.failedCount,
          invalidAddressCount: m.invalidAddressCount,
          complaintCount: m.complaintCount,
          accountStatus: m.accountStatus,
          notes: m.notes,
          isDemoData: m.isDemoData,
        },
        create: {
          metricDate,
          domainName: m.domainName,
          source: m.source,
          requestsCount: m.requestsCount,
          deliveredCount: m.deliveredCount,
          failedCount: m.failedCount,
          invalidAddressCount: m.invalidAddressCount,
          complaintCount: m.complaintCount,
          accountStatus: m.accountStatus,
          notes: m.notes,
          isDemoData: m.isDemoData,
        },
      });
    }

    for (const t of data.inboxPlacementTests) {
      await tx.inboxPlacementTest.upsert({
        where: { id: t.id },
        update: {},
        create: {
          id: t.id,
          testDomain: t.testDomain,
          sendingProvider: t.sendingProvider,
          campaignUid: t.campaignUid,
          recipientProvider: t.recipientProvider,
          customProviderName: t.customProviderName,
          testedAt: new Date(t.testedAt),
          placement: t.placement,
          spfPass: t.spfPass,
          dkimPass: t.dkimPass,
          dmarcPass: t.dmarcPass,
          postmasterReputation: t.postmasterReputation,
          notes: t.notes,
          recordedByEmail: t.recordedByEmail,
          isDemoData: t.isDemoData,
        },
      });
    }

    for (const s of data.postmasterStats) {
      const statDate = new Date(s.statDate);
      await tx.postmasterStat.upsert({
        where: {
          domain_statDate_source: {
            domain: s.domain,
            statDate,
            source: s.source,
          },
        },
        update: {
          domainReputation: s.domainReputation,
          userReportedSpamRatio: s.userReportedSpamRatio,
          dkimSuccessRatio: s.dkimSuccessRatio,
          dmarcSuccessRatio: s.dmarcSuccessRatio,
          spfSuccessRatio: s.spfSuccessRatio,
          inboundEncryptionRatio: s.inboundEncryptionRatio,
          notes: s.notes,
          isDemoData: s.isDemoData,
        },
        create: {
          domain: s.domain,
          statDate,
          domainReputation: s.domainReputation,
          userReportedSpamRatio: s.userReportedSpamRatio,
          dkimSuccessRatio: s.dkimSuccessRatio,
          dmarcSuccessRatio: s.dmarcSuccessRatio,
          spfSuccessRatio: s.spfSuccessRatio,
          inboundEncryptionRatio: s.inboundEncryptionRatio,
          source: s.source,
          notes: s.notes,
          isDemoData: s.isDemoData,
        },
      });
    }
  });

  await recordAuditLog({
    actorEmail: params.actorEmail,
    action: 'APP_BACKUP_RESTORED',
    resourceType: 'AppBackup',
    outcome: 'SUCCESS',
    details: { checksumSha256: parsed.checksumSha256 },
  });

  return {
    restoredConfig: Boolean(data.appConfig),
    dnsChecksRestored: data.domainAuthChecks.length,
    directMailRowsRestored: data.directMailMetrics.length,
    inboxTestsRestored: data.inboxPlacementTests.length,
    postmasterStatsRestored: data.postmasterStats.length,
  };
}
