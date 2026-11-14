import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  createAdminSession,
  getSessionCookieOptions,
  verifyAdminCredentials,
} from '@/services/security/auth';
import { deriveCsrfToken } from '@/services/security/csrf';
import { checkRateLimit, getClientIp } from '@/services/security/rate-limit';
import { isIpAllowedByEnv } from '@/services/security/ip-allowlist';
import { recordAuditLog } from '@/services/security/audit';

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const ip = getClientIp(req.headers);
  const ipCheck = isIpAllowedByEnv(ip);
  if (!ipCheck.allowed) {
    return NextResponse.json(
      { error: 'Access denied from this IP address by administrator policy.' },
      { status: 403 }
    );
  }
  const rl = checkRateLimit(`login:${ip}`, 10, 15 * 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many login attempts. Try again later.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON request body.' }, { status: 400 });
  }

  const parsed = LoginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Valid email and password are required.' },
      { status: 400 }
    );
  }

  const valid = verifyAdminCredentials(parsed.data.email, parsed.data.password);
  if (!valid) {
    await recordAuditLog({
      actorEmail: parsed.data.email.trim().toLowerCase(),
      action: 'ADMIN_LOGIN',
      resourceType: 'AdminSession',
      outcome: 'DENIED',
      ipAddress: ip,
      details: { reason: 'Invalid credentials' },
    }).catch(() => undefined);

    return NextResponse.json(
      { error: 'Invalid administrator email or password.' },
      { status: 401 }
    );
  }

  const normalizedEmail = parsed.data.email.trim().toLowerCase();
  const created = await createAdminSession({
    adminEmail: normalizedEmail,
    ipAddress: ip,
    userAgent: req.headers.get('user-agent'),
  });

  // Derive CSRF token using a temporary session-like lookup
  const tokenRes = await import('@/services/security/auth').then((m) =>
    m.getActiveSessionFromToken(created.rawToken)
  );
  const csrfToken = tokenRes ? deriveCsrfToken(tokenRes) : '';

  const response = NextResponse.json({
    ok: true,
    adminEmail: normalizedEmail,
    csrfToken,
    expiresAt: created.expiresAt.toISOString(),
  });

  response.cookies.set({
    ...getSessionCookieOptions(created.expiresAt),
    value: created.rawToken,
  });

  return response;
}
