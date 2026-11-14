const SECRET_KEYS = new Set([
  'apikey',
  'api_key',
  'x-api-key',
  'password',
  'secret',
  'token',
  'authorization',
  'proxy-authorization',
  'cookie',
  'database_url',
  'reportingdburl',
  'webhooksecret',
  'mailwizzapikeyenc',
  'app_session_secret',
  'app_encryption_key',
  'accesskeyid',
  'access_key_id',
  'accesskeysecret',
  'access_key_secret',
  'csrfsecret',
  'rawtoken',
  'snapshotenc',
  'privatekey',
  'private_key',
  'x-mw-signature',
]);

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

export function redactEmailString(input: string): string {
  return input.replace(EMAIL_REGEX, (match) => {
    const [, domain] = match.split('@');
    return `[REDACTED_EMAIL@${domain ?? 'unknown'}]`;
  });
}

export function sanitizeForLog(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[MAX_DEPTH]';
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') {
    return redactEmailString(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactEmailString(value.message),
    };
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeForLog(item, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const normalized = k.toLowerCase();
      if (
        SECRET_KEYS.has(normalized) ||
        normalized.includes('secret') ||
        normalized.includes('password') ||
        normalized.includes('apikey') ||
        normalized.includes('api_key') ||
        normalized.includes('token') ||
        normalized.includes('credential') ||
        normalized.includes('privatekey') ||
        normalized.includes('private_key') ||
        normalized.includes('accesskey') ||
        normalized.includes('access_key') ||
        normalized.includes('encryption') ||
        normalized.includes('signature')
      ) {
        out[k] = '[REDACTED_SECRET]';
      } else if (
        normalized === 'email' ||
        normalized === 'fname' ||
        normalized === 'lname' ||
        normalized === 'firstname' ||
        normalized === 'lastname' ||
        normalized === 'ip_address' ||
        normalized === 'ipaddress'
      ) {
        out[k] = '[REDACTED_PII]';
      } else {
        out[k] = sanitizeForLog(v, depth + 1);
      }
    }
    return out;
  }
  return '[UNSERIALIZABLE]';
}

type LogLevel = 'info' | 'warn' | 'error';

function emit(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  const payload = {
    ts: new Date().toISOString(),
    level,
    msg: redactEmailString(message),
    ...(meta ? { meta: sanitizeForLog(meta) } : {}),
  };
  const line = JSON.stringify(payload);
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  info: (msg: string, meta?: Record<string, unknown>) => emit('info', msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => emit('warn', msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => emit('error', msg, meta),
};
