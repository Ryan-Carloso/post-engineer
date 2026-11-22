import type { NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeSupabase, type FakeSupabase, type QueryResult } from '@/lib/share-links/__tests__/fake-supabase';
import { hashShareToken, isShareTokenShape } from '@/lib/share-links/token';
import { RATE_LIMITS } from '@/lib/rate-limit';

vi.mock('@/lib/request-auth', () => ({ requireSupabaseSession: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ createSupabaseServiceClient: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { logger } from '@/lib/logger';
import { GET, POST } from '../route';
import { DELETE } from '../[id]/route';

const USER = '11111111-1111-4111-8111-111111111111';
const PERSONA_A = '22222222-2222-4222-8222-222222222222';
const PERSONA_B = '44444444-4444-4444-8444-444444444444';
const LINK = '33333333-3333-4333-8333-333333333333';

function signIn(overrides: Record<string, unknown> = {}): void {
  vi.mocked(requireSupabaseSession).mockResolvedValue({
    auth: { userId: USER, accessToken: 'session', ...overrides },
    error: null,
  });
}

function useSupabase(options: Parameters<typeof fakeSupabase>[0]): FakeSupabase {
  const fake = fakeSupabase(options);
  vi.mocked(createSupabaseServiceClient).mockReturnValue(fake.client as unknown as ReturnType<typeof createSupabaseServiceClient>);
  return fake;
}

let nextIp = 1;

function post(body: unknown, init: { raw?: string } = {}): Request {
  nextIp += 1;
  return new Request('http://localhost:3434/api/share-links', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `203.0.113.${nextIp % 250}.${Math.floor(nextIp / 250)}` },
    body: init.raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
}

function createdRow(overrides: Record<string, unknown> = {}): QueryResult {
  return {
    data: [{ id: LINK, persona_ids: null, created_at: '2026-11-22T00:00:00.000Z', expires_at: null, ...overrides }],
    error: null,
  };
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe('POST /api/share-links', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signIn();
  });

  it('returns the unauthenticated response untouched', async () => {
    vi.mocked(requireSupabaseSession).mockResolvedValue({
      auth: null,
      error: new Response(JSON.stringify({ error: 'Auth required' }), { status: 401 }) as unknown as NextResponse,
    });
    const fake = useSupabase({});
    const response = await POST(post({}));
    expect(response.status).toBe(401);
    expect(fake.rpcCalls).toHaveLength(0);
  });

  it('creates an unscoped link, stores only the hash and returns the token once', async () => {
    const fake = useSupabase({ rpc: { create_share_link: createdRow() } });
    const response = await POST(post({}));
    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await json(response);
    expect(isShareTokenShape(body.token as string)).toBe(true);
    expect(body.path).toBe(`/s/${body.token as string}`);
    expect(body.url).toBe(`https://post-engineer.com/s/${body.token as string}`);
    expect(body).toMatchObject({ success: true, id: LINK, personaIds: null, expiresAt: null });
    const [call] = fake.rpcCalls;
    expect(call.fn).toBe('create_share_link');
    expect(call.args).toMatchObject({
      p_user_id: USER,
      p_token_hash: hashShareToken(body.token as string),
      p_persona_ids: null,
      p_expires_at: null,
      p_max: 10,
    });
    expect(JSON.stringify(call.args)).not.toContain(body.token as string);
  });

  it('accepts an empty body as an unscoped link', async () => {
    useSupabase({ rpc: { create_share_link: createdRow() } });
    const response = await POST(post(undefined));
    expect(response.status).toBe(201);
  });

  it('never logs the token', async () => {
    useSupabase({ rpc: { create_share_link: createdRow() } });
    const response = await POST(post({}));
    const { token } = await json(response);
    const logged = JSON.stringify([
      vi.mocked(logger.info).mock.calls,
      vi.mocked(logger.warn).mock.calls,
      vi.mocked(logger.error).mock.calls,
      vi.mocked(logger.debug).mock.calls,
    ]);
    expect(logged).not.toContain(token as string);
  });

  it('sets an expiry from expiresInDays', async () => {
    const fake = useSupabase({ rpc: { create_share_link: createdRow() } });
    const before = Date.now();
    await POST(post({ expiresInDays: 7 }));
    const expiresAt = Date.parse(fake.rpcCalls[0].args.p_expires_at as string);
    expect(expiresAt).toBeGreaterThanOrEqual(before + 7 * 24 * 60 * 60 * 1000);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + 7 * 24 * 60 * 60 * 1000);
  });

  it('scopes the link to personas the user owns', async () => {
    const fake = useSupabase({
      results: { personas: [{ data: [{ id: PERSONA_A }], error: null }] },
      rpc: { create_share_link: createdRow({ persona_ids: [PERSONA_A] }) },
    });
    const response = await POST(post({ personaIds: [PERSONA_A] }));
    expect(response.status).toBe(201);
    expect(await json(response)).toMatchObject({ personaIds: [PERSONA_A] });
    expect(fake.queries[0].calls).toContainEqual(['eq', 'user_id', USER]);
    expect(fake.queries[0].calls).toContainEqual(['in', 'id', [PERSONA_A]]);
    expect(fake.rpcCalls[0].args.p_persona_ids).toEqual([PERSONA_A]);
  });

  it('answers 404 and creates nothing when a persona is not the user\'s', async () => {
    const fake = useSupabase({ results: { personas: [{ data: [{ id: PERSONA_A }], error: null }] } });
    const response = await POST(post({ personaIds: [PERSONA_A, PERSONA_B] }));
    expect(response.status).toBe(404);
    expect(fake.rpcCalls).toHaveLength(0);
  });

  it('answers 500 and creates nothing when the persona lookup fails', async () => {
    const fake = useSupabase({ results: { personas: [{ data: null, error: { message: 'db down' } }] } });
    const response = await POST(post({ personaIds: [PERSONA_A] }));
    expect(response.status).toBe(500);
    expect(fake.rpcCalls).toHaveLength(0);
  });

  it.each([
    ['malformed JSON', { raw: '{nope' }, undefined],
    ['an unknown field', {}, { surprise: true }],
    ['a non-uuid persona', {}, { personaIds: ['not-a-uuid'] }],
    ['duplicate personas', {}, { personaIds: [PERSONA_A, PERSONA_A] }],
    ['an empty persona list', {}, { personaIds: [] }],
    ['a fractional expiry', {}, { expiresInDays: 1.5 }],
    ['a zero expiry', {}, { expiresInDays: 0 }],
    ['an expiry beyond a year', {}, { expiresInDays: 366 }],
    ['a string expiry', {}, { expiresInDays: '7' }],
    ['an array body', {}, []],
  ])('answers 400 for %s without touching the database', async (_label, init, body) => {
    const fake = useSupabase({});
    const response = await POST(post(body, init));
    expect(response.status).toBe(400);
    expect(fake.queries).toHaveLength(0);
    expect(fake.rpcCalls).toHaveLength(0);
  });

  it('answers 409 with a stable code when the active-link cap is reached', async () => {
    useSupabase({ rpc: { create_share_link: { data: [], error: null } } });
    const response = await POST(post({}));
    expect(response.status).toBe(409);
    expect(await json(response)).toMatchObject({ code: 'SHARE_LINK_LIMIT' });
  });

  it('answers 500 when the create function fails', async () => {
    useSupabase({ rpc: { create_share_link: { data: null, error: { message: 'db down' } } } });
    expect((await POST(post({}))).status).toBe(500);
  });

  it('answers 500 and never returns a token for a row it cannot read', async () => {
    useSupabase({ rpc: { create_share_link: { data: [{ id: 5 }], error: null } } });
    const response = await POST(post({}));
    expect(response.status).toBe(500);
    expect(JSON.stringify(await json(response))).not.toContain('"token"');
  });

  it('refuses a persona-scoped API key', async () => {
    signIn({ isApiKey: true, personaIds: [PERSONA_A] });
    const fake = useSupabase({});
    expect((await POST(post({}))).status).toBe(403);
    expect(fake.rpcCalls).toHaveLength(0);
  });

  it('lets an unscoped API key and an OAuth caller create links', async () => {
    useSupabase({ rpc: { create_share_link: createdRow() } });
    signIn({ isApiKey: true, personaIds: null });
    expect((await POST(post({}))).status).toBe(201);
    signIn({ isOAuth: true });
    expect((await POST(post({}))).status).toBe(201);
  });

  it('rate limits creation per address before authenticating', async () => {
    useSupabase({ rpc: { create_share_link: createdRow() } });
    const limited = (): Request =>
      new Request('http://localhost:3434/api/share-links', {
        method: 'POST',
        headers: { 'x-forwarded-for': '198.51.100.250' },
        body: '{}',
      });
    for (let index = 0; index < RATE_LIMITS.shareLinkManage.limit; index += 1) {
      expect((await POST(limited())).status).toBe(201);
    }
    vi.mocked(requireSupabaseSession).mockClear();
    const response = await POST(limited());
    expect(response.status).toBe(429);
    expect(requireSupabaseSession).not.toHaveBeenCalled();
  });
});

describe('GET /api/share-links', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signIn();
  });

  it('lists only the caller\'s links, newest first, without any token or hash', async () => {
    const fake = useSupabase({
      results: {
        share_links: [
          {
            data: [
              {
                id: LINK,
                persona_ids: [PERSONA_A],
                created_at: '2026-11-22T00:00:00.000Z',
                expires_at: null,
                revoked_at: null,
                last_viewed_at: '2026-11-22T01:00:00.000Z',
                token_hash: 'must-not-leak',
                user_id: USER,
              },
            ],
            error: null,
          },
        ],
      },
    });
    const response = await GET(new Request('http://localhost:3434/api/share-links'));
    expect(response.status).toBe(200);
    const body = await json(response);
    expect(body).toEqual({
      success: true,
      links: [
        {
          id: LINK,
          personaIds: [PERSONA_A],
          createdAt: '2026-11-22T00:00:00.000Z',
          expiresAt: null,
          revokedAt: null,
          lastViewedAt: '2026-11-22T01:00:00.000Z',
        },
      ],
    });
    const calls = fake.queries[0].calls;
    expect(calls).toContainEqual(['eq', 'user_id', USER]);
    expect(calls).toContainEqual(['order', 'created_at', { ascending: false }]);
    expect(String(calls.find((call) => call[0] === 'select')?.[1])).not.toContain('token_hash');
  });

  it('skips a row it cannot read and logs it', async () => {
    useSupabase({ results: { share_links: [{ data: [{ id: 5 }], error: null }] } });
    const response = await GET(new Request('http://localhost:3434/api/share-links'));
    expect((await json(response)).links).toEqual([]);
    expect(logger.error).toHaveBeenCalledWith('[api/share-links] skipped an unreadable share link row', expect.any(Error));
  });

  it('answers 500 when the list fails', async () => {
    useSupabase({ results: { share_links: [{ data: null, error: { message: 'db down' } }] } });
    expect((await GET(new Request('http://localhost:3434/api/share-links'))).status).toBe(500);
  });

  it('refuses a persona-scoped API key', async () => {
    signIn({ isApiKey: true, personaIds: [PERSONA_A] });
    const fake = useSupabase({});
    expect((await GET(new Request('http://localhost:3434/api/share-links'))).status).toBe(403);
    expect(fake.queries).toHaveLength(0);
  });
});

describe('DELETE /api/share-links/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signIn();
  });

  let revokeIp = 1;

  function remove(id: string): Promise<Response> {
    revokeIp += 1;
    return DELETE(
      new Request(`http://localhost:3434/api/share-links/${id}`, {
        method: 'DELETE',
        headers: { 'x-forwarded-for': `192.0.2.${revokeIp % 250}.${Math.floor(revokeIp / 250)}` },
      }),
      { params: Promise.resolve({ id }) },
    );
  }

  it('revokes an active link of the caller', async () => {
    const fake = useSupabase({ results: { share_links: [{ data: [{ id: LINK }], error: null }] } });
    const response = await remove(LINK);
    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ success: true, alreadyRevoked: false });
    const calls = fake.queries[0].calls;
    expect(calls).toContainEqual(['eq', 'id', LINK]);
    expect(calls).toContainEqual(['eq', 'user_id', USER]);
    expect(calls).toContainEqual(['is', 'revoked_at', null]);
    expect(calls.find((call) => call[0] === 'update')?.[1]).toEqual({ revoked_at: expect.any(String) });
  });

  it('reports an already revoked link as a success', async () => {
    useSupabase({
      results: { share_links: [{ data: [], error: null }, { data: { id: LINK }, error: null }] },
    });
    const response = await remove(LINK);
    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ success: true, alreadyRevoked: true });
  });

  it('answers 404 for a link that is not the caller\'s', async () => {
    const fake = useSupabase({ results: { share_links: [{ data: [], error: null }, { data: null, error: null }] } });
    expect((await remove(LINK)).status).toBe(404);
    expect(fake.queries[1].calls).toContainEqual(['eq', 'user_id', USER]);
  });

  it('answers 404 for a non-uuid id without touching the database', async () => {
    const fake = useSupabase({});
    expect((await remove('not-a-uuid')).status).toBe(404);
    expect(fake.queries).toHaveLength(0);
  });

  it('answers 500 when the revoke fails', async () => {
    useSupabase({ results: { share_links: [{ data: null, error: { message: 'db down' } }] } });
    expect((await remove(LINK)).status).toBe(500);
  });

  it('answers 500 when the existence check fails', async () => {
    useSupabase({
      results: { share_links: [{ data: [], error: null }, { data: null, error: { message: 'db down' } }] },
    });
    expect((await remove(LINK)).status).toBe(500);
  });

  it('refuses a persona-scoped API key', async () => {
    signIn({ isApiKey: true, personaIds: [PERSONA_A] });
    const fake = useSupabase({});
    expect((await remove(LINK)).status).toBe(403);
    expect(fake.queries).toHaveLength(0);
  });

  it('rate limits revocation per address before authenticating', async () => {
    useSupabase({ results: { share_links: Array.from({ length: 25 }, () => ({ data: [{ id: LINK }], error: null })) } });
    const same = (): Promise<Response> =>
      DELETE(
        new Request(`http://localhost:3434/api/share-links/${LINK}`, {
          method: 'DELETE',
          headers: { 'x-forwarded-for': '198.51.100.251' },
        }),
        { params: Promise.resolve({ id: LINK }) },
      );
    for (let index = 0; index < RATE_LIMITS.shareLinkManage.limit; index += 1) {
      expect((await same()).status).toBe(200);
    }
    vi.mocked(requireSupabaseSession).mockClear();
    expect((await same()).status).toBe(429);
    expect(requireSupabaseSession).not.toHaveBeenCalled();
  });
});
