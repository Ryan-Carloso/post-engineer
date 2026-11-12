// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

vi.mock('@/lib/request-auth', () => ({ requireSupabaseSession: vi.fn() }));
vi.mock('@/lib/rate-limit', () => ({
  applyRateLimit: vi.fn(async () => null),
  RATE_LIMITS: { signedVideoUpload: {}, publishById: {} },
}));
vi.mock('@/lib/posthog-server', () => ({
  getPostHogServer: vi.fn(() => ({ capture: vi.fn(), captureAs: vi.fn() })),
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), generateLogId: vi.fn(() => 'log-1') },
}));
vi.mock('@/lib/videos/signed-upload', () => {
  class VideoUploadError extends Error {
    constructor(
      message: string,
      public readonly status: number,
      public readonly code: string,
    ) {
      super(message);
      this.name = 'VideoUploadError';
    }
  }
  return {
    VideoUploadError,
    parseMintBody: vi.fn((body: { contentType?: string; sizeBytes?: number }) => {
      if (body.contentType !== 'video/mp4' && body.contentType !== 'video/quicktime') {
        throw new VideoUploadError('contentType must be video/mp4 or video/quicktime.', 400, 'VIDEO_UPLOAD_INVALID_CONTENT_TYPE');
      }
      if (typeof body.sizeBytes !== 'number' || body.sizeBytes <= 0) {
        throw new VideoUploadError('sizeBytes must be a positive integer.', 400, 'VIDEO_UPLOAD_INVALID_SIZE');
      }
      return { contentType: body.contentType, sizeBytes: body.sizeBytes };
    }),
    mintVideoUpload: vi.fn(async () => ({
      uploadId: '11111111-1111-4111-8111-111111111111',
      signedUrl: 'https://storage.test/upload/x?token=t',
      token: 'tok',
      storagePath: 'user-uuid-1/direct-uploads/x.mp4',
      expiresAt: '2026-11-12T00:15:00.000Z',
      maxBytes: 2147483648,
    })),
    createSupabaseVideoUploadStore: vi.fn(() => ({})),
    createSupabaseVideoUploadStorage: vi.fn(() => ({})),
  };
});

import { POST } from '../route';
import { requireSupabaseSession } from '@/lib/request-auth';
import { applyRateLimit } from '@/lib/rate-limit';
import { mintVideoUpload } from '@/lib/videos/signed-upload';

function jsonRequest(body: unknown): Request {
  return new Request('https://post-engineer.com/api/videos/upload-url', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireSupabaseSession).mockResolvedValue({
    auth: { userId: 'user-uuid-1', accessToken: 'token' },
    error: null,
  } as never);
});

describe('POST /api/videos/upload-url', () => {
  it('mints a signed upload bound to the caller', async () => {
    const response = await POST(jsonRequest({ contentType: 'video/mp4', sizeBytes: 123 }));
    expect(response.status).toBe(200);
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload.success).toBe(true);
    expect(payload.uploadId).toBe('11111111-1111-4111-8111-111111111111');
    expect(payload.signedUrl).toContain('token=');
    expect(vi.mocked(mintVideoUpload).mock.calls[0]?.[2]).toBe('user-uuid-1');
  });

  it('rejects unauthenticated callers before minting', async () => {
    vi.mocked(requireSupabaseSession).mockResolvedValueOnce({
      auth: null,
      error: NextResponse.json({ success: false, error: 'Authentication required.' }, { status: 401 }),
    } as never);
    const response = await POST(jsonRequest({ contentType: 'video/mp4', sizeBytes: 1 }));
    expect(response.status).toBe(401);
    expect(vi.mocked(mintVideoUpload)).not.toHaveBeenCalled();
  });

  it('rejects an invalid content type with a stable code', async () => {
    const response = await POST(jsonRequest({ contentType: 'image/png', sizeBytes: 1 }));
    expect(response.status).toBe(400);
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload.code).toBe('VIDEO_UPLOAD_INVALID_CONTENT_TYPE');
    expect(vi.mocked(mintVideoUpload)).not.toHaveBeenCalled();
  });

  it('rejects a malformed JSON body', async () => {
    const response = await POST(
      new Request('https://post-engineer.com/api/videos/upload-url', { method: 'POST', body: 'not json' }),
    );
    expect(response.status).toBe(400);
  });

  it('returns the rate-limit response before minting', async () => {
    vi.mocked(applyRateLimit).mockResolvedValueOnce(
      NextResponse.json({ success: false, error: 'Too many requests.' }, { status: 429 }) as never,
    );
    const response = await POST(jsonRequest({ contentType: 'video/mp4', sizeBytes: 1 }));
    expect(response.status).toBe(429);
    expect(vi.mocked(mintVideoUpload)).not.toHaveBeenCalled();
  });

  it('rethrows an unexpected mint failure', async () => {
    vi.mocked(mintVideoUpload).mockRejectedValueOnce(new Error('db down'));
    await expect(POST(jsonRequest({ contentType: 'video/mp4', sizeBytes: 1 }))).rejects.toThrow('db down');
  });
});
