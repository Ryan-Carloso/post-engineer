import 'server-only';

import crypto from 'crypto';

//---------------
// Token Crypto — AES-256-GCM encryption of OAuth tokens
// Ciphertext format: v1.<iv_b64>.<auth_tag_b64>.<payload_b64>
// The key comes from TOKEN_ENCRYPTION_KEY (base64, 32 bytes = 256 bits).
// There is never a fallback: if the env var is missing, fail explicitly.
//---------------

const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';

export interface EncryptedTokenPayload {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  expiry_date?: number;
  [key: string]: unknown;
}

//---------------
// getEncryptionKey — validates and returns the encryption key
//---------------
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

//---------------
// Shared AES-256-GCM envelope: every encrypted blob in this file is
// `v1.<iv_b64url>.<auth_tag_b64url>.<payload_b64url>` under
// TOKEN_ENCRYPTION_KEY. encryptTokens/decryptTokens are the OAuth-token
// shape; encryptJson/decryptJson are the same envelope for any other JSON
// payload (tool-config API keys) — no second crypto scheme, same key,
// same format, same errors.
//---------------
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
    decipher.final(), // throws if the auth tag does not match
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

//---------------
// encryptTokens — encrypts a tokens object
//---------------
export function encryptTokens(payload: EncryptedTokenPayload): string {
  return encryptPlaintext(JSON.stringify(payload));
}

//---------------
// TokenDecryptError — the stored blob cannot be decrypted (tampered,
// truncated, or encrypted under a different key). Callers use it to tell
// an undecryptable stored token — reconnecting fixes it — from a transient
// failure. Key-config errors are NOT this: a missing TOKEN_ENCRYPTION_KEY
// is a server misconfiguration, not a dead token.
//---------------
export class TokenDecryptError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'TokenDecryptError';
    if (options?.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

//---------------
// decryptTokens — decrypts and validates format/version/tag
// Throws TokenDecryptError on tampering or invalid format. A missing or
// wrong-size TOKEN_ENCRYPTION_KEY throws a plain Error before the try:
// a key-config error is a server misconfiguration, not a dead token.
//---------------
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

//---------------
// encryptJson/decryptJson — same envelope for a plain JSON object
// (tool-config API keys). The caller validates the shape after
// decryption; a tampered or foreign blob fails here with
// TokenDecryptError, never with a partial object.
//---------------
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