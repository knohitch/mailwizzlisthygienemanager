import { NextRequest, NextResponse } from 'next/server';
import {
  getActiveSessionFromToken,
  SESSION_COOKIE_NAME,
  type AuthenticatedSession,
} from '@/services/security/auth';
import { verifyCsrfToken } from '@/services/security/csrf';
import { checkRateLimit, getClientIp } from '@/services/security/rate-limit';
import { isIpAllowedByEnv } from '@/services/security/ip-allowlist';

export async function requireApiAuth(
  req: NextRequest,
  options?: { requireCsrf?: boolean; rateLimitBucket?: string; limitPerMin?: number }
): Promise<
  | { ok: true; session: AuthenticatedSession; ip: string }
  | { ok: false; response: NextResponse }
> {
  const ip = getClientIp(req.headers);
  const ipCheck = isIpAllowedByEnv(ip);
  if (!ipCheck.allowed) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Access denied from this IP address by administrator policy.' },
        { status: 403 }
      ),
    };
  }
  const bucket = options?.rateLimitBucket ?? 'api-default';
  const limit = options?.limitPerMin ?? 120;
  const rl = checkRateLimit(`${bucket}:${ip}`, limit, 60_000);
  if (!rl.allowed) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Too many requests. Please slow down.' },
        {
          status: 429,
          headers: { 'Retry-After': String(rl.retryAfterSeconds) },
        }
      ),
    };
  }

  const rawToken = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = await getActiveSessionFromToken(rawToken);
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Authentication required.' }, { status: 401 }),
    };
  }

  const method = req.method.toUpperCase();
  const needsCsrf =
    options?.requireCsrf ??
    (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS');

  if (needsCsrf) {
    const csrfToken = req.headers.get('x-csrf-token');
    if (!verifyCsrfToken(session, csrfToken)) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: 'Invalid or missing CSRF token.' },
          { status: 403 }
        ),
      };
    }
  }

  return { ok: true, session, ip };
}
