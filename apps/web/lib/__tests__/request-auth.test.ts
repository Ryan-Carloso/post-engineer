import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { requireSupabaseSession } from '../request-auth';
import { getMcpResource } from '../oauth/config';
import * as apiKeysModule from '../api-keys';

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: vi.fn(),
}));

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';

describe('requireSupabaseSession', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('authenticates via valid Bearer API key in request header', async () => {
    const mockServiceClient = {} as unknown as SupabaseClient;
    vi.mocked(createSupabaseServiceClient).mockReturnValue(mockServiceClient);
    vi.spyOn(apiKeysModule, 'resolveApiKey').mockResolvedValue({
      userId: 'user-api-key-123',
      keyId: 'key-1',
      personaIds: null,
    });

    const request = new Request('http://localhost:3434/api/persona/video-job', {
      headers: {
        authorization: 'Bearer pe_live_1234567890abcdef1234567890abcdef',
      },
    });

    const result = await requireSupabaseSession(request);
    expect(result.error).toBeNull();
    expect(result.auth?.userId).toBe('user-api-key-123');
    expect(result.auth?.isApiKey).toBe(true);
    expect(result.auth?.personaIds).toBeNull();
  });

  it('propagates the persona scope of restricted keys', async () => {
    const mockServiceClient = {} as unknown as SupabaseClient;
    vi.mocked(createSupabaseServiceClient).mockReturnValue(mockServiceClient);
    const personaIds = ['11111111-1111-4111-8111-111111111111'];
    vi.spyOn(apiKeysModule, 'resolveApiKey').mockResolvedValue({
      userId: 'user-api-key-123',
      keyId: 'key-2',
      personaIds,
    });

    const request = new Request('http://localhost:3434/api/persona/video-job', {
      headers: {
        authorization: 'Bearer pe_live_1234567890abcdef1234567890abcdef',
      },
    });

    const result = await requireSupabaseSession(request);
    expect(result.error).toBeNull();
    expect(result.auth?.personaIds).toEqual(personaIds);
  });

  it('rejects invalid Bearer API key with 401', async () => {
    const mockServiceClient = {} as unknown as SupabaseClient;
    vi.mocked(createSupabaseServiceClient).mockReturnValue(mockServiceClient);
    vi.spyOn(apiKeysModule, 'resolveApiKey').mockResolvedValue(null);

    const request = new Request('http://localhost:3434/api/persona/video-job', {
      headers: {
        authorization: 'Bearer pe_live_invalid_key_1234567890abcdef',
      },
    });

    const result = await requireSupabaseSession(request);
    expect(result.auth).toBeNull();
    expect(result.error?.status).toBe(401);
  });

  it('authenticates via cookie session when no API key header is present', async () => {
    const mockServerClient = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-cookie-456' } },
          error: null,
        }),
        getSession: vi.fn().mockResolvedValue({
          data: { session: { access_token: 'cookie-session-token' } },
          error: null,
        }),
      },
    };
    vi.mocked(createSupabaseServerClient).mockResolvedValue(mockServerClient as unknown as SupabaseClient);

    const result = await requireSupabaseSession();
    expect(result.error).toBeNull();
    expect(result.auth?.userId).toBe('user-cookie-456');
    expect(result.auth?.accessToken).toBe('cookie-session-token');
  });
});

describe('requireSupabaseSession with OAuth access tokens', () => {
  const ENV_KEYS = ['MCP_OAUTH_PRIVATE_KEY_PEM', 'NEXT_PUBLIC_APP_URL'] as const;
  const previousEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const key of ENV_KEYS) previousEnv[key] = process.env[key];
    const { generateKeyPair, exportPKCS8 } = await import('jose');
    const { privateKey } = await generateKeyPair('ES256', { extractable: true });
    process.env.MCP_OAUTH_PRIVATE_KEY_PEM = await exportPKCS8(privateKey);
    process.env.NEXT_PUBLIC_APP_URL = 'https://post-engineer.test';
    const { clearOAuthKeysCache } = await import('../oauth/keys');
    clearOAuthKeysCache();
  });

  afterAll(async () => {
    for (const key of ENV_KEYS) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
    const { clearOAuthKeysCache } = await import('../oauth/keys');
    clearOAuthKeysCache();
  });

  it('authenticates via a valid OAuth access token', async () => {
    const { getOAuthKeys } = await import('../oauth/keys');
    const { mintAccessToken } = await import('../oauth/tokens');
    const keys = await getOAuthKeys();
    const token = await mintAccessToken(keys, {
      sub: 'user-oauth-789',
      clientId: 'mcp_client_abc',
      scope: 'mcp:tools',
      resource: getMcpResource(),
    });

    const request = new Request('http://localhost:3434/api/persona/list', {
      headers: { authorization: `Bearer ${token}` },
    });
    const result = await requireSupabaseSession(request);
    expect(result.error).toBeNull();
    expect(result.auth?.userId).toBe('user-oauth-789');
    // The flag is what routes use to pick the service client for OAuth
    // callers (no cookie session); pin the producer-side contract.
    expect(result.auth?.isOAuth).toBe(true);
  });

  it('falls through to session auth when the OAuth token is invalid', async () => {
    const mockServerClient = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
        getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      },
    };
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      mockServerClient as unknown as SupabaseClient,
    );

    const request = new Request('http://localhost:3434/api/persona/list', {
      headers: { authorization: 'Bearer invalid.oauth.token' },
    });
    const result = await requireSupabaseSession(request);
    expect(result.auth).toBeNull();
    expect(result.error?.status).toBe(401);
  });
});
