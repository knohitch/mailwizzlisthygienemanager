import crypto from 'node:crypto';

export type MailWizzAuthMode = 'auto' | 'x-api-key' | 'legacy-hmac' | 'bearer';

/**
 * Normalizes MailWizz PHP `json_encode` outputs where empty or associative PHP
 * arrays deserialize as JSON objects (`{"0": ...}`) or `null` instead of `[]`.
 */
export function coerceArrayFromPhpJson(val: unknown): unknown[] {
  if (Array.isArray(val)) return val;
  if (val && typeof val === 'object') {
    return Object.values(val as Record<string, unknown>);
  }
  return [];
}

/**
 * Parses numeric counts or percentage strings (e.g. `"1,250"`, `"14.2%"`, `null`) safely.
 */
export function coerceNumberFromMailWizz(val: unknown, fallback = 0): number {
  if (typeof val === 'number') {
    return Number.isFinite(val) ? val : fallback;
  }
  if (typeof val === 'string') {
    const cleaned = val.trim().replace(/,/g, '').replace(/%$/, '');
    if (!cleaned) return fallback;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

export function pickFirstString(
  obj: Record<string, unknown>,
  keys: string[]
): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return undefined;
}

/**
 * Implements MailWizz 1.x PHP SDK HMAC-SHA1 canonical request signing for legacy installs
 * using `publicKey:privateKey` credentials.
 */
export function signMailWizzV1Request(params: {
  method: string;
  requestUrl: string;
  publicKey: string;
  privateKey: string;
  timestamp: string;
  remoteAddr: string;
  bodyParams?: Record<string, string>;
}): string {
  const parsedUrl = new URL(params.requestUrl);
  const queryMap: Record<string, string> = {};
  parsedUrl.searchParams.forEach((v, k) => {
    queryMap[k] = v;
  });

  const signParams: Record<string, string> = {
    'X-MW-PUBLIC-KEY': params.publicKey,
    'X-MW-TIMESTAMP': params.timestamp,
    'X-MW-REMOTE-ADDR': params.remoteAddr,
    ...(params.bodyParams ?? {}),
  };

  const sortedAll: Record<string, string> = {
    ...queryMap,
    ...signParams,
  };
  const sortedKeys = Object.keys(sortedAll).sort();
  const canonical = sortedKeys
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(sortedAll[k])}`)
    .join('&');

  const baseUrl = `${parsedUrl.origin}${parsedUrl.pathname}`;
  const separator = sortedKeys.length > 0 ? '?' : '';
  const payload = `${params.method.toUpperCase()} ${baseUrl}${separator}${canonical}`;

  return crypto
    .createHmac('sha1', params.privateKey)
    .update(payload, 'utf8')
    .digest('hex');
}

/**
 * Builds version-tolerant MailWizz authentication headers for 1.x (HMAC),
 * 2.x/3.x (`X-Api-Key`), and Bearer-style future gateways.
 */
export function buildMailWizzAuthHeaders(params: {
  apiKey: string;
  authMode?: MailWizzAuthMode;
  method: string;
  requestUrl: string;
  remoteAddr?: string;
  timestamp?: string;
  bodyParams?: Record<string, string>;
}): Record<string, string> {
  const mode = params.authMode ?? 'auto';
  const rawKey = params.apiKey.trim();

  if (mode === 'bearer') {
    return {
      Authorization: `Bearer ${rawKey}`,
    };
  }

  const colonIdx = rawKey.indexOf(':');
  const hasDualKeys = colonIdx > 0 && colonIdx < rawKey.length - 1;

  if (mode === 'legacy-hmac' || (mode === 'auto' && hasDualKeys)) {
    const publicKey = hasDualKeys ? rawKey.slice(0, colonIdx).trim() : rawKey;
    const privateKey = hasDualKeys ? rawKey.slice(colonIdx + 1).trim() : rawKey;
    const timestamp = params.timestamp ?? String(Math.floor(Date.now() / 1000));
    const remoteAddr = params.remoteAddr ?? '127.0.0.1';
    const signature = signMailWizzV1Request({
      method: params.method,
      requestUrl: params.requestUrl,
      publicKey,
      privateKey,
      timestamp,
      remoteAddr,
      bodyParams: params.bodyParams,
    });
    return {
      'X-Api-Key': publicKey,
      'X-MW-PUBLIC-KEY': publicKey,
      'X-MW-TIMESTAMP': timestamp,
      'X-MW-REMOTE-ADDR': remoteAddr,
      'X-MW-SIGNATURE': signature,
    };
  }

  return {
    'X-Api-Key': rawKey,
  };
}

export function detectMailWizzVersionFromResponse(
  headers: Headers,
  rawJson: unknown
): string | null {
  const headerVersion =
    headers.get('x-mailwizz-version') ||
    headers.get('x-mw-version') ||
    headers.get('x-app-version');
  if (headerVersion?.trim()) return headerVersion.trim();

  if (rawJson && typeof rawJson === 'object') {
    const obj = rawJson as Record<string, unknown>;
    const meta =
      obj.meta && typeof obj.meta === 'object'
        ? (obj.meta as Record<string, unknown>)
        : null;
    const data =
      obj.data && typeof obj.data === 'object'
        ? (obj.data as Record<string, unknown>)
        : null;
    const candidate =
      (typeof obj.version === 'string' && obj.version) ||
      (typeof meta?.version === 'string' && meta.version) ||
      (typeof data?.version === 'string' && data.version);
    if (candidate && candidate.trim()) return candidate.trim();
  }
  return null;
}

/**
 * Normalizes MailWizz 1.x / 2.x / 3.x / future REST response envelopes into `{ status, error, data }`.
 */
export function normalizeMailWizzEnvelope(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const obj = { ...(raw as Record<string, unknown>) };

  if (obj.status === undefined) {
    if (obj.success === false || obj.ok === false || obj.error) {
      obj.status = 'error';
    } else if (obj.success === true || obj.ok === true || obj.data !== undefined) {
      obj.status = 'success';
    }
  }

  if (obj.data && typeof obj.data === 'object' && !Array.isArray(obj.data)) {
    const data = { ...(obj.data as Record<string, unknown>) };
    const meta =
      obj.meta && typeof obj.meta === 'object'
        ? (obj.meta as Record<string, unknown>)
        : null;
    const pagination =
      meta?.pagination && typeof meta.pagination === 'object'
        ? (meta.pagination as Record<string, unknown>)
        : meta;

    if (data.records === undefined) {
      if (Array.isArray(data.items)) data.records = data.items;
      else if (data.items && typeof data.items === 'object') {
        data.records = coerceArrayFromPhpJson(data.items);
      }
    } else {
      data.records = coerceArrayFromPhpJson(data.records);
    }

    if (data.count === undefined && pagination?.total !== undefined) {
      data.count = pagination.total;
    }
    if (data.total_pages === undefined && pagination?.total_pages !== undefined) {
      data.total_pages = pagination.total_pages;
    }
    if (data.current_page === undefined && pagination?.current_page !== undefined) {
      data.current_page = pagination.current_page;
    }
    if (data.next_page === undefined && pagination?.next_page !== undefined) {
      data.next_page = pagination.next_page;
    }

    obj.data = data;
  }

  return obj;
}

/**
 * Normalizes a list record whether fields live under `general` (standard MailWizz) or flat top-level (future/custom).
 */
export function normalizeMailWizzListRecord(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const obj = raw as Record<string, unknown>;
  if (obj.general && typeof obj.general === 'object') {
    const gen = { ...(obj.general as Record<string, unknown>) };
    if (!gen.list_uid && (gen.uid || obj.list_uid || obj.uid)) {
      gen.list_uid = gen.uid ?? obj.list_uid ?? obj.uid;
    }
    return { ...obj, general: gen };
  }

  const listUid = pickFirstString(obj, ['list_uid', 'uid', 'id']);
  const name = pickFirstString(obj, ['name', 'display_name']) ?? 'Untitled List';
  return {
    ...obj,
    general: {
      list_uid: listUid ?? '',
      name,
      display_name: typeof obj.display_name === 'string' ? obj.display_name : '',
      description: typeof obj.description === 'string' ? obj.description : '',
      subscribers_count: obj.subscribers_count,
      opt_in: obj.opt_in,
      opt_out: obj.opt_out,
    },
    defaults:
      obj.defaults && typeof obj.defaults === 'object'
        ? obj.defaults
        : {
            from_name: obj.from_name,
            from_email: obj.from_email,
            reply_to: obj.reply_to,
            subject: obj.subject,
          },
  };
}

/**
 * Normalizes subscriber fields across casing/version differences (`EMAIL`/`email`, `FNAME`/`first_name`, `subscriber_uid`/`uid`).
 */
export function normalizeMailWizzSubscriberRecord(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const obj = { ...(raw as Record<string, unknown>) };
  const uid = pickFirstString(obj, ['subscriber_uid', 'uid', 'id']);
  if (uid && !obj.subscriber_uid) obj.subscriber_uid = uid;

  if (!obj.EMAIL && typeof obj.email === 'string') obj.EMAIL = obj.email;
  if (!obj.email && typeof obj.EMAIL === 'string') obj.email = obj.EMAIL;
  if (!obj.EMAIL && typeof obj.Email === 'string') obj.EMAIL = obj.Email;

  if (obj.FNAME === undefined) {
    obj.FNAME = obj.fname ?? obj.first_name ?? obj.FIRST_NAME ?? null;
  }
  if (obj.LNAME === undefined) {
    obj.LNAME = obj.lname ?? obj.last_name ?? obj.LAST_NAME ?? null;
  }
  return obj;
}

export function normalizeMailWizzBounceRecord(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const obj = { ...(raw as Record<string, unknown>) };
  const rawType = String(obj.bounce_type ?? obj.type ?? 'hard')
    .trim()
    .toLowerCase();
  if (rawType.includes('soft') || rawType.includes('transient') || rawType.includes('temp')) {
    obj.bounce_type = 'soft';
  } else if (rawType.includes('internal')) {
    obj.bounce_type = 'internal';
  } else {
    obj.bounce_type = 'hard';
  }

  if (!obj.subscriber && (obj.subscriber_uid || obj.uid || obj.email)) {
    obj.subscriber = {
      subscriber_uid: pickFirstString(obj, ['subscriber_uid', 'uid']) ?? '',
      email: pickFirstString(obj, ['email', 'EMAIL']),
    };
  }
  return obj;
}
