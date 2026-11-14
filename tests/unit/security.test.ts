import { describe, expect, it } from 'vitest';
import {
  decryptExportBuffer,
  decryptSecret,
  encryptExportBuffer,
  encryptSecret,
  hashPassword,
  maskSecretLast4,
  verifyPassword,
} from '@/services/security/crypto';
import { sanitizeForLog } from '@/services/security/logger';
import { deriveCsrfToken, verifyCsrfToken } from '@/services/security/csrf';
import { checkRateLimit, clearRateLimitsForTests } from '@/services/security/rate-limit';
import { assertReadOnlySqlStatement } from '@/services/mailwizz/reporting-db';
import {
  mailWizzMutationService,
  MutationGateLockedError,
} from '@/services/mutations/gate';

const TEST_KEY = 'a'.repeat(64);

describe('Security Controls', () => {
  it('encrypts and decrypts secrets and exports using AES-256-GCM', () => {
    const secret = 'mw_live_api_key_99887766';
    const enc = encryptSecret(secret, TEST_KEY);
    expect(enc).not.toContain(secret);
    expect(decryptSecret(enc, TEST_KEY)).toBe(secret);
    expect(maskSecretLast4(secret)).toBe('••••7766');

    const csvBuf = Buffer.from('email,status\nuser@example.com,confirmed', 'utf8');
    const envelope = encryptExportBuffer(csvBuf, TEST_KEY);
    expect(envelope.ciphertext).not.toContain('user@example.com');
    expect(decryptExportBuffer(envelope, TEST_KEY).toString('utf8')).toContain(
      'user@example.com'
    );
  });

  it('redacts secrets and subscriber PII from logs', () => {
    const sanitized = sanitizeForLog({
      apiKey: 'super-secret-key',
      email: 'alice@example.com',
      nested: {
        message: 'Failed syncing bob@company.org',
        token: 'tok-123',
      },
    }) as Record<string, unknown>;

    expect(sanitized.apiKey).toBe('[REDACTED_SECRET]');
    expect(sanitized.email).toBe('[REDACTED_PII]');
    const nested = sanitized.nested as Record<string, unknown>;
    expect(nested.token).toBe('[REDACTED_SECRET]');
    expect(nested.message).toBe('Failed syncing [REDACTED_EMAIL@company.org]');
  });

  it('hashes and verifies admin passwords with scrypt', () => {
    const hash = hashPassword('MyVeryStrongPass!2026');
    expect(verifyPassword('MyVeryStrongPass!2026', hash)).toBe(true);
    expect(verifyPassword('WrongPassword', hash)).toBe(false);
  });

  it('derives and verifies session-bound CSRF tokens', () => {
    const session = { sessionId: 'sess-1', csrfSecret: 'csrf-abc' };
    const token = deriveCsrfToken(session);
    expect(verifyCsrfToken(session, token)).toBe(true);
    expect(verifyCsrfToken(session, 'tampered')).toBe(false);
  });

  it('enforces sliding window rate limits', () => {
    clearRateLimitsForTests();
    const r1 = checkRateLimit('ip-1', 2, 60_000, 1000);
    const r2 = checkRateLimit('ip-1', 2, 60_000, 2000);
    const r3 = checkRateLimit('ip-1', 2, 60_000, 3000);
    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);
    expect(r3.allowed).toBe(false);
    expect(r3.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('blocks non-SELECT SQL statements on the reporting DB connector', () => {
    expect(() => assertReadOnlySqlStatement('SELECT * FROM mw_campaign')).not.toThrow();
    expect(() =>
      assertReadOnlySqlStatement('DELETE FROM mw_list_subscriber')
    ).toThrow();
    expect(() =>
      assertReadOnlySqlStatement('SELECT 1; UPDATE mw_list_subscriber SET status="unsubscribed"')
    ).toThrow();
  });

  it('locks Phase 2 MailWizz mutations by default', async () => {
    await expect(
      mailWizzMutationService.unsubscribeSubscriber({
        listUid: 'list1',
        subscriberUid: 'sub1',
        actorEmail: 'admin@example.com',
      })
    ).rejects.toBeInstanceOf(MutationGateLockedError);
  });
});
