import { NextRequest, NextResponse } from 'next/server';
import { requireApiAuth } from '@/lib/api-auth';
import { validateStoredCustomerConnection } from '@/services/mailwizz/client-factory';
import { getCustomerConnectionById } from '@/services/mailwizz/connections';
import { recordAuditLog } from '@/services/security/audit';

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireApiAuth(req, {
    requireCsrf: true,
    rateLimitBucket: 'connections-validate',
    limitPerMin: 20,
  });
  if (!auth.ok) return auth.response;

  const { id } = await context.params;

  try {
    const validation = await validateStoredCustomerConnection({ connectionId: id });
    const connection = await getCustomerConnectionById(id);

    await recordAuditLog({
      customerConnectionId: id,
      actorEmail: auth.session.adminEmail,
      action: 'VALIDATE_CUSTOMER_CONNECTION',
      resourceType: 'MailWizzCustomerConnection',
      resourceId: id,
      outcome: validation.ok ? 'SUCCESS' : 'FAILED',
      ipAddress: auth.ip,
      details: {
        verifiedAuthMode: validation.verifiedAuthMode,
        detectedVersion: validation.detectedVersion,
        totalListsFound: validation.totalListsFound,
        latencyMs: validation.latencyMs,
      },
    });

    return NextResponse.json({ ok: validation.ok, validation, connection });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Connection validation failed.' },
      { status: 400 }
    );
  }
}
