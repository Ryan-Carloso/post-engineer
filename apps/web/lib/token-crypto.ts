import 'server-only';

import crypto from 'crypto';

const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';

export interface EncryptedTokenPayload {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  expiry_date?: number;
  [key: string]: unknown;
}

function getEncryptionKey(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;

  if (!raw) {
    throw new Error('TOKEN_ENCRYPTION_KEY is not defined');
  }

  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes (AES-256)');
  }

  return key;
}

export function deriveServerKey(purpose: string): Buffer {
  return Buffer.from(crypto.hkdfSync('sha256', getEncryptionKey(), Buffer.alloc(0), purpose, 32));
}

function encryptPlaintext(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf-8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString('base64url'),
    authTag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.');
}

function decryptPlaintext(encrypted: string, key: Buffer): string {
  const parts = encrypted.split('.');

  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('Invalid encrypted token format or version');
  }

  const [, ivB64, tagB64, payloadB64] = parts;

  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payloadB64, 'base64url')),
    decipher.final(),
  ]);

  return decrypted.toString('utf-8');
}

function parseDecryptedObject(plaintext: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(plaintext);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Decrypted payload is not an object');
  }
  return parsed as Record<string, unknown>;
}

export function encryptTokens(payload: EncryptedTokenPayload): string {
  return encryptPlaintext(JSON.stringify(payload));
}

export class TokenDecryptError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'TokenDecryptError';
    if (options?.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

export function decryptTokens(encrypted: string): EncryptedTokenPayload {
  const key = getEncryptionKey();
  try {
    return parseDecryptedObject(decryptPlaintext(encrypted, key)) as EncryptedTokenPayload;
  } catch (error) {
    throw new TokenDecryptError(
      error instanceof Error ? error.message : 'Failed to decrypt stored tokens',
      { cause: error },
    );
  }
}

export function encryptJson(payload: Record<string, unknown>): string {
  return encryptPlaintext(JSON.stringify(payload));
}

export function decryptJson(encrypted: string): Record<string, unknown> {
  const key = getEncryptionKey();
  try {
    return parseDecryptedObject(decryptPlaintext(encrypted, key));
  } catch (error) {
    throw new TokenDecryptError(
      error instanceof Error ? error.message : 'Failed to decrypt stored data',
      { cause: error },
    );
  }
}