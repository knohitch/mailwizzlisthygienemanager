import { prisma } from '@/lib/db';
import type {
  EngagementClass,
  EngagementConfidence,
  Prisma,
  SubscriberStatus,
} from '@prisma/client';
import { z } from 'zod';

const MS_PER_DAY = 86_400_000;

export const FilterConditionSchema = z.discriminatedUnion('field', [
  z.object({
    field: z.literal('mailingListId'),
    op: z.enum(['eq', 'in']),
    value: z.union([z.string(), z.array(z.string())]),
  }),
  z.object({
    field: z.literal('engagementStatus'),
    op: z.enum(['eq', 'in', 'neq']),
    value: z.union([
      z.enum([
        'ACTIVE',
        'COOLING',
        'INACTIVE',
        'LONG_TERM_INACTIVE',
        'NEVER_ENGAGED',
        'INSUFFICIENT_DATA',
        'EXCLUDED',
      ]),
      z.array(
        z.enum([
          'ACTIVE',
          'COOLING',
          'INACTIVE',
          'LONG_TERM_INACTIVE',
          'NEVER_ENGAGED',
          'INSUFFICIENT_DATA',
          'EXCLUDED',
        ])
      ),
    ]),
  }),
  z.object({
    field: z.literal('daysSinceLastEngagement'),
    op: z.enum(['gte', 'lte', 'isNull']),
    value: z.number().int().min(0).max(3650).optional(),
  }),
  z.object({
    field: z.literal('daysSinceSignup'),
    op: z.enum(['gte', 'lte']),
    value: z.number().int().min(0).max(3650),
  }),
  z.object({
    field: z.literal('deliveredCampaignsCount'),
    op: z.enum(['gte', 'lte', 'eq']),
    value: z.number().int().min(0),
  }),
  z.object({
    field: z.literal('opensCount'),
    op: z.enum(['gte', 'lte', 'eq']),
    value: z.number().int().min(0),
  }),
  z.object({
    field: z.literal('clicksCount'),
    op: z.enum(['gte', 'lte', 'eq']),
    value: z.number().int().min(0),
  }),
  z.object({
    field: z.literal('emailDomain'),
    op: z.enum(['eq', 'in', 'contains']),
    value: z.union([z.string(), z.array(z.string())]),
  }),
  z.object({
    field: z.literal('status'),
    op: z.enum(['eq', 'in', 'neq']),
    value: z.union([
      z.enum([
        'CONFIRMED',
        'UNCONFIRMED',
        'UNSUBSCRIBED',
        'BLACKLISTED',
        'MOVED',
        'UNAPPROVED',
        'UNKNOWN',
      ]),
      z.array(
        z.enum([
          'CONFIRMED',
          'UNCONFIRMED',
          'UNSUBSCRIBED',
          'BLACKLISTED',
          'MOVED',
          'UNAPPROVED',
          'UNKNOWN',
        ])
      ),
    ]),
  }),
  z.object({
    field: z.literal('source'),
    op: z.enum(['eq', 'contains', 'isNull']),
    value: z.string().optional(),
  }),
  z.object({
    field: z.literal('engagementConfidence'),
    op: z.enum(['eq', 'in']),
    value: z.union([
      z.enum(['HIGH', 'MEDIUM', 'LOW', 'NONE']),
      z.array(z.enum(['HIGH', 'MEDIUM', 'LOW', 'NONE'])),
    ]),
  }),
  z.object({
    field: z.literal('isProtectedOrVip'),
    op: z.literal('eq'),
    value: z.boolean(),
  }),
  z.object({
    field: z.literal('isSuppressed'),
    op: z.literal('eq'),
    value: z.boolean(),
  }),
  z.object({
    field: z.literal('isArchived'),
    op: z.literal('eq'),
    value: z.boolean(),
  }),
]);

export type FilterCondition = z.infer<typeof FilterConditionSchema>;

export interface FilterGroup {
  combinator: 'AND' | 'OR';
  conditions: FilterCondition[];
  groups?: FilterGroup[];
}

export const FilterGroupSchema: z.ZodType<FilterGroup, z.ZodTypeDef, unknown> = z.lazy(() =>
  z.object({
    combinator: z.enum(['AND', 'OR']).default('AND'),
    conditions: z.array(FilterConditionSchema).default([]),
    groups: z.array(FilterGroupSchema).optional(),
  })
);

function conditionToPrismaWhere(
  cond: FilterCondition,
  now: Date
): Prisma.SubscriberWhereInput {
  switch (cond.field) {
    case 'mailingListId':
      return Array.isArray(cond.value)
        ? { mailingListId: { in: cond.value } }
        : { mailingListId: cond.value };

    case 'engagementStatus': {
      const vals = (
        Array.isArray(cond.value) ? cond.value : [cond.value]
      ) as EngagementClass[];
      return cond.op === 'neq'
        ? { engagementStatus: { notIn: vals } }
        : { engagementStatus: { in: vals } };
    }

    case 'daysSinceLastEngagement': {
      if (cond.op === 'isNull') {
        return {
          AND: [
            { lastOpenAt: null },
            { lastClickAt: null },
            { lastReplyAt: null },
            { lastConversionAt: null },
          ],
        };
      }
      const cutoff = new Date(now.getTime() - (cond.value ?? 0) * MS_PER_DAY);
      if (cond.op === 'gte') {
        // At least one engagement exists AND none of them are newer than cutoff
        return {
          AND: [
            {
              OR: [
                { lastOpenAt: { not: null } },
                { lastClickAt: { not: null } },
                { lastReplyAt: { not: null } },
                { lastConversionAt: { not: null } },
              ],
            },
            { OR: [{ lastOpenAt: null }, { lastOpenAt: { lte: cutoff } }] },
            { OR: [{ lastClickAt: null }, { lastClickAt: { lte: cutoff } }] },
            { OR: [{ lastReplyAt: null }, { lastReplyAt: { lte: cutoff } }] },
            {
              OR: [
                { lastConversionAt: null },
                { lastConversionAt: { lte: cutoff } },
              ],
            },
          ],
        };
      }
      // lte: at least one engagement occurred >= cutoff
      return {
        OR: [
          { lastOpenAt: { gte: cutoff } },
          { lastClickAt: { gte: cutoff } },
          { lastReplyAt: { gte: cutoff } },
          { lastConversionAt: { gte: cutoff } },
        ],
      };
    }

    case 'daysSinceSignup': {
      const cutoff = new Date(now.getTime() - cond.value * MS_PER_DAY);
      return cond.op === 'gte'
        ? { dateAddedMailwizz: { lte: cutoff } }
        : { dateAddedMailwizz: { gte: cutoff } };
    }

    case 'deliveredCampaignsCount':
      return {
        deliveredCampaignsCount:
          cond.op === 'eq'
            ? cond.value
            : cond.op === 'gte'
              ? { gte: cond.value }
              : { lte: cond.value },
      };

    case 'opensCount':
      return {
        opensCount:
          cond.op === 'eq'
            ? cond.value
            : cond.op === 'gte'
              ? { gte: cond.value }
              : { lte: cond.value },
      };

    case 'clicksCount':
      return {
        clicksCount:
          cond.op === 'eq'
            ? cond.value
            : cond.op === 'gte'
              ? { gte: cond.value }
              : { lte: cond.value },
      };

    case 'emailDomain': {
      const domains = (
        Array.isArray(cond.value) ? cond.value : [cond.value]
      )
        .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
        .filter(Boolean);
      if (domains.length === 0) return {};
      if (cond.op === 'contains') {
        return {
          OR: domains.map((d) => ({
            email: { contains: d, mode: 'insensitive' },
          })),
        };
      }
      return {
        OR: domains.map((d) => ({
          email: { endsWith: `@${d}`, mode: 'insensitive' },
        })),
      };
    }

    case 'status': {
      const vals = (
        Array.isArray(cond.value) ? cond.value : [cond.value]
      ) as SubscriberStatus[];
      return cond.op === 'neq' ? { status: { notIn: vals } } : { status: { in: vals } };
    }

    case 'source':
      if (cond.op === 'isNull') return { OR: [{ source: null }, { source: '' }] };
      if (!cond.value) return {};
      return cond.op === 'eq'
        ? { source: { equals: cond.value, mode: 'insensitive' } }
        : { source: { contains: cond.value, mode: 'insensitive' } };

    case 'engagementConfidence': {
      const vals = (
        Array.isArray(cond.value) ? cond.value : [cond.value]
      ) as EngagementConfidence[];
      return { engagementConfidence: { in: vals } };
    }

    case 'isProtectedOrVip':
      if (cond.value) {
        return {
          OR: [
            { isVip: true },
            { hasPaidRelationship: true },
            { isExcluded: true },
          ],
        };
      }
      return {
        AND: [{ isVip: false }, { hasPaidRelationship: false }],
      };

    case 'isSuppressed':
      return { isSuppressed: cond.value };

    case 'isArchived':
      return { isArchived: cond.value };
  }
}

export function buildPrismaWhereFromFilter(
  filter: FilterGroup,
  now = new Date()
): Prisma.SubscriberWhereInput {
  const parts: Prisma.SubscriberWhereInput[] = [
    ...filter.conditions.map((c) => conditionToPrismaWhere(c, now)),
    ...(filter.groups ?? []).map((g) => buildPrismaWhereFromFilter(g, now)),
  ];

  if (parts.length === 0) return {};
  if (parts.length === 1) return parts[0];
  return filter.combinator === 'OR' ? { OR: parts } : { AND: parts };
}

export async function queryFilteredSubscribers(params: {
  filter: FilterGroup;
  mailingListId?: string;
  explicitSubscriberIds?: string[];
  page?: number;
  pageSize?: number;
}) {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, params.pageSize ?? 25));

  const filterWhere = buildPrismaWhereFromFilter(params.filter);
  const clauses: Prisma.SubscriberWhereInput[] = [];
  if (Object.keys(filterWhere).length > 0) clauses.push(filterWhere);
  if (params.mailingListId) clauses.push({ mailingListId: params.mailingListId });
  if (params.explicitSubscriberIds && params.explicitSubscriberIds.length > 0) {
    clauses.push({ id: { in: params.explicitSubscriberIds } });
  }

  const where: Prisma.SubscriberWhereInput =
    clauses.length === 0 ? {} : clauses.length === 1 ? clauses[0] : { AND: clauses };

  const [totalMatched, breakdown, subscribers] = await Promise.all([
    prisma.subscriber.count({ where }),
    prisma.subscriber.groupBy({
      by: ['engagementStatus'],
      where,
      _count: { _all: true },
    }),
    prisma.subscriber.findMany({
      where,
      orderBy: [{ engagementStatus: 'asc' }, { deliveredCampaignsCount: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        mailingList: {
          select: { id: true, listUid: true, name: true },
        },
      },
    }),
  ]);

  const byEngagementStatus: Record<string, number> = {};
  for (const row of breakdown) {
    byEngagementStatus[row.engagementStatus] = row._count._all;
  }

  return {
    totalMatched,
    page,
    pageSize,
    byEngagementStatus,
    subscribers,
    where,
  };
}
