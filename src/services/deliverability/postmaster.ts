import { prisma } from '@/lib/db';
import { recordAuditLog } from '@/services/security/audit';
import { decryptSecret, encryptSecret } from '@/services/security/crypto';
import type { MailboxProvider, PlacementLocation } from '@prisma/client';

export async function recordInboxPlacementTest(params: {
  testDomain: string;
  sendingProvider: string;
  campaignUid?: string;
  recipientProvider: MailboxProvider;
  customProviderName?: string;
  testedAt: Date;
  placement: PlacementLocation;
  spfPass?: boolean | null;
  dkimPass?: boolean | null;
  dmarcPass?: boolean | null;
  postmasterReputation?: string;
  notes?: string;
  actorEmail: string;
}) {
  const created = await prisma.inboxPlacementTest.create({
    data: {
      testDomain: params.testDomain.trim().toLowerCase(),
      sendingProvider:
        params.sendingProvider.trim() || 'Alibaba Cloud DirectMail (SMTP)',
      campaignUid: params.campaignUid?.trim() || null,
      recipientProvider: params.recipientProvider,
      customProviderName: params.customProviderName?.trim() || null,
      testedAt: params.testedAt,
      placement: params.placement,
      spfPass: params.spfPass ?? null,
      dkimPass: params.dkimPass ?? null,
      dmarcPass: params.dmarcPass ?? null,
      postmasterReputation: params.postmasterReputation?.trim() || null,
      notes: params.notes?.trim() || null,
      recordedByEmail: params.actorEmail,
      isDemoData: false,
    },
  });

  await recordAuditLog({
    actorEmail: params.actorEmail,
    action: 'INBOX_PLACEMENT_TEST_RECORDED',
    resourceType: 'InboxPlacementTest',
    resourceId: created.id,
    outcome: 'SUCCESS',
    details: {
      testDomain: created.testDomain,
      recipientProvider: created.recipientProvider,
      placement: created.placement,
      campaignUid: created.campaignUid,
    },
  });

  return created;
}

export async function recordManualPostmasterStat(params: {
  domain: string;
  statDate: Date;
  domainReputation?: string;
  userReportedSpamRatio?: number | null;
  dkimSuccessRatio?: number | null;
  dmarcSuccessRatio?: number | null;
  spfSuccessRatio?: number | null;
  inboundEncryptionRatio?: number | null;
  notes?: string;
  actorEmail: string;
}) {
  const normalizedDomain = params.domain.trim().toLowerCase();
  const dateOnly = new Date(`${params.statDate.toISOString().slice(0, 10)}T00:00:00Z`);

  const stat = await prisma.postmasterStat.upsert({
    where: {
      domain_statDate_source: {
        domain: normalizedDomain,
        statDate: dateOnly,
        source: 'MANUAL_ENTRY',
      },
    },
    update: {
      domainReputation: params.domainReputation ?? null,
      userReportedSpamRatio: params.userReportedSpamRatio ?? null,
      dkimSuccessRatio: params.dkimSuccessRatio ?? null,
      dmarcSuccessRatio: params.dmarcSuccessRatio ?? null,
      spfSuccessRatio: params.spfSuccessRatio ?? null,
      inboundEncryptionRatio: params.inboundEncryptionRatio ?? null,
      notes: params.notes ?? null,
      isDemoData: false,
    },
    create: {
      domain: normalizedDomain,
      statDate: dateOnly,
      domainReputation: params.domainReputation ?? null,
      userReportedSpamRatio: params.userReportedSpamRatio ?? null,
      dkimSuccessRatio: params.dkimSuccessRatio ?? null,
      dmarcSuccessRatio: params.dmarcSuccessRatio ?? null,
      spfSuccessRatio: params.spfSuccessRatio ?? null,
      inboundEncryptionRatio: params.inboundEncryptionRatio ?? null,
      source: 'MANUAL_ENTRY',
      notes: params.notes ?? null,
      isDemoData: false,
    },
  });

  await recordAuditLog({
    actorEmail: params.actorEmail,
    action: 'POSTMASTER_MANUAL_STAT_SAVED',
    resourceType: 'PostmasterStat',
    resourceId: stat.id,
    outcome: 'SUCCESS',
    details: { domain: normalizedDomain, domainReputation: params.domainReputation },
  });

  return stat;
}

export async function saveGooglePostmasterConfig(params: {
  oauthAccessToken?: string;
  domain?: string;
  actorEmail: string;
}) {
  await prisma.appConfig.upsert({
    where: { id: 'default' },
    update: {
      ...(params.oauthAccessToken?.trim()
        ? { googlePostmasterTokenEnc: encryptSecret(params.oauthAccessToken.trim()) }
        : {}),
      ...(params.domain?.trim()
        ? { googlePostmasterDomain: params.domain.trim().toLowerCase() }
        : {}),
    },
    create: {
      id: 'default',
      ...(params.oauthAccessToken?.trim()
        ? { googlePostmasterTokenEnc: encryptSecret(params.oauthAccessToken.trim()) }
        : {}),
      ...(params.domain?.trim()
        ? { googlePostmasterDomain: params.domain.trim().toLowerCase() }
        : {}),
    },
  });
  await recordAuditLog({
    actorEmail: params.actorEmail,
    action: 'GOOGLE_POSTMASTER_CONFIG_SAVED',
    resourceType: 'AppConfig',
    resourceId: 'default',
    outcome: 'SUCCESS',
    details: { domain: params.domain },
  });
}

export async function syncGooglePostmasterTrafficStats(params: {
  domain?: string;
  daysBack?: number;
  actorEmail: string;
  fetchImpl?: typeof fetch;
}): Promise<{ syncedDays: number }> {
  const cfg = await prisma.appConfig.upsert({
    where: { id: 'default' },
    update: {},
    create: { id: 'default' },
  });

  const targetDomain = (params.domain || cfg.googlePostmasterDomain || '').trim().toLowerCase();
  if (!targetDomain || !cfg.googlePostmasterTokenEnc) {
    throw new Error(
      'Google Postmaster domain and authorized read-only OAuth token (postmaster.readonly) are required.'
    );
  }

  const token = decryptSecret(cfg.googlePostmasterTokenEnc);
  const end = new Date();
  const start = new Date(end.getTime() - (params.daysBack ?? 14) * 86_400_000);

  const qs = new URLSearchParams({
    'startDate.year': String(start.getUTCFullYear()),
    'startDate.month': String(start.getUTCMonth() + 1),
    'startDate.day': String(start.getUTCDate()),
    'endDate.year': String(end.getUTCFullYear()),
    'endDate.month': String(end.getUTCMonth() + 1),
    'endDate.day': String(end.getUTCDate()),
  });

  const url = `https://gmailpostmastertools.googleapis.com/v1/domains/${encodeURIComponent(targetDomain)}/trafficStats?${qs.toString()}`;
  const fetcher = params.fetchImpl ?? fetch;
  const res = await fetcher(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    throw new Error(`Google Postmaster Tools API failed with HTTP ${res.status}`);
  }

  const json = (await res.json()) as {
    trafficStats?: Array<{
      name?: string;
      domainReputation?: string;
      userReportedSpamRatio?: number;
      dkimSuccessRatio?: number;
      dmarcSuccessRatio?: number;
      spfSuccessRatio?: number;
      inboundEncryptionRatio?: number;
    }>;
  };

  let syncedDays = 0;
  for (const row of json.trafficStats ?? []) {
    const datePart = row.name?.split('/').pop();
    if (!datePart || datePart.length !== 8) continue;
    const statDate = new Date(
      `${datePart.slice(0, 4)}-${datePart.slice(4, 6)}-${datePart.slice(6, 8)}T00:00:00Z`
    );
    if (Number.isNaN(statDate.getTime())) continue;

    await prisma.postmasterStat.upsert({
      where: {
        domain_statDate_source: {
          domain: targetDomain,
          statDate,
          source: 'GOOGLE_POSTMASTER_API',
        },
      },
      update: {
        domainReputation: row.domainReputation ?? null,
        userReportedSpamRatio: row.userReportedSpamRatio ?? null,
        dkimSuccessRatio: row.dkimSuccessRatio ?? null,
        dmarcSuccessRatio: row.dmarcSuccessRatio ?? null,
        spfSuccessRatio: row.spfSuccessRatio ?? null,
        inboundEncryptionRatio: row.inboundEncryptionRatio ?? null,
        isDemoData: false,
      },
      create: {
        domain: targetDomain,
        statDate,
        domainReputation: row.domainReputation ?? null,
        userReportedSpamRatio: row.userReportedSpamRatio ?? null,
        dkimSuccessRatio: row.dkimSuccessRatio ?? null,
        dmarcSuccessRatio: row.dmarcSuccessRatio ?? null,
        spfSuccessRatio: row.spfSuccessRatio ?? null,
        inboundEncryptionRatio: row.inboundEncryptionRatio ?? null,
        source: 'GOOGLE_POSTMASTER_API',
        isDemoData: false,
      },
    });
    syncedDays++;
  }

  await recordAuditLog({
    actorEmail: params.actorEmail,
    action: 'GOOGLE_POSTMASTER_SYNCED',
    resourceType: 'PostmasterStat',
    outcome: 'SUCCESS',
    details: { domain: targetDomain, syncedDays },
  });

  return { syncedDays };
}
