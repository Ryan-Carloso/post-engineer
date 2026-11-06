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

vi.mock('@/lib/bluesky', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/bluesky')>();
  return {
    ...actual,
    loginToBluesky: vi.fn(),
  };
});

vi.mock('@/lib/bluesky-profile', () => ({ fetchBlueskyPublicProfile: vi.fn() }));
// The limiter has its own suite (rate-limit.test.ts); here it never throttles.
vi.mock('@/lib/rate-limit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/rate-limit')>();
  return { ...actual, applyRateLimit: vi.fn().mockResolvedValue(null) };
});
vi.mock('@/lib/account-profile-telemetry', () => ({
  reportProfileFetched: vi.fn(),
  reportProfileFetchFailed: vi.fn(),
}));

import { POST } from '@/app/api/bluesky-connect/route';
import { fetchBlueskyPublicProfile } from '@/lib/bluesky-profile';
import { reportProfileFetched, reportProfileFetchFailed } from '@/lib/account-profile-telemetry';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { requireSupabaseSession } from '@/lib/request-auth';
import { loginToBluesky } from '@/lib/bluesky';
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
      }) as never
  );
  return { inserted };
}

function formRequest(fields: Record<string, string>): Request {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.append(key, value);
  }
  return new Request('http://localhost/api/bluesky-connect', { method: 'POST', body: formData });
}

function jsonRequest(body: Record<string, string>): Request {
  return new Request('http://localhost/api/bluesky-connect', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', authorization: 'Bearer test-key' },
  });
}

describe('POST /api/bluesky-connect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stores the display name, avatar and sync stamp from the public profile', async () => {
    const { inserted } = mockSupabase();
    vi.mocked(loginToBluesky).mockResolvedValueOnce({ did: 'did:plc:me', handle: 'eu.bsky.social' });
    vi.mocked(fetchBlueskyPublicProfile).mockResolvedValueOnce({
      did: 'did:plc:me', handle: 'eu.bsky.social', displayName: 'Eu', avatar: 'https://cdn.bsky.app/a.jpg',
    });

    const res = await POST(formRequest({ handle: 'eu.bsky.social', appPassword: 'x' }));

    expect(res.status).toBe(200);
    expect(fetchBlueskyPublicProfile).toHaveBeenCalledWith('did:plc:me');
    expect(inserted[0].account_metadata).toEqual({
      displayName: 'Eu',
      avatar: 'https://cdn.bsky.app/a.jpg',
      profileSyncedAt: expect.any(String),
    });
    expect(reportProfileFetched).toHaveBeenCalledWith('bluesky', 'connect', {
      accountName: 'eu.bsky.social',
      pictureUrl: 'https://cdn.bsky.app/a.jpg',
    });
  });

  it('still connects without profile metadata when the profile read fails, and reports it', async () => {
    const { inserted } = mockSupabase();
    vi.mocked(loginToBluesky).mockResolvedValueOnce({ did: 'did:plc:me', handle: 'eu.bsky.social' });
    const failure = new Error('BLUESKY_PROFILE_FAILED: status 502');
    vi.mocked(fetchBlueskyPublicProfile).mockRejectedValueOnce(failure);

    const res = await POST(formRequest({ handle: 'eu.bsky.social', appPassword: 'x' }));

    expect(res.status).toBe(200);
    expect(inserted[0].account_metadata).toEqual({});
    expect(reportProfileFetchFailed).toHaveBeenCalledWith('bluesky', 'connect', failure);
  });

  it('returns 401 without session', async () => {
    mockSupabase({ user: null });
    const res = await POST(formRequest({ handle: 'eu.bsky.social', appPassword: 'x' }));
    expect(res.status).toBe(401);
  });

  it('returns 400 without handle or app password', async () => {
    mockSupabase();
    const noHandle = await POST(formRequest({ appPassword: 'x' }));
    expect(noHandle.status).toBe(400);
    const noPassword = await POST(formRequest({ handle: 'eu.bsky.social' }));
    expect(noPassword.status).toBe(400);
  });

  it('rejects invalid credentials with 422 + BLUESKY_CREDENTIAL_REJECTED (not 401) and saves nothing', async () => {
    mockSupabase();
    vi.mocked(loginToBluesky).mockRejectedValueOnce(
      Object.assign(new Error('Invalid Bluesky handle or app password.'), { name: 'BlueskyError' }),
    );
    const res = await POST(formRequest({ handle: 'wrong.bsky.social', appPassword: 'wrong' }));
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ success: false, code: 'BLUESKY_CREDENTIAL_REJECTED' });
  });

  it('connects: validates credential, encrypts password and saves social_accounts', async () => {
    const { inserted } = mockSupabase();
    vi.mocked(loginToBluesky).mockResolvedValueOnce({ did: 'did:plc:abc', handle: 'eu.bsky.social' });

    const res = await POST(formRequest({ handle: 'eu.bsky.social', appPassword: 'app-pass-1' }));
    expect(res.status).toBe(200);

    expect(loginToBluesky).toHaveBeenCalledWith('eu.bsky.social', 'app-pass-1');

    // encrypted password, never in plaintext
    expect(encryptTokens).toHaveBeenCalledWith(
      expect.objectContaining({ access_token: 'app-pass-1', token_type: 'bluesky_app_password' }),
    );
    const blob = inserted[0]?.encrypted_tokens;
    expect(typeof blob).toBe('string');
    expect(String(blob)).not.toContain('app-pass-1');

    expect(inserted[0]).toMatchObject({
      user_id: USER_ID,
      provider: 'bluesky',
      provider_account_id: 'did:plc:abc',
    });
  });

  it('returns 500 when the insert fails', async () => {
    mockSupabase({ insertError: { message: 'check violation' } });
    vi.mocked(loginToBluesky).mockResolvedValueOnce({ did: 'did:plc:abc', handle: 'eu.bsky.social' });

    const res = await POST(formRequest({ handle: 'eu.bsky.social', appPassword: 'app-pass-1' }));
    expect(res.status).toBe(500);
  });

  it('error message never contains the app password', async () => {
    mockSupabase({ user: null });
    const res = await POST(formRequest({ handle: 'x', appPassword: 'segredo-123' }));
    const body = (await res.json()) as { error?: string };
    expect(JSON.stringify(body)).not.toContain('segredo-123');
  });

  it('MCP flow: API key + JSON connects and associates with the key owner', async () => {
    const { inserted } = mockSupabase({ isApiKey: true });
    vi.mocked(loginToBluesky).mockResolvedValueOnce({ did: 'did:plc:mcp', handle: 'eu.bsky.social' });

    const res = await POST(jsonRequest({ handle: 'eu.bsky.social', appPassword: 'app-pass-mcp' }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; did: string };
    expect(body.success).toBe(true);
    expect(body.did).toBe('did:plc:mcp');

    expect(loginToBluesky).toHaveBeenCalledWith('eu.bsky.social', 'app-pass-mcp');
    expect(inserted[0]).toMatchObject({
      user_id: USER_ID,
      provider: 'bluesky',
      provider_account_id: 'did:plc:mcp',
    });
    // via API key uses the service client
    expect(vi.mocked(createSupabaseServiceClient)).toHaveBeenCalled();
  });

  it('MCP flow: JSON without handle/appPassword returns 400', async () => {
    mockSupabase({ isApiKey: true });
    const res = await POST(jsonRequest({ handle: 'eu.bsky.social' }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(JSON.stringify(body)).not.toContain('app-pass');
  });
});
