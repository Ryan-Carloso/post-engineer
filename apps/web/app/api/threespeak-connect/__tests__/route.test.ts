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

function mockSupabase(overrides: { user?: { id: string } | null; upsertError?: unknown; isApiKey?: boolean } = {}) {
  const upserted: Array<Record<string, unknown>> = [];
  const upsertOptions: Array<unknown> = [];
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
          upsert: vi.fn((values: Record<string, unknown>, options?: unknown) => {
            upserted.push(values);
            upsertOptions.push(options);
            return {
              select: vi.fn(() => ({
                single: vi.fn(async () => ({
                  data: { id: 'row-1', ...values },
                  error: overrides.upsertError ?? null,
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
  return { upserted, upsertOptions };
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
    expect(((await res.json()) as { error?: string }).error).toBe('Authentication required.');
  });

  it('returns 400 without username or posting key', async () => {
    mockSupabase();
    const noUsername = await POST(formRequest({ postingKey: '5Kx' }));
    expect(noUsername.status).toBe(400);
    expect(((await noUsername.json()) as { error?: string }).error).toBe('Hive username is required.');
    const noKey = await POST(formRequest({ username: 'alice' }));
    expect(noKey.status).toBe(400);
    expect(((await noKey.json()) as { error?: string }).error).toBe('Hive posting key is required.');
  });

  it('returns 400 with the field message for a blank username or posting key (JSON and FormData)', async () => {
    mockSupabase();
    const blankJsonUsername = await POST(jsonRequest({ username: '   ', postingKey: '5Kx' }));
    expect(blankJsonUsername.status).toBe(400);
    expect(((await blankJsonUsername.json()) as { error?: string }).error).toBe('Hive username is required.');
    const blankJsonKey = await POST(jsonRequest({ username: 'alice', postingKey: '   ' }));
    expect(blankJsonKey.status).toBe(400);
    expect(((await blankJsonKey.json()) as { error?: string }).error).toBe('Hive posting key is required.');
    const blankFormUsername = await POST(formRequest({ username: '   ', postingKey: '5Kx' }));
    expect(blankFormUsername.status).toBe(400);
    expect(((await blankFormUsername.json()) as { error?: string }).error).toBe('Hive username is required.');
    const blankFormKey = await POST(formRequest({ username: 'alice', postingKey: '   ' }));
    expect(blankFormKey.status).toBe(400);
    expect(((await blankFormKey.json()) as { error?: string }).error).toBe('Hive posting key is required.');
  });

  it('trims a padded username before validating the credential', async () => {
    mockSupabase();
    vi.mocked(loginToThreespeak).mockResolvedValueOnce({ username: 'alice', accessToken: 'jwt-1' });
    const res = await POST(formRequest({ username: '  Alice  ', postingKey: '5Kpostingkey' }));
    expect(res.status).toBe(200);
    expect(loginToThreespeak).toHaveBeenCalledWith('Alice', '5Kpostingkey');
  });

  it('returns 422 when the login error matches only by message (ThreespeakError name, no code)', async () => {
    mockSupabase();
    const error = new Error('Invalid Hive posting key.');
    error.name = 'ThreespeakError';
    vi.mocked(loginToThreespeak).mockRejectedValueOnce(error);
    const res = await POST(formRequest({ username: 'alice', postingKey: 'wrong' }));
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ success: false, code: 'THREESPEAK_CREDENTIAL_REJECTED' });
  });

  it('returns 500 when login fails with a non-credentials error', async () => {
    mockSupabase();
    vi.mocked(loginToThreespeak).mockRejectedValueOnce(new Error('Studio is down.'));
    const generic = await POST(formRequest({ username: 'alice', postingKey: '5Kpostingkey' }));
    expect(generic.status).toBe(500);
    expect(((await generic.json()) as { error?: string }).error).toBe('Could not connect the 3Speak account.');
    vi.mocked(loginToThreespeak).mockRejectedValueOnce(
      new ThreespeakError('login_failed', 'Studio is down.'),
    );
    const otherCode = await POST(formRequest({ username: 'alice', postingKey: '5Kpostingkey' }));
    expect(otherCode.status).toBe(500);
  });

  it('rejects invalid credentials with 422 + THREESPEAK_CREDENTIAL_REJECTED (not 401) and saves nothing', async () => {
    const { upserted } = mockSupabase();
    vi.mocked(loginToThreespeak).mockRejectedValueOnce(
      new ThreespeakError('invalid_credentials', 'Invalid Hive posting key.'),
    );
    const res = await POST(formRequest({ username: 'alice', postingKey: 'wrong' }));
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ success: false, code: 'THREESPEAK_CREDENTIAL_REJECTED' });
    expect(upserted).toEqual([]);
  });

  it('connects: validates credential, encrypts posting key and saves social_accounts', async () => {
    const { upserted } = mockSupabase();
    vi.mocked(loginToThreespeak).mockResolvedValueOnce({ username: 'alice', accessToken: 'jwt-1' });

    const res = await POST(formRequest({ username: 'Alice', postingKey: '5Kpostingkey' }));
    expect(res.status).toBe(200);

    expect(loginToThreespeak).toHaveBeenCalledWith('Alice', '5Kpostingkey');

    // encrypted posting key, never in plaintext
    expect(encryptTokens).toHaveBeenCalledWith(
      expect.objectContaining({ access_token: '5Kpostingkey', token_type: 'threespeak_posting_key', handle: 'alice' }),
    );
    const blob = upserted[0]?.encrypted_tokens;
    expect(typeof blob).toBe('string');
    expect(String(blob)).not.toContain('5Kpostingkey');

    expect(upserted[0]).toMatchObject({
      user_id: USER_ID,
      provider: '3speak',
      provider_account_id: 'alice',
      account_name: 'alice',
      account_metadata: {},
    });
    const body = (await res.json()) as { success: boolean; username: string };
    expect(body).toMatchObject({ success: true, username: 'alice' });
  });

  it('refreshes the existing row when the account reconnects', async () => {
    const { upserted, upsertOptions } = mockSupabase();
    vi.mocked(loginToThreespeak).mockResolvedValueOnce({ username: 'alice', accessToken: 'jwt-1' });

    const res = await POST(formRequest({ username: 'Alice', postingKey: '5Kpostingkey' }));
    expect(res.status).toBe(200);
    // A reconnect overwrites the stored token on the same row: the upsert
    // targets the unique (user_id, provider, provider_account_id) key, so
    // it cannot fail with a constraint violation like the plain insert did.
    expect(upserted).toHaveLength(1);
    expect(upsertOptions[0]).toEqual({ onConflict: 'user_id,provider,provider_account_id' });
    expect(upserted[0]).toMatchObject({
      user_id: USER_ID,
      provider: '3speak',
      provider_account_id: 'alice',
    });
  });

  it('returns 500 when the upsert fails', async () => {
    mockSupabase({ upsertError: { message: 'check violation' } });
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
    const { upserted } = mockSupabase({ isApiKey: true });
    vi.mocked(loginToThreespeak).mockResolvedValueOnce({ username: 'alice', accessToken: 'jwt-1' });

    const res = await POST(jsonRequest({ username: 'alice', postingKey: '5Kpostingkey' }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; username: string };
    expect(body.success).toBe(true);
    expect(body.username).toBe('alice');

    expect(loginToThreespeak).toHaveBeenCalledWith('alice', '5Kpostingkey');
    expect(upserted[0]).toMatchObject({
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
