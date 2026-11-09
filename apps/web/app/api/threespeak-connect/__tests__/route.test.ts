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

vi.mock('@/lib/threespeak', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/threespeak')>();
  return {
    ...actual,
    loginToThreespeak: vi.fn(),
  };
});

// The limiter has its own suite (rate-limit.test.ts); here it never throttles.
vi.mock('@/lib/rate-limit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/rate-limit')>();
  return { ...actual, applyRateLimit: vi.fn().mockResolvedValue(null) };
});

import { POST } from '@/app/api/threespeak-connect/route';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { requireSupabaseSession } from '@/lib/request-auth';
import { loginToThreespeak, ThreespeakError } from '@/lib/threespeak';
import { encryptTokens } from '@/lib/token-crypto';

const USER_ID = 'user-uuid-1';

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
      }) as never,
  );
  return { inserted };
}

function formRequest(fields: Record<string, string>): Request {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.append(key, value);
  }
  return new Request('http://localhost/api/threespeak-connect', { method: 'POST', body: formData });
}

function jsonRequest(body: Record<string, string>): Request {
  return new Request('http://localhost/api/threespeak-connect', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', authorization: 'Bearer <redacted>' },
  });
}

describe('POST /api/threespeak-connect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 without session', async () => {
    mockSupabase({ user: null });
    const res = await POST(formRequest({ username: 'alice', postingKey: '5Kx' }));
    expect(res.status).toBe(401);
  });

  it('returns 400 without username or posting key', async () => {
    mockSupabase();
    const noUsername = await POST(formRequest({ postingKey: '5Kx' }));
    expect(noUsername.status).toBe(400);
    const noKey = await POST(formRequest({ username: 'alice' }));
    expect(noKey.status).toBe(400);
  });

  it('rejects invalid credentials with 422 + THREESPEAK_CREDENTIAL_REJECTED (not 401) and saves nothing', async () => {
    const { inserted } = mockSupabase();
    vi.mocked(loginToThreespeak).mockRejectedValueOnce(
      new ThreespeakError('invalid_credentials', 'Invalid Hive posting key.'),
    );
    const res = await POST(formRequest({ username: 'alice', postingKey: 'wrong' }));
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ success: false, code: 'THREESPEAK_CREDENTIAL_REJECTED' });
    expect(inserted).toEqual([]);
  });

  it('connects: validates credential, encrypts posting key and saves social_accounts', async () => {
    const { inserted } = mockSupabase();
    vi.mocked(loginToThreespeak).mockResolvedValueOnce({ username: 'alice', accessToken: 'jwt-1' });

    const res = await POST(formRequest({ username: 'Alice', postingKey: '5Kpostingkey' }));
    expect(res.status).toBe(200);

    expect(loginToThreespeak).toHaveBeenCalledWith('Alice', '5Kpostingkey');

    // encrypted posting key, never in plaintext
    expect(encryptTokens).toHaveBeenCalledWith(
      expect.objectContaining({ access_token: '5Kpostingkey', token_type: 'threespeak_posting_key', handle: 'alice' }),
    );
    const blob = inserted[0]?.encrypted_tokens;
    expect(typeof blob).toBe('string');
    expect(String(blob)).not.toContain('5Kpostingkey');

    expect(inserted[0]).toMatchObject({
      user_id: USER_ID,
      provider: '3speak',
      provider_account_id: 'alice',
      account_name: 'alice',
    });
    const body = (await res.json()) as { success: boolean; username: string };
    expect(body).toMatchObject({ success: true, username: 'alice' });
  });

  it('returns 500 when the insert fails', async () => {
    mockSupabase({ insertError: { message: 'check violation' } });
    vi.mocked(loginToThreespeak).mockResolvedValueOnce({ username: 'alice', accessToken: 'jwt-1' });

    const res = await POST(formRequest({ username: 'alice', postingKey: '5Kpostingkey' }));
    expect(res.status).toBe(500);
  });

  it('error message never contains the posting key', async () => {
    mockSupabase({ user: null });
    const res = await POST(formRequest({ username: 'alice', postingKey: '5Ksegredo-123' }));
    const body = (await res.json()) as { error?: string };
    expect(JSON.stringify(body)).not.toContain('5Ksegredo-123');
  });

  it('MCP flow: API key + JSON connects and associates with the key owner', async () => {
    const { inserted } = mockSupabase({ isApiKey: true });
    vi.mocked(loginToThreespeak).mockResolvedValueOnce({ username: 'alice', accessToken: 'jwt-1' });

    const res = await POST(jsonRequest({ username: 'alice', postingKey: '5Kpostingkey' }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; username: string };
    expect(body.success).toBe(true);
    expect(body.username).toBe('alice');

    expect(loginToThreespeak).toHaveBeenCalledWith('alice', '5Kpostingkey');
    expect(inserted[0]).toMatchObject({
      user_id: USER_ID,
      provider: '3speak',
      provider_account_id: 'alice',
    });
    // via API key uses the service client
    expect(vi.mocked(createSupabaseServiceClient)).toHaveBeenCalled();
  });

  it('MCP flow: JSON without username/postingKey returns 400', async () => {
    mockSupabase({ isApiKey: true });
    const res = await POST(jsonRequest({ username: 'alice' }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(JSON.stringify(body)).not.toContain('5Kpostingkey');
  });
});
