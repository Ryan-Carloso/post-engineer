import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const { mockRequireSupabaseSession, mockApplyRateLimit, mockHandleYoutubeUpload, mockHandleInstagramUpload, mockHandleBlueskyUpload, mockHandleLinkedinUpload, mockBuildUploadErrorResponse, apiErrorReportingCalls } = vi.hoisted(() => {
  return {
    mockRequireSupabaseSession: vi.fn(),
    mockApplyRateLimit: vi.fn(),
    mockHandleYoutubeUpload: vi.fn(),
    mockHandleInstagramUpload: vi.fn(),
    mockHandleBlueskyUpload: vi.fn(),
    mockHandleLinkedinUpload: vi.fn(),
    mockBuildUploadErrorResponse: vi.fn(),
    // Plain array (not a mock fn): beforeEach's clearAllMocks must not wipe
    // the registration record — the wrapper runs once at module import.
    apiErrorReportingCalls: [] as unknown[][],
  };
});

vi.mock('@/lib/api-error-reporting', () => ({
  withApiErrorReporting: (...args: unknown[]) => {
    apiErrorReportingCalls.push(args);
    return args[1];
  },
}));

vi.mock('@/lib/request-auth', () => ({
  requireSupabaseSession: (...args: unknown[]) => mockRequireSupabaseSession(...args),
}));

vi.mock('@/lib/rate-limit', () => ({
  RATE_LIMITS: {
    youtubeUpload: { name: 'youtube-upload', limit: 5, windowMs: 60_000 },
    instagramPost: { name: 'instagram-post', limit: 10, windowMs: 60_000 },
  },
  applyRateLimit: (...args: unknown[]) => mockApplyRateLimit(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    generateLogId: vi.fn(() => 'log-1'),
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    logUploadStart: vi.fn(),
  },
}));

vi.mock('@/lib/upload/handlers', () => ({
  handleYoutubeUpload: (...args: unknown[]) => mockHandleYoutubeUpload(...args),
  handleInstagramUpload: (...args: unknown[]) => mockHandleInstagramUpload(...args),
  handleBlueskyUpload: (...args: unknown[]) => mockHandleBlueskyUpload(...args),
  handleLinkedinUpload: (...args: unknown[]) => mockHandleLinkedinUpload(...args),
  buildUploadErrorResponse: (...args: unknown[]) => mockBuildUploadErrorResponse(...args),
}));

import { logger } from '@/lib/logger';
import { RATE_LIMITS } from '@/lib/rate-limit';
import type { ValidationError } from '@/lib/errors';
import { POST } from '@/app/api/upload-content/route';

const USER_ID = 'user-1';
const API_SECRET = 'engine-shared-secret';

function makeRequest(opts?: {
  provider?: string | null;
  authorization?: string;
  userId?: string;
}): NextRequest {
  const form = new FormData();
  if (opts?.provider !== null) form.append('provider', opts?.provider ?? 'youtube');
  if (opts?.provider === 'instagram') form.append('caption', 'hello');
  if (opts?.userId) form.append('userId', opts.userId);
  const req = new NextRequest('http://localhost/api/upload-content', {
    method: 'POST',
    body: form,
  });
  if (opts?.authorization) req.headers.set('authorization', opts.authorization);
  return req;
}

describe('POST /api/upload-content', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('MONEYPRINT_API_SECRET', API_SECRET);
    mockRequireSupabaseSession.mockResolvedValue({
      auth: { userId: USER_ID, accessToken: 'sb-token' },
      error: null,
    });
    mockApplyRateLimit.mockResolvedValue(null);
    mockHandleYoutubeUpload.mockResolvedValue({ success: true, provider: 'youtube', results: [] });
    mockHandleInstagramUpload.mockResolvedValue({ success: true, provider: 'instagram', results: [] });
    mockHandleBlueskyUpload.mockResolvedValue({ success: true, provider: 'bluesky', results: [] });
    mockHandleLinkedinUpload.mockResolvedValue({ success: true, provider: 'linkedin', results: [] });
  });

  it('returns 401 without a session', async () => {
    mockRequireSupabaseSession.mockResolvedValue({
      auth: null,
      error: NextResponse.json({ success: false }, { status: 401 }),
    });

    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
    expect(mockHandleYoutubeUpload).not.toHaveBeenCalled();
  });

  it('uses the user session and forwards the userId to the handler', async () => {
    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(mockHandleYoutubeUpload).toHaveBeenCalledTimes(1);
    const [, userId] = mockHandleYoutubeUpload.mock.calls[0] as unknown[];
    expect(userId).toBe(USER_ID);
    // Pin the observability calls: message, endpoint/method labels and the
    // structured metadata travel to the logger verbatim.
    expect(vi.mocked(logger.info)).toHaveBeenCalledWith('[upload-content] request recebido', {
      logId: 'log-1',
      metadata: { provider: 'youtube', userId: USER_ID, fields: ['provider'] },
    });
    expect(vi.mocked(logger.logUploadStart)).toHaveBeenCalledWith('log-1', {
      endpoint: '/api/upload-content',
      method: 'POST',
      timestamp: expect.any(String),
    });
    expect(vi.mocked(logger.info)).toHaveBeenCalledWith('[upload-content] handler finalizado', {
      provider: 'youtube',
      success: true,
      logId: 'log-1',
    });
  });

  it('accepts the shared secret (engine publish-back) with userId in the form', async () => {
    mockRequireSupabaseSession.mockResolvedValue({
      auth: null,
      error: NextResponse.json({ success: false }, { status: 401 }),
    });

    const res = await POST(makeRequest({
      authorization: `Bearer ${API_SECRET}`,
      userId: 'engine-owner',
    }));

    expect(res.status).toBe(200);
    const [, userId] = mockHandleYoutubeUpload.mock.calls[0] as unknown[];
    expect(userId).toBe('engine-owner');
  });

  it('returns 401 with a valid secret but no userId in the form', async () => {
    mockRequireSupabaseSession.mockResolvedValue({
      auth: null,
      error: NextResponse.json({ success: false }, { status: 401 }),
    });

    const res = await POST(makeRequest({ authorization: `Bearer ${API_SECRET}` }));

    expect(res.status).toBe(401);
    expect(mockHandleYoutubeUpload).not.toHaveBeenCalled();
  });

  it('rejects a bearer that is not the shared secret', async () => {
    mockRequireSupabaseSession.mockResolvedValue({
      auth: null,
      error: NextResponse.json({ success: false }, { status: 401 }),
    });

    const res = await POST(makeRequest({ authorization: 'Bearer post-engineer_some-key' }));

    expect(res.status).toBe(401);
    expect(mockHandleYoutubeUpload).not.toHaveBeenCalled();
    // The session helper's error passes through verbatim — the route must
    // not substitute its own fallback body on this path.
    expect(await res.json()).toEqual({ success: false });
  });

  it('a different-length bearer does not throw (timing-safe comparison)', async () => {
    mockRequireSupabaseSession.mockResolvedValue({
      auth: null,
      error: NextResponse.json({ success: false }, { status: 401 }),
    });

    const res = await POST(makeRequest({ authorization: 'Bearer x', userId: 'engine-owner' }));

    expect(res.status).toBe(401);
    expect(mockHandleYoutubeUpload).not.toHaveBeenCalled();
  });

  it('returns the authentication-required fallback when the auth helper yields no auth and no error', async () => {
    // requireSupabaseSession always returns an error with a null auth in
    // production; this pins the defensive fallback for callers that do not.
    mockRequireSupabaseSession.mockResolvedValue({ auth: null, error: null });

    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, error: 'Authentication required.' });
    expect(mockHandleYoutubeUpload).not.toHaveBeenCalled();
  });

  it('rejects an uppercase BEARER scheme (the scheme check is case-sensitive)', async () => {
    mockRequireSupabaseSession.mockResolvedValue({
      auth: null,
      error: NextResponse.json({ success: false }, { status: 401 }),
    });

    const res = await POST(makeRequest({
      authorization: `BEARER ${API_SECRET}`,
      userId: 'engine-owner',
    }));

    expect(res.status).toBe(401);
    expect(mockHandleYoutubeUpload).not.toHaveBeenCalled();
  });

  it('trims surrounding whitespace from the bearer token', async () => {
    mockRequireSupabaseSession.mockResolvedValue({
      auth: null,
      error: NextResponse.json({ success: false }, { status: 401 }),
    });

    const res = await POST(makeRequest({
      authorization: `Bearer   ${API_SECRET}  `,
      userId: 'engine-owner',
    }));

    expect(res.status).toBe(200);
    const [, userId] = mockHandleYoutubeUpload.mock.calls[0] as unknown[];
    expect(userId).toBe('engine-owner');
  });

  it('rejects a non-string userId on the engine-secret path', async () => {
    mockRequireSupabaseSession.mockResolvedValue({ auth: null, error: null });

    // A File userId must not be honored: the engine-secret path only trusts
    // a non-empty string. Built as a minimal fake because constructing a
    // NextRequest over a FormData containing a File chokes in jsdom; the
    // route only touches headers and formData().
    const form = new FormData();
    form.append('provider', 'youtube');
    form.append('userId', new File(['x'], 'id.txt', { type: 'text/plain' }));
    const req = {
      headers: new Headers({ authorization: `Bearer ${API_SECRET}` }),
      formData: async () => form,
    } as unknown as NextRequest;

    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, error: 'Authentication required.' });
    expect(mockHandleYoutubeUpload).not.toHaveBeenCalled();
  });

  it('registers the route label with the API error-reporting wrapper', () => {
    // The wrapper runs once at module import; calls are recorded in a plain
    // array because beforeEach's clearAllMocks wipes mock functions.
    expect(apiErrorReportingCalls).toEqual([
      ['POST /api/upload-content', expect.any(Function)],
    ]);
  });

  it('returns 400 when provider is missing', async () => {
    const req = makeRequest({ provider: null });
    mockBuildUploadErrorResponse.mockReturnValue(
      NextResponse.json({ success: false, error: 'bad provider' }, { status: 400 }),
    );

    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(mockBuildUploadErrorResponse).toHaveBeenCalled();
  });

  it('rejects an unknown provider listing the supported providers (no hardcode)', async () => {
    const req = makeRequest({ provider: 'tiktok' });
    mockBuildUploadErrorResponse.mockReturnValue(
      NextResponse.json({ success: false, error: 'bad provider' }, { status: 400 }),
    );

    const res = await POST(req);

    expect(res.status).toBe(400);
    expect(mockBuildUploadErrorResponse).toHaveBeenCalled();
    const err = mockBuildUploadErrorResponse.mock.calls[0][0] as Error;
    expect(err.message).toBe('Invalid provider. Use one of: youtube, instagram, bluesky, linkedin');
    // The validation error carries the offending field for the client.
    expect((err as ValidationError).field).toBe('provider');
  });

  it('applies the per-user rate limit', async () => {
    const limited = NextResponse.json({ success: false }, { status: 429 });
    mockApplyRateLimit.mockResolvedValue(limited);

    const res = await POST(makeRequest());
    expect(res.status).toBe(429);
    expect(mockHandleYoutubeUpload).not.toHaveBeenCalled();
    const [, profile, identity] = mockApplyRateLimit.mock.calls[0] as unknown[];
    expect(identity).toBe(USER_ID);
    // YouTube uploads use the dedicated youtube-upload profile.
    expect(profile).toBe(RATE_LIMITS.youtubeUpload);
  });

  it('handles the instagram upload', async () => {
    const res = await POST(makeRequest({ provider: 'instagram' }));

    expect(mockHandleInstagramUpload).toHaveBeenCalledTimes(1);
    expect(mockHandleYoutubeUpload).not.toHaveBeenCalled();
    const body = (await res.json()) as { success: boolean; provider: string };
    expect(body).toEqual({ success: true, provider: 'instagram', results: [] });
    // Non-YouTube providers share the instagram-post rate-limit profile.
    const [, profile] = mockApplyRateLimit.mock.calls[0] as unknown[];
    expect(profile).toBe(RATE_LIMITS.instagramPost);
  });

  it('handles the bluesky upload', async () => {
    const res = await POST(makeRequest({ provider: 'bluesky' }));

    expect(mockHandleBlueskyUpload).toHaveBeenCalledTimes(1);
    expect(mockHandleYoutubeUpload).not.toHaveBeenCalled();
    expect(mockHandleInstagramUpload).not.toHaveBeenCalled();
    expect(mockHandleLinkedinUpload).not.toHaveBeenCalled();
    const body = (await res.json()) as { success: boolean; provider: string };
    expect(body).toEqual({ success: true, provider: 'bluesky', results: [] });
  });

  it('handles the linkedin upload', async () => {
    const res = await POST(makeRequest({ provider: 'linkedin' }));

    expect(mockHandleLinkedinUpload).toHaveBeenCalledTimes(1);
    expect(mockHandleYoutubeUpload).not.toHaveBeenCalled();
    expect(mockHandleInstagramUpload).not.toHaveBeenCalled();
    expect(mockHandleBlueskyUpload).not.toHaveBeenCalled();
    const body = (await res.json()) as { success: boolean; provider: string };
    expect(body).toEqual({ success: true, provider: 'linkedin', results: [] });
  });

  it('responds with a handled error when the handler throws', async () => {
    mockHandleYoutubeUpload.mockRejectedValue(new Error('boom'));
    mockBuildUploadErrorResponse.mockReturnValue(
      NextResponse.json({ success: false, error: 'boom' }, { status: 500 }),
    );

    const res = await POST(makeRequest());
    expect(res.status).toBe(500);
    expect(mockBuildUploadErrorResponse).toHaveBeenCalled();
  });

  it('logs UNKNOWN as the error name when the handler throws a non-Error', async () => {
    mockHandleYoutubeUpload.mockRejectedValue('string-boom');
    mockBuildUploadErrorResponse.mockReturnValue(
      NextResponse.json({ success: false, error: 'boom' }, { status: 500 }),
    );

    const res = await POST(makeRequest());
    expect(res.status).toBe(500);
    expect(mockBuildUploadErrorResponse).toHaveBeenCalled();
    expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
      '[upload-content] ERRO',
      undefined,
      expect.objectContaining({ message: 'string-boom', name: 'UNKNOWN' }),
    );
  });
});

describe('POST /api/upload-content with a personal API key', () => {
  const KEY_USER = 'api-key-user';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('MONEYPRINT_API_SECRET', API_SECRET);
    mockApplyRateLimit.mockResolvedValue(null);
    mockHandleYoutubeUpload.mockResolvedValue({ success: true, provider: 'youtube', results: [] });
    mockHandleBlueskyUpload.mockResolvedValue({ success: true, provider: 'bluesky', results: [] });
    mockHandleLinkedinUpload.mockResolvedValue({ success: true, provider: 'linkedin', results: [] });
  });

  it('passes the request to requireSupabaseSession so personal API keys are accepted', async () => {
    mockRequireSupabaseSession.mockResolvedValue({
      auth: { userId: KEY_USER, accessToken: 'pe_live_abc123', isApiKey: true },
      error: null,
    });

    // A form userId must never let an API-key caller publish as someone
    // else: the identity comes from the resolved key, not the form.
    const req = makeRequest({ userId: 'someone-else' });
    const res = await POST(req);

    expect(res.status).toBe(200);
    // The auth helper only inspects Bearer/x-api-key headers when it
    // receives the request — this assertion pins the API-key capability.
    expect(mockRequireSupabaseSession).toHaveBeenCalledTimes(1);
    expect(mockRequireSupabaseSession.mock.calls[0][0]).toBe(req);
    const [, userId] = mockHandleYoutubeUpload.mock.calls[0] as unknown[];
    expect(userId).toBe(KEY_USER);
  });

  it('still accepts the engine shared secret after the API-key change', async () => {
    mockRequireSupabaseSession.mockResolvedValue({
      auth: null,
      error: NextResponse.json({ success: false }, { status: 401 }),
    });

    const res = await POST(makeRequest({
      authorization: `Bearer ${API_SECRET}`,
      userId: 'engine-owner',
    }));

    expect(res.status).toBe(200);
    const [, userId] = mockHandleYoutubeUpload.mock.calls[0] as unknown[];
    expect(userId).toBe('engine-owner');
  });
});
