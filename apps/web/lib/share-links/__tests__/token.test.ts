import { describe, expect, it } from 'vitest';
import { SHARE_TOKEN_BYTES, generateShareToken, hashShareToken, isShareTokenShape, sharePathFor } from '../token';

describe('share token', () => {
  it('encodes 32 random bytes as 43 base64url characters', () => {
    const token = generateShareToken();
    expect(token).toHaveLength(43);
    expect(Buffer.from(token, 'base64url')).toHaveLength(SHARE_TOKEN_BYTES);
    expect(isShareTokenShape(token)).toBe(true);
  });

  it('never repeats a token', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateShareToken()));
    expect(tokens.size).toBe(200);
  });

  it('hashes with SHA-256 hex and never returns the token', () => {
    const token = 'a'.repeat(43);
    const hash = hashShareToken(token);
    expect(hash).toBe('66d34fba71f8f450f7e45598853e53bfc23bbd129027cbb131a2f4ffd7878cd0');
    expect(hash).not.toContain(token);
    expect(hashShareToken(token)).toBe(hash);
    expect(hashShareToken('b'.repeat(43))).not.toBe(hash);
  });

  it.each(['', 'short', 'a'.repeat(42), 'a'.repeat(44), `${'a'.repeat(42)}/`, `${'a'.repeat(42)} `, `${'a'.repeat(42)}+`])(
    'rejects the malformed token %j',
    (value) => {
      expect(isShareTokenShape(value)).toBe(false);
    },
  );

  it('builds the public path', () => {
    expect(sharePathFor('abc')).toBe('/s/abc');
  });
});
