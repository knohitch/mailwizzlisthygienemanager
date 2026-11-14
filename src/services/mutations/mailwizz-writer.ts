import { z } from 'zod';
import { getEnv } from '@/lib/env';
import {
  MailWizzApiError,
  normalizeMailWizzBaseUrl,
  ReadOnlyGuardError,
} from '@/services/mailwizz/client';
import {
  buildMailWizzAuthHeaders,
  type MailWizzAuthMode,
} from '@/services/mailwizz/compat';
import {
  MailWizzBulkSubscribersResponseSchema,
  MailWizzCreateListResponseSchema,
  MailWizzSegmentMutationResponseSchema,
  MailWizzSimpleStatusResponseSchema,
  MailWizzSingleListResponseSchema,
  MailWizzSingleSubscriberResponseSchema,
  type MailWizzClientOptions,
} from '@/services/mailwizz/types';
import { recordAuditLog } from '@/services/security/audit';
import { logger } from '@/services/security/logger';

export class MutationGateLockedError extends Error {
  constructor(action: string) {
    super(
      `MailWizz mutation "${action}" is disabled (ENABLE_MAILWIZZ_MUTATIONS=false). Use DRY RUN or enable mutations explicitly after review.`
    );
    this.name = 'MutationGateLockedError';
  }
}

export class UnsafeOperationBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeOperationBlockedError';
  }
}

export function isMailWizzMutationsEnabled(): boolean {
  return getEnv().ENABLE_MAILWIZZ_MUTATIONS === true;
}

const PERMANENTLY_FORBIDDEN_WRITE_PATHS = [
  'track-opening',
  'track-url',
  'track-unsubscribe',
  '/tracking/',
  '/tracking/open',
  '/tracking/click',
  '/tracking/unsubscribe',
  'unsubscribe-by-email',
];

const RETRYABLE_HTTP_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function assertSafeMutationRequest(method: string, path: string): void {
  const upper = method.toUpperCase();
  if (upper === 'DELETE') {
    throw new UnsafeOperationBlockedError(
      'Permanent subscriber/list DELETE operations are prohibited during hygiene cleanup.'
    );
  }
  const lower = path.toLowerCase();
  for (const frag of PERMANENTLY_FORBIDDEN_WRITE_PATHS) {
    if (lower.includes(frag)) {
      throw new ReadOnlyGuardError(
        `Safety violation: Endpoint fragment "${frag}" is permanently blocked.`
      );
    }
  }
}

/**
 * Serializes nested objects/arrays into PHP/MailWizz application/x-www-form-urlencoded keys,
 * e.g. general[name]=Clean&subscribers[0][EMAIL]=a@example.com
 */
export function encodeMailWizzForm(
  obj: unknown,
  prefix = '',
  out = new URLSearchParams()
): URLSearchParams {
  if (obj === null || obj === undefined) return out;

  if (Array.isArray(obj)) {
    obj.forEach((item, index) => {
      const key = prefix ? `${prefix}[${index}]` : String(index);
      encodeMailWizzForm(item, key, out);
    });
    return out;
  }

  if (typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (v === undefined || v === null) continue;
      const key = prefix ? `${prefix}[${k}]` : k;
      encodeMailWizzForm(v, key, out);
    }
    return out;
  }

  if (prefix) {
    out.append(prefix, String(obj));
  }
  return out;
}

export class MailWizzMutationClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly authMode: MailWizzAuthMode;
  private readonly remoteAddr: string;
  private readonly maxRequestsPerSecond: number;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof fetch;
  private nextAvailableSlotMs = 0;

  constructor(options: MailWizzClientOptions) {
    if (!options.apiKey || options.apiKey.trim().length < 6) {
      throw new Error('MailWizz API key is required.');
    }
    this.baseUrl = normalizeMailWizzBaseUrl(
      options.apiUrl,
      options.allowInsecureHttp ?? false
    );
    this.apiKey = options.apiKey.trim();
    this.authMode = options.authMode ?? 'auto';
    this.remoteAddr = options.remoteAddr ?? '127.0.0.1';
    this.maxRequestsPerSecond = Math.max(
      1,
      Math.min(20, options.maxRequestsPerSecond ?? 3)
    );
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.maxRetries = options.maxRetries ?? 3;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async waitForRateLimitSlot(): Promise<void> {
    const intervalMs = Math.ceil(1000 / this.maxRequestsPerSecond);
    const now = Date.now();
    const scheduled = Math.max(now, this.nextAvailableSlotMs);
    this.nextAvailableSlotMs = scheduled + intervalMs;
    const delayMs = scheduled - now;
    if (delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  private computeBackoffMs(attempt: number, retryAfterHeader?: string | null): number {
    if (retryAfterHeader) {
      const seconds = Number(retryAfterHeader);
      if (!Number.isNaN(seconds) && seconds > 0) {
        return Math.min(seconds * 1000, 30_000);
      }
    }
    const base = 500 * Math.pow(2, attempt);
    const jitter = Math.floor(Math.random() * 250);
    return Math.min(base + jitter, 20_000);
  }

  private async requestJson<S extends z.ZodTypeAny>(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    schema: S,
    formPayload?: Record<string, unknown>,
    options?: { skipMutationGateForRead?: boolean; actorEmail?: string }
  ): Promise<z.infer<S>> {
    assertSafeMutationRequest(method, path);

    if (!options?.skipMutationGateForRead && method !== 'GET') {
      if (!isMailWizzMutationsEnabled()) {
        await recordAuditLog({
          actorEmail: options?.actorEmail ?? 'system',
          action: `BLOCKED_MUTATION_${method}`,
          resourceType: 'MailWizzMutationGate',
          resourceId: path,
          outcome: 'DENIED',
          details: { reason: 'ENABLE_MAILWIZZ_MUTATIONS=false' },
        });
        throw new MutationGateLockedError(`${method} ${path}`);
      }
    }

    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    const url = `${this.baseUrl}${cleanPath}`;

    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      await this.waitForRateLimitSlot();

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const encodedParams = formPayload ? encodeMailWizzForm(formPayload) : undefined;
        const encoded = encodedParams ? encodedParams.toString() : undefined;
        const bodyParamsForSig: Record<string, string> | undefined = encodedParams
          ? Object.fromEntries(encodedParams.entries())
          : undefined;
        const authHeaders = buildMailWizzAuthHeaders({
          apiKey: this.apiKey,
          authMode: this.authMode,
          method,
          requestUrl: url,
          remoteAddr: this.remoteAddr,
          bodyParams: bodyParamsForSig,
        });
        const response = await this.fetchImpl(url, {
          method,
          headers: {
            ...authHeaders,
            Accept: 'application/json',
            ...(encoded
              ? { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' }
              : {}),
          },
          body: encoded,
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (!response.ok) {
          const retryable = RETRYABLE_HTTP_STATUS.has(response.status);
          const err = new MailWizzApiError(
            `MailWizz ${method} ${cleanPath} failed with HTTP ${response.status}`,
            { statusCode: response.status, retryable, endpoint: cleanPath }
          );
          if (retryable && attempt < this.maxRetries) {
            const delay = this.computeBackoffMs(attempt, response.headers.get('retry-after'));
            logger.warn('Transient MailWizz mutation HTTP error, backing off', {
              method,
              endpoint: cleanPath,
              statusCode: response.status,
              attempt: attempt + 1,
              delayMs: delay,
            });
            await new Promise((r) => setTimeout(r, delay));
            continue;
          }
          throw err;
        }

        const rawJson: unknown = await response.json();
        const parsed = schema.parse(rawJson);
        const envelope = parsed as { status?: string; error?: unknown };
        if (envelope.status === 'error') {
          throw new MailWizzApiError(
            `MailWizz ${method} ${cleanPath} returned API error: ${typeof envelope.error === 'string' ? envelope.error : JSON.stringify(envelope.error ?? 'Unknown')}`,
            { statusCode: response.status, retryable: false, endpoint: cleanPath }
          );
        }
        return parsed;
      } catch (err) {
        clearTimeout(timer);
        lastError = err;
        if (err instanceof MailWizzApiError && !err.retryable) throw err;
        if (err instanceof ReadOnlyGuardError || err instanceof MutationGateLockedError || err instanceof UnsafeOperationBlockedError) {
          throw err;
        }
        if (attempt < this.maxRetries) {
          const delay = this.computeBackoffMs(attempt);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        throw err;
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(`MailWizz ${method} ${cleanPath} failed`);
  }

  async getRemoteSubscriber(listUid: string, subscriberUid: string) {
    return this.requestJson(
      'GET',
      `/lists/${encodeURIComponent(listUid)}/subscribers/${encodeURIComponent(subscriberUid)}`,
      MailWizzSingleSubscriberResponseSchema,
      undefined,
      { skipMutationGateForRead: true }
    );
  }

  async getRemoteSubscriberByEmail(listUid: string, email: string) {
    return this.requestJson(
      'GET',
      `/lists/${encodeURIComponent(listUid)}/subscribers/search-by-email?EMAIL=${encodeURIComponent(email)}`,
      MailWizzSingleSubscriberResponseSchema,
      undefined,
      { skipMutationGateForRead: true }
    );
  }

  /**
   * Read-only membership confirmation before source-list unsubscribe during MOVE_SUBSCRIBERS.
   */
  async verifySubscriberMembershipInList(params: {
    listUid: string;
    subscriberUid?: string;
    email: string;
  }): Promise<{ confirmedPresent: boolean; subscriberUid?: string }> {
    const normalizedTargetEmail = params.email.trim().toLowerCase();
    if (params.subscriberUid) {
      try {
        const res = await this.getRemoteSubscriber(params.listUid, params.subscriberUid);
        const rec = res.data?.record;
        const remoteEmail = (rec?.EMAIL ?? rec?.email ?? '').trim().toLowerCase();
        if (rec?.subscriber_uid && remoteEmail === normalizedTargetEmail) {
          return { confirmedPresent: true, subscriberUid: rec.subscriber_uid };
        }
      } catch {
        // Fall back to search-by-email below
      }
    }

    const searchRes = await this.getRemoteSubscriberByEmail(params.listUid, normalizedTargetEmail);
    const rec = searchRes.data?.record;
    const remoteEmail = (rec?.EMAIL ?? rec?.email ?? '').trim().toLowerCase();
    if (rec?.subscriber_uid && remoteEmail === normalizedTargetEmail) {
      return { confirmedPresent: true, subscriberUid: rec.subscriber_uid };
    }
    return { confirmedPresent: false };
  }

  async getRemoteList(listUid: string) {
    return this.requestJson(
      'GET',
      `/lists/${encodeURIComponent(listUid)}`,
      MailWizzSingleListResponseSchema,
      undefined,
      { skipMutationGateForRead: true }
    );
  }

  async createList(params: {
    name: string;
    description: string;
    fromName: string;
    fromEmail: string;
    replyTo: string;
    subject?: string;
    optIn?: 'single' | 'double';
    optOut?: 'single' | 'double';
    actorEmail: string;
  }): Promise<{ listUid: string }> {
    const res = await this.requestJson(
      'POST',
      '/lists',
      MailWizzCreateListResponseSchema,
      {
        general: {
          name: params.name,
          description: params.description,
          opt_in: params.optIn ?? 'single',
          opt_out: params.optOut ?? 'single',
        },
        defaults: {
          from_name: params.fromName,
          from_email: params.fromEmail,
          reply_to: params.replyTo,
          subject: params.subject ?? `${params.name} Update`,
        },
      },
      { actorEmail: params.actorEmail }
    );

    const listUid =
      res.list_uid ??
      res.data?.record?.list_uid ??
      res.data?.record?.general?.list_uid;

    if (!listUid) {
      throw new Error('MailWizz createList succeeded but did not return list_uid.');
    }

    return { listUid };
  }

  async createOrUpdateSegment(params: {
    listUid: string;
    segmentUid?: string;
    name: string;
    operatorMatch: 'any' | 'all';
    conditions?: Array<{ field_id: string; operator_id: string; value: string }>;
    campaignConditions?: Array<{
      action: 'click' | 'open';
      campaign_id?: string;
      time_comparison_operator: 'lte' | 'lt' | 'gte' | 'gt' | 'eq';
      time_value: number;
      time_unit: 'day' | 'month' | 'year';
    }>;
    actorEmail: string;
  }): Promise<{ segmentUid: string }> {
    const path = params.segmentUid
      ? `/lists/${encodeURIComponent(params.listUid)}/segments/${encodeURIComponent(params.segmentUid)}`
      : `/lists/${encodeURIComponent(params.listUid)}/segments`;

    const res = await this.requestJson(
      params.segmentUid ? 'PUT' : 'POST',
      path,
      MailWizzSegmentMutationResponseSchema,
      {
        name: params.name,
        operator_match: params.operatorMatch,
        ...(params.conditions && params.conditions.length > 0
          ? { conditions: params.conditions }
          : {}),
        ...(params.campaignConditions && params.campaignConditions.length > 0
          ? { campaign_conditions: params.campaignConditions }
          : {}),
      },
      { actorEmail: params.actorEmail }
    );

    const segmentUid = res.data?.record?.segment_uid ?? params.segmentUid;
    if (!segmentUid) {
      throw new Error('MailWizz segment mutation did not return segment_uid.');
    }

    return { segmentUid };
  }

  async createSubscribersBulk(params: {
    targetListUid: string;
    targetListOptIn: string | null | undefined;
    subscribers: Array<{
      EMAIL: string;
      FNAME?: string;
      LNAME?: string;
    }>;
    actorEmail: string;
  }): Promise<{ acceptedCount: number; subscriberUids: string[] }> {
    // Safety rule: copying subscribers must NOT automatically dispatch confirmation/welcome emails.
    // MailWizz 3.x POST /subscribers/bulk triggers confirmation emails if target list uses double opt-in.
    if (params.targetListOptIn?.toLowerCase() !== 'single') {
      throw new UnsafeOperationBlockedError(
        `Refused bulk copy into list ${params.targetListUid}: target list opt_in is "${params.targetListOptIn ?? 'unknown'}". MailWizz triggers confirmation emails on bulk create unless opt_in is explicitly verified as "single".`
      );
    }

    const res = await this.requestJson(
      'POST',
      `/lists/${encodeURIComponent(params.targetListUid)}/subscribers/bulk`,
      MailWizzBulkSubscribersResponseSchema,
      {
        subscribers: params.subscribers,
      },
      { actorEmail: params.actorEmail }
    );

    const records = res.data?.records;
    if (!records || records.length === 0) {
      return { acceptedCount: 0, subscriberUids: [] };
    }

    const acceptedRecords = records.filter((r) => r.status !== 'error');
    const subscriberUids = acceptedRecords
      .map((r) => r.subscriber_uid)
      .filter((u): u is string => typeof u === 'string' && u.length > 0);
    return {
      acceptedCount: acceptedRecords.length,
      subscriberUids,
    };
  }

  /**
   * Executes silent single-list unsubscribe across MailWizz 1.x / 2.x / 3.x / future versions:
   * prefers PUT /lists/{LIST_UID}/subscribers/{SUBSCRIBER_UID}/unsubscribe, and falls back on
   * HTTP 404/405 to PUT /lists/{LIST_UID}/subscribers/{SUBSCRIBER_UID} (status=unsubscribed).
   */
  async unsubscribeSubscriber(params: {
    listUid: string;
    subscriberUid: string;
    actorEmail: string;
  }): Promise<{ ok: true }> {
    const baseSubPath = `/lists/${encodeURIComponent(params.listUid)}/subscribers/${encodeURIComponent(params.subscriberUid)}`;
    try {
      await this.requestJson(
        'PUT',
        `${baseSubPath}/unsubscribe`,
        MailWizzSimpleStatusResponseSchema,
        {},
        { actorEmail: params.actorEmail }
      );
    } catch (err) {
      if (
        err instanceof MailWizzApiError &&
        (err.statusCode === 404 || err.statusCode === 405)
      ) {
        await this.requestJson(
          'PUT',
          baseSubPath,
          MailWizzSimpleStatusResponseSchema,
          { status: 'unsubscribed' },
          { actorEmail: params.actorEmail }
        );
      } else {
        throw err;
      }
    }
    return { ok: true };
  }
}
