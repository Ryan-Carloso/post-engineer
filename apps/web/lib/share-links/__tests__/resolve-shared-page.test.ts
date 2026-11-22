import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeSupabase } from './fake-supabase';

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { RATE_LIMITS } from '@/lib/rate-limit';
import { resolveSharedPage } from '../resolve-shared-page';
import { hashShareToken } from '../token';

const OWNER = '11111111-1111-4111-8111-111111111111';
const LINK = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-11-18T15:30:00.000Z');

function request(ip: string): Request {
  return new Request('http://share.invalid/', { headers: { 'x-forwarded-for': ip } });
}

function tokenFor(label: string): string {
  return label.padEnd(43, 'x').slice(0, 43);
}

function supabaseFor(link: Record<string, unknown> | null) {
  return fakeSupabase({
    results: {
      share_links: [{ data: link, error: null }, { data: null, error: null }],
      post_metrics: [{ data: [], error: null }],
    },
    rpc: { share_week_posts: { data: [], error: null } },
  });
}

const ACTIVE = { id: LINK, user_id: OWNER, persona_ids: null, expires_at: null, revoked_at: null };

describe('resolveSharedPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('serves the view of an active link and records the visit', async () => {
    const fake = supabaseFor(ACTIVE);
    const result = await resolveSharedPage(tokenFor('view'), request('203.0.113.1'), fake.client, NOW);
    expect(result.kind).toBe('view');
    expect(fake.queries.map((query) => query.table)).toEqual(['share_links', 'post_metrics', 'share_links']);
    expect(fake.rpcCalls[0].args.p_user_id).toBe(OWNER);
  });

  it('answers not found for an unknown token without reading any data', async () => {
    const fake = supabaseFor(null);
    const result = await resolveSharedPage(tokenFor('unknown'), request('203.0.113.2'), fake.client, NOW);
    expect(result).toEqual({ kind: 'not-found' });
    expect(fake.queries.map((query) => query.table)).toEqual(['share_links']);
    expect(fake.rpcCalls).toHaveLength(0);
  });

  it('answers not found for a revoked token the same way as an unknown one', async () => {
    const fake = supabaseFor({ ...ACTIVE, revoked_at: '2026-11-17T00:00:00.000Z' });
    const result = await resolveSharedPage(tokenFor('revoked'), request('203.0.113.3'), fake.client, NOW);
    expect(result).toEqual({ kind: 'not-found' });
    expect(fake.rpcCalls).toHaveLength(0);
  });

  it('answers not found for a malformed token before touching the database', async () => {
    const fake = supabaseFor(ACTIVE);
    const result = await resolveSharedPage('short', request('203.0.113.4'), fake.client, NOW);
    expect(result).toEqual({ kind: 'not-found' });
    expect(fake.queries).toHaveLength(0);
  });

  it('limits one address and answers rate limited before any lookup', async () => {
    const fake = supabaseFor(ACTIVE);
    const limit = RATE_LIMITS.shareViewIp.limit;
    for (let index = 0; index < limit; index += 1) {
      await resolveSharedPage('short', request('203.0.113.5'), fake.client, NOW);
    }
    const result = await resolveSharedPage(tokenFor('ip-limited'), request('203.0.113.5'), fake.client, NOW);
    expect(result).toEqual({ kind: 'rate-limited' });
    expect(fake.queries).toHaveLength(0);
    const other = await resolveSharedPage(tokenFor('ip-other'), request('203.0.113.6'), fake.client, NOW);
    expect(other.kind).toBe('view');
  });

  it('limits one token across many addresses and answers rate limited before any lookup', async () => {
    const fake = supabaseFor(ACTIVE);
    const token = tokenFor('token-limited');
    const limit = RATE_LIMITS.shareViewToken.limit;
    for (let index = 0; index < limit; index += 1) {
      await resolveSharedPage(token, request(`198.51.100.${(index % 250) + 1}`), supabaseFor(null).client, NOW);
    }
    const result = await resolveSharedPage(token, request('192.0.2.77'), fake.client, NOW);
    expect(result).toEqual({ kind: 'rate-limited' });
    expect(fake.queries).toHaveLength(0);
  });

  it('keys the token limiter on a hash prefix, not the token', () => {
    const token = tokenFor('bucket');
    expect(hashShareToken(token).slice(0, 16)).not.toContain(token);
  });
});
