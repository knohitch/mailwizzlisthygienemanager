import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ConnectionStatus } from '@prisma/client';
import { requireApiAuth } from '@/lib/api-auth';
import {
  createCustomerConnection,
  getCustomerConnectionById,
  listCustomerConnections,
} from '@/services/mailwizz/connections';
import { validateStoredCustomerConnection } from '@/services/mailwizz/client-factory';

const CreateConnectionSchema = z.object({
  customerName: z.string().trim().min(2).max(120),
  customerSlug: z.string().trim().max(80).optional(),
  baseUrl: z.string().trim().min(8).max(500),
  installationName: z.string().trim().max(120).optional(),
  apiKey: z.string().trim().min(8).max(512),
  authMode: z
    .enum(['auto', 'x_api_key_only', 'x-api-key', 'legacy_hmac', 'legacy-hmac', 'bearer'])
    .optional(),
  mailwizzCustomerUid: z.string().trim().max(80).optional(),
  webhookSecret: z.string().trim().max(512).optional(),
  reportingDbUrl: z.string().trim().max(500).optional(),
  reportingDbPrefix: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9_]{0,20}$/)
    .optional(),
  maxRequestsPerSecond: z.coerce.number().int().min(1).max(25).optional(),
  syncScheduleCron: z.string().trim().min(1).max(64).optional(),
  syncScheduleEnabled: z.boolean().optional(),
  notes: z.string().trim().max(1000).optional(),
  isPrimary: z.boolean().optional(),
  validateImmediately: z.boolean().optional(),
});

const VALID_STATUSES = new Set<ConnectionStatus>([
  'PENDING',
  'CONNECTED',
  'AUTH_FAILED',
  'DISABLED',
  'LEGACY_QUARANTINE',
]);

export async function GET(req: NextRequest) {
  const auth = await requireApiAuth(req, { rateLimitBucket: 'connections-read' });
  if (!auth.ok) return auth.response;

  const sp = req.nextUrl.searchParams;
  const search = sp.get('search')?.trim() || undefined;
  const statusRaw = sp.get('status')?.trim().toUpperCase();
  const status =
    statusRaw && VALID_STATUSES.has(statusRaw as ConnectionStatus)
      ? (statusRaw as ConnectionStatus)
      : undefined;
  const installationId = sp.get('installationId')?.trim() || undefined;
  const includeQuarantine = sp.get('includeQuarantine') !== 'false';
  const page = Math.max(1, Number(sp.get('page')) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(sp.get('pageSize')) || 25));

  const result = await listCustomerConnections({
    search,
    status,
    installationId,
    includeQuarantine,
    page,
    pageSize,
  });

  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const auth = await requireApiAuth(req, {
    requireCsrf: true,
    rateLimitBucket: 'connections-write',
    limitPerMin: 20,
  });
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 });
  }

  const parsed = CreateConnectionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid connection payload.', issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const { validateImmediately, ...input } = parsed.data;
    const created = await createCustomerConnection({
      ...input,
      actorEmail: auth.session.adminEmail,
      ipAddress: auth.ip,
    });

    let validation = null;
    let connection = created;
    if (validateImmediately) {
      try {
        validation = await validateStoredCustomerConnection({ connectionId: created.id });
        const refreshed = await getCustomerConnectionById(created.id);
        if (refreshed) connection = refreshed;
      } catch (valErr) {
        validation = {
          ok: false,
          connectionId: created.id,
          detectedVersion: null,
          verifiedAuthMode: null,
          totalListsFound: 0,
          latencyMs: 0,
          message: valErr instanceof Error ? valErr.message : 'Validation failed.',
        };
      }
    }

    return NextResponse.json({ ok: true, connection, validation }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create customer connection.' },
      { status: 400 }
    );
  }
}
