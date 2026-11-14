import type { EngagementEventType, SubscriberStatus } from '@prisma/client';
import {
  coerceArrayFromPhpJson,
  coerceNumberFromMailWizz,
  normalizeMailWizzBounceRecord,
  normalizeMailWizzEnvelope,
  normalizeMailWizzListRecord,
  normalizeMailWizzSingleRecordEnvelope,
  normalizeMailWizzSubscriberRecord,
  pickFirstString,
} from './compat';
import type {
  ContractValidationIssue,
  ContractValidationResult,
  InternalActivityRecord,
  InternalBounceRecord,
  InternalCampaignDetail,
  InternalCampaignStats,
  InternalCampaignSummary,
  InternalMailingList,
  InternalPaginatedPage,
  InternalSegmentDetail,
  InternalSegmentSummary,
  InternalSubscriber,
  InternalWebhookEvent,
  MailWizzAdapter,
} from './contracts';

const KNOWN_LIST_KEYS = new Set([
  'general',
  'defaults',
  'company',
  'notifications',
  'list_uid',
  'uid',
  'id',
  'name',
  'display_name',
  'description',
  'subscribers_count',
  'opt_in',
  'opt_out',
  'from_name',
  'from_email',
  'reply_to',
  'subject',
]);

const KNOWN_SUBSCRIBER_KEYS = new Set([
  'subscriber_uid',
  'uid',
  'id',
  'EMAIL',
  'email',
  'Email',
  'FNAME',
  'fname',
  'first_name',
  'FIRST_NAME',
  'LNAME',
  'lname',
  'last_name',
  'LAST_NAME',
  'status',
  'source',
  'ip_address',
  'date_added',
]);

const KNOWN_CAMPAIGN_KEYS = new Set([
  'campaign_uid',
  'campaign_id',
  'name',
  'type',
  'from_name',
  'from_email',
  'reply_to',
  'to_name',
  'subject',
  'status',
  'group',
  'date_added',
  'send_at',
  'list',
  'segment',
]);

const KNOWN_STATS_KEYS = new Set([
  'campaign_status',
  'subscribers_count',
  'processed_count',
  'delivery_success_count',
  'delivery_success_rate',
  'delivery_error_count',
  'delivery_error_rate',
  'opens_count',
  'opens_rate',
  'unique_opens_count',
  'unique_opens_rate',
  'clicks_count',
  'clicks_rate',
  'unique_clicks_count',
  'unique_clicks_rate',
  'unsubscribes_count',
  'unsubscribes_rate',
  'complaints_count',
  'complaints_rate',
  'bounces_count',
  'bounces_rate',
  'hard_bounces_count',
  'hard_bounces_rate',
  'soft_bounces_count',
  'soft_bounces_rate',
  'internal_bounces_count',
  'internal_bounces_rate',
]);

function collectAdditiveKeys(
  obj: Record<string, unknown>,
  knownKeys: Set<string>,
  prefix = ''
): string[] {
  return Object.keys(obj)
    .filter((k) => !knownKeys.has(k))
    .map((k) => (prefix ? `${prefix}.${k}` : k));
}

export function mapStrictMailWizzSubscriberStatus(raw: string | undefined): {
  status: SubscriberStatus;
  unknownStatusDetected: boolean;
} {
  const s = (raw ?? '').trim().toLowerCase();
  if (s === 'confirmed') return { status: 'CONFIRMED', unknownStatusDetected: false };
  if (s === 'unconfirmed') return { status: 'UNCONFIRMED', unknownStatusDetected: false };
  if (s === 'unsubscribed') return { status: 'UNSUBSCRIBED', unknownStatusDetected: false };
  if (s === 'blacklisted') return { status: 'BLACKLISTED', unknownStatusDetected: false };
  if (s === 'moved') return { status: 'MOVED', unknownStatusDetected: false };
  if (s === 'unapproved') return { status: 'UNAPPROVED', unknownStatusDetected: false };
  return { status: 'UNKNOWN', unknownStatusDetected: true };
}

function mapWebhookEventType(raw: string): EngagementEventType | null {
  const s = raw.trim().toLowerCase();
  if (s === 'open' || s === 'opened' || s === 'campaign_open' || s === 'campaign.open') {
    return 'OPEN';
  }
  if (s === 'click' || s === 'clicked' || s === 'url_click' || s === 'campaign.click') {
    return 'CLICK';
  }
  if (
    s === 'unsubscribe' ||
    s === 'unsubscribed' ||
    s === 'campaign.unsubscribe' ||
    s === 'subscriber.unsubscribe'
  ) {
    return 'UNSUBSCRIBE';
  }
  if (s === 'hard_bounce' || s === 'bounce_hard' || s === 'campaign.hard_bounce') {
    return 'HARD_BOUNCE';
  }
  if (s === 'soft_bounce' || s === 'bounce_soft' || s === 'bounce' || s === 'campaign.bounce') {
    return 'SOFT_BOUNCE';
  }
  if (
    s === 'complaint' ||
    s === 'complained' ||
    s === 'spam' ||
    s === 'abuse' ||
    s === 'campaign.complaint'
  ) {
    return 'COMPLAINT';
  }
  return null;
}

export class MailWizzV3Adapter implements MailWizzAdapter {
  readonly id = 'mailwizz-v3-adapter';
  readonly name = 'MailWizz 3.0.5+ / Compatible REST Adapter';
  readonly supportedMajors = [3, 2, 1];
  readonly verifiedBaselineVersion = '3.0.5';
  readonly isFictionalFutureStub = false as const;

  normalizePaginatedEnvelope<T>(
    rawPayload: unknown,
    recordNormalizer: (raw: unknown) => ContractValidationResult<T>,
    endpoint: string
  ): ContractValidationResult<InternalPaginatedPage<T>> {
    const issues: ContractValidationIssue[] = [];
    const additiveFields = new Set<string>();

    if (!rawPayload || typeof rawPayload !== 'object' || Array.isArray(rawPayload)) {
      return {
        ok: false,
        issues: [
          {
            severity: 'ERROR',
            code: 'UNEXPECTED_TYPE',
            endpoint,
            message: 'Expected paginated MailWizz JSON object envelope.',
          },
        ],
        additiveFields: [],
      };
    }

    const normalized = normalizeMailWizzEnvelope(rawPayload) as Record<string, unknown>;
    if (normalized.status === 'error') {
      return {
        ok: false,
        issues: [
          {
            severity: 'ERROR',
            code: 'ENDPOINT_UNAVAILABLE',
            endpoint,
            message: `MailWizz returned API error status: ${String(normalized.error ?? 'unknown error')}`,
          },
        ],
        additiveFields: [],
      };
    }

    const data = normalized.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return {
        ok: false,
        issues: [
          {
            severity: 'ERROR',
            code: 'MISSING_REQUIRED_FIELD',
            endpoint,
            fieldPath: 'data',
            message: 'Missing `data` object in paginated MailWizz response.',
          },
        ],
        additiveFields: [],
      };
    }

    const dataObj = data as Record<string, unknown>;
    const rawRecs = dataObj.records;
    if (rawRecs === undefined) {
      return {
        ok: false,
        issues: [
          {
            severity: 'ERROR',
            code: 'RENAMED_FIELD',
            endpoint,
            fieldPath: 'data.records',
            message: 'Expected `data.records` (or aliased `data.items`) array in paginated response.',
          },
        ],
        additiveFields: [],
      };
    }

    if (
      dataObj.count !== undefined &&
      typeof dataObj.count !== 'number' &&
      typeof dataObj.count !== 'string'
    ) {
      issues.push({
        severity: 'ERROR',
        code: 'PAGINATION_ANOMALY',
        endpoint,
        fieldPath: 'data.count',
        message: `Unexpected non-numeric data.count type (${typeof dataObj.count}).`,
      });
    }

    const nextPagePre =
      dataObj.next_page === null || dataObj.next_page === undefined
        ? null
        : Math.trunc(coerceNumberFromMailWizz(dataObj.next_page, 0)) || null;
    const totalPagesRaw =
      dataObj.total_pages === undefined
        ? Math.max(1, nextPagePre ?? 1)
        : coerceNumberFromMailWizz(dataObj.total_pages, -1);
    const currentPageRaw =
      dataObj.current_page === undefined ? 1 : coerceNumberFromMailWizz(dataObj.current_page, -1);

    if (totalPagesRaw < 0 || !Number.isFinite(totalPagesRaw)) {
      issues.push({
        severity: 'ERROR',
        code: 'PAGINATION_ANOMALY',
        endpoint,
        fieldPath: 'data.total_pages',
        message: 'Invalid `total_pages` pagination count.',
      });
    }
    if (currentPageRaw < 1 || !Number.isFinite(currentPageRaw)) {
      issues.push({
        severity: 'ERROR',
        code: 'PAGINATION_ANOMALY',
        endpoint,
        fieldPath: 'data.current_page',
        message: 'Invalid `current_page` pagination index.',
      });
    }

    const coercedRecords = coerceArrayFromPhpJson(rawRecs);
    const records: T[] = [];

    for (let idx = 0; idx < coercedRecords.length; idx++) {
      const res = recordNormalizer(coercedRecords[idx]);
      res.additiveFields.forEach((f) => additiveFields.add(f));
      if (!res.ok || !res.data) {
        issues.push(
          ...res.issues.map((iss) => ({
            ...iss,
            fieldPath: iss.fieldPath ? `records[${idx}].${iss.fieldPath}` : `records[${idx}]`,
          }))
        );
      } else {
        issues.push(...res.issues);
        records.push(res.data);
      }
    }

    const nextPageRaw =
      dataObj.next_page === null || dataObj.next_page === undefined
        ? null
        : Math.trunc(coerceNumberFromMailWizz(dataObj.next_page, 0)) || null;

    if (
      typeof nextPageRaw === 'number' &&
      currentPageRaw >= 1 &&
      nextPageRaw <= currentPageRaw
    ) {
      issues.push({
        severity: 'ERROR',
        code: 'PAGINATION_ANOMALY',
        endpoint,
        fieldPath: 'data.next_page',
        message: `Pagination loop risk: next_page (${nextPageRaw}) did not advance beyond current_page (${currentPageRaw}).`,
      });
    }

    const hasError = issues.some((i) => i.severity === 'ERROR');
    return {
      ok: !hasError,
      data: {
        records,
        totalReportedCount: Math.max(0, Math.trunc(coerceNumberFromMailWizz(dataObj.count, records.length))),
        totalPages: Math.max(0, Math.trunc(totalPagesRaw)),
        currentPage: Math.max(1, Math.trunc(currentPageRaw)),
        nextPage: nextPageRaw,
        additiveFields: Array.from(additiveFields),
      },
      issues,
      additiveFields: Array.from(additiveFields),
    };
  }

  normalizeListRecord(
    raw: unknown,
    endpoint = '/lists'
  ): ContractValidationResult<InternalMailingList> {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return {
        ok: false,
        issues: [
          {
            severity: 'ERROR',
            code: 'UNEXPECTED_TYPE',
            endpoint,
            message: 'List record must be an object.',
          },
        ],
        additiveFields: [],
      };
    }

    const normalized = normalizeMailWizzListRecord(raw) as Record<string, unknown>;
    const general =
      normalized.general && typeof normalized.general === 'object'
        ? (normalized.general as Record<string, unknown>)
        : null;
    const defaults =
      normalized.defaults && typeof normalized.defaults === 'object'
        ? (normalized.defaults as Record<string, unknown>)
        : null;

    const listUid = general ? pickFirstString(general, ['list_uid', 'uid', 'id']) : undefined;
    const name = general ? pickFirstString(general, ['name', 'display_name']) : undefined;

    const issues: ContractValidationIssue[] = [];
    if (!listUid) {
      issues.push({
        severity: 'ERROR',
        code: 'MISSING_REQUIRED_FIELD',
        endpoint,
        fieldPath: 'general.list_uid',
        message: 'Mailing list record missing required `list_uid`.',
      });
    }
    if (!name) {
      issues.push({
        severity: 'ERROR',
        code: 'MISSING_REQUIRED_FIELD',
        endpoint,
        fieldPath: 'general.name',
        message: 'Mailing list record missing required `name`.',
      });
    }

    const additiveFields = collectAdditiveKeys(raw as Record<string, unknown>, KNOWN_LIST_KEYS, 'list');
    if (additiveFields.length > 0) {
      issues.push({
        severity: 'WARNING',
        code: 'ADDITIVE_FIELDS_DETECTED',
        endpoint,
        message: `Harmless additive list fields preserved: ${additiveFields.join(', ')}`,
      });
    }

    if (issues.some((i) => i.severity === 'ERROR')) {
      return { ok: false, issues, additiveFields };
    }

    return {
      ok: true,
      data: {
        listUid: listUid!,
        name: name!,
        displayName: typeof general?.display_name === 'string' ? general.display_name : null,
        description: typeof general?.description === 'string' ? general.description : null,
        fromName: typeof defaults?.from_name === 'string' ? defaults.from_name : null,
        fromEmail: typeof defaults?.from_email === 'string' ? defaults.from_email : null,
        replyTo: typeof defaults?.reply_to === 'string' ? defaults.reply_to : null,
        optIn: typeof general?.opt_in === 'string' ? general.opt_in : null,
        optOut: typeof general?.opt_out === 'string' ? general.opt_out : null,
        subscribersCount:
          general?.subscribers_count !== undefined
            ? coerceNumberFromMailWizz(general.subscribers_count, 0)
            : normalized.subscribers_count !== undefined
              ? coerceNumberFromMailWizz(normalized.subscribers_count, 0)
              : null,
        additiveFields,
      },
      issues,
      additiveFields,
    };
  }

  normalizeSingleListResponse(
    raw: unknown,
    endpoint = '/lists/{uid}'
  ): ContractValidationResult<InternalMailingList> {
    const env = normalizeMailWizzSingleRecordEnvelope(raw) as Record<string, unknown>;
    const record =
      env?.data && typeof env.data === 'object'
        ? (env.data as Record<string, unknown>).record
        : null;
    return this.normalizeListRecord(record, endpoint);
  }

  normalizeSubscriberRecord(
    raw: unknown,
    endpoint = '/lists/{uid}/subscribers'
  ): ContractValidationResult<InternalSubscriber> {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return {
        ok: false,
        issues: [
          {
            severity: 'ERROR',
            code: 'UNEXPECTED_TYPE',
            endpoint,
            message: 'Subscriber record must be an object.',
          },
        ],
        additiveFields: [],
      };
    }

    const rawObj = raw as Record<string, unknown>;
    const normalized = normalizeMailWizzSubscriberRecord(raw) as Record<string, unknown>;
    const issues: ContractValidationIssue[] = [];

    const subscriberUid = pickFirstString(normalized, ['subscriber_uid', 'uid']);
    if (!subscriberUid) {
      const possibleRenamedId = pickFirstString(rawObj, [
        'contact_uid',
        'contact_id',
        'member_uid',
        'uuid',
      ]);
      issues.push({
        severity: 'ERROR',
        code: possibleRenamedId ? 'RENAMED_FIELD' : 'MISSING_REQUIRED_FIELD',
        endpoint,
        fieldPath: 'subscriber_uid',
        message: possibleRenamedId
          ? `Subscriber identifier appears renamed (${possibleRenamedId ? 'contact/member UID' : 'unknown'}); expected \`subscriber_uid\`.`
          : 'Subscriber record missing required `subscriber_uid`.',
      });
    }

    const emailRaw = normalized.EMAIL ?? normalized.email;
    const email = typeof emailRaw === 'string' ? emailRaw.trim().toLowerCase() : '';
    if (!email) {
      issues.push({
        severity: 'ERROR',
        code: 'MISSING_REQUIRED_FIELD',
        endpoint,
        fieldPath: 'EMAIL',
        message: 'Subscriber record missing required EMAIL/email address.',
      });
    }

    if (normalized.status !== undefined && typeof normalized.status !== 'string') {
      issues.push({
        severity: 'ERROR',
        code: 'UNEXPECTED_TYPE',
        endpoint,
        fieldPath: 'status',
        message: `Expected subscriber status string, received ${typeof normalized.status}.`,
      });
    }

    const rawStatusStr = typeof normalized.status === 'string' ? normalized.status.trim() : '';
    if (!rawStatusStr) {
      issues.push({
        severity: 'ERROR',
        code: 'MISSING_REQUIRED_FIELD',
        endpoint,
        fieldPath: 'status',
        message: 'Subscriber record missing consent/subscription `status`. Refusing to guess status.',
      });
    }

    const { status: mappedStatus, unknownStatusDetected } =
      mapStrictMailWizzSubscriberStatus(rawStatusStr);
    if (rawStatusStr && unknownStatusDetected) {
      issues.push({
        severity: 'WARNING',
        code: 'UNKNOWN_SUBSCRIBER_STATUS',
        endpoint,
        fieldPath: 'status',
        message: `Unrecognized subscriber status "${rawStatusStr}". Mapped safely to UNKNOWN without altering consent interpretation.`,
      });
    }

    const additiveFields = collectAdditiveKeys(rawObj, KNOWN_SUBSCRIBER_KEYS, 'subscriber');
    if (additiveFields.length > 0) {
      issues.push({
        severity: 'WARNING',
        code: 'ADDITIVE_FIELDS_DETECTED',
        endpoint,
        message: `Harmless additive subscriber fields preserved: ${additiveFields.join(', ')}`,
      });
    }

    if (issues.some((i) => i.severity === 'ERROR' && i.code !== 'UNKNOWN_SUBSCRIBER_STATUS')) {
      return { ok: false, issues, additiveFields };
    }

    return {
      ok: !issues.some((i) => i.severity === 'ERROR'),
      data: {
        subscriberUid: subscriberUid!,
        email,
        firstName: typeof normalized.FNAME === 'string' ? normalized.FNAME : null,
        lastName: typeof normalized.LNAME === 'string' ? normalized.LNAME : null,
        status: mappedStatus,
        rawStatus: rawStatusStr || 'missing',
        unknownStatusDetected,
        source: typeof normalized.source === 'string' ? normalized.source : null,
        dateAdded: typeof normalized.date_added === 'string' ? normalized.date_added : null,
        additiveFields,
      },
      issues,
      additiveFields,
    };
  }

  normalizeSingleSubscriberResponse(
    raw: unknown,
    endpoint = '/lists/{uid}/subscribers/{sub_uid}'
  ): ContractValidationResult<InternalSubscriber> {
    const env = normalizeMailWizzSingleRecordEnvelope(raw) as Record<string, unknown>;
    const record =
      env?.data && typeof env.data === 'object'
        ? (env.data as Record<string, unknown>).record
        : null;
    return this.normalizeSubscriberRecord(record, endpoint);
  }

  normalizeSegmentSummary(
    raw: unknown,
    endpoint = '/lists/{uid}/segments'
  ): ContractValidationResult<InternalSegmentSummary> {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return {
        ok: false,
        issues: [
          {
            severity: 'ERROR',
            code: 'UNEXPECTED_TYPE',
            endpoint,
            message: 'Segment summary must be an object.',
          },
        ],
        additiveFields: [],
      };
    }

    const obj = raw as Record<string, unknown>;
    const segmentUid = pickFirstString(obj, ['segment_uid', 'uid']);
    const name = pickFirstString(obj, ['name', 'title']);
    const issues: ContractValidationIssue[] = [];

    if (!segmentUid) {
      issues.push({
        severity: 'ERROR',
        code: 'MISSING_REQUIRED_FIELD',
        endpoint,
        fieldPath: 'segment_uid',
        message: 'Segment missing `segment_uid`.',
      });
    }
    if (!name) {
      issues.push({
        severity: 'ERROR',
        code: 'MISSING_REQUIRED_FIELD',
        endpoint,
        fieldPath: 'name',
        message: 'Segment missing `name`.',
      });
    }

    const additiveFields = collectAdditiveKeys(
      obj,
      new Set(['segment_uid', 'uid', 'name', 'title', 'subscribers_count']),
      'segment'
    );

    if (issues.some((i) => i.severity === 'ERROR')) {
      return { ok: false, issues, additiveFields };
    }

    return {
      ok: true,
      data: {
        segmentUid: segmentUid!,
        name: name!,
        subscribersCount: Math.max(
          0,
          Math.trunc(coerceNumberFromMailWizz(obj.subscribers_count, 0))
        ),
        additiveFields,
      },
      issues,
      additiveFields,
    };
  }

  normalizeSegmentDetailResponse(
    raw: unknown,
    endpoint = '/lists/{uid}/segments/{seg_uid}'
  ): ContractValidationResult<InternalSegmentDetail> {
    const env = normalizeMailWizzSingleRecordEnvelope(raw) as Record<string, unknown>;
    const record =
      env?.data && typeof env.data === 'object'
        ? (env.data as Record<string, unknown>).record
        : null;
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      return {
        ok: false,
        issues: [
          {
            severity: 'ERROR',
            code: 'MISSING_REQUIRED_FIELD',
            endpoint,
            fieldPath: 'data.record',
            message: 'Segment detail missing `data.record`.',
          },
        ],
        additiveFields: [],
      };
    }

    const rec = record as Record<string, unknown>;
    const segmentUid = pickFirstString(rec, ['segment_uid', 'uid']);
    const name = pickFirstString(rec, ['name', 'title']);
    const issues: ContractValidationIssue[] = [];

    if (!segmentUid) {
      issues.push({
        severity: 'ERROR',
        code: 'MISSING_REQUIRED_FIELD',
        endpoint,
        fieldPath: 'segment_uid',
        message: 'Segment detail missing `segment_uid`.',
      });
    }
    if (!name) {
      issues.push({
        severity: 'ERROR',
        code: 'MISSING_REQUIRED_FIELD',
        endpoint,
        fieldPath: 'name',
        message: 'Segment detail missing `name`.',
      });
    }

    if (issues.some((i) => i.severity === 'ERROR')) {
      return { ok: false, issues, additiveFields: [] };
    }

    return {
      ok: true,
      data: {
        segmentUid: segmentUid!,
        name: name!,
        operatorMatch:
          typeof rec.operator_match === 'string' && rec.operator_match.trim()
            ? rec.operator_match.trim()
            : 'all',
        subscribersCount: Math.max(
          0,
          Math.trunc(coerceNumberFromMailWizz(rec.subscribers_count, 0))
        ),
        conditions: coerceArrayFromPhpJson(rec.conditions),
        campaignConditions: coerceArrayFromPhpJson(rec.campaign_conditions),
        additiveFields: collectAdditiveKeys(
          rec,
          new Set([
            'segment_uid',
            'segment_id',
            'uid',
            'name',
            'title',
            'operator_match',
            'date_added',
            'subscribers_count',
            'conditions',
            'campaign_conditions',
          ]),
          'segmentDetail'
        ),
      },
      issues,
      additiveFields: [],
    };
  }

  normalizeCampaignSummary(
    raw: unknown,
    endpoint = '/campaigns'
  ): ContractValidationResult<InternalCampaignSummary> {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return {
        ok: false,
        issues: [
          {
            severity: 'ERROR',
            code: 'UNEXPECTED_TYPE',
            endpoint,
            message: 'Campaign summary must be an object.',
          },
        ],
        additiveFields: [],
      };
    }

    const obj = raw as Record<string, unknown>;
    const campaignUid = pickFirstString(obj, ['campaign_uid', 'uid']);
    const name = pickFirstString(obj, ['name', 'title']);
    const status = pickFirstString(obj, ['status']);
    const issues: ContractValidationIssue[] = [];

    if (!campaignUid) {
      issues.push({
        severity: 'ERROR',
        code: 'MISSING_REQUIRED_FIELD',
        endpoint,
        fieldPath: 'campaign_uid',
        message: 'Campaign summary missing `campaign_uid`.',
      });
    }
    if (!name) {
      issues.push({
        severity: 'ERROR',
        code: 'MISSING_REQUIRED_FIELD',
        endpoint,
        fieldPath: 'name',
        message: 'Campaign summary missing `name`.',
      });
    }
    if (!status) {
      issues.push({
        severity: 'ERROR',
        code: 'MISSING_REQUIRED_FIELD',
        endpoint,
        fieldPath: 'status',
        message: 'Campaign summary missing `status`.',
      });
    }

    const additiveFields = collectAdditiveKeys(obj, KNOWN_CAMPAIGN_KEYS, 'campaign');
    if (issues.some((i) => i.severity === 'ERROR')) {
      return { ok: false, issues, additiveFields };
    }

    return {
      ok: true,
      data: {
        campaignUid: campaignUid!,
        campaignIdMailwizz: pickFirstString(obj, ['campaign_id']) ?? null,
        name: name!,
        status: status!,
        additiveFields,
      },
      issues,
      additiveFields,
    };
  }

  normalizeCampaignDetailResponse(
    raw: unknown,
    endpoint = '/campaigns/{uid}'
  ): ContractValidationResult<InternalCampaignDetail> {
    const env = normalizeMailWizzSingleRecordEnvelope(raw) as Record<string, unknown>;
    const record =
      env?.data && typeof env.data === 'object'
        ? (env.data as Record<string, unknown>).record
        : null;
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      return {
        ok: false,
        issues: [
          {
            severity: 'ERROR',
            code: 'MISSING_REQUIRED_FIELD',
            endpoint,
            fieldPath: 'data.record',
            message: 'Campaign detail missing `data.record`.',
          },
        ],
        additiveFields: [],
      };
    }

    const rec = record as Record<string, unknown>;
    const campaignUid = pickFirstString(rec, ['campaign_uid', 'uid']);
    const name = pickFirstString(rec, ['name', 'title']);
    const status = pickFirstString(rec, ['status']);
    if (!campaignUid || !name || !status) {
      return {
        ok: false,
        issues: [
          {
            severity: 'ERROR',
            code: 'MISSING_REQUIRED_FIELD',
            endpoint,
            message: 'Campaign detail missing required campaign_uid/name/status.',
          },
        ],
        additiveFields: [],
      };
    }

    const listObj =
      rec.list && typeof rec.list === 'object'
        ? (rec.list as Record<string, unknown>)
        : null;
    const segObj =
      rec.segment && typeof rec.segment === 'object' && !Array.isArray(rec.segment)
        ? (rec.segment as Record<string, unknown>)
        : null;

    const additiveFields = collectAdditiveKeys(rec, KNOWN_CAMPAIGN_KEYS, 'campaignDetail');

    return {
      ok: true,
      data: {
        campaignUid,
        campaignIdMailwizz: pickFirstString(rec, ['campaign_id']) ?? null,
        name,
        subject: typeof rec.subject === 'string' ? rec.subject : null,
        type: typeof rec.type === 'string' ? rec.type : null,
        status,
        sendAt: typeof rec.send_at === 'string' ? rec.send_at : null,
        dateAdded: typeof rec.date_added === 'string' ? rec.date_added : null,
        listUid: listObj ? (pickFirstString(listObj, ['list_uid', 'uid']) ?? null) : null,
        segmentUid: segObj ? (pickFirstString(segObj, ['segment_uid', 'uid']) ?? null) : null,
        additiveFields,
      },
      issues: [],
      additiveFields,
    };
  }

  normalizeCampaignStatsResponse(
    raw: unknown,
    endpoint = '/campaigns/{uid}/stats'
  ): ContractValidationResult<InternalCampaignStats> {
    const env = normalizeMailWizzEnvelope(raw) as Record<string, unknown>;
    const data = env?.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return {
        ok: false,
        issues: [
          {
            severity: 'ERROR',
            code: 'MISSING_REQUIRED_FIELD',
            endpoint,
            fieldPath: 'data',
            message: 'Campaign stats response missing `data`.',
          },
        ],
        additiveFields: [],
      };
    }

    const d = data as Record<string, unknown>;
    const recognizedStatKeys = Object.keys(d).filter((k) => KNOWN_STATS_KEYS.has(k));
    const additiveFields = collectAdditiveKeys(d, KNOWN_STATS_KEYS, 'campaignStats');
    const issues: ContractValidationIssue[] = [];
    if (Object.keys(d).length > 0 && recognizedStatKeys.length === 0) {
      issues.push({
        severity: 'ERROR',
        code: 'RENAMED_FIELD',
        endpoint,
        fieldPath: 'data',
        message: `Campaign stats payload contains only unrecognized keys (${Object.keys(d).join(', ')}); refusing to treat renamed metrics as zero.`,
      });
      return { ok: false, issues, additiveFields };
    }
    if (additiveFields.length > 0) {
      issues.push({
        severity: 'WARNING',
        code: 'ADDITIVE_FIELDS_DETECTED',
        endpoint,
        message: `Harmless additive campaign stats fields preserved: ${additiveFields.join(', ')}`,
      });
    }

    return {
      ok: true,
      data: {
        campaignStatus: typeof d.campaign_status === 'string' ? d.campaign_status : undefined,
        subscribersCount: Math.trunc(coerceNumberFromMailWizz(d.subscribers_count, 0)),
        processedCount: Math.trunc(coerceNumberFromMailWizz(d.processed_count, 0)),
        deliverySuccessCount: Math.trunc(coerceNumberFromMailWizz(d.delivery_success_count, 0)),
        deliverySuccessRate: coerceNumberFromMailWizz(d.delivery_success_rate, 0),
        deliveryErrorCount: Math.trunc(coerceNumberFromMailWizz(d.delivery_error_count, 0)),
        deliveryErrorRate: coerceNumberFromMailWizz(d.delivery_error_rate, 0),
        opensCount: Math.trunc(coerceNumberFromMailWizz(d.opens_count, 0)),
        opensRate: coerceNumberFromMailWizz(d.opens_rate, 0),
        uniqueOpensCount: Math.trunc(coerceNumberFromMailWizz(d.unique_opens_count, 0)),
        uniqueOpensRate: coerceNumberFromMailWizz(d.unique_opens_rate, 0),
        clicksCount: Math.trunc(coerceNumberFromMailWizz(d.clicks_count, 0)),
        clicksRate: coerceNumberFromMailWizz(d.clicks_rate, 0),
        uniqueClicksCount: Math.trunc(coerceNumberFromMailWizz(d.unique_clicks_count, 0)),
        uniqueClicksRate: coerceNumberFromMailWizz(d.unique_clicks_rate, 0),
        unsubscribesCount: Math.trunc(coerceNumberFromMailWizz(d.unsubscribes_count, 0)),
        unsubscribesRate: coerceNumberFromMailWizz(d.unsubscribes_rate, 0),
        complaintsCount: Math.trunc(coerceNumberFromMailWizz(d.complaints_count, 0)),
        complaintsRate: coerceNumberFromMailWizz(d.complaints_rate, 0),
        bouncesCount: Math.trunc(coerceNumberFromMailWizz(d.bounces_count, 0)),
        bouncesRate: coerceNumberFromMailWizz(d.bounces_rate, 0),
        hardBouncesCount: Math.trunc(coerceNumberFromMailWizz(d.hard_bounces_count, 0)),
        hardBouncesRate: coerceNumberFromMailWizz(d.hard_bounces_rate, 0),
        softBouncesCount: Math.trunc(coerceNumberFromMailWizz(d.soft_bounces_count, 0)),
        softBouncesRate: coerceNumberFromMailWizz(d.soft_bounces_rate, 0),
        internalBouncesCount: Math.trunc(coerceNumberFromMailWizz(d.internal_bounces_count, 0)),
        internalBouncesRate: coerceNumberFromMailWizz(d.internal_bounces_rate, 0),
        additiveFields,
      },
      issues,
      additiveFields,
    };
  }

  normalizeBounceRecord(
    raw: unknown,
    endpoint = '/campaigns/{uid}/bounces'
  ): ContractValidationResult<InternalBounceRecord> {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return {
        ok: false,
        issues: [
          {
            severity: 'ERROR',
            code: 'UNEXPECTED_TYPE',
            endpoint,
            message: 'Bounce record must be an object.',
          },
        ],
        additiveFields: [],
      };
    }

    const norm = normalizeMailWizzBounceRecord(raw) as Record<string, unknown>;
    const sub =
      norm.subscriber && typeof norm.subscriber === 'object'
        ? (norm.subscriber as Record<string, unknown>)
        : null;
    const subscriberUid = sub ? pickFirstString(sub, ['subscriber_uid', 'uid']) : undefined;

    if (!subscriberUid) {
      return {
        ok: false,
        issues: [
          {
            severity: 'ERROR',
            code: 'MISSING_REQUIRED_FIELD',
            endpoint,
            fieldPath: 'subscriber.subscriber_uid',
            message: 'Bounce record missing subscriber identifier (`subscriber.subscriber_uid`).',
          },
        ],
        additiveFields: [],
      };
    }

    const bType = norm.bounce_type;
    const bounceType: 'hard' | 'soft' | 'internal' | 'unknown' =
      bType === 'hard' || bType === 'soft' || bType === 'internal' ? bType : 'unknown';

    const bounceIssues: ContractValidationIssue[] = [];
    if (bounceType === 'unknown') {
      bounceIssues.push({
        severity: 'WARNING',
        code: 'STATUS_SEMANTIC_DRIFT',
        endpoint,
        fieldPath: 'bounce_type',
        message: `Unfamiliar bounce_type "${String((raw as Record<string, unknown>).bounce_type ?? (raw as Record<string, unknown>).type ?? 'missing')}" preserved as unknown rather than coerced to hard bounce.`,
      });
    }

    return {
      ok: true,
      data: {
        subscriberUid,
        email: typeof sub?.email === 'string' ? sub.email : null,
        bounceType,
        message: typeof norm.message === 'string' ? norm.message : '',
        processed: norm.processed !== undefined ? String(norm.processed) : 'no',
        additiveFields: collectAdditiveKeys(
          raw as Record<string, unknown>,
          new Set(['message', 'processed', 'bounce_type', 'type', 'subscriber', 'subscriber_uid', 'uid', 'email', 'EMAIL']),
          'bounce'
        ),
      },
      issues: bounceIssues,
      additiveFields: [],
    };
  }

  normalizeActivityRecord(
    raw: unknown,
    endpoint = '/campaigns/{uid}/activity'
  ): ContractValidationResult<InternalActivityRecord> {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return {
        ok: false,
        issues: [
          {
            severity: 'ERROR',
            code: 'UNEXPECTED_TYPE',
            endpoint,
            message: 'Activity log record must be an object.',
          },
        ],
        additiveFields: [],
      };
    }

    const obj = raw as Record<string, unknown>;
    const subObj =
      obj.subscriber && typeof obj.subscriber === 'object'
        ? (obj.subscriber as Record<string, unknown>)
        : null;
    const subscriberUid =
      pickFirstString(obj, ['subscriber_uid', 'uid']) ??
      (subObj ? pickFirstString(subObj, ['subscriber_uid', 'uid']) : undefined);

    if (!subscriberUid) {
      return {
        ok: false,
        issues: [
          {
            severity: 'ERROR',
            code: 'MISSING_REQUIRED_FIELD',
            endpoint,
            fieldPath: 'subscriber_uid',
            message: 'Activity log record missing `subscriber_uid`.',
          },
        ],
        additiveFields: [],
      };
    }

    return {
      ok: true,
      data: {
        subscriberUid,
        occurredAt: pickFirstString(obj, ['date_added', 'created_at', 'occurred_at']) ?? null,
        status: pickFirstString(obj, ['status']) ?? null,
        additiveFields: collectAdditiveKeys(
          obj,
          new Set(['subscriber_uid', 'uid', 'date_added', 'created_at', 'occurred_at', 'status', 'subscriber']),
          'activity'
        ),
      },
      issues: [],
      additiveFields: [],
    };
  }

  normalizeWebhookPayload(rawPayload: unknown): {
    events: InternalWebhookEvent[];
    issues: ContractValidationIssue[];
  } {
    const list = Array.isArray(rawPayload) ? rawPayload : [rawPayload];
    const events: InternalWebhookEvent[] = [];
    const issues: ContractValidationIssue[] = [];

    for (let idx = 0; idx < list.length; idx++) {
      const item = list[idx];
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        issues.push({
          severity: 'ERROR',
          code: 'WEBHOOK_FORMAT_CHANGE',
          endpoint: '/api/webhooks/mailwizz',
          fieldPath: `payload[${idx}]`,
          message: 'Webhook item is not a JSON object.',
        });
        continue;
      }

      const obj = item as Record<string, unknown>;
      const dataObj =
        obj.data && typeof obj.data === 'object' && !Array.isArray(obj.data)
          ? (obj.data as Record<string, unknown>)
          : {};
      const eventObj =
        obj.event && typeof obj.event === 'object'
          ? (obj.event as Record<string, unknown>)
          : obj;
      const campObj =
        obj.campaign && typeof obj.campaign === 'object'
          ? (obj.campaign as Record<string, unknown>)
          : dataObj;
      const subObj =
        obj.subscriber && typeof obj.subscriber === 'object'
          ? (obj.subscriber as Record<string, unknown>)
          : dataObj;
      const listObj =
        obj.list && typeof obj.list === 'object'
          ? (obj.list as Record<string, unknown>)
          : dataObj;

      const rawEventType = String(
        eventObj.type ??
          (typeof obj.event === 'string' ? obj.event : undefined) ??
          obj.event_type ??
          obj.type ??
          eventObj.name ??
          ''
      ).trim();
      const campaignUid = String(
        campObj.uid ?? campObj.campaign_uid ?? obj.campaign_uid ?? dataObj.campaign_uid ?? ''
      ).trim();
      const subscriberUid = String(
        subObj.uid ?? subObj.subscriber_uid ?? obj.subscriber_uid ?? dataObj.subscriber_uid ?? ''
      ).trim();
      const listUid =
        String(
          listObj.list_uid ??
            listObj.uid ??
            obj.list_uid ??
            dataObj.list_uid ??
            subObj.list_uid ??
            ''
        ).trim() || undefined;
      const eventId =
        String(
          eventObj.id ?? eventObj.event_id ?? obj.event_id ?? dataObj.event_id ?? ''
        ).trim() || undefined;
      const tsRaw = eventObj.timestamp ?? obj.timestamp ?? obj.date_added ?? obj.occurred_at;
      const timestamp =
        typeof tsRaw === 'string' || typeof tsRaw === 'number' ? tsRaw : undefined;

      const itemWarnings: string[] = [];
      if (!rawEventType || !campaignUid || !subscriberUid) {
        issues.push({
          severity: 'ERROR',
          code: 'WEBHOOK_FORMAT_CHANGE',
          endpoint: '/api/webhooks/mailwizz',
          fieldPath: `payload[${idx}]`,
          message:
            'Webhook item missing required event_type, campaign_uid, or subscriber_uid field.',
        });
        continue;
      }

      const mapped = mapWebhookEventType(rawEventType);
      if (!mapped) {
        issues.push({
          severity: 'WARNING',
          code: 'WEBHOOK_FORMAT_CHANGE',
          endpoint: '/api/webhooks/mailwizz',
          fieldPath: `payload[${idx}].event_type`,
          message: `Unrecognized webhook event type "${rawEventType}" safely ignored.`,
        });
        itemWarnings.push(`Unknown event_type "${rawEventType}"`);
      }

      events.push({
        eventType: mapped,
        rawEventType,
        timestamp,
        campaignUid,
        subscriberUid,
        listUid,
        eventId,
        contractWarnings: itemWarnings,
      });
    }

    return { events, issues };
  }
}

export const mailWizzV3Adapter = new MailWizzV3Adapter();
