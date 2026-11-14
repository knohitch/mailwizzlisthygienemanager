import crypto from 'node:crypto';
import { getEnv } from '@/lib/env';

const AES_ALGO = 'aes-256-gcm';
const IV_BYTES = 12;

function getMasterKeyBuffer(overrideKeyHex?: string): Buffer {
  const raw = overrideKeyHex ?? getEnv().APP_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'APP_ENCRYPTION_KEY is required for encrypting/decrypting credentials and exports.'
    );
  }
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, 'hex');
  }
  // Derive deterministic 32-byte key from arbitrary-length secret string
  return crypto.createHash('sha256').update(raw, 'utf8').digest();
}

export function encryptSecret(plaintext: string, overrideKeyHex?: string): string {
  const key = getMasterKeyBuffer(overrideKeyHex);
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(AES_ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

export function decryptSecret(ciphertext: string, overrideKeyHex?: string): string {
  const parts = ciphertext.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('Unsupported encrypted payload format.');
  }
  const key = getMasterKeyBuffer(overrideKeyHex);
  const iv = Buffer.from(parts[1], 'base64');
  const tag = Buffer.from(parts[2], 'base64');
  const data = Buffer.from(parts[3], 'base64');
  const decipher = crypto.createDecipheriv(AES_ALGO, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString('utf8');
}

export interface EncryptedEnvelope {
  format: 'mailwizz-hygiene-encrypted-v1';
  algorithm: 'AES-256-GCM';
  createdAt: string;
  iv: string;
  authTag: string;
  ciphertext: string;
}

export function encryptExportBuffer(
  buffer: Buffer,
  overrideKeyHex?: string
): EncryptedEnvelope {
  const key = getMasterKeyBuffer(overrideKeyHex);
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(AES_ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    format: 'mailwizz-hygiene-encrypted-v1',
    algorithm: 'AES-256-GCM',
    createdAt: new Date().toISOString(),
    iv: iv.toString('base64'),
    authTag: tag.toString('base64'),
    ciphertext: encrypted.toString('base64'),
  };
}

export function decryptExportBuffer(
  envelope: EncryptedEnvelope,
  overrideKeyHex?: string
): Buffer {
  if (envelope.format !== 'mailwizz-hygiene-encrypted-v1') {
    throw new Error('Invalid encrypted export envelope.');
  }
  const key = getMasterKeyBuffer(overrideKeyHex);
  const decipher = crypto.createDecipheriv(
    AES_ALGO,
    key,
    Buffer.from(envelope.iv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(envelope.authTag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
    decipher.final(),
  ]);
}

export function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

export function hashEmail(email: string): string {
  return sha256Hex(email.trim().toLowerCase());
}

export function maskSecretLast4(secret: string): string {
  const trimmed = secret.trim();
  if (trimmed.length <= 4) return '****';
  return `••••${trimmed.slice(-4)}`;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, hexHash] = parts;
  const derived = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hexHash, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

export function timingSafeEqualString(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
