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
// encryptTokens — encrypts a tokens object
//---------------
export function encryptTokens(payload: EncryptedTokenPayload): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const plaintext = JSON.stringify(payload);
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

//---------------
// decryptTokens — decrypts and validates format/version/tag
// Throws on tampering or invalid format.
//---------------
export function decryptTokens(encrypted: string): EncryptedTokenPayload {
  const key = getEncryptionKey();
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

  const parsed: unknown = JSON.parse(decrypted.toString('utf-8'));
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Decrypted payload is not an object');
  }

  return parsed as EncryptedTokenPayload;
}