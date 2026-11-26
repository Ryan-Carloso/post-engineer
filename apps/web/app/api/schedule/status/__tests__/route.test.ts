import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextResponse } from 'next/server';

vi.mock('@/lib/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rate-limit')>()),
  applyRateLimit: vi.fn(async () => null),
}));
vi.mock('@/lib/request-auth', () => ({
  requireSupabaseSession: vi.fn(),
  engineAuthHeaders: (userId: string) => ({ 'x-user-id': userId }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}));
vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: vi.fn(),
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { GET } from '../route';
import { parseStatusLimit as parseLimit } from '@/lib/contracts/schedule';
import { ListPostsInRangeResponseSchema, ListPostsResponseSchema, RANGE_STATUSES } from '@/lib/contracts/schedule';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { logger } from '@/lib/logger';

describe('parseStatusLimit', () => {
  it('defaults to 10 when the param is missing', () => {
    expect(parseLimit(null)).toBe(10);
  });

  it('accepts valid positive integers', () => {
    expect(parseLimit('50')).toBe(50);
    expect(parseLimit('1')).toBe(1);
  });

  it('falls back to 10 for non-numeric or non-positive values', () => {
    expect(parseLimit('abc')).toBe(10);
    expect(parseLimit('0')).toBe(10);
    expect(parseLimit('-5')).toBe(10);
    expect(parseLimit('')).toBe(10);
  });

  it('falls back to 10 for partially-numeric values', () => {
    expect(parseLimit('12abc')).toBe(10);
    expect(parseLimit(' 20')).toBe(10);
    expect(parseLimit('20 ')).toBe(10);
  });

  it('caps the limit at 500', () => {
    expect(parseLimit('1000')).toBe(500);
    expect(parseLimit('500')).toBe(500);
  });
});

const USER_ID = 'user-1';

function mockPostsClient(upcoming: unknown[], recent: unknown[], queue: unknown[] = [], any?: unknown[], awaiting: unknown[] = []) {
  let limitCalls = 0;
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    contains: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn(async () => {
      const call = limitCalls++;
      return {
        data:
          call === 0
            ? upcoming
            : call === 1
              ? awaiting
              : call === 2
                ? recent
                : call === 4
                  ? (any ?? (upcoming.length > 0 || recent.length > 0 || awaiting.length > 0 ? [{ id: 'any-1' }] : []))
                  : [],
        error: null,
      };
    }),
    then: (resolve: (value: unknown) => void) => resolve({ data: queue, error: null }),
  };
  const from = vi.fn(() => chain);
  return { from, chain };
}

function mockAuthSession(auth: unknown, error: unknown) {
  vi.mocked(requireSupabaseSession).mockResolvedValue({ auth, error } as never);
}

function mockScopedPostsClient(schedules: Array<{ id: string; persona_id: string | null }>, upcoming: unknown[], recent: unknown[], queue: unknown[] = [], any?: unknown[], awaiting: unknown[] = []) {
  let limitCalls = 0;
  const postsChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    contains: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn(async () => {
      const call = limitCalls++;
      return {
        data:
          call === 0
            ? upcoming
            : call === 1
              ? awaiting
              : call === 2
                ? recent
                : call === 4
                  ? (any ?? (upcoming.length > 0 || recent.length > 0 || awaiting.length > 0 ? [{ id: 'any-1' }] : []))
                  : [],
        error: null,
      };
    }),
    then: (resolve: (value: unknown) => void) => resolve({ data: queue, error: null }),
  };
  const schedulesChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    then: (resolve: (value: unknown) => void) => resolve({ data: schedules, error: null }),
  };
  const from = vi.fn((table: string) => (table === 'schedules' ? schedulesChain : postsChain));
  return { from, postsChain, schedulesChain };
}

describe('GET auth', () => {
  const upcoming = [{ id: 'up-1', slot_at: '2026-09-24T10:00:00Z', status: 'ready', title: 'Next', schedule_id: 's1', error: null, published_at: null}];
  const recent = [{ id: 're-1', slot_at: '2026-09-20T10:00:00Z', status: 'published', title: 'Old', schedule_id: 's1', error: null, published_at: null}];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://example.com');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('accepts an API key and queries with the service client', async () => {
    const client = mockPostsClient(upcoming, recent);
    mockAuthSession({ userId: USER_ID, accessToken: 'pe_test_key', isApiKey: true }, null);
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await GET(new Request('https://example.com/api/schedule/status?limit=5'));

    expect(requireSupabaseSession).toHaveBeenCalledOnce();
    expect(createSupabaseServiceClient).toHaveBeenCalledOnce();
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
    expect(client.chain.eq).toHaveBeenCalledWith('user_id', USER_ID);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(ListPostsResponseSchema.safeParse(body).success).toBe(true);
    const upcomingSelect = client.chain.select.mock.calls[0]?.[0] as string;
    expect(upcomingSelect).toContain('error');
    expect(upcomingSelect).toContain('published_at');
    expect(body).toEqual({
      success: true,
      upcoming: upcoming.map((slot) => ({
        ...slot,
        postUrl: `https://example.com/posts/${slot.id}`,
      })),
      recent: recent.map((slot) => ({
        ...slot,
        postUrl: `https://example.com/posts/${slot.id}`,
      })),
      hasAnyPost: true,
    });
  });

  it('keeps far-future awaiting slots when nearer ready slots fill the limit', async () => {
    const ready = [
      { id: 'up-1', slot_at: '2026-09-24T10:00:00Z', status: 'ready', title: 'First', schedule_id: 's1', error: null, published_at: null },
      { id: 'up-2', slot_at: '2026-09-24T11:00:00Z', status: 'ready', title: 'Second', schedule_id: 's1', error: null, published_at: null },
    ];
    const awaiting = [
      { id: 'aw-1', slot_at: '2026-10-24T10:00:00Z', status: 'awaiting_approval', title: 'Held', schedule_id: 's1', error: null, published_at: null },
    ];
    const client = mockPostsClient(ready, [], [], [], awaiting);
    mockAuthSession({ userId: USER_ID, accessToken: 'pe_test_key', isApiKey: true }, null);
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await GET(new Request('https://example.com/api/schedule/status?limit=2'));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(ListPostsResponseSchema.safeParse(body).success).toBe(true);
    expect(body.upcoming.map((slot: { id: string }) => slot.id)).toEqual(['up-1', 'up-2', 'aw-1']);
  });

  it('builds postUrl from the public app URL, not the proxy request origin', async () => {
    const client = mockPostsClient(upcoming, recent);
    mockAuthSession({ userId: USER_ID, accessToken: 'pe_test_key', isApiKey: true }, null);
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://post-engineer.com');

    const response = await GET(new Request('http://0.0.0.0:3000/api/schedule/status?limit=5'));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.upcoming[0].postUrl).toBe('https://post-engineer.com/posts/up-1');
    expect(body.recent[0].postUrl).toBe('https://post-engineer.com/posts/re-1');
  });

  it('keeps working with a cookie session through the server client', async () => {
    const client = mockPostsClient(upcoming, recent);
    mockAuthSession({ userId: USER_ID, accessToken: 'jwt' }, null);
    vi.mocked(createSupabaseServerClient).mockResolvedValue(client as never);

    const response = await GET(new Request('https://example.com/api/schedule/status'));

    expect(createSupabaseServerClient).toHaveBeenCalledOnce();
    expect(createSupabaseServiceClient).not.toHaveBeenCalled();
    expect(client.chain.eq).toHaveBeenCalledWith('user_id', USER_ID);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      success: true,
      upcoming: upcoming.map((slot) => ({
        ...slot,
        postUrl: `https://example.com/posts/${slot.id}`,
      })),
      recent: recent.map((slot) => ({
        ...slot,
        postUrl: `https://example.com/posts/${slot.id}`,
      })),
      hasAnyPost: true,
    });
  });

  it('returns 401 when authentication fails', async () => {
    const authError = NextResponse.json(
      { success: false, error: 'Authentication required.' },
      { status: 401 },
    );
    mockAuthSession(null, authError);

    const response = await GET(new Request('https://example.com/api/schedule/status'));

    expect(response.status).toBe(401);
    expect(createSupabaseServiceClient).not.toHaveBeenCalled();
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it('uses the service client for OAuth tokens (no silent-empty via RLS)', async () => {
    const client = mockPostsClient(upcoming, recent);
    mockAuthSession({ userId: USER_ID, accessToken: 'oauth.jwt.token', isOAuth: true }, null);
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await GET(new Request('https://example.com/api/schedule/status'));

    expect(createSupabaseServiceClient).toHaveBeenCalledOnce();
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      success: true,
      upcoming: upcoming.map((slot) => ({
        ...slot,
        postUrl: `https://example.com/posts/${slot.id}`,
      })),
      recent: recent.map((slot) => ({
        ...slot,
        postUrl: `https://example.com/posts/${slot.id}`,
      })),
      hasAnyPost: true,
    });
  });

  it('restricts a persona-scoped API key to its allowed schedules', async () => {
    const allowedUpcoming = [{ id: 'up-1', slot_at: '2026-09-24T10:00:00Z', status: 'ready', title: 'Next', schedule_id: 's1', error: null, published_at: null}];
    const allowedRecent = [{ id: 're-1', slot_at: '2026-09-20T10:00:00Z', status: 'published', title: 'Old', schedule_id: 's1', error: null, published_at: null}];
    const client = mockScopedPostsClient(
      [{ id: 's1', persona_id: 'p1' }],
      allowedUpcoming,
      allowedRecent,
    );
    mockAuthSession(
      { userId: USER_ID, accessToken: 'pe_live_scoped', isApiKey: true, keyId: 'key-1', personaIds: ['p1'] },
      null,
    );
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await GET(new Request('https://example.com/api/schedule/status'));

    expect(response.status).toBe(200);
    expect(client.from).toHaveBeenCalledWith('schedules');
    expect(client.schedulesChain.eq).toHaveBeenCalledWith('user_id', USER_ID);
    expect(client.schedulesChain.select).toHaveBeenCalledWith('id, persona_id');
    expect(client.postsChain.in).toHaveBeenCalledWith('schedule_id', ['s1']);
    const body = await response.json();
    expect(body).toEqual({
      success: true,
      upcoming: allowedUpcoming.map((slot) => ({
        ...slot,
        postUrl: `https://example.com/posts/${slot.id}`,
      })),
      recent: allowedRecent.map((slot) => ({
        ...slot,
        postUrl: `https://example.com/posts/${slot.id}`,
      })),
      hasAnyPost: true,
    });
  });

  it('keeps a persona-less schedule visible to a scoped key', async () => {
    const upcoming = [{ id: 'up-9', slot_at: '2026-09-24T10:00:00Z', status: 'ready', title: 'No persona', schedule_id: 's9', error: null, published_at: null}];
    const client = mockScopedPostsClient(
      [{ id: 's9', persona_id: null }],
      upcoming,
      [],
    );
    mockAuthSession(
      { userId: USER_ID, accessToken: 'pe_live_scoped', isApiKey: true, keyId: 'key-1', personaIds: ['p1'] },
      null,
    );
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await GET(new Request('https://example.com/api/schedule/status'));

    expect(response.status).toBe(200);
    expect(client.postsChain.in).toHaveBeenCalledWith('schedule_id', ['s9']);
    const body = await response.json();
    expect(body.upcoming).toHaveLength(1);
    expect(body.upcoming[0].title).toBe('No persona');
  });

  it('drops a schedule whose persona is outside the key scope', async () => {
    const upcoming = [{ id: 'up-8', slot_at: '2026-09-24T10:00:00Z', status: 'ready', title: 'Other persona', schedule_id: 's8', error: null, published_at: null}];
    const client = mockScopedPostsClient(
      [{ id: 's8', persona_id: 'p-other' }],
      upcoming,
      [],
    );
    mockAuthSession(
      { userId: USER_ID, accessToken: 'pe_live_scoped', isApiKey: true, keyId: 'key-1', personaIds: ['p1'] },
      null,
    );
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await GET(new Request('https://example.com/api/schedule/status'));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ success: true, upcoming: [], recent: [], hasAnyPost: false });
  });

  it('returns empty lists for a scoped key with no allowed schedules', async () => {
    const client = mockScopedPostsClient([], [], []);
    mockAuthSession(
      { userId: USER_ID, accessToken: 'pe_live_scoped', isApiKey: true, keyId: 'key-1', personaIds: ['p1'] },
      null,
    );
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await GET(new Request('https://example.com/api/schedule/status'));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ success: true, upcoming: [], recent: [], hasAnyPost: false });
    expect(client.from).not.toHaveBeenCalledWith('scheduled_posts');
  });
});

describe('hasAnyPost', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is true when the only posts are stale past pending slots invisible to upcoming/recent', async () => {
    const client = mockPostsClient([], [], [], [{ id: 'stale-1' }]);
    mockAuthSession({ userId: USER_ID, accessToken: 'pe_test_key', isApiKey: true }, null);
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await GET(new Request('https://example.com/api/schedule/status?limit=1'));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ success: true, upcoming: [], recent: [], hasAnyPost: true });
  });

  it('is false when the account has no posts at all', async () => {
    const client = mockPostsClient([], []);
    mockAuthSession({ userId: USER_ID, accessToken: 'pe_test_key', isApiKey: true }, null);
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await GET(new Request('https://example.com/api/schedule/status?limit=1'));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ success: true, upcoming: [], recent: [], hasAnyPost: false });
  });
});




describe('GET query contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function getWithLimit(limitParam: string | null) {
    const upcoming = [
      { id: 'up-1', slot_at: '2026-09-24T10:00:00Z', status: 'ready', title: 'Next', schedule_id: 's1', error: null, published_at: null},
    ];
    const client = mockPostsClient(upcoming, []);
    mockAuthSession({ userId: USER_ID, accessToken: 'pe_test_key', isApiKey: true }, null);
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
    const url =
      limitParam === null
        ? 'https://example.com/api/schedule/status'
        : `https://example.com/api/schedule/status?limit=${limitParam}`;
    const response = await GET(new Request(url));
    expect(response.status).toBe(200);
    return client;
  }

  function scheduleIdFilters(chain: { in: { mock: { calls: unknown[][] } } }) {
    const calls: unknown[][] = chain.in.mock.calls;
    return calls.filter(([column]) => column === 'schedule_id');
  }

  it('queries scheduled_posts five times, each scoped by the caller user id', async () => {
    const client = await getWithLimit(null);
    const fromCalls: unknown[][] = client.from.mock.calls;
    expect(fromCalls).toHaveLength(5);
    expect(fromCalls.every(([table]) => table === 'scheduled_posts')).toBe(true);
    const eqCalls: unknown[][] = client.chain.eq.mock.calls;
    expect(eqCalls).toHaveLength(5);
    expect(eqCalls.every(([column, value]) => column === 'user_id' && value === USER_ID)).toBe(true);
  });

  it('filters upcoming, recent and publishing queries by status', async () => {
    const client = await getWithLimit(null);
    const inCalls = client.chain.in.mock.calls;
    expect(inCalls).toContainEqual(['status', ['ready']]);
    expect(inCalls).toContainEqual(['status', ['awaiting_approval']]);
    expect(inCalls).toContainEqual(['status', ['published', 'failed']]);
    expect(inCalls).toContainEqual(['status', ['publishing']]);
    expect(inCalls.filter(([column]: unknown[]) => column === 'status')).toHaveLength(4);
  });

  it('selects the documented columns on every query', async () => {
    const client = await getWithLimit(null);
    expect(client.chain.select).toHaveBeenCalledWith(
      'id, slot_at, status, title, error, published_at, schedule_id',
    );
    expect(client.chain.select).toHaveBeenCalledWith(
      'id, slot_at, status, title, error, published_at, schedule_id, publish_outcomes',
    );
    expect(client.chain.select).toHaveBeenCalledWith('id');
  });

  it('orders upcoming ascending and recent descending by slot_at', async () => {
    const client = await getWithLimit(null);
    const orderCalls: unknown[][] = client.chain.order.mock.calls;
    const ascending = orderCalls.filter(
      ([column, options]) =>
        column === 'slot_at' && (options as { ascending?: boolean } | null)?.ascending === true,
    );
    const descending = orderCalls.filter(
      ([column, options]) =>
        column === 'slot_at' && (options as { ascending?: boolean } | null)?.ascending === false,
    );
    expect(ascending).toHaveLength(3);
    expect(descending).toHaveLength(1);
  });

  it('only fetches upcoming slots at or after now', async () => {
    const client = await getWithLimit(null);
    expect(client.chain.gte).toHaveBeenCalledWith('slot_at', expect.any(String));
  });

  it('applies the parsed limit to the paginated lists, and 1 to the existence row', async () => {
    const client = await getWithLimit('5');
    expect(client.chain.limit).toHaveBeenCalledTimes(5);
    expect(client.chain.limit).toHaveBeenNthCalledWith(1, 5);
    expect(client.chain.limit).toHaveBeenNthCalledWith(2, 5);
    expect(client.chain.limit).toHaveBeenNthCalledWith(3, 5);
    expect(client.chain.limit).toHaveBeenNthCalledWith(4, 5);
    expect(client.chain.limit).toHaveBeenNthCalledWith(5, 1);
  });

  it('does not filter by schedule id for unscoped callers', async () => {
    const client = await getWithLimit(null);
    expect(scheduleIdFilters(client.chain)).toHaveLength(0);
  });

  it('restricts every scoped post query to the allowed schedule ids', async () => {
    const client = mockScopedPostsClient([{ id: 's1', persona_id: 'p1' }], [], []);
    mockAuthSession(
      { userId: USER_ID, accessToken: 'pe_live_scoped', isApiKey: true, keyId: 'key-1', personaIds: ['p1'] },
      null,
    );
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
    const response = await GET(new Request('https://example.com/api/schedule/status'));
    expect(response.status).toBe(200);
    expect(scheduleIdFilters(client.postsChain)).toHaveLength(5);
    expect(client.schedulesChain.select).toHaveBeenCalledWith('id, persona_id');
  });

  it('puts a publishing slot with a user notice into upcoming', async () => {
    const notice = 'Bluesky did not publish because the email on this account is not verified. This is a problem with your account. Only you can fix it: verify the email on Bluesky.';
    let limitCalls = 0;
    const publishingRow = {
      id: 'pub-1',
      slot_at: '2026-09-24T10:00:00Z',
      status: 'publishing',
      title: 'Live',
      schedule_id: 's1',
      publish_outcomes: [{
        provider: 'bluesky',
        accountId: 'b1',
        status: 'failed',
        code: 'email_not_verified',
        requiresUser: true,
        notice,
      }],
      error: null, published_at: null};
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      contains: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn(async () => {
        const call = limitCalls++;
        return { data: call === 3 ? [publishingRow] : [], error: null };
      }),
      then: (resolve: (value: unknown) => void) => resolve({ data: [], error: null }),
    };
    const client = { from: vi.fn(() => chain) };
    mockAuthSession({ userId: USER_ID, accessToken: 'pe_test_key', isApiKey: true }, null);
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await GET(new Request('https://example.com/api/schedule/status'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.upcoming).toHaveLength(1);
    expect(body.upcoming[0].id).toBe('pub-1');
    expect(body.upcoming[0].status).toBe('publishing');
    expect(body.upcoming[0].userNotices[0].notice).toBe(notice);
    expect(body.upcoming[0].userNotices[0].requiresUser).toBe(true);
    expect(body.upcoming[0].providerFailures[0].requiresUser).toBe(true);
    expect(body.upcoming[0].providerFailures[0].notice).toContain('Only you can fix');
    expect(body.upcoming[0].publish_outcomes).toBeUndefined();
    expect(body.recent).toEqual([]);
  });

  it('filters publishing slots by user notice in SQL, before the limit', async () => {
    const client = await getWithLimit(null);
    expect(client.chain.contains).toHaveBeenCalledTimes(1);
    expect(client.chain.contains).toHaveBeenCalledWith('publish_outcomes', '[{"requiresUser":true}]');
  });

  it('merges publishing slots into upcoming by slot_at and caps the list at the limit', async () => {
    const outcome = { provider: 'bluesky', accountId: 'b1', status: 'failed', code: 'token_expired', requiresUser: true, notice: 'n' };
    const upcomingRows = [
      { id: 'up-1', slot_at: '2026-09-24T09:00:00Z', status: 'ready', title: 'A', schedule_id: 's1', error: null, published_at: null},
      { id: 'up-2', slot_at: '2026-09-24T11:00:00Z', status: 'ready', title: 'B', schedule_id: 's1', error: null, published_at: null},
    ];
    const publishingRows = [
      { id: 'pub-1', slot_at: '2026-09-24T10:00:00Z', status: 'publishing', title: 'P', schedule_id: 's1', publish_outcomes: [outcome], error: null, published_at: null},
    ];
    let limitCalls = 0;
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      contains: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn(async () => {
        const call = limitCalls++;
        return { data: call === 0 ? upcomingRows : call === 3 ? publishingRows : [], error: null };
      }),
      then: (resolve: (value: unknown) => void) => resolve({ data: [], error: null }),
    };
    mockAuthSession({ userId: USER_ID, accessToken: 'pe_test_key', isApiKey: true }, null);
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: vi.fn(() => chain) } as never);

    const response = await GET(new Request('https://example.com/api/schedule/status?limit=2'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.upcoming.map((slot: { id: string }) => slot.id)).toEqual(['up-1', 'pub-1']);
  });

  it('lists awaiting_approval slots in upcoming, including an expired one', async () => {
    const awaiting = [
      { id: 'aw-1', slot_at: '2026-09-20T10:00:00Z', status: 'awaiting_approval', title: 'Expired hold', schedule_id: 's1', error: null, published_at: null },
      { id: 'aw-2', slot_at: '2026-09-25T10:00:00Z', status: 'awaiting_approval', title: 'Held', schedule_id: 's1', error: null, published_at: null },
    ];
    const client = mockPostsClient([], [], [], undefined, awaiting);
    mockAuthSession({ userId: USER_ID, accessToken: 'pe_test_key', isApiKey: true }, null);
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await GET(new Request('https://example.com/api/schedule/status'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(ListPostsResponseSchema.safeParse(body).success).toBe(true);
    expect(body.upcoming.map((slot: { id: string }) => slot.id)).toEqual(['aw-1', 'aw-2']);
    expect(body.upcoming[0].status).toBe('awaiting_approval');
  });

  it('serves awaiting_approval descriptions and signed media previews in upcoming', async () => {
    const awaiting = [
      {
        id: 'aw-1',
        slot_at: '2026-09-25T10:00:00Z',
        status: 'awaiting_approval',
        title: 'Held',
        description: 'Edited outside.',
        schedule_id: 's1',
        error: null,
        published_at: null,
        media_kind: 'image',
        media_ref: 'scheduled-media/user-1/pic.jpg',
        media_content_type: 'image/jpeg',
      },
    ];
    const client = mockPostsClient([], [], [], undefined, awaiting);
    const mediaClient = {
      ...client,
      storage: {
        from: () => ({
          createSignedUrl: async () => ({
            data: { signedUrl: 'https://example.com/signed.jpg' },
            error: null,
          }),
        }),
      },
    };
    mockAuthSession({ userId: USER_ID, accessToken: 'pe_test_key', isApiKey: true }, null);
    vi.mocked(createSupabaseServiceClient).mockReturnValue(mediaClient as never);

    const response = await GET(new Request('https://example.com/api/schedule/status'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(ListPostsResponseSchema.safeParse(body).success).toBe(true);
    expect(body.upcoming[0].description).toBe('Edited outside.');
    expect(body.upcoming[0].media).toEqual({
      kind: 'image',
      url: 'https://example.com/signed.jpg',
      contentType: 'image/jpeg',
    });
    expect(body.upcoming[0].media_kind).toBeUndefined();
    expect(body.upcoming[0].media_ref).toBeUndefined();
    expect(body.upcoming[0].media_content_type).toBeUndefined();
  });

  it('restricts awaiting_approval slots to the scoped key schedules', async () => {
    const awaiting = [
      { id: 'aw-1', slot_at: '2026-09-25T10:00:00Z', status: 'awaiting_approval', title: 'Held', schedule_id: 's1', error: null, published_at: null },
    ];
    const client = mockScopedPostsClient([{ id: 's1', persona_id: 'p1' }], [], [], [], undefined, awaiting);
    mockAuthSession(
      { userId: USER_ID, accessToken: 'pe_live_scoped', isApiKey: true, keyId: 'key-1', personaIds: ['p1'] },
      null,
    );
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await GET(new Request('https://example.com/api/schedule/status'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.upcoming.map((slot: { id: string }) => slot.id)).toEqual(['aw-1']);
    expect(client.postsChain.in).toHaveBeenCalledWith('schedule_id', ['s1']);
  });
});

function mockFailingPostsClient(options: {
  upcoming?: unknown[];
  upcomingError?: unknown;
  recentError?: unknown;
  queueError?: unknown;
  queue?: unknown;
}) {
  let limitCalls = 0;
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    contains: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn(async () => {
      const isUpcoming = limitCalls++ === 0;
      return {
        data: isUpcoming ? (options.upcoming ?? []) : [],
        error: isUpcoming ? (options.upcomingError ?? null) : (options.recentError ?? null),
      };
    }),
    then: (resolve: (value: unknown) => void) =>
      resolve({
        data: options.queue !== undefined ? options.queue : [],
        error: options.queueError ?? null,
      }),
  };
  const from = vi.fn(() => chain);
  return { from, chain };
}

function mockScopedScheduleClient(scheduleResult: { data: unknown; error: unknown }) {
  const schedulesChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    then: (resolve: (value: unknown) => void) => resolve(scheduleResult),
  };
  const from = vi.fn(() => schedulesChain);
  return { from, schedulesChain };
}

describe('GET failure handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function getWithFailures(options: {
    upcoming?: unknown[];
    upcomingError?: unknown;
    recentError?: unknown;
    queueError?: unknown;
    queue?: unknown;
  }) {
    const client = mockFailingPostsClient(options);
    mockAuthSession({ userId: USER_ID, accessToken: 'pe_test_key', isApiKey: true }, null);
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
    const response = await GET(new Request('https://example.com/api/schedule/status'));
    return { response, client };
  }

  function getScopedWithScheduleResult(scheduleResult: { data: unknown; error: unknown }) {
    const client = mockScopedScheduleClient(scheduleResult);
    mockAuthSession(
      { userId: USER_ID, accessToken: 'pe_live_scoped', isApiKey: true, keyId: 'key-1', personaIds: ['p1'] },
      null,
    );
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
    return GET(new Request('https://example.com/api/schedule/status')).then((response) => ({
      response,
      client,
    }));
  }

  it('returns 500 when the upcoming query fails', async () => {
    const { response } = await getWithFailures({ upcomingError: { message: 'db down' } });
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ success: false, error: 'Failed to load schedule status.' });
  });

  it('returns 500 when the recent query fails', async () => {
    const { response } = await getWithFailures({ recentError: { message: 'db down' } });
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ success: false, error: 'Failed to load schedule status.' });
  });

  it('returns 500 when the scoped schedule lookup fails', async () => {
    const { response, client } = await getScopedWithScheduleResult({
      data: null,
      error: { message: 'db down' },
    });
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ success: false, error: 'Failed to load schedule status.' });
    expect(client.from).not.toHaveBeenCalledWith('scheduled_posts');
  });

  it('treats a null scope lookup result as no allowed schedules', async () => {
    const { response, client } = await getScopedWithScheduleResult({ data: null, error: null });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ success: true, upcoming: [], recent: [], hasAnyPost: false });
    expect(client.from).not.toHaveBeenCalledWith('scheduled_posts');
  });

  it('treats null query data as empty lists', async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      contains: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn(async () => ({ data: null, error: null })),
      then: (resolve: (value: unknown) => void) => resolve({ data: null, error: null }),
    };
    const client = { from: vi.fn(() => chain) };
    mockAuthSession({ userId: USER_ID, accessToken: 'pe_test_key', isApiKey: true }, null);
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await GET(new Request('https://example.com/api/schedule/status'));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ success: true, upcoming: [], recent: [], hasAnyPost: false });
  });

  it('treats a scoped key with no personas as no allowed schedules', async () => {
    const client = mockScopedScheduleClient({ data: [], error: null });
    mockAuthSession(
      { userId: USER_ID, accessToken: 'pe_live_scoped', isApiKey: true, keyId: 'key-1', personaIds: [] },
      null,
    );
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await GET(new Request('https://example.com/api/schedule/status'));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ success: true, upcoming: [], recent: [], hasAnyPost: false });
    expect(client.from).not.toHaveBeenCalledWith('scheduled_posts');
  });
});

describe('GET range mode', () => {
  const FROM = '2026-11-01T00:00:00.000Z';
  const TO = '2026-12-01T00:00:00.000Z';
  const url = `https://example.com/api/schedule/status?from=${FROM}&to=${TO}`;

  function mockRangeClient(rows: unknown[], error: unknown = null) {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      contains: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lt: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn(async () => ({ data: rows, error })),
    };
    return { from: vi.fn(() => chain), chain };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthSession({ userId: USER_ID, accessToken: 't' }, null);
  });

  it('returns every status in [from, to) as slots, owner-scoped', async () => {
    const rows = [
      { id: 'a', slot_at: '2026-11-02T10:00:00Z', status: 'ready', title: 'A', schedule_id: 's1', error: null, published_at: null},
      { id: 'b', slot_at: '2026-11-03T10:00:00Z', status: 'published', title: 'B', schedule_id: 's1', error: null, published_at: null},
    ];
    const client = mockRangeClient(rows);
    vi.mocked(createSupabaseServerClient).mockResolvedValue(client as never);

    const response = await GET(new Request(url));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(ListPostsInRangeResponseSchema.safeParse(body).success).toBe(true);
    expect(body.truncated).toBe(false);
    expect(body.slots.map((s: { id: string; status: string }) => [s.id, s.status])).toEqual([
      ['a', 'ready'],
      ['b', 'published'],
    ]);
    expect(body.upcoming).toBeUndefined();
    expect(client.chain.eq).toHaveBeenCalledWith('user_id', USER_ID);
    expect(client.chain.gte).toHaveBeenCalledWith('slot_at', FROM);
    expect(client.chain.lt).toHaveBeenCalledWith('slot_at', TO);
    expect(client.chain.in).toHaveBeenCalledWith('status', [...RANGE_STATUSES]);
  });

  it('flags truncation instead of silently cutting past the cap', async () => {
    const rows = Array.from({ length: 1001 }, (_, i) => ({
      id: `p${i}`, slot_at: '2026-11-02T10:00:00Z', status: 'published', title: null, schedule_id: 's1',
      error: null, published_at: null}));
    const client = mockRangeClient(rows);
    vi.mocked(createSupabaseServerClient).mockResolvedValue(client as never);

    const body = await (await GET(new Request(url))).json();

    expect(client.chain.limit).toHaveBeenCalledWith(1001);
    expect(body.slots).toHaveLength(1000);
    expect(body.truncated).toBe(true);
  });

  it('answers 400 on a malformed range before touching auth or the database', async () => {
    const response = await GET(new Request('https://example.com/api/schedule/status?from=nope&to=nope'));
    expect(response.status).toBe(400);
    expect(requireSupabaseSession).not.toHaveBeenCalled();
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it('answers 400 when the range is combined with limit', async () => {
    const response = await GET(new Request(`${url}&limit=5`));
    expect(response.status).toBe(400);
  });

  it('logs and answers 500 when the range query fails', async () => {
    const client = mockRangeClient([], { message: 'boom' });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(client as never);
    const response = await GET(new Request(url));
    expect(response.status).toBe(500);
    expect(logger.error).toHaveBeenCalled();
  });

  it('restricts a persona-scoped key to its schedules in range mode', async () => {
    const client = mockScopedPostsClient([{ id: 's1', persona_id: 'p1' }, { id: 's2', persona_id: 'p2' }], [], []);
    (client.postsChain as Record<string, unknown>).lt = vi.fn().mockReturnThis();
    (client.postsChain as Record<string, unknown>).limit = vi.fn(async () => ({ data: [], error: null }));
    mockAuthSession({ userId: USER_ID, accessToken: 'pe_k', isApiKey: true, personaIds: ['p1'] }, null);
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await GET(new Request(url));

    expect(response.status).toBe(200);
    expect(client.postsChain.in).toHaveBeenCalledWith('schedule_id', ['s1']);
  });

  it('returns empty slots for a scoped key with no allowed schedules', async () => {
    const client = mockScopedPostsClient([{ id: 's2', persona_id: 'p2' }], [], []);
    mockAuthSession({ userId: USER_ID, accessToken: 'pe_k', isApiKey: true, personaIds: ['p1'] }, null);
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
    const body = await (await GET(new Request(url))).json();
    expect(body).toEqual({ success: true, slots: [], truncated: false });
  });
});
