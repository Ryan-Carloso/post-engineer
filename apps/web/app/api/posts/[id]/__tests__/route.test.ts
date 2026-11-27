import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/request-auth', () => ({
  requireSupabaseSession: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(() => 'log-id'), warn: vi.fn(() => 'log-id'), info: vi.fn(() => 'log-id') },
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: vi.fn(),
}));

vi.mock('@/lib/rate-limit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/rate-limit')>();
  return { ...actual, applyRateLimit: vi.fn().mockResolvedValue(null) };
});

vi.mock('@/lib/post-detail', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/post-detail')>();
  return { ...actual, getSlotPost: vi.fn() };
});

vi.mock('@/lib/api-error-reporting', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-error-reporting')>();
  return {
    ...actual,
    withApiErrorReporting: (_route: string, handler: unknown) => handler,
    resolveReportingUserId: vi.fn(),
  };
});

import { NextResponse } from 'next/server';
import { GET } from '../route';
import { GetPostResponseSchema } from '@/lib/contracts/posts';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { applyRateLimit } from '@/lib/rate-limit';
import { getSlotPost } from '@/lib/post-detail';

const USER_ID = 'user-1';
const SLOT_ID = '11111111-1111-4111-8111-111111111111';

function mockAuth() {
  vi.mocked(requireSupabaseSession).mockResolvedValue({
    auth: { userId: USER_ID, isApiKey: false, isOAuth: false },
    error: null,
  } as never);
  vi.mocked(createSupabaseServerClient).mockResolvedValue({} as never);
}

function get(id: string) {
  return GET(new Request(`https://example.com/api/posts/${id}`), {
    params: Promise.resolve({ id }),
  });
}

describe('GET /api/posts/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth();
  });

  it('returns the slot detail for a slot id', async () => {
    vi.mocked(getSlotPost).mockResolvedValue({
      slot: {
        id: 'slot-1',
        scheduleId: 'sched-1',
        slotAt: '2026-10-18T10:00:00.000Z',
        status: 'ready',
        title: 'myth busting',
        description: 'Edited outside.',
        error: null,
        publishedAt: null,
        publishLinks: [],
        userNotices: [],
        providerFailures: [],
        firstComment: null,
        commentWarnings: [],
        postUrl: 'https://example.com/posts/slot-1',
        media: null,
      },
      schedule: {
        id: 'sched-1',
        personaId: 'persona-1',
        providers: ['youtube'],
        youtubeAccountIds: [],
        instagramAccountIds: [],
        linkedinAccountIds: [],
        blueskyAccountIds: [],
        threadsAccountIds: [],
        facebookAccountIds: [],
        pinterestAccountIds: [],
        pinterestBoardId: null,
        threespeakAccountIds: [],
        rumbleAccountIds: [],
        fanvueAccountIds: [],
        telegramAccountIds: [],
        timezone: 'UTC',
        publishMode: 'scheduled',
      },
      persona: { id: 'persona-1', name: 'Viva Leve' },
      prompt: null,
    });
    const response = await get(SLOT_ID);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { success: boolean; slot: { id: string } };
    expect(body.success).toBe(true);
    expect(body).not.toHaveProperty('kind');
    expect(body.slot.id).toBe('slot-1');
    expect(GetPostResponseSchema.safeParse(body).success).toBe(true);
    expect(getSlotPost).toHaveBeenCalledWith(expect.anything(), SLOT_ID, USER_ID, null);
  });

  it('returns 404 when the slot lookup does not match (genuine miss)', async () => {
    const { logger } = await import('@/lib/logger');
    vi.mocked(getSlotPost).mockResolvedValue(null);
    const response = await get(SLOT_ID);
    expect(response.status).toBe(404);
    const body = (await response.json()) as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toBe('Post not found.');
    expect(logger.warn).toHaveBeenCalledWith(
      '[GET /api/posts/[id]] 404 Post not found.',
      expect.objectContaining({ route: 'GET /api/posts/[id]' }),
    );
  });

  it('returns 404 for another user’s slot id without leaking the row', async () => {
    vi.mocked(getSlotPost).mockResolvedValue(null);
    const response = await get(SLOT_ID);
    expect(response.status).toBe(404);
    const body = (await response.json()) as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toBe('Post not found.');
    expect(getSlotPost).toHaveBeenCalledWith(expect.anything(), SLOT_ID, USER_ID, null);
  });

  it('returns 500 and logs when a lookup throws', async () => {
    const { logger } = await import('@/lib/logger');
    vi.mocked(getSlotPost).mockRejectedValue(new Error('db down'));
    const response = await get(SLOT_ID);
    expect(response.status).toBe(500);
    expect(logger.error).toHaveBeenCalledWith(
      '[api/posts] post detail lookup failed',
      expect.anything(),
      { id: SLOT_ID },
    );
    expect(logger.error).toHaveBeenCalledWith(
      '[GET /api/posts/[id]] 500 Failed to load post.',
      expect.any(Error),
      expect.objectContaining({ route: 'GET /api/posts/[id]' }),
    );
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('Failed to load post.');
  });

  it('returns 401 when authentication fails', async () => {
    const { apiErrorResponse } = await import('@/lib/api-error');
    vi.mocked(requireSupabaseSession).mockResolvedValue({
      auth: null,
      error: apiErrorResponse(401, 'Unauthorized.', {}),
    } as never);
    const response = await get('slot-1');
    expect(response.status).toBe(401);
    expect(getSlotPost).not.toHaveBeenCalled();
  });

  it('returns the auth error when an auth object is present alongside it', async () => {
    const { apiErrorResponse } = await import('@/lib/api-error');
    vi.mocked(requireSupabaseSession).mockResolvedValue({
      auth: { userId: USER_ID, isApiKey: false, isOAuth: false },
      error: apiErrorResponse(401, 'Unauthorized.', {}),
    } as never);
    const response = await get(SLOT_ID);
    expect(response.status).toBe(401);
    expect(getSlotPost).not.toHaveBeenCalled();
  });

  it('returns 429 and skips the lookup when the caller is rate limited', async () => {
    vi.mocked(applyRateLimit).mockResolvedValueOnce(
      NextResponse.json({ success: false, error: 'Too many requests.' }, { status: 429 }),
    );
    const response = await get(SLOT_ID);
    expect(response.status).toBe(429);
    expect(getSlotPost).not.toHaveBeenCalled();
  });

  it('reads through the cookie session client for a browser caller', async () => {
    const server = { tag: 'server' };
    vi.mocked(createSupabaseServerClient).mockResolvedValue(server as never);
    vi.mocked(getSlotPost).mockResolvedValue(null);
    await get(SLOT_ID);
    expect(getSlotPost).toHaveBeenCalledWith(server, SLOT_ID, USER_ID, null);
    expect(createSupabaseServiceClient).not.toHaveBeenCalled();
  });

  it('reads through the service client for an API-key caller', async () => {
    const service = { tag: 'service' };
    vi.mocked(createSupabaseServiceClient).mockReturnValue(service as never);
    vi.mocked(requireSupabaseSession).mockResolvedValue({
      auth: { userId: USER_ID, isApiKey: true, isOAuth: false },
      error: null,
    } as never);
    vi.mocked(getSlotPost).mockResolvedValue(null);
    await get(SLOT_ID);
    expect(getSlotPost).toHaveBeenCalledWith(service, SLOT_ID, USER_ID, null);
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it('reads through the service client for an OAuth caller', async () => {
    const service = { tag: 'oauth-service' };
    vi.mocked(createSupabaseServiceClient).mockReturnValue(service as never);
    vi.mocked(requireSupabaseSession).mockResolvedValue({
      auth: { userId: USER_ID, isApiKey: false, isOAuth: true },
      error: null,
    } as never);
    vi.mocked(getSlotPost).mockResolvedValue(null);
    await get(SLOT_ID);
    expect(getSlotPost).toHaveBeenCalledWith(service, SLOT_ID, USER_ID, null);
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
  });
});
