import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  analyzeDomainDns,
  type DnsResolverAdapter,
} from '@/services/deliverability/dns-checker';
import {
  AlibabaDirectMailReadOnlyClient,
  signAlibabaRpcRequest,
} from '@/services/deliverability/alibaba-directmail';
import { isIpAllowedByEnv } from '@/services/security/ip-allowlist';
import { resetEnvCacheForTests } from '@/lib/env';

function createMockResolver(records: {
  txt?: Record<string, string[][]>;
  mx?: Record<string, Array<{ exchange: string; priority: number }>>;
  cname?: Record<string, string[]>;
  a?: Record<string, string[]>;
}): DnsResolverAdapter {
  return {
    resolveTxt: async (h) => {
      const r = records.txt?.[h];
      if (!r) throw new Error(`ENOTFOUND ${h}`);
      return r;
    },
    resolveMx: async (h) => {
      const r = records.mx?.[h];
      if (!r) throw new Error(`ENOTFOUND ${h}`);
      return r;
    },
    resolveCname: async (h) => {
      const r = records.cname?.[h];
      if (!r) throw new Error(`ENODATA ${h}`);
      return r;
    },
    resolve4: async (h) => {
      const r = records.a?.[h];
      if (!r) throw new Error(`ENOTFOUND ${h}`);
      return r;
    },
  };
}

describe('Phase 3 Unit: Domain Auth DNS Diagnostics', () => {
  it('verifies SPF, explicit DKIM selector, DMARC alignment, MX, and tracking domain', async () => {
    const resolver = createMockResolver({
      txt: {
        'mail.acme.test': [['v=spf1 include:spf.dm.aliyun.com ~all']],
        'aliyun._domainkey.acme.test': [
          ['v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC'],
        ],
        '_dmarc.acme.test': [
          ['v=DMARC1; p=quarantine; adkim=r; aspf=r; rua=mailto:dmarc@acme.test'],
        ],
      },
      mx: {
        'acme.test': [{ exchange: 'mx.acme.test', priority: 10 }],
      },
      cname: {
        'track.acme.test': ['tr.mailwizz-host.example'],
      },
    });

    const result = await analyzeDomainDns({
      domain: 'mail.acme.test',
      fromDomain: 'acme.test',
      trackingDomain: 'track.acme.test',
      dkimSelector: 'aliyun',
      actorEmail: 'admin@example.com',
      resolver,
    });

    expect(result.spfStatus).toBe('PASS');
    expect(result.dkimStatus).toBe('PASS');
    expect(result.dmarcStatus).toBe('PASS');
    expect(result.dmarcAlignmentOk).toBe(true);
    expect(result.mxStatus).toBe('PASS');
    expect(result.trackingStatus).toBe('PASS');
  });

  it('never guesses unknown DKIM selectors and returns UNKNOWN when selector omitted', async () => {
    const resolver = createMockResolver({
      txt: {
        'acme.test': [['v=spf1 -all']],
        '_dmarc.acme.test': [['v=DMARC1; p=none;']],
      },
      mx: {
        'acme.test': [{ exchange: 'mx.acme.test', priority: 10 }],
      },
    });

    const result = await analyzeDomainDns({
      domain: 'acme.test',
      actorEmail: 'admin@example.com',
      resolver,
    });

    expect(result.dkimStatus).toBe('UNKNOWN');
    expect(result.dkimDetail.toLowerCase()).toContain('never guessed');
    expect(result.dmarcStatus).toBe('WARN'); // p=none
  });

  it('detects strict DMARC misalignment across unrelated sending and From domains', async () => {
    const resolver = createMockResolver({
      txt: {
        'bounce.vendor-esp.net': [['v=spf1 include:_spf.vendor-esp.net -all']],
        '_dmarc.brand.com': [['v=DMARC1; p=reject; adkim=s; aspf=s;']],
      },
    });

    const result = await analyzeDomainDns({
      domain: 'bounce.vendor-esp.net',
      fromDomain: 'brand.com',
      actorEmail: 'admin@example.com',
      resolver,
    });

    expect(result.dmarcAlignmentOk).toBe(false);
    expect(result.dmarcStatus).toBe('FAIL');
  });
});

describe('Phase 3 Unit: Alibaba Cloud DirectMail Read-Only Client & Guardrails', () => {
  it('blocks write/send/credential Alibaba DirectMail actions unconditionally', () => {
    for (const blockedAction of [
      'SingleSendMail',
      'BatchSendMail',
      'ModifyMailAddress',
      'CreateDomain',
      'DeleteDomain',
      'UpdateSmtpPassword',
    ]) {
      expect(() =>
        signAlibabaRpcRequest({
          action: blockedAction,
          accessKeyId: 'test-key-id',
          accessKeySecret: 'test-key-secret',
        })
      ).toThrow(/Security violation/);
    }
  });

  it('signs allowed read-only DirectMail RPC requests and handles API failures safely', async () => {
    const signed = signAlibabaRpcRequest({
      action: 'DescAccountSummary',
      accessKeyId: 'LTAI_TEST_ID',
      accessKeySecret: 'TEST_SECRET',
      timestampIso: '2026-11-10T00:00:00Z',
      nonce: 'nonce123',
    });

    expect(signed.queryString).toContain('Action=DescAccountSummary');
    expect(signed.queryString).toContain('SignatureMethod=HMAC-SHA1');
    expect(signed.signature.length).toBeGreaterThan(10);

    const mockFetch = vi.fn(async () =>
      new Response(JSON.stringify({ QuotaLevel: 3, DailyQuota: 50000 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    ) as unknown as typeof fetch;

    const client = new AlibabaDirectMailReadOnlyClient({
      accessKeyId: 'LTAI_TEST_ID',
      accessKeySecret: 'TEST_SECRET',
      region: 'ap-southeast-1',
      fetchImpl: mockFetch,
    });

    const summary = await client.callReadOnly<{ DailyQuota?: number }>('DescAccountSummary');
    expect(summary.DailyQuota).toBe(50000);

    const failingClient = new AlibabaDirectMailReadOnlyClient({
      accessKeyId: 'LTAI_TEST_ID',
      accessKeySecret: 'TEST_SECRET',
      fetchImpl: vi.fn(async () =>
        new Response(JSON.stringify({ Message: 'InvalidAccessKeyId' }), { status: 403 })
      ) as unknown as typeof fetch,
    });

    await expect(failingClient.callReadOnly('DescAccountSummary')).rejects.toThrow(/InvalidAccessKeyId|HTTP 403/);
  });
});

describe('Phase 3 Unit: Optional Admin IP/CIDR Access Restriction', () => {
  const originalIps = process.env.ALLOWED_ADMIN_IPS;
  const originalCidrs = process.env.ALLOWED_ADMIN_CIDRS;

  afterEach(() => {
    process.env.ALLOWED_ADMIN_IPS = originalIps;
    process.env.ALLOWED_ADMIN_CIDRS = originalCidrs;
    resetEnvCacheForTests();
  });

  it('allows all IPs when no allowlist is configured, and enforces IP/CIDR when configured', () => {
    delete process.env.ALLOWED_ADMIN_IPS;
    delete process.env.ALLOWED_ADMIN_CIDRS;
    resetEnvCacheForTests();

    expect(isIpAllowedByEnv('203.0.113.50')).toEqual({
      allowed: true,
      configured: false,
      normalizedIp: '203.0.113.50',
    });

    process.env.ALLOWED_ADMIN_IPS = '127.0.0.1';
    process.env.ALLOWED_ADMIN_CIDRS = '10.8.0.0/24';
    resetEnvCacheForTests();

    expect(isIpAllowedByEnv('::ffff:127.0.0.1').allowed).toBe(true);
    expect(isIpAllowedByEnv('10.8.0.42').allowed).toBe(true);
    expect(isIpAllowedByEnv('198.51.100.9').allowed).toBe(false);
    expect(isIpAllowedByEnv('invalid-ip').allowed).toBe(false);
  });
});
