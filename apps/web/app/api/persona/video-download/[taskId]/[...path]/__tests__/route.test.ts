// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/request-auth', () => ({
  requireSupabaseSession: vi.fn(),
  engineAuthHeaders: (userId: string) => ({ 'x-user-id': userId }),
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(() => 'log-id'), warn: vi.fn(() => 'log-id'), info: vi.fn(() => 'log-id') },
}));
vi.mock('@/lib/rate-limit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/rate-limit')>();
  return { ...actual, applyRateLimit: vi.fn().mockResolvedValue(null) };
});

import { GET } from '../route';
import { requireSupabaseSession } from '@/lib/request-auth';
import { logger } from '@/lib/logger';
import { NextResponse } from 'next/server';

//---------------
// GET /api/persona/video-download/:taskId/*path — the guessable file name
// (`final-1.mp4`) is not what every engine task stores. When the upstream
// 404s, the proxy consults the engine's task record and redirects to the
// actual video file, so consumers (card thumbnails, detail player) don't
// need to know the engine's naming.
//---------------

const USER_ID = 'user-1';

function mockAuth() {
  vi.mocked(requireSupabaseSession).mockResolvedValue({
    auth: { userId: USER_ID, accessToken: 'pe_test_key', isApiKey: true },
    error: null,
  } as never);
}

describe('GET /api/persona/video-download', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('MONEYPRINT_API_URL', 'https://engine.test');
    vi.stubEnv('MONEYPRINT_API_SECRET', 'secret');
    mockAuth();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('returns 429 when the rate limiter rejects the request', async () => {
    const { applyRateLimit } = await import('@/lib/rate-limit');
    vi.mocked(applyRateLimit).mockResolvedValueOnce(
      NextResponse.json({ success: false, error: 'Too many requests.' }, { status: 429 }),
    );

    const response = await GET(new Request('https://app.test/api/persona/video-download/task-1/final-1.mp4'), {
      params: Promise.resolve({ taskId: 'task-1', path: ['final-1.mp4'] }),
    });

    expect(response.status).toBe(429);
  });

  it('streams through when the requested file exists upstream', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('video-bytes', {
      status: 200,
      headers: { 'content-type': 'video/mp4' },
    })));

    const response = await GET(new Request('https://app.test/api/persona/video-download/task-1/final-1.mp4'), {
      params: Promise.resolve({ taskId: 'task-1', path: ['final-1.mp4'] }),
    });

    expect(response.status).toBe(200);    expect(await response.text()).toBe('video-bytes');
    expect(response.headers.get('content-type')).toBe('video/mp4');
  });

  it('redirects to the real video file when the guessed name 404s upstream', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/v1/download/task-1/final-1.mp4')) {
        return new Response('not found', { status: 404 });
      }
      if (url.includes('/api/v1/tasks/task-1')) {
        return Response.json({
          data: { files: ['/api/v1/download/task-1/outputs/final-9.mp4'] },
        });
      }
      return new Response('unexpected', { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(new Request('https://app.test/api/persona/video-download/task-1/final-1.mp4'), {
      params: Promise.resolve({ taskId: 'task-1', path: ['final-1.mp4'] }),
    });

    expect(response.status).toBe(302);
    expect(new URL(response.headers.get('location') ?? '', 'https://app.test').pathname).toBe(
      '/api/persona/video-download/task-1/outputs/final-9.mp4',
    );
    // The miss is loud and diagnosable.
    expect(logger.warn).toHaveBeenCalledWith(
      '[video-download] requested file missing; redirecting',
      expect.objectContaining({ taskId: 'task-1', resolved: 'outputs/final-9.mp4' }),
    );
  });

  it('returns a logged 404 when the task has no video file at all', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/v1/download/')) return new Response('not found', { status: 404 });
      if (url.includes('/api/v1/tasks/')) return Response.json({ data: { files: [] } });
      return new Response('unexpected', { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(new Request('https://app.test/api/persona/video-download/task-1/final-1.mp4'), {
      params: Promise.resolve({ taskId: 'task-1', path: ['final-1.mp4'] }),
    });

    expect(response.status).toBe(404);
    expect(logger.warn).toHaveBeenCalledWith(
      '[video-download] no video file found for task',
      expect.objectContaining({ taskId: 'task-1' }),
    );
  });

  it('returns 502 (not a redirect) when the engine itself is unreachable', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('engine down');
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(new Request('https://app.test/api/persona/video-download/task-1/final-1.mp4'), {
      params: Promise.resolve({ taskId: 'task-1', path: ['final-1.mp4'] }),
    });

    expect(response.status).toBe(502);
  });

  it('passes through the engine storage-fallback redirect instead of following it', async () => {
    // The engine 302s to a signed Supabase Storage URL when the local file
    // is gone (restart wiped the disk). The proxy must hand the browser the
    // signed URL directly — never fetch the video bytes itself.
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(null, {
        status: 302,
        headers: { location: 'https://xyz.supabase.co/storage/v1/object/sign/videos/x?token=abc' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(new Request('https://app.test/api/persona/video-download/task-1/final-1.mp4'), {
      params: Promise.resolve({ taskId: 'task-1', path: ['final-1.mp4'] }),
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: 'manual' });
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(
      'https://xyz.supabase.co/storage/v1/object/sign/videos/x?token=abc',
    );
  });
});
