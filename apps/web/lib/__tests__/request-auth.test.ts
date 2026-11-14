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

const trackMcpToolCall = vi.hoisted(() => vi.fn());
vi.mock('@/lib/mcp-tool-telemetry', () => ({ trackMcpToolCall }));

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';

describe('requireSupabaseSession', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    trackMcpToolCall.mockClear();
  });

  it('authenticates via valid Bearer API key in request header', async () => {
    const mockServiceClient = {} as unknown as SupabaseClient;
    vi.mocked(createSupabaseServiceClient).mockReturnValue(mockServiceClient);
    vi.spyOn(apiKeysModule, 'resolveApiKey').mockResolvedValue({
      userId: 'user-api-key-123',
      keyId: 'key-1',
      personaIds: null,
    });

    const request = new Request('http://localhost:3434/api/videos/generate-and-schedule', {
      headers: {
        authorization: 'Bearer pe_live_1234567890abcdef1234567890abcdef',
      },
    });

    const result = await requireSupabaseSession(request);
    expect(result.error).toBeNull();
    expect(result.auth?.userId).toBe('user-api-key-123');
    expect(result.auth?.isApiKey).toBe(true);
    expect(result.auth?.personaIds).toBeNull();
    // MCP tool telemetry is recorded against the key's user.
    expect(trackMcpToolCall).toHaveBeenCalledWith(request, 'user-api-key-123', 'api_key');
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

    const request = new Request('http://localhost:3434/api/videos/generate-and-schedule', {
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

    const request = new Request('http://localhost:3434/api/videos/generate-and-schedule', {
      headers: {
        authorization: 'Bearer pe_live_invalid_key_1234567890abcdef',
      },
    });

    const result = await requireSupabaseSession(request);
    expect(result.auth).toBeNull();
    expect(result.error?.status).toBe(401);
    expect(trackMcpToolCall).not.toHaveBeenCalled();
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

  it('never records MCP tool telemetry for a cookie session, even with the MCP headers', async () => {
    const mockServerClient = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-cookie-456' } }, error: null }),
        getSession: vi.fn().mockResolvedValue({
          data: { session: { access_token: 'cookie-session-token' } },
          error: null,
        }),
      },
    };
    vi.mocked(createSupabaseServerClient).mockResolvedValue(mockServerClient as unknown as SupabaseClient);

    const request = new Request('http://localhost:3434/api/persona/list', {
      headers: { 'x-mcp-tool': 'personas (action: list)' },
    });
    const result = await requireSupabaseSession(request);
    expect(result.auth?.userId).toBe('user-cookie-456');
    expect(trackMcpToolCall).not.toHaveBeenCalled();
  });

  it('carries the display name from user_metadata on cookie sessions', async () => {
    const mockServerClient = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-cookie-456', user_metadata: { full_name: 'Test User' } } },
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
    expect(result.auth?.displayName).toBe('Test User');
  });

  it('falls back through name keys in user_metadata (full_name, name, display_name, user_name)', async () => {
    const mockServerClient = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: {
              id: 'user-cookie-456',
              user_metadata: { name: 'Plain Name', user_name: 'nick' },
            },
          },
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
    expect(result.auth?.displayName).toBe('Plain Name');
  });

  it('leaves displayName undefined when user_metadata carries no name', async () => {
    const mockServerClient = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-cookie-456', user_metadata: { avatar_url: 'x' } } },
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
    expect(result.auth?.displayName).toBeUndefined();
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
    expect(trackMcpToolCall).toHaveBeenCalledWith(request, 'user-oauth-789', 'oauth');
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

describe('requireSupabaseSession MCP version gate', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    trackMcpToolCall.mockClear();
    vi.stubEnv('REQUIRED_MCP_VERSION', '1.52.560');
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it('rejects a mismatched MCP with 426 before resolving its API key', async () => {
    const resolveApiKey = vi.spyOn(apiKeysModule, 'resolveApiKey');
    const request = new Request('http://localhost:3434/api/account', {
      headers: {
        authorization: 'Bearer pe_live_1234567890abcdef1234567890abcdef',
        'x-mcp-version': '1.52.0',
      },
    });

    const result = await requireSupabaseSession(request);
    expect(result.auth).toBeNull();
    expect(result.error?.status).toBe(426);
    const json = (await result.error?.json()) as Record<string, unknown>;
    expect(json.code).toBe('MCP_VERSION_MISMATCH');
    expect(json.requiredVersion).toBe('1.52.560');
    expect(resolveApiKey).not.toHaveBeenCalled();
    expect(trackMcpToolCall).not.toHaveBeenCalled();
  });

  it('authenticates an MCP whose version matches', async () => {
    vi.mocked(createSupabaseServiceClient).mockReturnValue({} as unknown as SupabaseClient);
    vi.spyOn(apiKeysModule, 'resolveApiKey').mockResolvedValue({
      userId: 'user-api-key-123',
      keyId: 'key-1',
      personaIds: null,
    });
    const request = new Request('http://localhost:3434/api/account', {
      headers: {
        authorization: 'Bearer pe_live_1234567890abcdef1234567890abcdef',
        'x-mcp-version': '1.52.560',
      },
    });

    const result = await requireSupabaseSession(request);
    expect(result.error).toBeNull();
    expect(result.auth?.userId).toBe('user-api-key-123');
  });

  it('never gates a cookie session request that sends no MCP version', async () => {
    vi.stubEnv('REQUIRED_MCP_VERSION', undefined);
    const mockServerClient = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-cookie-456' } }, error: null }),
        getSession: vi.fn().mockResolvedValue({
          data: { session: { access_token: 'cookie-session-token' } },
          error: null,
        }),
      },
    };
    vi.mocked(createSupabaseServerClient).mockResolvedValue(mockServerClient as unknown as SupabaseClient);

    const result = await requireSupabaseSession(new Request('http://localhost:3434/api/persona/list'));
    expect(result.error).toBeNull();
    expect(result.auth?.userId).toBe('user-cookie-456');
  });
});
