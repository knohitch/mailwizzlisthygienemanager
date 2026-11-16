import { prisma } from '@/lib/db';
import { sanitizeForLog } from './logger';
import type { Prisma } from '@prisma/client';

export interface AuditInput {
  customerConnectionId?: string | null;
  actorEmail: string;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  outcome: 'SUCCESS' | 'DENIED' | 'FAILED';
  ipAddress?: string | null;
  details?: Record<string, unknown>;
}

export async function recordAuditLog(input: AuditInput): Promise<void> {
  const sanitizedDetails = (sanitizeForLog(input.details ?? {}) ?? {}) as Prisma.InputJsonValue;
  await prisma.auditLog.create({
    data: {
      customerConnectionId: input.customerConnectionId ?? null,
      actorEmail: input.actorEmail,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      outcome: input.outcome,
      ipAddress: input.ipAddress ?? null,
      detailsJson: sanitizedDetails,
    },
  });
}
