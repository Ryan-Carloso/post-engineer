import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { encryptTokens, decryptTokens } from '@/lib/token-crypto';

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
});
