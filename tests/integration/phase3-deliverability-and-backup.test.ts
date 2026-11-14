import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { requireApiAuth } from '@/lib/api-auth';
import { resetEnvCacheForTests } from '@/lib/env';
import { importAlibabaDirectMailCsv } from '@/services/deliverability/alibaba-directmail';
import {
  recordInboxPlacementTest,
  recordManualPostmasterStat,
  syncGooglePostmasterTrafficStats,
  saveGooglePostmasterConfig,
} from '@/services/deliverability/postmaster';
import { getDeliverabilityDashboardData } from '@/services/deliverability/metrics';
import {
  exportEncryptedAppBackup,
  restoreEncryptedAppBackup,
} from '@/services/security/backup';

const TEST_DOMAIN = 'phase3-int-verify.example.test';
const TEST_BACKUP_PLACEMENT_ID = 'phase3_backup_placement_test';

describe('Integration: Phase 3 Deliverability, API Auth, Failure Handling & Backup Restore', () => {
  beforeAll(async () => {
    await prisma.directMailDailyMetric.deleteMany({
      where: { domainName: TEST_DOMAIN },
    });
    await prisma.inboxPlacementTest.deleteMany({
      where: {
        OR: [{ testDomain: TEST_DOMAIN }, { id: TEST_BACKUP_PLACEMENT_ID }],
      },
    });
    await prisma.postmasterStat.deleteMany({
      where: { domain: TEST_DOMAIN },
    });
  });

  afterAll(async () => {
    await prisma.directMailDailyMetric.deleteMany({
      where: { domainName: TEST_DOMAIN },
    });
    await prisma.inboxPlacementTest.deleteMany({
      where: {
        OR: [{ testDomain: TEST_DOMAIN }, { id: TEST_BACKUP_PLACEMENT_ID }],
      },
    });
    await prisma.postmasterStat.deleteMany({
      where: { domain: TEST_DOMAIN },
    });
    await prisma.appConfig.updateMany({
      where: { id: 'default' },
      data: {
        googlePostmasterDomain: null,
        googlePostmasterTokenEnc: null,
      },
    });
    resetEnvCacheForTests();
  });

  it('imports DirectMail CSV, logs seed placement, handles Postmaster API sync/failures, and keeps sources separated', async () => {
    const csv = [
      'date,domain,requests,delivered,failed,invalid_address,complaints',
      `2026-11-12,${TEST_DOMAIN},1200,1170,30,14,2`,
    ].join('\n');

    const imported = await importAlibabaDirectMailCsv({
      csvContent: csv,
      actorEmail: 'admin@example.com',
    });
    expect(imported.rowsImported).toBe(1);

    const placement = await recordInboxPlacementTest({
      testDomain: TEST_DOMAIN,
      sendingProvider: 'Alibaba Cloud DirectMail (SMTP)',
      recipientProvider: 'GMAIL',
      testedAt: new Date('2026-11-12T12:00:00Z'),
      placement: 'PRIMARY',
      spfPass: true,
      dkimPass: true,
      dmarcPass: true,
      actorEmail: 'admin@example.com',
    });
    expect(placement.placement).toBe('PRIMARY');

    await recordManualPostmasterStat({
      domain: TEST_DOMAIN,
      statDate: new Date('2026-11-12T00:00:00Z'),
      domainReputation: 'HIGH',
      userReportedSpamRatio: 0.0005,
      dkimSuccessRatio: 0.999,
      dmarcSuccessRatio: 0.998,
      spfSuccessRatio: 1,
      actorEmail: 'admin@example.com',
    });

    await saveGooglePostmasterConfig({
      domain: TEST_DOMAIN,
      oauthAccessToken: 'mock-oauth-token-1234567890',
      actorEmail: 'admin@example.com',
    });

    // Mock Google Postmaster API 200 success and 500 failure path
    const synced = await syncGooglePostmasterTrafficStats({
      domain: TEST_DOMAIN,
      daysBack: 7,
      actorEmail: 'admin@example.com',
      fetchImpl: vi.fn(async () =>
        new Response(
          JSON.stringify({
            trafficStats: [
              {
                name: `domains/${TEST_DOMAIN}/trafficStats/20261113`,
                domainReputation: 'HIGH',
                userReportedSpamRatio: 0.0004,
                dkimSuccessRatio: 0.999,
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      ) as unknown as typeof fetch,
    });
    expect(synced.syncedDays).toBe(1);

    await expect(
      syncGooglePostmasterTrafficStats({
        domain: TEST_DOMAIN,
        actorEmail: 'admin@example.com',
        fetchImpl: vi.fn(async () => new Response('Unauthorized', { status: 401 })) as unknown as typeof fetch,
      })
    ).rejects.toThrow(/HTTP 401/);

    const dashboard = await getDeliverabilityDashboardData({ days: 'ALL' });
    expect(
      dashboard.alibabaMetrics.some(
        (m) => m.domainName === TEST_DOMAIN && m.source === 'ALIBABA_CSV_IMPORT'
      )
    ).toBe(true);
    expect(
      dashboard.inboxTests.some(
        (t) => t.testDomain === TEST_DOMAIN && t.placement === 'PRIMARY'
      )
    ).toBe(true);
    expect(
      dashboard.postmasterStats.some(
        (p) => p.domain === TEST_DOMAIN && p.source === 'GOOGLE_POSTMASTER_API'
      )
    ).toBe(true);
    expect(dashboard.kpis.acceptanceCaveat).toContain('NEVER proves recipient inbox');
  });

  it('rejects unauthenticated requests and blocked IPs in requireApiAuth', async () => {
    const unauthReq = new NextRequest('http://localhost:3000/api/deliverability');
    const res401 = await requireApiAuth(unauthReq);
    expect(res401.ok).toBe(false);
    if (!res401.ok) {
      expect(res401.response.status).toBe(401);
    }

    const prevIps = process.env.ALLOWED_ADMIN_IPS;
    process.env.ALLOWED_ADMIN_IPS = '10.0.0.1';
    resetEnvCacheForTests();
    try {
      const blockedIpReq = new NextRequest('http://localhost:3000/api/deliverability', {
        headers: { 'x-forwarded-for': '203.0.113.99' },
      });
      const res403 = await requireApiAuth(blockedIpReq);
      expect(res403.ok).toBe(false);
      if (!res403.ok) {
        expect(res403.response.status).toBe(403);
      }
    } finally {
      process.env.ALLOWED_ADMIN_IPS = prevIps;
      resetEnvCacheForTests();
    }
  });

  it('exports, verifies SHA-256, and restores encrypted application backups', async () => {
    await prisma.inboxPlacementTest.create({
      data: {
        id: TEST_BACKUP_PLACEMENT_ID,
        testDomain: TEST_DOMAIN,
        sendingProvider: 'Alibaba Cloud DirectMail (SMTP)',
        recipientProvider: 'OUTLOOK',
        testedAt: new Date('2026-11-11T10:00:00Z'),
        placement: 'PRIMARY',
        recordedByEmail: 'admin@example.com',
        notes: 'Backup roundtrip verification fixture',
        isDemoData: false,
      },
    });

    const testKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const exported = await exportEncryptedAppBackup({
      actorEmail: 'admin@example.com',
      encryptionKeyOverride: testKey,
    });
    expect(exported.envelope.format).toBe('mailwizz-hygiene-encrypted-v1');
    expect(exported.summary.inboxTestsCount).toBeGreaterThanOrEqual(1);

    // Delete disposable test record, then restore from encrypted bundle
    await prisma.inboxPlacementTest.delete({ where: { id: TEST_BACKUP_PLACEMENT_ID } });
    expect(
      await prisma.inboxPlacementTest.findUnique({ where: { id: TEST_BACKUP_PLACEMENT_ID } })
    ).toBeNull();

    const restored = await restoreEncryptedAppBackup({
      envelope: exported.envelope,
      actorEmail: 'admin@example.com',
      encryptionKeyOverride: testKey,
    });
    expect(restored.restoredConfig).toBe(true);
    expect(restored.inboxTestsRestored).toBeGreaterThanOrEqual(1);

    const foundAfterRestore = await prisma.inboxPlacementTest.findUnique({
      where: { id: TEST_BACKUP_PLACEMENT_ID },
    });
    expect(foundAfterRestore?.notes).toBe('Backup roundtrip verification fixture');
  });
});
