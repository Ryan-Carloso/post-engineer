// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: vi.fn(),
}));

vi.mock('@/lib/request-auth', () => ({
  requireSupabaseSession: vi.fn(),
}));

vi.mock('@/lib/token-crypto', () => ({
  // non-reversible mock: hides the content like the real cipher would
  encryptTokens: vi.fn(
    (payload: Record<string, unknown>) => `v1.mockcipher.${Buffer.from(JSON.stringify(payload)).toString('base64')}`,
  ),
  decryptTokens: vi.fn(),
}));

// The limiter has its own suite (rate-limit.test.ts); here it never throttles.
vi.mock('@/lib/rate-limit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/rate-limit')>();
  return { ...actual, applyRateLimit: vi.fn().mockResolvedValue(null) };
});

import { POST } from '@/app/api/rumble-connect/route';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { requireSupabaseSession } from '@/lib/request-auth';
import { encryptTokens } from '@/lib/token-crypto';

const USER_ID = 'user-uuid-1';
const TOKEN = 'a'.repeat(40);

function mockSupabase(overrides: { user?: { id: string } | null; insertError?: unknown; isApiKey?: boolean } = {}) {
  const inserted: Array<Record<string, unknown>> = [];
  const client = {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: overrides.user === null ? null : { id: USER_ID } },
        error: null,
      })),
    },
    from: vi.fn((table: string) => {
      if (table === 'social_accounts') {
        return {
          insert: vi.fn((values: Record<string, unknown>) => {
            inserted.push(values);
            return {
              select: vi.fn(() => ({
                single: vi.fn(async () => ({
                  data: { id: 'row-1', ...values },
                  error: overrides.insertError ?? null,
                })),
              })),
            };
          }),
        };
      }
      return {};
    }),
  };
  vi.mocked(createSupabaseServerClient).mockResolvedValue(client as never);
  vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
  vi.mocked(requireSupabaseSession).mockResolvedValue(
    (overrides.user === null
      ? { auth: null, error: null }
      : {
        auth: {
          userId: USER_ID,
          accessToken: 'test-key',
          isApiKey: overrides.isApiKey === true,
        },
        error: null,
      }) as never
  );
  return { inserted };
}

function formRequest(fields: Record<string, string>): Request {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.append(key, value);
  }
  return new Request('http://localhost/api/rumble-connect', { method: 'POST', body: formData });
}

function jsonRequest(body: Record<string, string>): Request {
  return new Request('http://localhost/api/rumble-connect', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', authorization: 'Bearer test-key' },
  });
}

describe('POST /api/rumble-connect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 without session', async () => {
    mockSupabase({ user: null });
    const res = await POST(formRequest({ channelId: 'chan-1', accessToken: TOKEN }));
    expect(res.status).toBe(401);
  });

  it('returns 400 without channelId or accessToken', async () => {
    mockSupabase();
    const noChannel = await POST(formRequest({ accessToken: TOKEN }));
    expect(noChannel.status).toBe(400);
    const noToken = await POST(formRequest({ channelId: 'chan-1' }));
    expect(noToken.status).toBe(400);
  });

  it('returns 400 for a malformed token (wrong length or non-hex) and saves nothing', async () => {
    mockSupabase();
    const short = await POST(formRequest({ channelId: 'chan-1', accessToken: 'a'.repeat(39) }));
    expect(short.status).toBe(400);
    expect(await short.json()).toMatchObject({ success: false });
    const nonHex = await POST(formRequest({ channelId: 'chan-1', accessToken: 'g'.repeat(40) }));
    expect(nonHex.status).toBe(400);
    expect(vi.mocked(createSupabaseServerClient)).not.toHaveBeenCalled();
  });

  it('connects: encrypts the token and saves social_accounts with the channel id', async () => {
    const { inserted } = mockSupabase();

    const res = await POST(formRequest({ channelId: 'chan-1', accessToken: TOKEN }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; accountId: string; channelId: string };
    expect(body).toEqual({ success: true, accountId: 'row-1', channelId: 'chan-1' });

    // encrypted token, never in plaintext
    expect(encryptTokens).toHaveBeenCalledWith(
      expect.objectContaining({ access_token: TOKEN, token_type: 'rumble_access_token', channel_id: 'chan-1' }),
    );
    const blob = inserted[0]?.encrypted_tokens;
    expect(typeof blob).toBe('string');
    expect(String(blob)).not.toContain(TOKEN);

    expect(inserted[0]).toMatchObject({
      user_id: USER_ID,
      provider: 'rumble',
      provider_account_id: 'chan-1',
      account_name: 'chan-1',
      account_metadata: {},
    });
  });

  it('returns 500 when the insert fails', async () => {
    mockSupabase({ insertError: { message: 'check violation' } });
    const res = await POST(formRequest({ channelId: 'chan-1', accessToken: TOKEN }));
    expect(res.status).toBe(500);
  });

  it('error message never contains the access token', async () => {
    mockSupabase({ user: null });
    const res = await POST(formRequest({ channelId: 'x', accessToken: TOKEN }));
    const body = (await res.json()) as { error?: string };
    expect(JSON.stringify(body)).not.toContain(TOKEN);
  });

  it('MCP flow: API key + JSON connects and associates with the key owner', async () => {
    const { inserted } = mockSupabase({ isApiKey: true });

    const res = await POST(jsonRequest({ channelId: 'chan-1', accessToken: TOKEN }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; channelId: string };
    expect(body.success).toBe(true);
    expect(body.channelId).toBe('chan-1');

    expect(inserted[0]).toMatchObject({
      user_id: USER_ID,
      provider: 'rumble',
      provider_account_id: 'chan-1',
    });
    // via API key uses the service client
    expect(vi.mocked(createSupabaseServiceClient)).toHaveBeenCalled();
  });

  it('MCP flow: JSON without channelId/accessToken returns 400', async () => {
    mockSupabase({ isApiKey: true });
    const res = await POST(jsonRequest({ channelId: 'chan-1' }));
    expect(res.status).toBe(400);
  });
});
