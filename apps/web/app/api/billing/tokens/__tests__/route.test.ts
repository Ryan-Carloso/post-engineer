import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: vi.fn(),
}));

vi.mock('@/lib/api-keys', () => ({
  resolveApiKey: vi.fn(),
  validateApiKeyFormat: (key: string) => key.startsWith('post-engineer_'),
}));

vi.mock('@/lib/posthog-server', () => ({
  getPostHogServer: vi.fn(),
}));

//---------------
// Tests for GET /api/billing/tokens — prepaid wallet balance.
// Auth = Supabase session (cookie) OR personal API key (Bearer, MCP).
//---------------

import { GET } from '../route';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { resolveApiKey } from '@/lib/api-keys';
import { getPostHogServer } from '@/lib/posthog-server';

const USER_ID = 'user-1';

function profileSingle(data: unknown): { single: () => Promise<{ data: unknown }> } {
  return { single: () => Promise.resolve({ data }) };
}

function queryClient(singleData: unknown): {
  rpc: () => Promise<{ error: null }>;
  from: () => { select: () => { eq: () => { single: () => Promise<{ data: unknown }> } } };
} {
  return {
    rpc: () => Promise.resolve({ error: null }),
    from: () => ({ select: () => ({ eq: () => profileSingle(singleData) }) }),
  };
}

function mockServerProfile(singleData: unknown): void {
  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: {
      getUser: () => Promise.resolve({ data: { user: { id: USER_ID } }, error: null }),
      getSession: () => Promise.resolve({ data: { session: { access_token: 'sb-token' } }, error: null }),
    },
    from: () => ({
      select: () => ({
        eq: () => profileSingle(singleData),
      }),
    }),
  } as never);
}

function mockSession(): void {
  mockServerProfile({ tokens_balance: '5', free_tokens_balance: '3' });
}

describe('GET /api/billing/tokens', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession();
    vi.mocked(createSupabaseServiceClient).mockReturnValue(
      queryClient({ tokens_balance: '5', free_tokens_balance: '3' }) as never,
    );
    vi.mocked(getPostHogServer).mockReturnValue({ capture: vi.fn(), captureAs: vi.fn() } as never);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the balance summing paid + free for the session', async () => {
    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, balance: 8, free: 3 });
  });

  it('carries the fetched balance on the token_balance_fetched event', async () => {
    const client = { capture: vi.fn(), captureAs: vi.fn() };
    vi.mocked(getPostHogServer).mockReturnValue(client as never);
    const res = await GET();

    expect(res.status).toBe(200);
    // The wrapper reports fire-and-forget; the balance used to be
    // invisible in PostHog (route + status only), so a balance jump
    // could not be traced to the value the user actually saw.
    await vi.waitFor(() =>
      expect(client.capture).toHaveBeenCalledWith(
        'token_balance_fetched',
        expect.objectContaining({ balance: 8, route: 'GET /api/billing/tokens', status: 200 }),
      ),
    );
  });

  it('returns 401 without a session', async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: {
        getUser: () => Promise.resolve({ data: { user: null }, error: null }),
        getSession: () => Promise.resolve({ data: { session: null }, error: null }),
      },
    } as never);

    const res = await GET();

    expect(res.status).toBe(401);
  });

  it('accepts a personal API key via Authorization Bearer (MCP)', async () => {
    vi.mocked(resolveApiKey).mockResolvedValue({
      userId: USER_ID,
      keyId: 'key-1',
      personaIds: null,
    });

    const req = new Request('http://localhost:3434/api/billing/tokens', {
      headers: { Authorization: 'Bearer post-engineer_test123' },
    });
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, balance: 8, free: 3 });
  });

  it('returns a zero balance when there is no profile', async () => {
    mockServerProfile(null);

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, balance: 0, free: 0 });
  });

  it('grants the welcome bonus (lazy grant) via service role', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ rpc } as never);
    mockServerProfile({ tokens_balance: 0, free_tokens_balance: 3 });

    const res = await GET();

    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('grant_signup_bonus', { p_user_id: USER_ID });
    expect(await res.json()).toEqual({ success: true, balance: 3, free: 3 });
  });

  it('does not break when the grant fails (pending migration)', async () => {
    vi.mocked(createSupabaseServiceClient).mockReturnValue({
      rpc: vi.fn().mockRejectedValue(new Error('rpc missing')),
    } as never);
    mockServerProfile({ tokens_balance: '7', free_tokens_balance: '0' });

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, balance: 7, free: 0 });
  });

  it('returns 401 with an invalid API key', async () => {
    vi.mocked(resolveApiKey).mockResolvedValue(null);

    const req = new Request('http://localhost:3434/api/billing/tokens', {
      headers: { Authorization: 'Bearer post-engineer_invalid' },
    });
    const res = await GET(req);

    expect(res.status).toBe(401);
  });
});
