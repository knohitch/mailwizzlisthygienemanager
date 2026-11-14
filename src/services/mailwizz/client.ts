import { z } from 'zod';
import { logger } from '@/services/security/logger';
import {
  buildMailWizzAuthHeaders,
  type MailWizzAuthMode,
} from './compat';
import { mailWizzVersionDetector } from './version-detector';
import {
  MailWizzCampaignActivityRecordSchema,
  MailWizzCampaignBounceRecordSchema,
  MailWizzCampaignDetailSchema,
  MailWizzCampaignStatsSchema,
  MailWizzCampaignSummarySchema,
  MailWizzConditionOperatorsResponseSchema,
  MailWizzListFieldsResponseSchema,
  MailWizzListRecordSchema,
  MailWizzPaginatedEnvelopeSchema,
  MailWizzSegmentDetailSchema,
  MailWizzSegmentSummarySchema,
  MailWizzSingleListResponseSchema,
  MailWizzSingleSubscriberResponseSchema,
  MailWizzSubscriberRecordSchema,
  type MailWizzClientOptions,
} from './types';

export class MailWizzApiError extends Error {
  readonly statusCode: number;
  readonly retryable: boolean;
  readonly endpoint: string;

  constructor(
    message: string,
    opts: { statusCode: number; retryable: boolean; endpoint: string }
  ) {
    super(message);
    this.name = 'MailWizzApiError';
    this.statusCode = opts.statusCode;
    this.retryable = opts.retryable;
    this.endpoint = opts.endpoint;
  }
}

export class ReadOnlyGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReadOnlyGuardError';
  }
}

const FORBIDDEN_READONLY_PATH_FRAGMENTS = [
  'track-opening',
  'track-url',
  'track-unsubscribe',
  '/tracking/',
  '/tracking/open',
  '/tracking/click',
  '/tracking/unsubscribe',
  '/unsubscribe',
  '/pause-unpause',
  '/mark-sent',
  '/copy',
  '/bulk',
];

const RETRYABLE_HTTP_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export function normalizeMailWizzBaseUrl(
  rawUrl: string,
  allowInsecureHttp = false
): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error('Invalid MailWizz API URL format.');
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('MailWizz API URL must use https:// (or http:// only if explicitly allowed in dev).');
  }

  if (parsed.protocol === 'http:' && !allowInsecureHttp) {
    throw new Error(
      'TLS is required for MailWizz API communication (use https://, or set ALLOW_INSECURE_MAILWIZZ_HTTP=true for local mock testing).'
    );
  }

  // Strip trailing slashes so path concatenation is deterministic
  return parsed.toString().replace(/\/+$/, '');
}

export class MailWizzClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly authMode: MailWizzAuthMode;
  private readonly remoteAddr: string;
  private readonly maxRequestsPerSecond: number;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof fetch;
  private nextAvailableSlotMs = 0;
  private detectedServerVersion: string | null = null;

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
    this.maxRequestsPerSecond = Math.max(1, Math.min(50, options.maxRequestsPerSecond ?? 5));
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.maxRetries = options.maxRetries ?? 3;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async waitForRateLimitSlot(): Promise<void> {
    const minIntervalMs = Math.ceil(1000 / this.maxRequestsPerSecond);
    const now = Date.now();
    const waitMs = Math.max(0, this.nextAvailableSlotMs - now);
    this.nextAvailableSlotMs = Math.max(now, this.nextAvailableSlotMs) + minIntervalMs;
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }

  private assertReadOnlySafeEndpoint(path: string, method: string): void {
    if (method.toUpperCase() !== 'GET') {
      throw new ReadOnlyGuardError(
        `Phase 1 read-only guard blocked non-GET method "${method}" on "${path}".`
      );
    }
    const lower = path.toLowerCase();
    for (const fragment of FORBIDDEN_READONLY_PATH_FRAGMENTS) {
      if (lower.includes(fragment)) {
        throw new ReadOnlyGuardError(
          `Phase 1 read-only guard blocked prohibited tracking/mutation path "${path}" (matched "${fragment}").`
        );
      }
    }
  }

  /**
   * Executes a rate-limited, strictly read-only (`GET`) request and returns raw parsed JSON
   * plus detected server version headers. Blocks all `/tracking/*` and mutation paths.
   */
  async getRawJson(
    path: string,
    query?: Record<string, string | number | undefined>
  ): Promise<{ rawJson: unknown; headers: Headers }> {
    this.assertReadOnlySafeEndpoint(path, 'GET');

    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(`${this.baseUrl}${cleanPath}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== '') {
          url.searchParams.set(k, String(v));
        }
      }
    }

    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      await this.waitForRateLimitSlot();

      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const authHeaders = buildMailWizzAuthHeaders({
          apiKey: this.apiKey,
          authMode: this.authMode,
          method: 'GET',
          requestUrl: url.toString(),
          remoteAddr: this.remoteAddr,
        });

        const response = await this.fetchImpl(url.toString(), {
          method: 'GET',
          headers: {
            ...authHeaders,
            Accept: 'application/json',
          },
          signal: controller.signal,
        });

        clearTimeout(timeoutHandle);

        if (!response.ok) {
          const retryable = RETRYABLE_HTTP_STATUS.has(response.status);
          let errorDetail = `HTTP ${response.status}`;
          try {
            const errBody = (await response.json()) as { error?: unknown };
            if (errBody?.error) {
              errorDetail = `${errorDetail}: ${
                typeof errBody.error === 'string'
                  ? errBody.error
                  : JSON.stringify(errBody.error)
              }`;
            }
          } catch {
            // ignore non-json error body
          }

          const apiError = new MailWizzApiError(errorDetail, {
            statusCode: response.status,
            retryable,
            endpoint: cleanPath,
          });

          if (retryable && attempt < this.maxRetries) {
            const retryAfterHeader = response.headers.get('retry-after');
            const retryAfterMs = retryAfterHeader
              ? (Number(retryAfterHeader) || 1) * 1000
              : Math.min(15_000, 500 * 2 ** attempt + Math.floor(Math.random() * 250));
            logger.warn('MailWizz API transient HTTP response; retrying', {
              endpoint: cleanPath,
              statusCode: response.status,
              attempt: attempt + 1,
              retryAfterMs,
            });
            await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
            lastError = apiError;
            continue;
          }

          throw apiError;
        }

        const rawJson: unknown = await response.json();
        const detectedVersion = mailWizzVersionDetector.extractVersionFromHttpResponse(
          response.headers,
          rawJson
        );
        if (detectedVersion) {
          this.detectedServerVersion = detectedVersion;
        }
        return { rawJson, headers: response.headers };
      } catch (err) {
        clearTimeout(timeoutHandle);
        if (err instanceof ReadOnlyGuardError) {
          throw err;
        }
        if (err instanceof MailWizzApiError && !err.retryable) {
          throw err;
        }

        lastError = err;
        if (attempt < this.maxRetries) {
          const backoffMs = Math.min(
            15_000,
            500 * 2 ** attempt + Math.floor(Math.random() * 250)
          );
          logger.warn('MailWizz API request failed; backing off', {
            endpoint: cleanPath,
            attempt: attempt + 1,
            backoffMs,
            error: err instanceof Error ? err.message : 'unknown',
          });
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
          continue;
        }
      }
    }

    if (lastError instanceof Error) {
      throw lastError;
    }
    throw new MailWizzApiError('MailWizz API request failed after retries', {
      statusCode: 503,
      retryable: true,
      endpoint: cleanPath,
    });
  }

  async getJson<T extends z.ZodTypeAny>(
    path: string,
    schema: T,
    query?: Record<string, string | number | undefined>
  ): Promise<z.infer<T>> {
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    const { rawJson } = await this.getRawJson(cleanPath, query);
    const parsed = schema.safeParse(rawJson);
    if (!parsed.success) {
      throw new MailWizzApiError(
        `Unexpected MailWizz API response shape at ${cleanPath}: ${parsed.error.issues[0]?.message ?? 'validation failed'}`,
        {
          statusCode: 502,
          retryable: false,
          endpoint: cleanPath,
        }
      );
    }

    const dataObj = parsed.data as { status?: string; error?: unknown };
    if (dataObj.status === 'error') {
      throw new MailWizzApiError(
        `MailWizz API returned error at ${cleanPath}: ${String(dataObj.error ?? 'unknown error')}`,
        {
          statusCode: 400,
          retryable: false,
          endpoint: cleanPath,
        }
      );
    }

    return parsed.data;
  }

  async paginateAll<T extends z.ZodTypeAny>(
    path: string,
    recordSchema: T,
    perPage = 50,
    extraQuery?: Record<string, string | number | undefined>,
    onPage?: (page: number, totalPages: number) => Promise<void> | void
  ): Promise<{ records: Array<z.infer<T>>; totalReportedCount: number }> {
    const envelopeSchema = MailWizzPaginatedEnvelopeSchema(recordSchema);
    const records: Array<z.infer<T>> = [];
    let currentPage = 1;
    let effectivePerPage = Math.max(1, perPage);
    let totalReportedCount = 0;
    const maxPagesSafety = 10_000;
    const seenPages = new Set<number>();

    while (currentPage <= maxPagesSafety) {
      if (seenPages.has(currentPage)) break;
      seenPages.add(currentPage);

      let response: z.infer<typeof envelopeSchema>;
      try {
        response = await this.getJson(path, envelopeSchema, {
          ...extraQuery,
          page: currentPage,
          per_page: effectivePerPage,
        });
      } catch (err) {
        // Older or future MailWizz installs may enforce smaller per_page caps (e.g., max 50)
        if (
          err instanceof MailWizzApiError &&
          (err.statusCode === 400 || err.statusCode === 422) &&
          effectivePerPage > 25 &&
          currentPage === 1
        ) {
          effectivePerPage = effectivePerPage > 50 ? 50 : 25;
          seenPages.delete(currentPage);
          continue;
        }
        throw err;
      }

      const data = response.data;
      if (!data) break;

      if (currentPage === 1) {
        totalReportedCount = data.count;
      }

      records.push(...data.records);
      if (onPage) {
        await onPage(currentPage, data.total_pages);
      }

      const computedNext =
        data.next_page ?? (currentPage < data.total_pages ? currentPage + 1 : null);

      if (!computedNext || currentPage >= data.total_pages || data.records.length === 0) {
        break;
      }
      currentPage = computedNext;
    }

    return { records, totalReportedCount };
  }

  getDetectedServerVersion(): string | null {
    return this.detectedServerVersion;
  }

  async validateConnection(): Promise<{
    ok: boolean;
    listCount: number;
    detectedVersion: string | null;
    message: string;
  }> {
    const envelope = MailWizzPaginatedEnvelopeSchema(MailWizzListRecordSchema);
    const res = await this.getJson('/lists', envelope, { page: 1, per_page: 10 });
    const count = res.data?.count ?? 0;
    const versionSuffix = this.detectedServerVersion
      ? ` (MailWizz ${this.detectedServerVersion})`
      : '';
    return {
      ok: true,
      listCount: count,
      detectedVersion: this.detectedServerVersion,
      message: `Connected via ${this.authMode}${versionSuffix}. Discovered ${count} list(s).`,
    };
  }

  async getLists(perPage = 50) {
    return this.paginateAll('/lists', MailWizzListRecordSchema, perPage);
  }

  async getList(listUid: string) {
    return this.getJson(`/lists/${encodeURIComponent(listUid)}`, MailWizzSingleListResponseSchema);
  }

  async getSubscribers(
    listUid: string,
    options?: {
      perPage?: number;
      status?: string;
      onPage?: (page: number, totalPages: number) => Promise<void> | void;
    }
  ) {
    return this.paginateAll(
      `/lists/${encodeURIComponent(listUid)}/subscribers`,
      MailWizzSubscriberRecordSchema,
      options?.perPage ?? 50,
      options?.status ? { status: options.status } : undefined,
      options?.onPage
    );
  }

  async getSegments(listUid: string, perPage = 50) {
    return this.paginateAll(
      `/lists/${encodeURIComponent(listUid)}/segments`,
      MailWizzSegmentSummarySchema,
      perPage
    );
  }

  async getSegmentDetails(listUid: string, segmentUid: string) {
    return this.getJson(
      `/lists/${encodeURIComponent(listUid)}/segments/${encodeURIComponent(segmentUid)}`,
      MailWizzSegmentDetailSchema
    );
  }

  async getSegmentSubscribers(listUid: string, segmentUid: string, perPage = 50) {
    return this.paginateAll(
      `/lists/${encodeURIComponent(listUid)}/segments/${encodeURIComponent(segmentUid)}/subscribers`,
      MailWizzSubscriberRecordSchema,
      perPage
    );
  }

  async getCampaigns(perPage = 50) {
    return this.paginateAll('/campaigns', MailWizzCampaignSummarySchema, perPage);
  }

  async getCampaign(campaignUid: string) {
    return this.getJson(
      `/campaigns/${encodeURIComponent(campaignUid)}`,
      MailWizzCampaignDetailSchema
    );
  }

  async getCampaignStats(campaignUid: string) {
    return this.getJson(
      `/campaigns/${encodeURIComponent(campaignUid)}/stats`,
      MailWizzCampaignStatsSchema
    );
  }

  async getCampaignBounces(campaignUid: string, perPage = 50) {
    return this.paginateAll(
      `/campaigns/${encodeURIComponent(campaignUid)}/bounces`,
      MailWizzCampaignBounceRecordSchema,
      perPage
    );
  }

  async getSubscriber(listUid: string, subscriberUid: string) {
    return this.getJson(
      `/lists/${encodeURIComponent(listUid)}/subscribers/${encodeURIComponent(subscriberUid)}`,
      MailWizzSingleSubscriberResponseSchema
    );
  }

  async getListFields(listUid: string) {
    return this.getJson(
      `/lists/${encodeURIComponent(listUid)}/fields`,
      MailWizzListFieldsResponseSchema
    );
  }

  async getSegmentConditionOperators() {
    return this.getJson(
      '/lists/segments/condition-operators',
      MailWizzConditionOperatorsResponseSchema
    );
  }

  /**
   * Forward-compatibility probe for future MailWizz releases (3.1+ / 4.x) that may
   * add read-only delivery/open/click/complaint REST endpoints. Returns `supported: false`
   * cleanly on HTTP 404/405/501 without disrupting older MailWizz versions, and always
   * enforces the read-only guard blocking tracking triggers.
   */
  async tryReadOnlyCampaignActivityEndpoint(
    campaignUid: string,
    subpath: 'delivery-logs' | 'opens' | 'clicks' | 'complaints',
    perPage = 50
  ): Promise<{
    supported: boolean;
    records: Array<z.infer<typeof MailWizzCampaignActivityRecordSchema>>;
  }> {
    const path = `/campaigns/${encodeURIComponent(campaignUid)}/${subpath}`;
    try {
      const res = await this.paginateAll(
        path,
        MailWizzCampaignActivityRecordSchema,
        perPage
      );
      return { supported: true, records: res.records };
    } catch (err) {
      if (
        err instanceof MailWizzApiError &&
        (err.statusCode === 404 || err.statusCode === 405 || err.statusCode === 501)
      ) {
        return { supported: false, records: [] };
      }
      logger.warn('Optional MailWizz activity endpoint check failed', {
        endpoint: path,
        error: err instanceof Error ? err.message : 'unknown',
      });
      return { supported: false, records: [] };
    }
  }
}
