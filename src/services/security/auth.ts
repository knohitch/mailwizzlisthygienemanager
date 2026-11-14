import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/db';
import { getEnv } from '@/lib/env';
import { sha256Hex, timingSafeEqualString, verifyPassword } from './crypto';
import { recordAuditLog } from './audit';

export const SESSION_COOKIE_NAME = 'hygiene_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours

export interface AuthenticatedSession {
  sessionId: string;
  adminEmail: string;
  csrfSecret: string;
  expiresAt: Date;
}

export function verifyAdminCredentials(email: string, password: string): boolean {
  const env = getEnv();
  const normalizedInputEmail = email.trim().toLowerCase();
  const normalizedConfiguredEmail = env.ADMIN_EMAIL.trim().toLowerCase();

  if (!timingSafeEqualString(normalizedInputEmail, normalizedConfiguredEmail)) {
    return false;
  }

  if (env.ADMIN_PASSWORD_HASH) {
    return verifyPassword(password, env.ADMIN_PASSWORD_HASH);
  }

  if (!env.ADMIN_PASSWORD || env.ADMIN_PASSWORD.length < 8) {
    return false;
  }

  // Hash both with sha256 first so timingSafeEqual compares equal-length buffers
  return crypto.timingSafeEqual(
    crypto.createHash('sha256').update(password, 'utf8').digest(),
    crypto.createHash('sha256').update(env.ADMIN_PASSWORD, 'utf8').digest()
  );
}

export async function createAdminSession(params: {
  adminEmail: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<{ rawToken: string; csrfSecret: string; expiresAt: Date }> {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const csrfSecret = crypto.randomBytes(32).toString('hex');
  const tokenHash = sha256Hex(rawToken);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await prisma.adminSession.create({
    data: {
      tokenHash,
      csrfSecret,
      adminEmail: params.adminEmail,
      ipAddress: params.ipAddress ?? null,
      userAgent: params.userAgent ? params.userAgent.slice(0, 250) : null,
      expiresAt,
    },
  });

  await recordAuditLog({
    actorEmail: params.adminEmail,
    action: 'ADMIN_LOGIN',
    resourceType: 'AdminSession',
    outcome: 'SUCCESS',
    ipAddress: params.ipAddress,
  });

  return { rawToken, csrfSecret, expiresAt };
}

export async function getActiveSessionFromToken(
  rawToken: string | undefined | null
): Promise<AuthenticatedSession | null> {
  if (!rawToken || rawToken.length < 32) return null;
  const tokenHash = sha256Hex(rawToken);
  const session = await prisma.adminSession.findUnique({
    where: { tokenHash },
  });

  if (!session) return null;
  if (session.revokedAt) return null;
  if (session.expiresAt.getTime() <= Date.now()) return null;

  // Touch lastSeenAt opportunistically (throttled to >60s)
  if (Date.now() - session.lastSeenAt.getTime() > 60_000) {
    await prisma.adminSession
      .update({
        where: { id: session.id },
        data: { lastSeenAt: new Date() },
      })
      .catch(() => undefined);
  }

  return {
    sessionId: session.id,
    adminEmail: session.adminEmail,
    csrfSecret: session.csrfSecret,
    expiresAt: session.expiresAt,
  };
}

export async function getServerSession(): Promise<AuthenticatedSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  return getActiveSessionFromToken(token);
}

export async function revokeSessionByToken(
  rawToken: string | undefined | null,
  ipAddress?: string | null
): Promise<void> {
  if (!rawToken) return;
  const tokenHash = sha256Hex(rawToken);
  const session = await prisma.adminSession.findUnique({ where: { tokenHash } });
  if (!session) return;

  await prisma.adminSession.update({
    where: { id: session.id },
    data: { revokedAt: new Date() },
  });

  await recordAuditLog({
    actorEmail: session.adminEmail,
    action: 'ADMIN_LOGOUT',
    resourceType: 'AdminSession',
    resourceId: session.id,
    outcome: 'SUCCESS',
    ipAddress,
  });
}

export function getSessionCookieOptions(expiresAt: Date) {
  const env = getEnv();
  return {
    name: SESSION_COOKIE_NAME,
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: env.COOKIE_SECURE,
    path: '/',
    expires: expiresAt,
  };
}
