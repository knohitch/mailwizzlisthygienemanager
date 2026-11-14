import { NextRequest, NextResponse } from 'next/server';
import { requireApiAuth } from '@/lib/api-auth';
import {
  revokeSessionByToken,
  SESSION_COOKIE_NAME,
} from '@/services/security/auth';

export async function POST(req: NextRequest) {
  const auth = await requireApiAuth(req, { requireCsrf: true, rateLimitBucket: 'logout' });
  if (!auth.ok) return auth.response;

  const rawToken = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  await revokeSessionByToken(rawToken, auth.ip);

  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: '',
    path: '/',
    maxAge: 0,
    httpOnly: true,
    sameSite: 'lax',
  });
  return response;
}
