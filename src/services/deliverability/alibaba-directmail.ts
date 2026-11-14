import crypto from 'node:crypto';
import { parse } from 'csv-parse/sync';
import { prisma } from '@/lib/db';
import {
  decryptSecret,
  encryptSecret,
  maskSecretLast4,
} from '@/services/security/crypto';
import { recordAuditLog } from '@/services/security/audit';
import { logger } from '@/services/security/logger';

const ALLOWED_DIRECTMAIL_READONLY_ACTIONS = new Set([
  'DescAccountSummary',
  'QueryDomainByParam',
  'SenderStatisticsByTagNameAndBatchID',
  'SenderStatisticsDetailByParam',
  'QueryInvalidAddressByParam',
]);

const REGION_ENDPOINT_MAP: Record<string, string> = {
  'cn-hangzhou': 'https://dm.aliyuncs.com/',
  'ap-southeast-1': 'https://dm.ap-southeast-1.aliyuncs.com/',
  'ap-southeast-2': 'https://dm.ap-southeast-2.aliyuncs.com/',
  'us-east-1': 'https://dm.us-east-1.aliyuncs.com/',
  'eu-central-1': 'https://dm.eu-central-1.aliyuncs.com/',
};

export function resolveDirectMailEndpoint(region: string): string {
  return REGION_ENDPOINT_MAP[region] ?? 'https://dm.ap-southeast-1.aliyuncs.com/';
}

function percentEncodeAlibaba(str: string): string {
  return encodeURIComponent(str)
    .replace(/\+/g, '%20')
    .replace(/\*/g, '%2A')
    .replace(/%7E/g, '~');
}

export function signAlibabaRpcRequest(params: {
  action: string;
  accessKeyId: string;
  accessKeySecret: string;
  queryParams?: Record<string, string | number | undefined>;
  timestampIso?: string;
  nonce?: string;
}): { queryString: string; signature: string } {
  if (!ALLOWED_DIRECTMAIL_READONLY_ACTIONS.has(params.action)) {
    throw new Error(
      `Security violation: Alibaba DirectMail action "${params.action}" is blocked. Only strictly read-only reporting actions are permitted; SMTP credentials and sending APIs are permanently locked.`
    );
  }

  const allParams: Record<string, string> = {
    Format: 'JSON',
    Version: '2015-11-23',
    AccessKeyId: params.accessKeyId,
    SignatureMethod: 'HMAC-SHA1',
    Timestamp: params.timestampIso ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    SignatureVersion: '1.0',
    SignatureNonce: params.nonce ?? crypto.randomBytes(12).toString('hex'),
    Action: params.action,
  };

  for (const [k, v] of Object.entries(params.queryParams ?? {})) {
    if (v !== undefined && v !== '') {
      allParams[k] = String(v);
    }
  }

  const sortedKeys = Object.keys(allParams).sort();
  const canonicalized = sortedKeys
    .map((k) => `${percentEncodeAlibaba(k)}=${percentEncodeAlibaba(allParams[k])}`)
    .join('&');

  const stringToSign = `GET&${percentEncodeAlibaba('/')}&${percentEncodeAlibaba(canonicalized)}`;
  const signature = crypto
    .createHmac('sha1', `${params.accessKeySecret}&`)
    .update(stringToSign)
    .digest('base64');

  const queryString = `${canonicalized}&Signature=${percentEncodeAlibaba(signature)}`;
  return { queryString, signature };
}

export class AlibabaDirectMailReadOnlyClient {
  private readonly accessKeyId: string;
  private readonly accessKeySecret: string;
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: {
    accessKeyId: string;
    accessKeySecret: string;
    region?: string;
    fetchImpl?: typeof fetch;
  }) {
    if (!opts.accessKeyId.trim() || !opts.accessKeySecret.trim()) {
      throw new Error('Alibaba Cloud DirectMail AccessKeyId and AccessKeySecret are required.');
    }
    this.accessKeyId = opts.accessKeyId.trim();
    this.accessKeySecret = opts.accessKeySecret.trim();
    this.endpoint = resolveDirectMailEndpoint(opts.region ?? 'ap-southeast-1');
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async callReadOnly<T = Record<string, unknown>>(
    action: string,
    queryParams?: Record<string, string | number | undefined>
  ): Promise<T> {
    const { queryString } = signAlibabaRpcRequest({
      action,
      accessKeyId: this.accessKeyId,
      accessKeySecret: this.accessKeySecret,
      queryParams,
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await this.fetchImpl(`${this.endpoint}?${queryString}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      clearTimeout(timer);
      const data = (await res.json()) as Record<string, unknown>;
      if (!res.ok || data.Code) {
        throw new Error(
          `Alibaba DirectMail API ${action} failed: ${String(data.Message ?? data.Code ?? `HTTP ${res.status}`)}`
        );
      }
      return data as T;
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }
  }

  async fetchSummaryAndStats(daysBack = 30) {
    const end = new Date();
    const start = new Date(end.getTime() - daysBack * 86_400_000);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);

    const [accountSummary, domainsRes, statsRes, invalidRes] = await Promise.all([
      this.callReadOnly<{
        EnableTimes?: number;
        DayuStatus?: number;
        QuotaLevel?: number;
        MaxQuotaLevel?: number;
        Domains?: number;
        MailAddresses?: number;
        Receivers?: number;
        DailyQuota?: number;
      }>('DescAccountSummary'),
      this.callReadOnly<{
        data?: {
          domain?: Array<{
            DomainName?: string;
            DomainStatus?: string;
            CreateTime?: string;
          }>;
        };
      }>('QueryDomainByParam', { PageNo: 1, PageSize: 50 }),
      this.callReadOnly<{
        data?: {
          stat?: Array<{
            CreateTime?: string;
            RequestCount?: number | string;
            SuccessCount?: number | string;
            FaildCount?: number | string;
            FailedCount?: number | string;
            UnavailableCount?: number | string;
          }>;
        };
      }>('SenderStatisticsByTagNameAndBatchID', {
        StartTime: fmt(start),
        EndTime: fmt(end),
      }),
      this.callReadOnly<{
        TotalCount?: number;
      }>('QueryInvalidAddressByParam', {
        StartTime: fmt(start),
        EndTime: fmt(end),
        Length: 100,
      }).catch(() => ({ TotalCount: 0 })),
    ]);

    return {
      accountSummary,
      domains: domainsRes.data?.domain ?? [],
      dailyStats: statsRes.data?.stat ?? [],
      invalidAddressTotal: Number(invalidRes.TotalCount ?? 0),
    };
  }
}

export async function saveAlibabaCredentials(params: {
  accessKeyId?: string;
  accessKeySecret?: string;
  region?: string;
  clear?: boolean;
  actorEmail: string;
}) {
  if (params.clear) {
    await prisma.appConfig.upsert({
      where: { id: 'default' },
      update: {
        alibabaAccessKeyIdEnc: null,
        alibabaAccessKeySecretEnc: null,
        alibabaKeyLast4: null,
        alibabaAccountStatus: null,
      },
      create: { id: 'default' },
    });
    await recordAuditLog({
      actorEmail: params.actorEmail,
      action: 'ALIBABA_DIRECTMAIL_CREDS_CLEARED',
      resourceType: 'AppConfig',
      resourceId: 'default',
      outcome: 'SUCCESS',
    });
    return;
  }

  const updateData: Record<string, unknown> = {
    ...(params.region ? { alibabaRegion: params.region } : {}),
  };
  if (params.accessKeyId?.trim()) {
    updateData.alibabaAccessKeyIdEnc = encryptSecret(params.accessKeyId.trim());
    updateData.alibabaKeyLast4 = maskSecretLast4(params.accessKeyId.trim());
  }
  if (params.accessKeySecret?.trim()) {
    updateData.alibabaAccessKeySecretEnc = encryptSecret(
      params.accessKeySecret.trim()
    );
  }

  await prisma.appConfig.upsert({
    where: { id: 'default' },
    update: updateData,
    create: { id: 'default', ...updateData },
  });

  await recordAuditLog({
    actorEmail: params.actorEmail,
    action: 'ALIBABA_DIRECTMAIL_CREDS_SAVED',
    resourceType: 'AppConfig',
    resourceId: 'default',
    outcome: 'SUCCESS',
    details: { region: params.region ?? 'unchanged' },
  });
}

export async function syncAlibabaDirectMailReadOnly(params: {
  actorEmail: string;
  daysBack?: number;
  clientOverride?: AlibabaDirectMailReadOnlyClient;
}) {
  const cfg = await prisma.appConfig.upsert({
    where: { id: 'default' },
    update: {},
    create: { id: 'default' },
  });

  let client = params.clientOverride;
  if (!client) {
    if (!cfg.alibabaAccessKeyIdEnc || !cfg.alibabaAccessKeySecretEnc) {
      throw new Error(
        'Alibaba Cloud DirectMail read-only AccessKey credentials are not configured. Save RAM read-only credentials or use manual DirectMail CSV import.'
      );
    }
    client = new AlibabaDirectMailReadOnlyClient({
      accessKeyId: decryptSecret(cfg.alibabaAccessKeyIdEnc),
      accessKeySecret: decryptSecret(cfg.alibabaAccessKeySecretEnc),
      region: cfg.alibabaRegion,
    });
  }

  const res = await client.fetchSummaryAndStats(params.daysBack ?? 30);
  const accountStatusStr = `QuotaLevel=${res.accountSummary.QuotaLevel ?? 'unknown'}, DailyQuota=${res.accountSummary.DailyQuota ?? 'unknown'}, VerifiedDomains=${res.domains.length}`;

  let rowsSynced = 0;
  for (const st of res.dailyStats) {
    const rawDate = st.CreateTime?.slice(0, 10);
    if (!rawDate) continue;
    const metricDate = new Date(`${rawDate}T00:00:00Z`);
    if (Number.isNaN(metricDate.getTime())) continue;

    const requestsCount = Number(st.RequestCount ?? 0);
    const deliveredCount = Number(st.SuccessCount ?? 0);
    const failedCount = Number(st.FailedCount ?? st.FaildCount ?? 0);
    const invalidAddressCount = Number(st.UnavailableCount ?? 0);

    await prisma.directMailDailyMetric.upsert({
      where: {
        metricDate_domainName_source: {
          metricDate,
          domainName: res.domains[0]?.DomainName ?? 'all',
          source: 'ALIBABA_API',
        },
      },
      update: {
        requestsCount,
        deliveredCount,
        failedCount,
        invalidAddressCount,
        accountStatus: accountStatusStr,
        notes: 'Synced via Alibaba Cloud DirectMail Dm/2015-11-23 read-only OpenAPI. Complaint FBL counts are not exposed by DirectMail RPC.',
        isDemoData: false,
      },
      create: {
        metricDate,
        domainName: res.domains[0]?.DomainName ?? 'all',
        source: 'ALIBABA_API',
        requestsCount,
        deliveredCount,
        failedCount,
        invalidAddressCount,
        complaintCount: null,
        accountStatus: accountStatusStr,
        notes: 'Synced via Alibaba Cloud DirectMail Dm/2015-11-23 read-only OpenAPI. Complaint FBL counts are not exposed by DirectMail RPC.',
        isDemoData: false,
      },
    });
    rowsSynced++;
  }

  await prisma.appConfig.update({
    where: { id: 'default' },
    data: {
      alibabaAccountStatus: accountStatusStr,
      alibabaLastSyncedAt: new Date(),
    },
  });

  await recordAuditLog({
    actorEmail: params.actorEmail,
    action: 'ALIBABA_DIRECTMAIL_SYNCED',
    resourceType: 'DirectMailDailyMetric',
    outcome: 'SUCCESS',
    details: { rowsSynced, invalidAddressTotal: res.invalidAddressTotal },
  });

  return {
    rowsSynced,
    accountStatus: accountStatusStr,
    domains: res.domains,
    invalidAddressTotal: res.invalidAddressTotal,
  };
}

export async function importAlibabaDirectMailCsv(params: {
  csvContent: string;
  actorEmail: string;
}): Promise<{ rowsImported: number }> {
  const rows = parse(params.csvContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Array<Record<string, string>>;

  let rowsImported = 0;
  for (const r of rows) {
    const lower: Record<string, string> = {};
    for (const [k, v] of Object.entries(r)) {
      lower[k.trim().toLowerCase()] = v;
    }

    const rawDate =
      lower.date || lower.metric_date || lower.createtime || lower.stat_date;
    if (!rawDate) continue;
    const metricDate = new Date(
      rawDate.length === 10 ? `${rawDate}T00:00:00Z` : rawDate
    );
    if (Number.isNaN(metricDate.getTime())) continue;

    const domainName =
      (lower.domain || lower.domain_name || 'all').trim().toLowerCase() || 'all';
    const requestsCount = Number(lower.requests || lower.request_count || lower.send_count || 0) || 0;
    const deliveredCount = Number(lower.delivered || lower.success_count || lower.accepted || 0) || 0;
    const failedCount = Number(lower.failed || lower.fail_count || lower.failure_count || 0) || 0;
    const invalidAddressCount =
      Number(lower.invalid_address || lower.invalid_count || lower.bounces || 0) || 0;
    const complaintRaw = lower.complaints ?? lower.complaint_count;
    const complaintCount =
      complaintRaw !== undefined && complaintRaw !== ''
        ? Number(complaintRaw) || 0
        : null;

    await prisma.directMailDailyMetric.upsert({
      where: {
        metricDate_domainName_source: {
          metricDate,
          domainName,
          source: 'ALIBABA_CSV_IMPORT',
        },
      },
      update: {
        requestsCount,
        deliveredCount,
        failedCount,
        invalidAddressCount,
        complaintCount,
        notes: 'Manually imported from Alibaba Cloud DirectMail CSV report.',
        isDemoData: false,
      },
      create: {
        metricDate,
        domainName,
        source: 'ALIBABA_CSV_IMPORT',
        requestsCount,
        deliveredCount,
        failedCount,
        invalidAddressCount,
        complaintCount,
        notes: 'Manually imported from Alibaba Cloud DirectMail CSV report.',
        isDemoData: false,
      },
    });
    rowsImported++;
  }

  logger.info('Alibaba DirectMail CSV imported', { rowsImported });
  await recordAuditLog({
    actorEmail: params.actorEmail,
    action: 'ALIBABA_DIRECTMAIL_CSV_IMPORTED',
    resourceType: 'DirectMailDailyMetric',
    outcome: 'SUCCESS',
    details: { rowsImported },
  });

  return { rowsImported };
}
