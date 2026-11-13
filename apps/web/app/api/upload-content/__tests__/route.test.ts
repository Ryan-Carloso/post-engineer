import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const { mockRequireSupabaseSession, mockApplyRateLimit, mockHandleYoutubeUpload, mockHandleInstagramUpload, mockHandleBlueskyUpload, mockHandleLinkedinUpload, mockHandleRumbleUpload, mockBuildUploadErrorResponse, mockCreateSupabaseServiceClient, apiErrorReportingCalls } = vi.hoisted(() => {
  return {
    mockRequireSupabaseSession: vi.fn(),
    mockApplyRateLimit: vi.fn(),
    mockHandleYoutubeUpload: vi.fn(),
    mockHandleInstagramUpload: vi.fn(),
    mockHandleBlueskyUpload: vi.fn(),
    mockHandleLinkedinUpload: vi.fn(),
    mockHandleRumbleUpload: vi.fn(),
    mockBuildUploadErrorResponse: vi.fn(),
    mockCreateSupabaseServiceClient: vi.fn(),
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
  resolveReportingUserId: vi.fn(),
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

const { mockHandleFacebookUpload, mockHandleThreadsUpload, mockHandleThreespeakUpload } = vi.hoisted(() => ({
  mockHandleFacebookUpload: vi.fn(),
  mockHandleThreadsUpload: vi.fn(),
  mockHandleThreespeakUpload: vi.fn(),
}));
vi.mock('@/lib/upload/facebook-handler', () => ({
  handleFacebookUpload: (...args: unknown[]) => mockHandleFacebookUpload(...args),
}));
vi.mock('@/lib/upload/rumble-handler', () => ({
  handleRumbleUpload: (...args: unknown[]) => mockHandleRumbleUpload(...args),
}));
vi.mock('@/lib/upload/threads-handler', () => ({
  handleThreadsUpload: (...args: unknown[]) => mockHandleThreadsUpload(...args),
}));
vi.mock('@/lib/upload/threespeak-handler', () => ({
  handleThreespeakUpload: (...args: unknown[]) => mockHandleThreespeakUpload(...args),
}));

vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: (...args: unknown[]) => mockCreateSupabaseServiceClient(...args),
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
  accountIds?: string[];
  scopeKey?: string;
}): NextRequest {
  const form = new FormData();
  if (opts?.provider !== null) form.append('provider', opts?.provider ?? 'youtube');
  if (opts?.provider === 'instagram') form.append('caption', 'hello');
  if (opts?.userId) form.append('userId', opts.userId);
  for (const accountId of opts?.accountIds ?? []) form.append('accountIds', accountId);
  if (opts?.scopeKey) form.append('publishScopeKey', opts.scopeKey);
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
      ['POST /api/upload-content', expect.any(Function), { getUserId: expect.any(Function) }],
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
    expect(err.message).toBe('Invalid provider. Use one of: youtube, instagram, bluesky, linkedin, threads, facebook, pinterest, 3speak, rumble, fanvue');
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

  it('handles the facebook upload with the caller as the Page owner', async () => {
    mockHandleFacebookUpload.mockResolvedValue({ success: true, results: [{ accountId: '111', success: true, postId: 'vid-1' }] });
    const res = await POST(makeRequest({ provider: 'facebook' }));

    expect(mockHandleFacebookUpload).toHaveBeenCalledTimes(1);
    const [formData, userId] = mockHandleFacebookUpload.mock.calls[0] as [FormData, string];
    expect(formData.get('provider')).toBe('facebook');
    expect(userId).toBe(USER_ID);
    expect(mockHandleThreadsUpload).not.toHaveBeenCalled();
    expect(mockHandleInstagramUpload).not.toHaveBeenCalled();
    expect(mockHandleYoutubeUpload).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({ success: true, results: [{ accountId: '111', success: true, postId: 'vid-1' }] });
  });

  it('handles the 3speak upload with the caller as the Hive owner', async () => {
    mockHandleThreespeakUpload.mockResolvedValue({ success: true, results: [{ accountId: 'alice', success: true, postId: 'video-1' }] });
    const res = await POST(makeRequest({ provider: '3speak' }));

    expect(mockHandleThreespeakUpload).toHaveBeenCalledTimes(1);
    const [formData, userId] = mockHandleThreespeakUpload.mock.calls[0] as [FormData, string];
    expect(formData.get('provider')).toBe('3speak');
    expect(userId).toBe(USER_ID);
    expect(mockHandleFacebookUpload).not.toHaveBeenCalled();
    expect(mockHandleInstagramUpload).not.toHaveBeenCalled();
    expect(mockHandleYoutubeUpload).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({ success: true, results: [{ accountId: 'alice', success: true, postId: 'video-1' }] });
  });

  it('handles the rumble upload with the caller as the channel owner', async () => {
    mockHandleRumbleUpload.mockResolvedValue({ success: true, results: [{ accountId: 'chan-1', success: true, postId: 'vid-1' }] });
    const res = await POST(makeRequest({ provider: 'rumble' }));

    expect(mockHandleRumbleUpload).toHaveBeenCalledTimes(1);
    const [formData, userId] = mockHandleRumbleUpload.mock.calls[0] as [FormData, string];
    expect(formData.get('provider')).toBe('rumble');
    expect(userId).toBe(USER_ID);
    expect(mockHandleFacebookUpload).not.toHaveBeenCalled();
    expect(mockHandleThreadsUpload).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({ success: true, results: [{ accountId: 'chan-1', success: true, postId: 'vid-1' }] });
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

//---------------
// Publish ledger — an in-memory stand-in for the claim/record RPCs
// (migration 061), with the same rules: a fresh key is claimed, a
// published key replays its recorded result, an in-flight key waits,
// a failed key or an expired lease is claimed again, and only the
// request holding the lease can record.
//---------------
type LedgerRow = {
  status: 'in_progress' | 'published' | 'failed' | 'unknown';
  leaseUntil: number | null;
  token: string | null;
  result: Record<string, unknown> | null;
  userId: string | null;
  error?: string;
};

function makeLedgerFake() {
  const rows = new Map<string, LedgerRow>();
  const failRecordKeys = new Set<string>();
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
    if (fn === 'claim_publish_ledger') {
      const key = args.p_key as string;
      const row = rows.get(key);
      if (row === undefined) {
        rows.set(key, {
          status: 'in_progress',
          leaseUntil: Date.now() + (args.p_lease_seconds as number) * 1000,
          token: args.p_token as string,
          result: null,
          userId: args.p_user_id as string,
        });
        return { data: { outcome: 'claimed' }, error: null };
      }
      if (row.userId !== args.p_user_id) {
        return { data: { outcome: 'forbidden' }, error: null };
      }
      if (row.status === 'published') {
        return { data: { outcome: 'published', result: row.result }, error: null };
      }
      if (row.status === 'unknown') {
        return { data: { outcome: 'unknown' }, error: null };
      }
      if (row.status === 'in_progress' && row.leaseUntil !== null && row.leaseUntil > Date.now()) {
        return { data: { outcome: 'in_progress' }, error: null };
      }
      row.status = 'in_progress';
      row.leaseUntil = Date.now() + (args.p_lease_seconds as number) * 1000;
      row.token = args.p_token as string;
      row.result = null;
      return { data: { outcome: 'claimed' }, error: null };
    }
    if (fn === 'record_publish_ledger') {
      const key = args.p_key as string;
      if (failRecordKeys.has(key)) {
        return { data: null, error: { message: 'db down' } };
      }
      const row = rows.get(key);
      if (row === undefined || row.token !== args.p_token || row.status !== 'in_progress') {
        return { data: false, error: null };
      }
      row.status = args.p_status as 'published' | 'failed';
      row.result = (args.p_result as Record<string, unknown> | null) ?? null;
      row.leaseUntil = null;
      return { data: true, error: null };
    }
    if (fn === 'mark_publish_unknown') {
      const key = args.p_key as string;
      const row = rows.get(key);
      if (row === undefined || row.token !== args.p_token || row.status !== 'in_progress') {
        return { data: false, error: null };
      }
      row.status = 'unknown';
      row.leaseUntil = null;
      row.error = args.p_error as string;
      return { data: true, error: null };
    }
    if (fn === 'touch_publish_ledger') {
      const key = args.p_key as string;
      const row = rows.get(key);
      if (row === undefined || row.token !== args.p_token || row.status !== 'in_progress') {
        return { data: false, error: null };
      }
      row.leaseUntil = Date.now() + (args.p_lease_seconds as number) * 1000;
      return { data: true, error: null };
    }
    throw new Error(`unexpected rpc ${fn}`);
  });
  return { rows, rpc, failRecordKeys };
}

const SCOPE_KEY = 'slot:slot-1:video:v.mp4';
const ledgerKey = (accountId: string): string => `publish:${SCOPE_KEY}:youtube:${accountId}`;

describe('POST /api/upload-content with a publish scope key', () => {
  let ledger: ReturnType<typeof makeLedgerFake>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('MONEYPRINT_API_SECRET', API_SECRET);
    mockRequireSupabaseSession.mockResolvedValue({
      auth: { userId: USER_ID, accessToken: 'sb-token' },
      error: null,
    });
    mockApplyRateLimit.mockResolvedValue(null);
    mockHandleYoutubeUpload.mockResolvedValue({ success: true, provider: 'youtube', results: [] });
    ledger = makeLedgerFake();
    mockCreateSupabaseServiceClient.mockReturnValue({ rpc: ledger.rpc });
  });

  it('replays an already-published account without calling the handler for it', async () => {
    ledger.rows.set(ledgerKey('acc-1'), {
      status: 'published',
      leaseUntil: null,
      token: null,
      result: { accountId: 'acc-1', success: true, videoUrl: 'https://youtu.be/abc' },
      userId: USER_ID,
    });
    mockHandleYoutubeUpload.mockResolvedValue({
      success: true,
      provider: 'youtube',
      results: [{ accountId: 'acc-2', success: true, videoUrl: 'https://youtu.be/def' }],
    });

    const res = await POST(makeRequest({
      accountIds: ['acc-1', 'acc-2'],
      scopeKey: SCOPE_KEY,
    }));

    expect(mockHandleYoutubeUpload).toHaveBeenCalledTimes(1);
    const [formData] = mockHandleYoutubeUpload.mock.calls[0] as [FormData, string];
    expect(formData.getAll('accountIds')).toEqual(['acc-2']);
    expect(await res.json()).toEqual({
      success: true,
      provider: 'youtube',
      successCount: 2,
      results: [
        { accountId: 'acc-1', success: true, videoUrl: 'https://youtu.be/abc' },
        { accountId: 'acc-2', success: true, videoUrl: 'https://youtu.be/def' },
      ],
    });
    // The fresh account's post is recorded, so a later retry replays it too.
    expect(ledger.rows.get(ledgerKey('acc-2'))?.status).toBe('published');
    expect(ledger.rows.get(ledgerKey('acc-2'))?.result).toEqual(
      { accountId: 'acc-2', success: true, videoUrl: 'https://youtu.be/def' },
    );
  });

  it('waits for an in-flight account instead of publishing it again', async () => {
    ledger.rows.set(ledgerKey('acc-1'), {
      status: 'in_progress',
      leaseUntil: Date.now() + 30 * 60_000,
      token: 'first-token',
      result: null,
      userId: USER_ID,
    });

    const res = await POST(makeRequest({ accountIds: ['acc-1'], scopeKey: SCOPE_KEY }));

    expect(mockHandleYoutubeUpload).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({
      success: false,
      successCount: 0,
      results: [{
        accountId: 'acc-1',
        success: false,
        error: 'Publish still in progress from an earlier request.',
        errorCode: 'publish_in_progress',
      }],
    });
    expect(ledger.rpc).toHaveBeenCalledWith(
      'claim_publish_ledger',
      expect.objectContaining({ p_key: ledgerKey('acc-1') }),
    );
  });

  it('fails closed when the scope key belongs to another user', async () => {
    ledger.rows.set(ledgerKey('acc-1'), {
      status: 'published',
      leaseUntil: null,
      token: null,
      result: { accountId: 'acc-1', success: true, videoUrl: 'https://youtu.be/abc' },
      userId: 'user-2',
    });
    mockBuildUploadErrorResponse.mockReturnValue(
      NextResponse.json({ success: false, error: 'boom' }, { status: 500 }),
    );

    const res = await POST(makeRequest({ accountIds: ['acc-1'], scopeKey: SCOPE_KEY }));

    expect(res.status).toBe(500);
    expect(mockHandleYoutubeUpload).not.toHaveBeenCalled();
    expect(mockBuildUploadErrorResponse).toHaveBeenCalled();
  });

  it('records a handler failure so the next retry can claim a fresh attempt', async () => {
    mockHandleYoutubeUpload
      .mockResolvedValueOnce({
        success: false,
        provider: 'youtube',
        results: [{ accountId: 'acc-1', success: false, error: 'YouTube 503', errorCode: 'transient' }],
      })
      .mockResolvedValueOnce({
        success: true,
        provider: 'youtube',
        results: [{ accountId: 'acc-1', success: true, videoUrl: 'https://youtu.be/abc' }],
      });

    const first = await POST(makeRequest({ accountIds: ['acc-1'], scopeKey: SCOPE_KEY }));
    expect((await first.json() as { success: boolean }).success).toBe(false);
    expect(ledger.rows.get(ledgerKey('acc-1'))?.status).toBe('failed');

    const second = await POST(makeRequest({ accountIds: ['acc-1'], scopeKey: SCOPE_KEY }));
    expect(mockHandleYoutubeUpload).toHaveBeenCalledTimes(2);
    expect(await second.json()).toEqual({
      success: true,
      provider: 'youtube',
      successCount: 1,
      results: [{ accountId: 'acc-1', success: true, videoUrl: 'https://youtu.be/abc' }],
    });
    expect(ledger.rows.get(ledgerKey('acc-1'))?.status).toBe('published');
  });

  it('releases the claims on a request-level rejection so a same-key retry proceeds at once', async () => {
    mockHandleYoutubeUpload
      .mockResolvedValueOnce({
        success: false,
        provider: 'youtube',
        results: [{ accountId: '', success: false, error: 'Caption is required', errorCode: 'publish_rejected' }],
      })
      .mockResolvedValueOnce({
        success: true,
        provider: 'youtube',
        results: [{ accountId: 'acc-1', success: true, videoUrl: 'https://youtu.be/abc' }],
      });

    const first = await POST(makeRequest({ accountIds: ['acc-1'], scopeKey: SCOPE_KEY }));
    expect((await first.json() as { success: boolean }).success).toBe(false);
    expect(ledger.rows.get(ledgerKey('acc-1'))?.status).toBe('failed');

    const second = await POST(makeRequest({ accountIds: ['acc-1'], scopeKey: SCOPE_KEY }));
    expect(mockHandleYoutubeUpload).toHaveBeenCalledTimes(2);
    expect(await second.json()).toEqual({
      success: true,
      provider: 'youtube',
      successCount: 1,
      results: [{ accountId: 'acc-1', success: true, videoUrl: 'https://youtu.be/abc' }],
    });
    expect(ledger.rows.get(ledgerKey('acc-1'))?.status).toBe('published');
  });

  it('parks a published account as unknown when its record is lost, and never re-posts it', async () => {
    ledger.failRecordKeys.add(ledgerKey('acc-1'));
    mockHandleYoutubeUpload.mockResolvedValue({
      success: true,
      provider: 'youtube',
      results: [{ accountId: 'acc-1', success: true, videoUrl: 'https://youtu.be/abc' }],
    });

    const first = await POST(makeRequest({ accountIds: ['acc-1'], scopeKey: SCOPE_KEY }));
    // The caller still gets the handler's success: when it receives it, its
    // own recorded success keeps the account from retrying at all. The
    // unknown park only matters when the caller never got this answer.
    expect((await first.json() as { success: boolean }).success).toBe(true);
    expect(ledger.rows.get(ledgerKey('acc-1'))?.status).toBe('unknown');

    const second = await POST(makeRequest({ accountIds: ['acc-1'], scopeKey: SCOPE_KEY }));
    expect(mockHandleYoutubeUpload).toHaveBeenCalledTimes(1);
    expect(await second.json()).toEqual({
      success: false,
      successCount: 0,
      results: [{
        accountId: 'acc-1',
        success: false,
        error: 'Publish result could not be recorded — this account may already have published. Check the provider before posting again.',
        errorCode: 'publish_unknown',
      }],
    });
    expect(ledger.rows.get(ledgerKey('acc-1'))?.status).toBe('unknown');
  });

  it('reclaims an expired lease instead of waiting forever', async () => {
    ledger.rows.set(ledgerKey('acc-1'), {
      status: 'in_progress',
      leaseUntil: Date.now() - 1000,
      token: 'dead-token',
      result: null,
      userId: USER_ID,
    });
    mockHandleYoutubeUpload.mockResolvedValue({
      success: true,
      provider: 'youtube',
      results: [{ accountId: 'acc-1', success: true, videoUrl: 'https://youtu.be/abc' }],
    });

    const res = await POST(makeRequest({ accountIds: ['acc-1'], scopeKey: SCOPE_KEY }));

    expect(mockHandleYoutubeUpload).toHaveBeenCalledTimes(1);
    expect((await res.json() as { success: boolean }).success).toBe(true);
    expect(ledger.rows.get(ledgerKey('acc-1'))?.status).toBe('published');
  });

  it('publishes without the ledger when no scope key is sent', async () => {
    mockHandleYoutubeUpload.mockResolvedValue({
      success: true,
      provider: 'youtube',
      results: [{ accountId: 'acc-1', success: true, videoUrl: 'https://youtu.be/abc' }],
    });

    const res = await POST(makeRequest({ accountIds: ['acc-1', 'acc-2'] }));

    expect(mockHandleYoutubeUpload).toHaveBeenCalledTimes(1);
    const [formData] = mockHandleYoutubeUpload.mock.calls[0] as [FormData, string];
    expect(formData.getAll('accountIds')).toEqual(['acc-1', 'acc-2']);
    expect((await res.json() as { success: boolean }).success).toBe(true);
    expect(ledger.rpc).not.toHaveBeenCalled();
  });

  it('releases the claims when the handler throws', async () => {
    mockHandleYoutubeUpload.mockRejectedValue(new Error('boom'));
    mockBuildUploadErrorResponse.mockReturnValue(
      NextResponse.json({ success: false, error: 'boom' }, { status: 500 }),
    );

    const res = await POST(makeRequest({ accountIds: ['acc-1'], scopeKey: SCOPE_KEY }));

    expect(res.status).toBe(500);
    expect(ledger.rows.get(ledgerKey('acc-1'))?.status).toBe('failed');
  });

  it('renews the claims while a slow handler runs and stops when it finishes', async () => {
    vi.useFakeTimers();
    try {
      let resolveHandler!: (value: unknown) => void;
      const handlerDone = new Promise((resolve) => {
        resolveHandler = resolve;
      });
      mockHandleYoutubeUpload.mockImplementation(() => handlerDone);
      const resPromise = POST(makeRequest({ accountIds: ['acc-1'], scopeKey: SCOPE_KEY }));
      // Let the route claim and reach the handler.
      await vi.advanceTimersByTimeAsync(0);
      expect(mockHandleYoutubeUpload).toHaveBeenCalledTimes(1);
      const before = ledger.rows.get(ledgerKey('acc-1'))?.leaseUntil;

      // One heartbeat beat touches the claim, pushing its lease out.
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
      expect(ledger.rpc).toHaveBeenCalledWith(
        'touch_publish_ledger',
        expect.objectContaining({ p_key: ledgerKey('acc-1') }),
      );
      expect(ledger.rows.get(ledgerKey('acc-1'))?.leaseUntil).toBeGreaterThan(before ?? 0);

      // Finish the handler; the heartbeat stops with the request.
      resolveHandler({
        success: true,
        provider: 'youtube',
        results: [{ accountId: 'acc-1', success: true, videoUrl: 'https://youtu.be/abc' }],
      });
      const res = await resPromise;
      expect((await res.json() as { success: boolean }).success).toBe(true);
      const touches = ledger.rpc.mock.calls.filter(([fn]) => fn === 'touch_publish_ledger').length;
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
      expect(ledger.rpc.mock.calls.filter(([fn]) => fn === 'touch_publish_ledger').length).toBe(touches);
    } finally {
      vi.useRealTimers();
    }
  });
});
