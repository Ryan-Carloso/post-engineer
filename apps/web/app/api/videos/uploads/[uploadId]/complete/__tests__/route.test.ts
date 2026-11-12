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
    completeVideoUpload: vi.fn(async (_store: unknown, _storage: unknown, _user: string, uploadId: string) => {
      if (uploadId === 'missing') throw new VideoUploadError('Video upload not found.', 404, 'VIDEO_UPLOAD_NOT_FOUND');
      if (uploadId === 'expired') throw new VideoUploadError('This video upload has expired. Mint a new one.', 410, 'VIDEO_UPLOAD_EXPIRED');
      return { uploadId, status: 'ready' as const, contentType: 'video/mp4' as const, sizeBytes: 42 };
    }),
    createSupabaseVideoUploadStore: vi.fn(() => ({})),
    createSupabaseVideoUploadStorage: vi.fn(() => ({})),
  };
});

import { POST } from '../route';
import { requireSupabaseSession } from '@/lib/request-auth';
import { completeVideoUpload } from '@/lib/videos/signed-upload';

function completeRequest(): Request {
  return new Request('https://post-engineer.com/api/videos/uploads/x/complete', { method: 'POST' });
}

function ctx(uploadId: string): { params: Promise<{ uploadId: string }> } {
  return { params: Promise.resolve({ uploadId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireSupabaseSession).mockResolvedValue({
    auth: { userId: 'user-uuid-1', accessToken: 'token' },
    error: null,
  } as never);
});

describe('POST /api/videos/uploads/[uploadId]/complete', () => {
  it('returns the verified ready upload for its owner', async () => {
    const response = await POST(completeRequest(), ctx('upload-1'));
    expect(response.status).toBe(200);
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload).toMatchObject({ success: true, uploadId: 'upload-1', status: 'ready', contentType: 'video/mp4' });
    expect(vi.mocked(completeVideoUpload).mock.calls[0]?.[2]).toBe('user-uuid-1');
  });

  it('maps unknown uploads to 404 and expired uploads to 410', async () => {
    expect((await POST(completeRequest(), ctx('missing'))).status).toBe(404);
    const expired = await POST(completeRequest(), ctx('expired'));
    expect(expired.status).toBe(410);
    expect(((await expired.json()) as Record<string, unknown>).code).toBe('VIDEO_UPLOAD_EXPIRED');
  });

  it('rejects unauthenticated callers', async () => {
    vi.mocked(requireSupabaseSession).mockResolvedValueOnce({
      auth: null,
      error: NextResponse.json({ success: false, error: 'Authentication required.' }, { status: 401 }),
    } as never);
    const response = await POST(completeRequest(), ctx('upload-1'));
    expect(response.status).toBe(401);
    expect(vi.mocked(completeVideoUpload)).not.toHaveBeenCalled();
  });
});
