import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireApiAuth } from '@/lib/api-auth';
import {
  archiveCustomerConnection,
  deleteCustomerConnection,
  getCustomerConnectionById,
  revokeCustomerConnectionCredential,
  rotateCustomerConnectionApiKey,
  setConnectionSyncPaused,
  updateCustomerConnection,
} from '@/services/mailwizz/connections';

const PatchConnectionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('UPDATE_SETTINGS'),
    customerName: z.string().trim().min(2).max(120).optional(),
    baseUrl: z.string().trim().min(8).max(500).optional(),
    authMode: z
      .enum(['auto', 'x_api_key_only', 'x-api-key', 'legacy_hmac', 'legacy-hmac', 'bearer'])
      .optional(),
    mailwizzCustomerUid: z.string().trim().max(80).nullable().optional(),
    webhookSecret: z.string().trim().max(512).nullable().optional(),
    reportingDbUrl: z.string().trim().max(500).nullable().optional(),
    reportingDbPrefix: z
      .string()
      .trim()
      .regex(/^[a-zA-Z0-9_]{0,20}$/)
      .optional(),
    maxRequestsPerSecond: z.coerce.number().int().min(1).max(25).optional(),
    syncScheduleCron: z.string().trim().min(1).max(64).optional(),
    syncScheduleEnabled: z.boolean().optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
    isEnabled: z.boolean().optional(),
  }),
  z.object({
    action: z.literal('ROTATE_KEY'),
    newApiKey: z.string().trim().min(8).max(512),
  }),
  z.object({
    action: z.literal('REVOKE_KEY'),
    reason: z.string().trim().max(300).optional(),
  }),
  z.object({
    action: z.literal('PAUSE_SYNC'),
    reason: z.string().trim().max(300).optional(),
  }),
  z.object({
    action: z.literal('RESUME_SYNC'),
  }),
  z.object({
    action: z.literal('SET_ENABLED'),
    isEnabled: z.boolean(),
  }),
  z.object({
    action: z.literal('ARCHIVE_CONNECTION'),
    confirmationPhrase: z.string().trim().min(1),
    reason: z.string().trim().max(300).optional(),
  }),
]);

const DeleteConnectionSchema = z.object({
  confirmationPhrase: z.string().trim().min(1),
});

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireApiAuth(req, { rateLimitBucket: 'connections-read' });
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const connection = await getCustomerConnectionById(id);
  if (!connection) {
    return NextResponse.json({ error: 'Customer connection not found.' }, { status: 404 });
  }
  return NextResponse.json({ connection });
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireApiAuth(req, {
    requireCsrf: true,
    rateLimitBucket: 'connections-write',
    limitPerMin: 30,
  });
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 });
  }

  const parsed = PatchConnectionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid connection update payload.', issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    switch (parsed.data.action) {
      case 'UPDATE_SETTINGS': {
        const { action: _a, ...fields } = parsed.data;
        void _a;
        const connection = await updateCustomerConnection(id, {
          ...fields,
          actorEmail: auth.session.adminEmail,
          ipAddress: auth.ip,
        });
        return NextResponse.json({ ok: true, connection });
      }
      case 'ROTATE_KEY': {
        const connection = await rotateCustomerConnectionApiKey({
          connectionId: id,
          newApiKey: parsed.data.newApiKey,
          actorEmail: auth.session.adminEmail,
          ipAddress: auth.ip,
        });
        return NextResponse.json({ ok: true, connection });
      }
      case 'REVOKE_KEY': {
        const connection = await revokeCustomerConnectionCredential({
          connectionId: id,
          reason: parsed.data.reason,
          actorEmail: auth.session.adminEmail,
          ipAddress: auth.ip,
        });
        return NextResponse.json({ ok: true, connection });
      }
      case 'PAUSE_SYNC': {
        await setConnectionSyncPaused({
          connectionId: id,
          isPaused: true,
          reason: parsed.data.reason,
          actorEmail: auth.session.adminEmail,
          ipAddress: auth.ip,
        });
        const connection = await getCustomerConnectionById(id);
        return NextResponse.json({ ok: true, connection });
      }
      case 'RESUME_SYNC': {
        await setConnectionSyncPaused({
          connectionId: id,
          isPaused: false,
          actorEmail: auth.session.adminEmail,
          ipAddress: auth.ip,
        });
        const connection = await getCustomerConnectionById(id);
        return NextResponse.json({ ok: true, connection });
      }
      case 'SET_ENABLED': {
        const connection = await updateCustomerConnection(id, {
          isEnabled: parsed.data.isEnabled,
          actorEmail: auth.session.adminEmail,
          ipAddress: auth.ip,
        });
        return NextResponse.json({ ok: true, connection });
      }
      case 'ARCHIVE_CONNECTION': {
        const archived = await archiveCustomerConnection({
          connectionId: id,
          confirmationPhrase: parsed.data.confirmationPhrase,
          reason: parsed.data.reason,
          actorEmail: auth.session.adminEmail,
          ipAddress: auth.ip,
        });
        return NextResponse.json({ ok: true, archived, connection: archived.connection });
      }
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update customer connection.' },
      { status: 400 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireApiAuth(req, {
    requireCsrf: true,
    rateLimitBucket: 'connections-delete',
    limitPerMin: 10,
  });
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 });
  }

  const parsed = DeleteConnectionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'confirmationPhrase matching customer name or slug is required.' },
      { status: 400 }
    );
  }

  try {
    const deleted = await deleteCustomerConnection({
      connectionId: id,
      confirmationPhrase: parsed.data.confirmationPhrase,
      actorEmail: auth.session.adminEmail,
      ipAddress: auth.ip,
    });
    return NextResponse.json({ ok: true, deleted });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete customer connection.';
    const status = message.includes('Refusing destructive delete') ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
