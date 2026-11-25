import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QUOTE_TTL_MS, canonicalJson, isQuoteExpired, quoteExpiry, quoteKeyFor } from '../quote-key';

const SECRET = Buffer.alloc(32, 7).toString('base64');
const OTHER_SECRET = Buffer.alloc(32, 9).toString('base64');

beforeEach(() => {
  vi.stubEnv('TOKEN_ENCRYPTION_KEY', SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const BASE = {
  userId: 'user-1',
  perVideoCost: 2,
  totalTokens: 40,
  slots: ['2026-12-01T09:00:00.000Z', '2026-12-01T18:00:00.000Z'],
  expiresAt: '2026-12-01T00:15:00.000Z',
};

describe('quoteKeyFor', () => {
  it('does not depend on object key order', () => {
    const shuffled = { expiresAt: BASE.expiresAt, slots: BASE.slots, totalTokens: 40, userId: 'user-1', perVideoCost: 2 };
    expect(quoteKeyFor(shuffled)).toBe(quoteKeyFor(BASE));
  });

  it('changes when the price changes', () => {
    expect(quoteKeyFor({ ...BASE, perVideoCost: 3 })).not.toBe(quoteKeyFor(BASE));
    expect(quoteKeyFor({ ...BASE, totalTokens: 60 })).not.toBe(quoteKeyFor(BASE));
  });

  it('changes when a slot moves or the order of slots changes', () => {
    expect(quoteKeyFor({ ...BASE, slots: ['2026-12-01T09:00:00.000Z', '2026-12-02T18:00:00.000Z'] })).not.toBe(quoteKeyFor(BASE));
    expect(quoteKeyFor({ ...BASE, slots: [...BASE.slots].reverse() })).not.toBe(quoteKeyFor(BASE));
  });

  it('changes with the user and the expiry', () => {
    expect(quoteKeyFor({ ...BASE, userId: 'user-2' })).not.toBe(quoteKeyFor(BASE));
    expect(quoteKeyFor({ ...BASE, expiresAt: '2026-12-01T00:30:00.000Z' })).not.toBe(quoteKeyFor(BASE));
  });

  it('is a 64-character hex digest', () => {
    expect(quoteKeyFor(BASE)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('cannot be computed without the server secret: a plain SHA-256 of the same payload differs', () => {
    expect(quoteKeyFor(BASE)).not.toBe(createHash('sha256').update(canonicalJson(BASE)).digest('hex'));
  });

  it('changes with the server secret', () => {
    const first = quoteKeyFor(BASE);
    vi.stubEnv('TOKEN_ENCRYPTION_KEY', OTHER_SECRET);

    expect(quoteKeyFor(BASE)).not.toBe(first);
  });

  it('fails loudly when the server secret is not set', () => {
    vi.stubEnv('TOKEN_ENCRYPTION_KEY', undefined);

    expect(() => quoteKeyFor(BASE)).toThrow('TOKEN_ENCRYPTION_KEY');
  });

  it('tells two different dates apart', () => {
    expect(quoteKeyFor({ at: new Date('2026-12-01T00:00:00.000Z') })).not.toBe(quoteKeyFor({ at: new Date('2026-12-02T00:00:00.000Z') }));
  });
});

describe('canonicalJson', () => {
  it('sorts keys recursively and drops undefined values', () => {
    expect(canonicalJson({ b: 1, a: { d: undefined, c: [{ z: 1, y: 2 }] } })).toBe('{"a":{"c":[{"y":2,"z":1}]},"b":1}');
  });

  it('writes a Date as its ISO string, never as an empty object', () => {
    expect(canonicalJson({ at: new Date('2026-12-01T00:00:00.000Z') })).toBe('{"at":"2026-12-01T00:00:00.000Z"}');
  });
});

describe('quote expiry', () => {
  it('expires 15 minutes after the quote', () => {
    const now = new Date('2026-12-01T00:00:00.000Z');
    expect(QUOTE_TTL_MS).toBe(15 * 60 * 1000);
    expect(quoteExpiry(now)).toBe('2026-12-01T00:15:00.000Z');
  });

  it('is valid up to the expiry instant and expired from then on', () => {
    const expiresAt = '2026-12-01T00:15:00.000Z';
    expect(isQuoteExpired(expiresAt, new Date('2026-12-01T00:14:59.999Z'))).toBe(false);
    expect(isQuoteExpired(expiresAt, new Date('2026-12-01T00:15:00.000Z'))).toBe(true);
  });

  it('treats an unparseable expiry as expired', () => {
    expect(isQuoteExpired('not-a-date', new Date('2026-12-01T00:00:00.000Z'))).toBe(true);
  });
});
