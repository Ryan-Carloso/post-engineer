import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { encryptTokens, decryptTokens, encryptJson, decryptJson, deriveServerKey, TokenDecryptError } from '@/lib/token-crypto';

const VALID_KEY = Buffer.alloc(32).toString('base64');
const SHORT_KEY = Buffer.alloc(16).toString('base64');

describe('token-crypto', () => {
  const originalEnv = process.env.TOKEN_ENCRYPTION_KEY;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.TOKEN_ENCRYPTION_KEY;
    } else {
      process.env.TOKEN_ENCRYPTION_KEY = originalEnv;
    }
  });

  describe('encryptTokens', () => {
    beforeEach(() => {
      process.env.TOKEN_ENCRYPTION_KEY = VALID_KEY;
    });

    it('returns string with v1 prefix and 4 dot-separated parts', () => {
      const result = encryptTokens({ access_token: 'tok' });
      const parts = result.split('.');
      expect(parts.length).toBe(4);
      expect(parts[0]).toBe('v1');
    });

    it('produces different output each time (random IV)', () => {
      const a = encryptTokens({ access_token: 'tok' });
      const b = encryptTokens({ access_token: 'tok' });
      expect(a).not.toBe(b);
    });
  });

  describe('decryptTokens', () => {
    beforeEach(() => {
      process.env.TOKEN_ENCRYPTION_KEY = VALID_KEY;
    });

    it('roundtrip: encrypt then decrypt returns original payload', () => {
      const payload = { access_token: 'secret', refresh_token: 'refresh', expiry_date: 12345, extra: 'data' };
      const encrypted = encryptTokens(payload);
      const decrypted = decryptTokens(encrypted);
      expect(decrypted).toEqual(payload);
    });

    it('roundtrip with minimal payload', () => {
      const payload = { access_token: 'minimal' };
      const decrypted = decryptTokens(encryptTokens(payload));
      expect(decrypted).toEqual(payload);
    });

    it('throws on tampered ciphertext', () => {
      const encrypted = encryptTokens({ access_token: 'tok' });
      const parts = encrypted.split('.');
      parts[3] = parts[3] + 'x';
      expect(() => decryptTokens(parts.join('.'))).toThrow();
    });

    it('names undecryptable blobs TokenDecryptError so callers can tell a dead token from a transient failure', () => {
      const encrypted = encryptTokens({ access_token: 'tok' });
      const parts = encrypted.split('.');
      parts[3] = parts[3] + 'x';
      expect(() => decryptTokens(parts.join('.'))).toThrow(TokenDecryptError);
      expect(() => decryptTokens('not-a-token')).toThrow(TokenDecryptError);
    });

    it('throws on wrong version prefix', () => {
      const encrypted = encryptTokens({ access_token: 'tok' });
      const parts = encrypted.split('.');
      parts[0] = 'v2';
      expect(() => decryptTokens(parts.join('.'))).toThrow();
    });

    it('throws on completely invalid string', () => {
      expect(() => decryptTokens('not-a-token')).toThrow();
    });
  });

  describe('encryptJson/decryptJson', () => {
    beforeEach(() => {
      process.env.TOKEN_ENCRYPTION_KEY = VALID_KEY;
    });

    it('roundtrips a plain JSON object through the same v1 envelope', () => {
      const payload = { tavily: 'tvly-fake-key-1234', pexels: 'pxls-fake-key-5678' };
      const encrypted = encryptJson(payload);
      expect(encrypted.split('.')[0]).toBe('v1');
      expect(decryptJson(encrypted)).toEqual(payload);
    });

    it('never leaves a key value readable in the ciphertext', () => {
      const encrypted = encryptJson({ tavily: 'tvly-fake-key-1234' });
      expect(encrypted).not.toContain('tvly-fake-key-1234');
    });

    it('a token blob decrypts as JSON too: one envelope, not two schemes', () => {
      const encrypted = encryptTokens({ access_token: 'tok' });
      expect(decryptJson(encrypted)).toEqual({ access_token: 'tok' });
    });

    it('throws TokenDecryptError on a tampered blob', () => {
      const encrypted = encryptJson({ tavily: 'tvly-fake-key-1234' });
      const parts = encrypted.split('.');
      parts[3] = parts[3] + 'x';
      expect(() => decryptJson(parts.join('.'))).toThrow(TokenDecryptError);
    });

    it('throws TokenDecryptError on a blob that decrypts to a non-object', () => {
      const encrypted = encryptJson(['tavily'] as unknown as Record<string, unknown>);
      expect(() => decryptJson(encrypted)).toThrow(TokenDecryptError);
    });
  });

  describe('missing/invalid key', () => {
    it('throws when TOKEN_ENCRYPTION_KEY is not defined', () => {
      delete process.env.TOKEN_ENCRYPTION_KEY;
      expect(() => encryptTokens({ access_token: 'tok' })).toThrow('TOKEN_ENCRYPTION_KEY is not defined');
    });

    it('throws when key decodes to wrong length', () => {
      process.env.TOKEN_ENCRYPTION_KEY = SHORT_KEY;
      expect(() => encryptTokens({ access_token: 'tok' })).toThrow('32 bytes');
    });
  });

  describe('decrypt with a missing or invalid key', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('decryptTokens throws a plain Error, not TokenDecryptError, when the key is missing', () => {
      process.env.TOKEN_ENCRYPTION_KEY = VALID_KEY;
      const encrypted = encryptTokens({ access_token: 'tok' });
      vi.stubEnv('TOKEN_ENCRYPTION_KEY', undefined);
      expect(() => decryptTokens(encrypted)).toThrow('TOKEN_ENCRYPTION_KEY is not defined');
      expect(() => decryptTokens(encrypted)).not.toThrow(TokenDecryptError);
    });

    it('decryptJson throws a plain Error, not TokenDecryptError, when the key is missing', () => {
      process.env.TOKEN_ENCRYPTION_KEY = VALID_KEY;
      const encrypted = encryptJson({ tavily: 'tvly-fake-key-1234' });
      vi.stubEnv('TOKEN_ENCRYPTION_KEY', undefined);
      expect(() => decryptJson(encrypted)).toThrow('TOKEN_ENCRYPTION_KEY is not defined');
      expect(() => decryptJson(encrypted)).not.toThrow(TokenDecryptError);
    });

    it('decryptTokens throws a plain Error, not TokenDecryptError, when the key is the wrong length', () => {
      process.env.TOKEN_ENCRYPTION_KEY = VALID_KEY;
      const encrypted = encryptTokens({ access_token: 'tok' });
      vi.stubEnv('TOKEN_ENCRYPTION_KEY', SHORT_KEY);
      expect(() => decryptTokens(encrypted)).toThrow(
        'TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes',
      );
      expect(() => decryptTokens(encrypted)).not.toThrow(TokenDecryptError);
    });
  });

  describe('deriveServerKey', () => {
    it('derives a stable 32-byte key per purpose that is not the encryption key itself', () => {
      process.env.TOKEN_ENCRYPTION_KEY = VALID_KEY;
      const first = deriveServerKey('purpose-a');

      expect(first).toHaveLength(32);
      expect(deriveServerKey('purpose-a').equals(first)).toBe(true);
      expect(deriveServerKey('purpose-b').equals(first)).toBe(false);
      expect(first.equals(Buffer.from(VALID_KEY, 'base64'))).toBe(false);
    });

    it('throws when the encryption key is missing or the wrong length', () => {
      vi.stubEnv('TOKEN_ENCRYPTION_KEY', undefined);
      expect(() => deriveServerKey('purpose-a')).toThrow('TOKEN_ENCRYPTION_KEY is not defined');
      vi.stubEnv('TOKEN_ENCRYPTION_KEY', SHORT_KEY);
      expect(() => deriveServerKey('purpose-a')).toThrow('exactly 32 bytes');
    });
  });
});
