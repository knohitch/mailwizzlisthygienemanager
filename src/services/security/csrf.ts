import crypto from 'node:crypto';
import { getEnv } from '@/lib/env';
import { timingSafeEqualString } from './crypto';
import type { AuthenticatedSession } from './auth';

function getSigningSecret(): string {
  const env = getEnv();
  if (env.APP_SESSION_SECRET && env.APP_SESSION_SECRET.length >= 32) {
    return env.APP_SESSION_SECRET;
  }
  if (env.NODE_ENV === 'production') {
    throw new Error(
      'APP_SESSION_SECRET (>= 32 chars) is required in production to sign CSRF tokens.'
    );
  }
  return 'dev-fallback-session-secret-change-me';
}

export function deriveCsrfToken(session: Pick<AuthenticatedSession, 'sessionId' | 'csrfSecret'>): string {
  const hmac = crypto
    .createHmac('sha256', getSigningSecret())
    .update(`${session.sessionId}:${session.csrfSecret}`)
    .digest('hex');
  return hmac;
}

export function verifyCsrfToken(
  session: Pick<AuthenticatedSession, 'sessionId' | 'csrfSecret'>,
  providedToken: string | null | undefined
): boolean {
  if (!providedToken) return false;
  const expected = deriveCsrfToken(session);
  return timingSafeEqualString(expected, providedToken.trim());
}
