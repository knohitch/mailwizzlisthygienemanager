import { z } from 'zod';
import {
  coerceArrayFromPhpJson,
  coerceNumberFromMailWizz,
  normalizeMailWizzBounceRecord,
  normalizeMailWizzEnvelope,
  normalizeMailWizzListRecord,
  normalizeMailWizzSubscriberRecord,
  type MailWizzAuthMode,
} from './compat';

const tolerantInt = (fallback = 0) =>
  z.preprocess((v) => Math.trunc(coerceNumberFromMailWizz(v, fallback)), z.number().int());

const tolerantNumber = (fallback = 0) =>
  z.preprocess((v) => coerceNumberFromMailWizz(v, fallback), z.number());

const tolerantArray = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.preprocess((v) => coerceArrayFromPhpJson(v), z.array(itemSchema)).default([]);

export const MailWizzPaginatedEnvelopeSchema = <T extends z.ZodTypeAny>(recordSchema: T) =>
  z.preprocess(
    normalizeMailWizzEnvelope,
    z
      .object({
        status: z.enum(['success', 'error']).default('success'),
        error: z.union([z.string(), z.record(z.unknown()), z.array(z.unknown())]).optional(),
        data: z
          .object({
            count: tolerantInt(0),
            total_pages: tolerantInt(1).transform((n) => Math.max(0, n)),
            current_page: tolerantInt(1).transform((n) => Math.max(1, n)),
            next_page: z.coerce.number().int().nullable().optional(),
            prev_page: z.coerce.number().int().nullable().optional(),
            records: tolerantArray(recordSchema),
          })
          .passthrough()
          .optional(),
      })
      .passthrough()
  );

export const MailWizzListRecordSchema = z.preprocess(
  normalizeMailWizzListRecord,
  z
    .object({
      general: z
        .object({
          list_uid: z.string(),
          name: z.string(),
          display_name: z.string().optional().default(''),
          description: z.string().optional().default(''),
          subscribers_count: z.coerce.number().optional(),
          opt_in: z.string().optional().nullable(),
          opt_out: z.string().optional().nullable(),
        })
        .passthrough(),
      defaults: z
        .object({
          from_name: z.string().optional().nullable(),
          from_email: z.string().optional().nullable(),
          reply_to: z.string().optional().nullable(),
          subject: z.string().optional().nullable(),
        })
        .passthrough()
        .optional(),
    })
    .passthrough()
);

export type MailWizzListRecord = z.infer<typeof MailWizzListRecordSchema>;

export const MailWizzSingleListResponseSchema = z.preprocess(
  normalizeMailWizzEnvelope,
  z
    .object({
      status: z.enum(['success', 'error']).default('success'),
      error: z.union([z.string(), z.record(z.unknown())]).optional(),
      data: z
        .object({
          record: MailWizzListRecordSchema,
        })
        .passthrough()
        .optional(),
    })
    .passthrough()
);

export const MailWizzSubscriberRecordSchema = z.preprocess(
  normalizeMailWizzSubscriberRecord,
  z
    .object({
      subscriber_uid: z.string(),
      EMAIL: z.string().optional(),
      email: z.string().optional(),
      FNAME: z.string().optional().nullable(),
      LNAME: z.string().optional().nullable(),
      status: z.string().default('unknown'),
      source: z.string().optional().nullable(),
      ip_address: z.string().optional().nullable(),
      date_added: z.string().optional().nullable(),
    })
    .passthrough()
);

export type MailWizzSubscriberRecord = z.infer<typeof MailWizzSubscriberRecordSchema>;

export const MailWizzSegmentSummarySchema = z
  .object({
    segment_uid: z.string(),
    name: z.string(),
    subscribers_count: tolerantInt(0),
  })
  .passthrough();

export type MailWizzSegmentSummary = z.infer<typeof MailWizzSegmentSummarySchema>;

export const MailWizzSegmentDetailSchema = z.preprocess(
  normalizeMailWizzEnvelope,
  z
    .object({
      status: z.enum(['success', 'error']).default('success'),
      error: z.union([z.string(), z.record(z.unknown())]).optional(),
      data: z
        .object({
          record: z
            .object({
              segment_uid: z.string(),
              segment_id: z.union([z.string(), z.number()]).optional(),
              name: z.string(),
              operator_match: z.string().optional().default('all'),
              date_added: z.string().optional().nullable(),
              subscribers_count: tolerantInt(0),
              conditions: z.preprocess(coerceArrayFromPhpJson, z.array(z.unknown())).default([]),
              campaign_conditions: z
                .preprocess(coerceArrayFromPhpJson, z.array(z.unknown()))
                .default([]),
            })
            .passthrough(),
        })
        .passthrough()
        .optional(),
    })
    .passthrough()
);

export const MailWizzCampaignSummarySchema = z
  .object({
    campaign_uid: z.string(),
    campaign_id: z.union([z.string(), z.number()]).optional(),
    name: z.string(),
    status: z.string(),
    group: z.unknown().optional(),
  })
  .passthrough();

export type MailWizzCampaignSummary = z.infer<typeof MailWizzCampaignSummarySchema>;

export const MailWizzCampaignDetailSchema = z.preprocess(
  normalizeMailWizzEnvelope,
  z
    .object({
      status: z.enum(['success', 'error']).default('success'),
      error: z.union([z.string(), z.record(z.unknown())]).optional(),
      data: z
        .object({
          record: z
            .object({
              campaign_uid: z.string(),
              campaign_id: z.union([z.string(), z.number()]).optional(),
              name: z.string(),
              type: z.string().optional().nullable(),
              from_name: z.string().optional().nullable(),
              from_email: z.string().optional().nullable(),
              reply_to: z.string().optional().nullable(),
              subject: z.string().optional().nullable(),
              status: z.string(),
              date_added: z.string().optional().nullable(),
              send_at: z.string().optional().nullable(),
              list: z
                .object({
                  list_uid: z.string(),
                  name: z.string().optional(),
                  subscribers_count: z.coerce.number().optional(),
                })
                .passthrough()
                .optional(),
              segment: z
                .union([
                  z.array(z.unknown()),
                  z.object({
                    segment_uid: z.string().optional(),
                    name: z.string().optional(),
                  }),
                ])
                .nullable()
                .optional(),
            })
            .passthrough(),
        })
        .passthrough()
        .optional(),
    })
    .passthrough()
);

export const MailWizzCampaignStatsSchema = z.preprocess(
  normalizeMailWizzEnvelope,
  z
    .object({
      status: z.enum(['success', 'error']).default('success'),
      error: z.union([z.string(), z.record(z.unknown())]).optional(),
      data: z
        .object({
          campaign_status: z.string().optional(),
          subscribers_count: tolerantInt(0),
          processed_count: tolerantInt(0),
          delivery_success_count: tolerantInt(0),
          delivery_success_rate: tolerantNumber(0),
          delivery_error_count: tolerantInt(0),
          delivery_error_rate: tolerantNumber(0),
          opens_count: tolerantInt(0),
          opens_rate: tolerantNumber(0),
          unique_opens_count: tolerantInt(0),
          unique_opens_rate: tolerantNumber(0),
          clicks_count: tolerantInt(0),
          clicks_rate: tolerantNumber(0),
          unique_clicks_count: tolerantInt(0),
          unique_clicks_rate: tolerantNumber(0),
          unsubscribes_count: tolerantInt(0),
          unsubscribes_rate: tolerantNumber(0),
          complaints_count: tolerantInt(0),
          complaints_rate: tolerantNumber(0),
          bounces_count: tolerantInt(0),
          bounces_rate: tolerantNumber(0),
          hard_bounces_count: tolerantInt(0),
          hard_bounces_rate: tolerantNumber(0),
          soft_bounces_count: tolerantInt(0),
          soft_bounces_rate: tolerantNumber(0),
          internal_bounces_count: tolerantInt(0),
          internal_bounces_rate: tolerantNumber(0),
        })
        .passthrough()
        .optional(),
    })
    .passthrough()
);

export type MailWizzCampaignStats = NonNullable<
  z.infer<typeof MailWizzCampaignStatsSchema>['data']
>;

export const MailWizzCampaignBounceRecordSchema = z.preprocess(
  normalizeMailWizzBounceRecord,
  z
    .object({
      message: z.string().optional().default(''),
      processed: z.union([z.string(), z.boolean(), z.number()]).transform((v) => String(v)).default('no'),
      bounce_type: z.enum(['hard', 'soft', 'internal']).catch('hard'),
      subscriber: z
        .object({
          subscriber_uid: z.string(),
          email: z.string().optional(),
        })
        .passthrough(),
    })
    .passthrough()
);

export type MailWizzCampaignBounceRecord = z.infer<
  typeof MailWizzCampaignBounceRecordSchema
>;

/**
 * Forward-compatible schema for read-only campaign delivery / open / click / complaint log
 * endpoints introduced in future MailWizz releases (3.1+ / 4.x).
 */
export const MailWizzCampaignActivityRecordSchema = z
  .object({
    subscriber_uid: z.string().optional(),
    date_added: z.string().optional().nullable(),
    created_at: z.string().optional().nullable(),
    status: z.string().optional().nullable(),
    subscriber: z
      .object({
        subscriber_uid: z.string().optional(),
        uid: z.string().optional(),
        email: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type MailWizzCampaignActivityRecord = z.infer<
  typeof MailWizzCampaignActivityRecordSchema
>;

export interface MailWizzClientOptions {
  apiUrl: string;
  apiKey: string;
  authMode?: MailWizzAuthMode;
  remoteAddr?: string;
  maxRequestsPerSecond?: number;
  timeoutMs?: number;
  maxRetries?: number;
  allowInsecureHttp?: boolean;
  fetchImpl?: typeof fetch;
}

export const MailWizzSingleSubscriberResponseSchema = z.preprocess(
  normalizeMailWizzEnvelope,
  z
    .object({
      status: z.enum(['success', 'error']).default('success'),
      error: z.union([z.string(), z.record(z.unknown())]).optional(),
      data: z
        .object({
          record: MailWizzSubscriberRecordSchema,
        })
        .passthrough()
        .optional(),
    })
    .passthrough()
);

export const MailWizzListFieldRecordSchema = z
  .object({
    field_id: z.union([z.string(), z.number()]).transform((v) => String(v)),
    label: z.string().optional().default(''),
    tag: z.string(),
    required: z.string().optional(),
  })
  .passthrough();

export const MailWizzListFieldsResponseSchema = z.preprocess(
  normalizeMailWizzEnvelope,
  z
    .object({
      status: z.enum(['success', 'error']).default('success'),
      error: z.union([z.string(), z.record(z.unknown())]).optional(),
      data: z
        .object({
          records: tolerantArray(MailWizzListFieldRecordSchema),
        })
        .passthrough()
        .optional(),
    })
    .passthrough()
);

export const MailWizzConditionOperatorsResponseSchema = z.preprocess(
  normalizeMailWizzEnvelope,
  z
    .object({
      status: z.enum(['success', 'error']).default('success'),
      error: z.union([z.string(), z.record(z.unknown())]).optional(),
      data: z
        .object({
          records: tolerantArray(
            z
              .object({
                operator_id: z.union([z.string(), z.number()]).transform((v) => String(v)),
                name: z.string(),
                slug: z.string().optional(),
              })
              .passthrough()
          ),
        })
        .passthrough()
        .optional(),
    })
    .passthrough()
);

export const MailWizzCreateListResponseSchema = z.preprocess(
  normalizeMailWizzEnvelope,
  z
    .object({
      status: z.enum(['success', 'error']).default('success'),
      error: z.union([z.string(), z.record(z.unknown()), z.array(z.unknown())]).optional(),
      list_uid: z.string().optional(),
      data: z
        .object({
          list_uid: z.string().optional(),
          record: z
            .object({
              list_uid: z.string().optional(),
              general: z.object({ list_uid: z.string() }).passthrough().optional(),
            })
            .passthrough()
            .optional(),
        })
        .passthrough()
        .optional(),
    })
    .passthrough()
);

export const MailWizzSegmentMutationResponseSchema = z.preprocess(
  normalizeMailWizzEnvelope,
  z
    .object({
      status: z.enum(['success', 'error']).default('success'),
      error: z.union([z.string(), z.record(z.unknown()), z.array(z.unknown())]).optional(),
      data: z
        .object({
          segment_uid: z.string().optional(),
          record: z
            .object({
              segment_uid: z.string(),
            })
            .passthrough()
            .optional(),
        })
        .passthrough()
        .optional(),
    })
    .passthrough()
);

export const MailWizzSimpleStatusResponseSchema = z.preprocess(
  normalizeMailWizzEnvelope,
  z
    .object({
      status: z.enum(['success', 'error']).default('success'),
      error: z.union([z.string(), z.record(z.unknown()), z.array(z.unknown())]).optional(),
    })
    .passthrough()
);

export const MailWizzBulkSubscribersResponseSchema = z.preprocess(
  normalizeMailWizzEnvelope,
  z
    .object({
      status: z.enum(['success', 'error']).default('success'),
      error: z.union([z.string(), z.record(z.unknown()), z.array(z.unknown())]).optional(),
      data: z
        .object({
          records: tolerantArray(
            z
              .object({
                status: z.string().optional(),
                subscriber_uid: z.string().optional(),
                email: z.string().optional(),
                error: z.unknown().optional(),
              })
              .passthrough()
          ).optional(),
        })
        .passthrough()
        .optional(),
    })
    .passthrough()
);
