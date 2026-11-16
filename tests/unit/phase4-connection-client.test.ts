import { afterEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { resetEnvCacheForTests } from '@/lib/env';
import { encryptSecret } from '@/services/security/crypto';
import { sanitizeForLog } from '@/services/security/logger';
import {
  computeApiKeyFingerprint,
  maskApiKey,
  normalizeAuthMode,
  normalizeSlug,
  redactErrorMessage,
  validateAndNormalizeConnectionUrl,
} from '@/services/mailwizz/connections';
import {
  clearConnectionRateLimitersForTests,
  getMailWizzClientWithContext,
} from '@/services/mailwizz/client-factory';

describe('Unit: Phase 4 Customer Connection Security, Validation & Client Factory', () => {
  const prevInsecure = process.env.ALLOW_INSECURE_MAILWIZZ_HTTP;
  const prevNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    vi.restoreAllMocks();
    clearConnectionRateLimitersForTests();
    process.env.ALLOW_INSECURE_MAILWIZZ_HTTP = prevInsecure;
    (process.env as Record<string, string | undefined>).NODE_ENV = prevNodeEnv;
    resetEnvCacheForTests();
  });

  it('validates HTTPS MailWizz URLs, rejects SSRF/metadata/private IPs, and blocks insecure HTTP on public hosts', () => {
    const ok = validateAndNormalizeConnectionUrl('https://app.nohitchweb.com/');
    expect(ok.baseUrl).toBe('https://app.nohitchweb.com');
    expect(ok.hostname).toBe('app.nohitchweb.com');

    const withPath = validateAndNormalizeConnectionUrl('https://mw.customer.com/api/index.php/');
    expect(withPath.baseUrl).toBe('https://mw.customer.com/api/index.php');

    expect(() => validateAndNormalizeConnectionUrl('not-a-url')).toThrow(/Invalid MailWizz API URL/i);
    expect(() =>
      validateAndNormalizeConnectionUrl('https://169.254.169.254/latest/meta-data')
    ).toThrow(/internal\/metadata IP/i);
    expect(() =>
      validateAndNormalizeConnectionUrl('https://metadata.google.internal/computeMetadata/v1')
    ).toThrow(/internal\/metadata IP/i);
    expect(() =>
      validateAndNormalizeConnectionUrl('https://mailwizz.corp.internal/api/index.php')
    ).toThrow(/internal\/metadata IP/i);
    expect(() => validateAndNormalizeConnectionUrl('https://10.0.1.25/api/index.php')).toThrow(
      /internal\/metadata IP/i
    );
    expect(() => validateAndNormalizeConnectionUrl('https://192.168.1.10/api/index.php')).toThrow(
      /internal\/metadata IP/i
    );
    expect(() => validateAndNormalizeConnectionUrl('https://172.16.0.8/api/index.php')).toThrow(
      /internal\/metadata IP/i
    );

    process.env.ALLOW_INSECURE_MAILWIZZ_HTTP = 'false';
    resetEnvCacheForTests();
    expect(() =>
      validateAndNormalizeConnectionUrl('http://public.mailwizz.example/api/index.php')
    ).toThrow(/TLS|HTTPS/i);
  });

  it('masks API keys safely, computes deterministic non-reversible fingerprints, and redacts secrets in logs/errors', () => {
    const sampleSecret = 'mw_unit_synthetic_token_xyz9876';
    expect(maskApiKey(sampleSecret)).toBe('****9876');
    expect(maskApiKey('9876')).toBe('****9876');
    expect(maskApiKey(null)).toBeNull();
    expect(maskApiKey('')).toBeNull();

    const fp = computeApiKeyFingerprint(sampleSecret);
    expect(fp).toHaveLength(64);
    expect(fp).toBe(computeApiKeyFingerprint(`  ${sampleSecret}  `));
    expect(fp).not.toContain(sampleSecret);

    const errSafe = redactErrorMessage(
      new Error(`HTTP 401 X-Api-Key=${sampleSecret} Bearer=${sampleSecret}`)
    );
    expect(errSafe).not.toContain(sampleSecret);

    const logSafe = sanitizeForLog({
      customerConnectionId: 'conn-1',
      apiKey: sampleSecret,
      newApiKey: sampleSecret,
      webhookSecret: 'hook-secret-abc',
      x_api_key: sampleSecret,
      nested: { x_mw_signature: 'sig-123' },
    }) as Record<string, unknown>;
    expect(logSafe.apiKey).toBe('[REDACTED_SECRET]');
    expect(logSafe.newApiKey).toBe('[REDACTED_SECRET]');
    expect(logSafe.webhookSecret).toBe('[REDACTED_SECRET]');
    expect(logSafe.x_api_key).toBe('[REDACTED_SECRET]');
    expect((logSafe.nested as Record<string, unknown>).x_mw_signature).toBe('[REDACTED_SECRET]');
    expect(JSON.stringify(logSafe)).not.toContain(sampleSecret);
  });

  it('normalizes canonical and legacy auth modes cleanly and sanitizes customer slugs', () => {
    expect(normalizeAuthMode('auto')).toBe('auto');
    expect(normalizeAuthMode('x-api-key')).toBe('x-api-key');
    expect(normalizeAuthMode('x_api_key_only')).toBe('x-api-key');
    expect(normalizeAuthMode('legacy-hmac')).toBe('legacy-hmac');
    expect(normalizeAuthMode('legacy_hmac')).toBe('legacy-hmac');
    expect(normalizeAuthMode('bearer')).toBe('bearer');
    expect(normalizeAuthMode('unknown-mode')).toBe('auto');
    expect(normalizeAuthMode(undefined)).toBe('auto');

    expect(normalizeSlug('  Acme Corp (EU) #1  ')).toBe('acme-corp-eu-1');
  });

  it('fails closed in getMailWizzClientWithContext when connection is disabled, quarantined, paused, missing active credential, or rotated', async () => {
    const baseRecord = {
      id: 'conn-unit-1',
      installationId: 'inst-unit-1',
      customerName: 'Unit Customer',
      customerSlug: 'unit-customer',
      authMode: 'x-api-key',
      isEnabled: true,
      isQuarantine: false,
      status: 'CONNECTED',
      maxRequestsPerSecond: 10,
      installation: {
        id: 'inst-unit-1',
        name: 'Unit Install',
        baseUrl: 'https://unit.mailwizz.example/api/index.php',
        hostname: 'unit.mailwizz.example',
        maxRequestsPerSecond: 20,
        isActive: true,
      },
      syncState: { isPaused: false, pauseReason: null },
      credentials: [
        {
          id: 'cred-v2',
          version: 2,
          apiKeyEnc: encryptSecret('unit-key-v2-secret-value'),
          apiKeyLast4: 'alue',
          isActive: true,
          status: 'ACTIVE',
        },
      ],
    };

    // 1. Quarantined connection rejected
    vi.spyOn(prisma.mailWizzCustomerConnection, 'findUnique').mockResolvedValueOnce({
      ...baseRecord,
      isQuarantine: true,
      status: 'LEGACY_QUARANTINE',
    } as never);
    await expect(getMailWizzClientWithContext('conn-unit-1')).rejects.toThrow(/quarantined/i);

    // 2. Disabled connection rejected
    vi.spyOn(prisma.mailWizzCustomerConnection, 'findUnique').mockResolvedValueOnce({
      ...baseRecord,
      isEnabled: false,
      status: 'DISABLED',
    } as never);
    await expect(getMailWizzClientWithContext('conn-unit-1')).rejects.toThrow(/disabled/i);

    // 3. Missing active credential rejected
    vi.spyOn(prisma.mailWizzCustomerConnection, 'findUnique').mockResolvedValueOnce({
      ...baseRecord,
      credentials: [],
    } as never);
    await expect(getMailWizzClientWithContext('conn-unit-1')).rejects.toThrow(
      /no active API credential/i
    );

    // 4. Stale expectedCredentialVersion rejected after rotation
    vi.spyOn(prisma.mailWizzCustomerConnection, 'findUnique').mockResolvedValueOnce(
      baseRecord as never
    );
    await expect(
      getMailWizzClientWithContext('conn-unit-1', { expectedCredentialVersion: 1 })
    ).rejects.toThrow(/Credential version mismatch|rotated/i);

    // 5. Inactive installation rejected
    vi.spyOn(prisma.mailWizzCustomerConnection, 'findUnique').mockResolvedValueOnce({
      ...baseRecord,
      installation: { ...baseRecord.installation, isActive: false },
    } as never);
    await expect(getMailWizzClientWithContext('conn-unit-1')).rejects.toThrow(/disabled/i);

    // 6. Active valid credential resolves context & injects per-connection API key cleanly
    const mockFetch = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          status: 'success',
          data: { count: 0, total_pages: 1, current_page: 1, next_page: null, records: [] },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    vi.spyOn(prisma.mailWizzCustomerConnection, 'findUnique').mockResolvedValueOnce(
      baseRecord as never
    );
    const ctx = await getMailWizzClientWithContext('conn-unit-1', {
      expectedCredentialVersion: 2,
      fetchImpl: mockFetch,
    });
    expect(ctx.connectionId).toBe('conn-unit-1');
    expect(ctx.credentialVersion).toBe(2);
    expect(ctx.apiKeyLast4).toBe('alue');
    await ctx.client.getLists();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const reqInit = mockFetch.mock.calls[0]?.[1] as RequestInit | undefined;
    const headers = new Headers(reqInit?.headers);
    expect(headers.get('X-Api-Key')).toBe('unit-key-v2-secret-value');
  });
});
