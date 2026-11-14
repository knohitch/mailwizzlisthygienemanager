import { NextRequest, NextResponse } from 'next/server';
import {
  getActiveSessionFromToken,
  SESSION_COOKIE_NAME,
} from '@/services/security/auth';
import { deriveCsrfToken } from '@/services/security/csrf';

export async function GET(req: NextRequest) {
  const rawToken = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = await getActiveSessionFromToken(rawToken);
  if (!session) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  return NextResponse.json({
    authenticated: true,
    adminEmail: session.adminEmail,
    csrfToken: deriveCsrfToken(session),
    expiresAt: session.expiresAt.toISOString(),
  });
}
