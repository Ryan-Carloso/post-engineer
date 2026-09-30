import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/request-auth', () => ({
  requireSupabaseSession: vi.fn(),
}));
vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: vi.fn(),
}));
vi.mock('@/lib/oauth-connect', () => ({
  isOAuthConnectProvider: (v: unknown) => ['youtube', 'instagram', 'linkedin'].includes(v as string),
  buildOAuthConnectUrl: vi.fn(),
  storeOAuthState: vi.fn(),
  oauthStateRef: (s: string) => `ref-${s.slice(0, 8)}`,
}));
vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    generateLogId: vi.fn(() => 'test-log-id'),
    logOAuthError: vi.fn(),
  },
}));
vi.mock('@/lib/oauth-utils', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/oauth-utils')>();
  return { ...mod, resolveOAuthRedirectUri: vi.fn(mod.resolveOAuthRedirectUri) };
});

import { POST } from '../route';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { buildOAuthConnectUrl, storeOAuthState } from '@/lib/oauth-connect';
import { resolveOAuthRedirectUri } from '@/lib/oauth-utils';
import { logger } from '@/lib/logger';

const USER_ID = 'user-1';

function mockAuth(authenticated: boolean) {
  vi.mocked(requireSupabaseSession).mockResolvedValue(
    (authenticated
      ? { auth: { userId: USER_ID, accessToken: 'key', isApiKey: true }, error: null }
      : { auth: null, error: null }) as never
  );
  vi.mocked(createSupabaseServiceClient).mockReturnValue({} as never);
}

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('https://post-engineer.com/api/account/connect-url', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

describe('POST /api/account/connect-url', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.INSTAGRAM_REDIRECT_URI = 'https://post-engineer.com/api/instagram-auth/callback';
  });

  it('returns 401 + code without authentication', async () => {
    mockAuth(false);
    const res = await POST(makeRequest({ provider: 'instagram' }));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('authentication_required');
  });

  it('returns 400 + code for invalid JSON body', async () => {
    mockAuth(true);
    const req = new NextRequest('https://post-engineer.com/api/account/connect-url', {
      method: 'POST',
      body: 'this is not json{',
      headers: { 'content-type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_json_body');
  });

  it('returns 400 + code for missing or invalid provider', async () => {
    mockAuth(true);
    const res1 = await POST(makeRequest({}));
    expect(res1.status).toBe(400);
    expect(((await res1.json()) as { error: string }).error).toBe('invalid_provider');
    const res2 = await POST(makeRequest({ provider: 'tiktok' }));
    expect(res2.status).toBe(400);
    expect(((await res2.json()) as { error: string }).error).toBe('invalid_provider');
  });

  it('returns 400 + code for bluesky (has its own flow)', async () => {
    mockAuth(true);
    const res = await POST(makeRequest({ provider: 'bluesky' }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('bluesky_requires_app_password');
  });

  it('returns 500 + code when the redirect URI does not resolve', async () => {
    mockAuth(true);
    vi.mocked(resolveOAuthRedirectUri).mockImplementationOnce(() => {
      throw new Error('redirect env missing');
    });
    const res = await POST(makeRequest({ provider: 'instagram' }));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('redirect_uri_unavailable');
  });

  it('generates auth_url and stores the state server-side', async () => {
    mockAuth(true);
    vi.mocked(buildOAuthConnectUrl).mockResolvedValue({
      ok: true,
      authUrl: 'https://www.instagram.com/oauth/authorize?state=abc',
      state: 'state-abc',
      nonce: 'nonce-abc',
    });
    const res = await POST(makeRequest({ provider: 'instagram' }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; auth_url: string };
    expect(body.success).toBe(true);
    expect(body.auth_url).toContain('instagram.com');
    expect(vi.mocked(storeOAuthState)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        state: 'state-abc',
        userId: USER_ID,
        provider: 'instagram',
        nonce: 'nonce-abc',
      })
    );
  });

  it('returns 500 + code when the provider is not configured', async () => {
    mockAuth(true);
    vi.mocked(buildOAuthConnectUrl).mockResolvedValue({
      ok: false,
      error: 'Instagram credentials are not configured.',
    });
    const res = await POST(makeRequest({ provider: 'instagram' }));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('provider_not_configured');
  });

  it('returns 500 + code when the state cannot be stored', async () => {
    mockAuth(true);
    vi.mocked(buildOAuthConnectUrl).mockResolvedValue({
      ok: true,
      authUrl: 'https://www.instagram.com/oauth/authorize?state=abc',
      state: 'state-abc',
      nonce: 'nonce-abc',
    });
    vi.mocked(storeOAuthState).mockRejectedValueOnce(new Error('db down'));
    const res = await POST(makeRequest({ provider: 'instagram' }));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('state_store_failed');
  });

  it('reports the redirect-URI 500 once: cause threaded through apiErrorResponse, no pre-logging', async () => {
    mockAuth(true);
    vi.mocked(resolveOAuthRedirectUri).mockImplementationOnce(() => {
      throw new Error('redirect env missing');
    });
    const res = await POST(makeRequest({ provider: 'instagram' }));
    expect(res.status).toBe(500);
    // No double-reporting: the failure is logged exactly once, by
    // apiErrorResponse, with the underlying cause attached.
    expect(logger.logOAuthError).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledTimes(1);
    const [, cause] = vi.mocked(logger.error).mock.calls[0] as [string, unknown];
    expect(cause).toBeInstanceOf(Error);
    expect((cause as Error).message).toBe('redirect env missing');
  });

  it('reports the provider-not-configured 500 once, with the build failure as cause', async () => {
    mockAuth(true);
    vi.mocked(buildOAuthConnectUrl).mockResolvedValue({
      ok: false,
      error: 'Instagram credentials are not configured.',
    });
    const res = await POST(makeRequest({ provider: 'instagram' }));
    expect(res.status).toBe(500);
    expect(logger.logOAuthError).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledTimes(1);
    const [, cause] = vi.mocked(logger.error).mock.calls[0] as [string, unknown];
    expect((cause as Error).message).toContain('Instagram credentials are not configured.');
  });

  it('reports unexpected failures once, with the thrown error as cause', async () => {
    mockAuth(true);
    vi.mocked(buildOAuthConnectUrl).mockRejectedValueOnce(new Error('boom'));
    const res = await POST(makeRequest({ provider: 'instagram' }));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('internal_error');
    expect(logger.logOAuthError).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledTimes(1);
    const [, cause] = vi.mocked(logger.error).mock.calls[0] as [string, unknown];
    expect((cause as Error).message).toBe('boom');
  });

  it('logs the issuance with provider, userId and state reference', async () => {
    mockAuth(true);
    vi.mocked(buildOAuthConnectUrl).mockResolvedValue({
      ok: true,
      authUrl: 'https://www.instagram.com/oauth/authorize?state=abc',
      state: 'state-abc',
      nonce: 'nonce-abc',
    });
    const res = await POST(makeRequest({ provider: 'instagram' }));
    expect(res.status).toBe(200);
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('issued'),
      expect.objectContaining({
        provider: 'instagram',
        userId: USER_ID,
        stateRef: 'ref-state-ab',
      })
    );
  });
});
