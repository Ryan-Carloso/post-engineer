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
  return { ...actual, getGenerationPost: vi.fn(), getSlotPost: vi.fn() };
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
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { applyRateLimit } from '@/lib/rate-limit';
import { getGenerationPost, getSlotPost } from '@/lib/post-detail';

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

  it('returns the generation with kind=generation for a generation id', async () => {
    vi.mocked(getGenerationPost).mockResolvedValue({
      id: 'vg-1',
      generationId: 'gen-1:slot:slot-1',
      engineTaskId: 'task-1',
      personaName: 'Viva Leve',
      videoSubject: 'myth busting',
      status: 'pending',
      errorCode: null,
      tokensRefunded: false,
      createdAt: '2026-10-17T10:00:00.000Z',
      completedAt: null,
      progress: 67,
      stage: 'audio',
      scriptAngle: 'The myth that keeps coming back',
    });
    const response = await get('gen-1:slot:slot-1');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { success: boolean; kind: string; generation: { progress: number } };
    expect(body.success).toBe(true);
    expect(body.kind).toBe('generation');
    expect(body.generation.progress).toBe(67);
    expect(getSlotPost).not.toHaveBeenCalled();
  });

  it('returns the slot detail with kind=slot for a slot id', async () => {
    vi.mocked(getGenerationPost).mockResolvedValue(null);
    vi.mocked(getSlotPost).mockResolvedValue({
      slot: {
        id: 'slot-1',
        scheduleId: 'sched-1',
        slotAt: '2026-10-18T10:00:00.000Z',
        status: 'generating',
        title: 'myth busting',
        error: null,
        publishedAt: null,
        taskId: 'task-1',
        progress: 42,
        stage: 'video',
        retryable: null,
        scriptAngle: null,
        publishLinks: [],
        progressHistory: [],
        queuePosition: null,
        queueTotal: null,
      },
      schedule: {
        id: 'sched-1',
        personaId: 'persona-1',
        providers: ['youtube'],
        youtubeAccountIds: [],
        instagramAccountIds: [],
        linkedinAccountIds: [],
        blueskyAccountIds: [],
        timezone: 'UTC',
        publishMode: 'scheduled',
      },
      persona: { id: 'persona-1', name: 'Viva Leve' },
      generation: {
        faceless: false, material: 'broll',
        language: null,
        voiceId: null,
        videoAspect: null,
        videoLayout: null,
        niche: null,
        paragraphNumber: null,
        faceQuality: null,
      },
    });
    const response = await get(SLOT_ID);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { success: boolean; kind: string; slot: { id: string } };
    expect(body.success).toBe(true);
    expect(body.kind).toBe('slot');
    expect(body.slot.id).toBe('slot-1');
    expect(getSlotPost).toHaveBeenCalledWith(expect.anything(), SLOT_ID, USER_ID, null);
  });

  it('returns 404 when neither lookup matches (genuine miss)', async () => {
    const { logger } = await import('@/lib/logger');
    vi.mocked(getGenerationPost).mockResolvedValue(null);
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

  it('returns 500 and logs when a lookup throws', async () => {
    const { logger } = await import('@/lib/logger');
    vi.mocked(getGenerationPost).mockRejectedValue(new Error('db down'));
    const response = await get('gen-1');
    expect(response.status).toBe(500);
    expect(logger.error).toHaveBeenCalledWith(
      '[api/posts] post detail lookup failed',
      expect.anything(),
      { id: 'gen-1' },
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
    expect(getGenerationPost).not.toHaveBeenCalled();
  });

  it('returns the auth error when an auth object is present alongside it', async () => {
    const { apiErrorResponse } = await import('@/lib/api-error');
    vi.mocked(requireSupabaseSession).mockResolvedValue({
      auth: { userId: USER_ID, isApiKey: false, isOAuth: false },
      error: apiErrorResponse(401, 'Unauthorized.', {}),
    } as never);
    const response = await get(SLOT_ID);
    expect(response.status).toBe(401);
    expect(getGenerationPost).not.toHaveBeenCalled();
  });

  it('returns 429 and skips both lookups when the caller is rate limited', async () => {
    vi.mocked(applyRateLimit).mockResolvedValueOnce(
      NextResponse.json({ success: false, error: 'Too many requests.' }, { status: 429 }),
    );
    const response = await get(SLOT_ID);
    expect(response.status).toBe(429);
    expect(getGenerationPost).not.toHaveBeenCalled();
    expect(getSlotPost).not.toHaveBeenCalled();
  });

  it('reads through the cookie session client for a browser caller', async () => {
    const server = { tag: 'server' };
    vi.mocked(createSupabaseServerClient).mockResolvedValue(server as never);
    vi.mocked(getGenerationPost).mockResolvedValue(null);
    vi.mocked(getSlotPost).mockResolvedValue(null);
    await get(SLOT_ID);
    expect(getGenerationPost).toHaveBeenCalledWith(server, SLOT_ID, USER_ID, null);
    expect(createSupabaseServiceClient).not.toHaveBeenCalled();
  });

  it('reads through the service client for an API-key caller', async () => {
    const service = { tag: 'service' };
    vi.mocked(createSupabaseServiceClient).mockReturnValue(service as never);
    vi.mocked(requireSupabaseSession).mockResolvedValue({
      auth: { userId: USER_ID, isApiKey: true, isOAuth: false },
      error: null,
    } as never);
    vi.mocked(getGenerationPost).mockResolvedValue(null);
    vi.mocked(getSlotPost).mockResolvedValue(null);
    await get(SLOT_ID);
    expect(getGenerationPost).toHaveBeenCalledWith(service, SLOT_ID, USER_ID, null);
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it('reads through the service client for an OAuth caller', async () => {
    const service = { tag: 'oauth-service' };
    vi.mocked(createSupabaseServiceClient).mockReturnValue(service as never);
    vi.mocked(requireSupabaseSession).mockResolvedValue({
      auth: { userId: USER_ID, isApiKey: false, isOAuth: true },
      error: null,
    } as never);
    vi.mocked(getGenerationPost).mockResolvedValue(null);
    vi.mocked(getSlotPost).mockResolvedValue(null);
    await get(SLOT_ID);
    expect(getGenerationPost).toHaveBeenCalledWith(service, SLOT_ID, USER_ID, null);
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
  });
});
