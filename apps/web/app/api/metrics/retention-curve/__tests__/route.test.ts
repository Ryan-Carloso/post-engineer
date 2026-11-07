import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/service', () => ({ createSupabaseServiceClient: vi.fn() }));
vi.mock('@/lib/request-auth', () => ({ requireSupabaseSession: vi.fn() }));
vi.mock('@/lib/rate-limit', () => ({
  applyRateLimit: vi.fn(async () => null),
  RATE_LIMITS: { retentionCurve: { name: 'retention-curve', limit: 30, windowMs: 60_000 } },
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/upload/handlers', () => ({ getAuthenticatedClient: vi.fn() }));
vi.mock('@/lib/youtube', () => ({ getYouTubeVideoInfo: vi.fn() }));
vi.mock('@/lib/youtube-analytics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/youtube-analytics')>();
  return { ...actual, queryRetentionCurve: vi.fn() };
});

import { GET } from '../route';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { applyRateLimit } from '@/lib/rate-limit';
import { getAuthenticatedClient } from '@/lib/upload/handlers';
import { getYouTubeVideoInfo } from '@/lib/youtube';
import { AnalyticsAuthError, queryRetentionCurve } from '@/lib/youtube-analytics';
import { AuthError } from '@/lib/errors';

const PERSONA = '11111111-2222-4333-8444-555555555555';
const OWN_VIDEO = { snippet: { channelId: 'UC-own', publishedAt: '2026-10-01T10:00:00Z' } };
const POINTS = [{ ratio: 0.01, audienceWatchRatio: 1, relativeRetentionPerformance: 0.5 }];

function mockLookup(result: { data: unknown; error: unknown }) {
  const calls: Array<[string, ...unknown[]]> = [];
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'is', 'or', 'order']) {
    builder[method] = vi.fn((...args: unknown[]) => { calls.push([method, ...args]); return builder; });
  }
  builder.limit = vi.fn(async (...args: unknown[]) => { calls.push(['limit', ...args]); return result; });
  const from = vi.fn(() => builder);
  vi.mocked(createSupabaseServiceClient).mockReturnValue({ from } as never);
  return { calls, from };
}

function get(query: string): Promise<Response> {
  return GET(new Request(`http://localhost:3434/api/metrics/retention-curve${query}`));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireSupabaseSession).mockResolvedValue({ auth: { userId: 'user-1', accessToken: 't' }, error: null } as never);
  vi.mocked(getAuthenticatedClient).mockResolvedValue('client' as never);
  vi.mocked(getYouTubeVideoInfo).mockResolvedValue(OWN_VIDEO);
  vi.mocked(queryRetentionCurve).mockResolvedValue({ kind: 'ok', points: POINTS });
});

describe('GET /api/metrics/retention-curve', () => {
  it('returns the curve of an owned video after both ownership checks', async () => {
    const { calls, from } = mockLookup({ data: [{ post_id: 'p1' }], error: null });
    const response = await get('?account=UC-own&video=vid_1');

    expect(response.status).toBe(200);
    expect(applyRateLimit).toHaveBeenCalled();
    expect(from).toHaveBeenCalledWith('post_metrics');
    expect(calls).toContainEqual(['eq', 'user_id', 'user-1']);
    expect(calls).toContainEqual(['eq', 'provider', 'youtube']);
    expect(calls).toContainEqual(['eq', 'account_id', 'UC-own']);
    expect(calls).toContainEqual(['eq', 'external_id', 'vid_1']);
    expect(getAuthenticatedClient).toHaveBeenCalledWith('user-1', 'UC-own');
    expect(queryRetentionCurve).toHaveBeenCalledWith('client', expect.objectContaining({ videoId: 'vid_1', startDate: '2026-10-01' }));
    const body: unknown = await response.json();
    expect(body).toMatchObject({ success: true, points: POINTS, startDate: '2026-10-01', provisional: true });
  });

  it('rejects unknown, missing, duplicate and malformed params with 400', async () => {
    mockLookup({ data: [], error: null });
    for (const query of ['?account=UC&video=v&x=1', '?account=UC', '?account=UC&account=UD&video=v', '?account=UC&video=a%3Bb', '?account=&video=v']) {
      expect((await get(query)).status).toBe(400);
    }
    expect(createSupabaseServiceClient).not.toHaveBeenCalled();
  });

  it('404s a video the caller has no snapshot of, without calling Google', async () => {
    mockLookup({ data: [], error: null });
    expect((await get('?account=UC-own&video=vid_1')).status).toBe(404);
    expect(getAuthenticatedClient).not.toHaveBeenCalled();
    expect(queryRetentionCurve).not.toHaveBeenCalled();
  });

  it('404s a video on another channel and never queries Analytics for it', async () => {
    mockLookup({ data: [{ post_id: 'p1' }], error: null });
    vi.mocked(getYouTubeVideoInfo).mockResolvedValueOnce({ snippet: { channelId: 'UC-other', publishedAt: '2026-10-01T10:00:00Z' } });
    expect((await get('?account=UC-own&video=vid_1')).status).toBe(404);
    expect(queryRetentionCurve).not.toHaveBeenCalled();
  });

  it('500s on a lookup error', async () => {
    mockLookup({ data: null, error: { message: 'boom' } });
    expect((await get('?account=UC-own&video=vid_1')).status).toBe(500);
  });

  it('returns 403 YOUTUBE_ANALYTICS_SCOPE_MISSING for a token without the Analytics scope', async () => {
    mockLookup({ data: [{ post_id: 'p1' }], error: null });
    vi.mocked(queryRetentionCurve).mockResolvedValueOnce({ kind: 'scope_missing' });
    const response = await get('?account=UC-own&video=vid_1');
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: 'YOUTUBE_ANALYTICS_SCOPE_MISSING' });
  });

  it('returns 403 YOUTUBE_RECONNECT_REQUIRED when the stored token cannot be loaded', async () => {
    mockLookup({ data: [{ post_id: 'p1' }], error: null });
    vi.mocked(getAuthenticatedClient).mockRejectedValueOnce(new AuthError('bad', 'invalid_token'));
    const response = await get('?account=UC-own&video=vid_1');
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: 'YOUTUBE_RECONNECT_REQUIRED' });
  });

  it('maps provider failures to 502 with a stable code and a deleted video to 404', async () => {
    mockLookup({ data: [{ post_id: 'p1' }], error: null });
    vi.mocked(queryRetentionCurve).mockRejectedValueOnce(new AnalyticsAuthError(403));
    let response = await get('?account=UC-own&video=vid_1');
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ code: 'YOUTUBE_ANALYTICS_REJECTED' });

    vi.mocked(queryRetentionCurve).mockRejectedValueOnce(new Error('503'));
    response = await get('?account=UC-own&video=vid_1');
    await expect(response.json()).resolves.toMatchObject({ code: 'YOUTUBE_ANALYTICS_UNAVAILABLE' });

    vi.mocked(getYouTubeVideoInfo).mockRejectedValueOnce(new Error('Video not found'));
    expect((await get('?account=UC-own&video=vid_1')).status).toBe(404);
  });

  it('limits a persona-scoped API key to its personas plus persona-less rows', async () => {
    vi.mocked(requireSupabaseSession).mockResolvedValue({
      auth: { userId: 'user-1', isApiKey: true, personaIds: [PERSONA, 'not-a-uuid'] }, error: null,
    } as never);
    const { calls } = mockLookup({ data: [{ post_id: 'p1' }], error: null });
    await get('?account=UC-own&video=vid_1');
    expect(calls).toContainEqual(['or', `persona_id.in.(${PERSONA}),persona_id.is.null`]);

    vi.mocked(requireSupabaseSession).mockResolvedValue({
      auth: { userId: 'user-1', isApiKey: true, personaIds: [] }, error: null,
    } as never);
    const second = mockLookup({ data: [], error: null });
    await get('?account=UC-own&video=vid_1');
    expect(second.calls).toContainEqual(['is', 'persona_id', null]);
  });

  it('returns the auth error untouched', async () => {
    const denied = new Response(null, { status: 401 });
    vi.mocked(requireSupabaseSession).mockResolvedValue({ auth: null, error: denied } as never);
    expect((await get('?account=UC-own&video=vid_1')).status).toBe(401);
  });
});
