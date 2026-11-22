import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeSupabase } from './fake-supabase';

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { logger } from '@/lib/logger';
import { findActiveShareLink, touchShareLink } from '../lookup';
import { hashShareToken } from '../token';

const TOKEN = 'a'.repeat(43);
const NOW = new Date('2026-11-18T15:30:00.000Z');
const OWNER = '11111111-1111-4111-8111-111111111111';
const LINK = '33333333-3333-4333-8333-333333333333';

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: LINK, user_id: OWNER, persona_ids: null, expires_at: null, revoked_at: null, ...overrides };
}

function lookup(data: unknown, error: { message: string } | null = null) {
  const fake = fakeSupabase({ results: { share_links: [{ data, error }] } });
  return { fake, result: findActiveShareLink(fake.client, TOKEN, NOW) };
}

describe('findActiveShareLink', () => {
  beforeEach(() => {
    vi.mocked(logger.warn).mockClear();
  });

  it('finds the link by the hash of the token, never by the token', async () => {
    const { fake, result } = lookup(row());
    await expect(result).resolves.toEqual({ id: LINK, userId: OWNER, personaIds: null });
    const calls = fake.queries[0].calls;
    expect(calls).toContainEqual(['eq', 'token_hash', hashShareToken(TOKEN)]);
    expect(JSON.stringify(calls)).not.toContain(TOKEN);
  });

  it('returns null for an unknown token', async () => {
    await expect(lookup(null).result).resolves.toBeNull();
  });

  it('returns null for a revoked link', async () => {
    await expect(lookup(row({ revoked_at: '2026-11-17T00:00:00.000Z' })).result).resolves.toBeNull();
  });

  it('returns null for an expired link', async () => {
    await expect(lookup(row({ expires_at: '2026-11-18T15:29:59.000Z' })).result).resolves.toBeNull();
  });

  it('returns null for a link that expires at this very instant', async () => {
    await expect(lookup(row({ expires_at: NOW.toISOString() })).result).resolves.toBeNull();
  });

  it('accepts a link that has not expired yet', async () => {
    await expect(lookup(row({ expires_at: '2026-11-18T15:30:01.000Z' })).result).resolves.toMatchObject({ id: LINK });
  });

  it('treats an unreadable expiry as expired', async () => {
    await expect(lookup(row({ expires_at: 'not a date' })).result).resolves.toBeNull();
    await expect(lookup(row({ expires_at: 42 })).result).resolves.toBeNull();
  });

  it('treats a row without a revoked_at column as revoked', async () => {
    const { revoked_at: _removed, ...withoutRevoked } = row();
    await expect(lookup(withoutRevoked).result).resolves.toBeNull();
  });

  it('keeps the persona scope of the link', async () => {
    const persona = '22222222-2222-4222-8222-222222222222';
    await expect(lookup(row({ persona_ids: [persona] })).result).resolves.toMatchObject({ personaIds: [persona] });
  });

  it('fails closed with an empty scope when the persona list is not an array', async () => {
    await expect(lookup(row({ persona_ids: 'everyone' })).result).resolves.toMatchObject({ personaIds: [] });
  });

  it('drops non-string persona entries without widening the scope', async () => {
    await expect(lookup(row({ persona_ids: [5, null] })).result).resolves.toMatchObject({ personaIds: [] });
  });

  it('returns null for a row without an owner', async () => {
    await expect(lookup(row({ user_id: null })).result).resolves.toBeNull();
  });

  it.each(['', 'short', `${'a'.repeat(42)}/`])('does not query the database for the malformed token %j', async (token) => {
    const fake = fakeSupabase({});
    await expect(findActiveShareLink(fake.client, token, NOW)).resolves.toBeNull();
    expect(fake.queries).toHaveLength(0);
  });

  it('throws when the lookup fails instead of answering not found', async () => {
    await expect(lookup(null, { message: 'db down' }).result).rejects.toThrow('share link lookup failed: db down');
  });
});

describe('touchShareLink', () => {
  beforeEach(() => {
    vi.mocked(logger.warn).mockClear();
  });

  it('updates last_viewed_at only when it is empty or older than five minutes', async () => {
    const fake = fakeSupabase({ results: { share_links: [{ data: null, error: null }] } });
    await touchShareLink(fake.client, LINK, NOW);
    expect(fake.queries[0].calls).toEqual([
      ['update', { last_viewed_at: NOW.toISOString() }],
      ['eq', 'id', LINK],
      ['or', 'last_viewed_at.is.null,last_viewed_at.lt.2026-11-18T15:25:00.000Z'],
    ]);
  });

  it('logs a failed update and does not throw', async () => {
    const fake = fakeSupabase({ results: { share_links: [{ data: null, error: { message: 'db down' } }] } });
    await expect(touchShareLink(fake.client, LINK, NOW)).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith('[share-links] last_viewed_at update failed', { message: 'db down' });
  });
});
