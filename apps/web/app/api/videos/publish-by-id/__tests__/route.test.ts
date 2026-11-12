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
vi.mock('@/lib/upload/handlers', () => ({
  buildUploadErrorResponse: vi.fn(
    (error: unknown) =>
      NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'failed' }, { status: 500 }),
  ),
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
    createSupabaseVideoUploadStore: vi.fn(() => ({})),
    createSupabaseVideoUploadStorage: vi.fn(() => ({})),
  };
});
vi.mock('@/lib/videos/publish-uploaded', async () => {
  const { ValidationError } = await import('@/lib/errors');
  const { VideoUploadError } = await import('@/lib/videos/signed-upload');
  return {
    parsePublishBody: vi.fn((body: { uploadId?: string; provider?: string; accountIds?: string[]; caption?: string }) => {
      if (body.uploadId === 'bad-id') throw new ValidationError('uploadId must be the id returned by the signed-upload mint step.', 'uploadId');
      if (body.caption === undefined && body.provider === 'instagram') throw new ValidationError('Caption is required', 'caption');
      return { uploadId: body.uploadId, provider: body.provider, accountIds: body.accountIds, caption: body.caption };
    }),
    publishUploadedVideo: vi.fn(async (_s: unknown, _st: unknown, _u: string, input: { uploadId: string }) => {
      if (input.uploadId === '99999999-9999-4999-8999-999999999999') {
        throw new VideoUploadError('This video upload was already used to publish.', 409, 'VIDEO_UPLOAD_CONSUMED');
      }
      return {
        success: true as const,
        provider: 'instagram' as const,
        results: [{ accountId: 'ig-1', success: true, postId: 'p1' }],
        logId: 'log-1',
      };
    }),
  };
});

import { POST } from '../route';
import { requireSupabaseSession } from '@/lib/request-auth';
import { publishUploadedVideo } from '@/lib/videos/publish-uploaded';

const UPLOAD_ID = '11111111-1111-4111-8111-111111111111';

function jsonRequest(body: unknown): Request {
  return new Request('https://post-engineer.com/api/videos/publish-by-id', {
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

describe('POST /api/videos/publish-by-id', () => {
  it('publishes the claimed upload and returns per-account results', async () => {
    const response = await POST(
      jsonRequest({ uploadId: UPLOAD_ID, provider: 'instagram', accountIds: ['ig-1'], caption: 'hi' }),
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload.success).toBe(true);
    expect(payload.successCount).toBe(1);
    expect(vi.mocked(publishUploadedVideo).mock.calls[0]?.[2]).toBe('user-uuid-1');
  });

  it('maps a consumed upload to 409', async () => {
    const response = await POST(
      jsonRequest({
        uploadId: '99999999-9999-4999-8999-999999999999',
        provider: 'instagram',
        accountIds: ['ig-1'],
        caption: 'hi',
      }),
    );
    expect(response.status).toBe(409);
    expect(((await response.json()) as Record<string, unknown>).code).toBe('VIDEO_UPLOAD_CONSUMED');
  });

  it('rejects a malformed publish body with 400 before publishing', async () => {
    const response = await POST(jsonRequest({ uploadId: UPLOAD_ID, provider: 'instagram', accountIds: ['ig-1'] }));
    expect(response.status).toBe(400);
    expect(vi.mocked(publishUploadedVideo)).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated callers', async () => {
    vi.mocked(requireSupabaseSession).mockResolvedValueOnce({
      auth: null,
      error: NextResponse.json({ success: false, error: 'Authentication required.' }, { status: 401 }),
    } as never);
    const response = await POST(
      jsonRequest({ uploadId: UPLOAD_ID, provider: 'instagram', accountIds: ['ig-1'], caption: 'hi' }),
    );
    expect(response.status).toBe(401);
  });
});
