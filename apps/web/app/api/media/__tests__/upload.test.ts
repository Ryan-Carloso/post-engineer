// @vitest-environment node
//---------------
// Tests for POST /api/media/upload (MCP upload_media).
//
// The route authenticates the caller, validates the real image type and
// the 8MB engine photo limit, then hands the bytes to the engine's
// existing temp_assets flow server-side. It returns only the mediaId:
// the temp asset URL is a capability and never leaves the server.
//---------------

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

vi.mock('@/lib/request-auth', () => ({ requireSupabaseSession: vi.fn() }));
vi.mock('@/lib/rate-limit', () => ({
  applyRateLimit: vi.fn(async () => null),
  RATE_LIMITS: { mediaUpload: {} },
}));
vi.mock('@/lib/generation/video-generation', () => ({ uploadEngineTempAsset: vi.fn() }));
vi.mock('@/lib/posthog-server', () => ({
  getPostHogServer: vi.fn(() => ({ capture: vi.fn(), captureAs: vi.fn() })),
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { POST } from '../upload/route';
import { requireSupabaseSession } from '@/lib/request-auth';
import { uploadEngineTempAsset } from '@/lib/generation/video-generation';

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0]);

function uploadRequest(file: File): Request {
  const form = new FormData();
  form.append('file', file);
  return new Request('https://post-engineer.com/api/media/upload', { method: 'POST', body: form });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireSupabaseSession).mockResolvedValue({
    auth: { userId: 'user-uuid-1', accessToken: 'token' },
    error: null,
  } as never);
  vi.mocked(uploadEngineTempAsset).mockResolvedValue(
    'https://engine.test/api/v1/temp_assets/aabbccddeeff00112233445566778899.png',
  );
});

describe('POST /api/media/upload', () => {
  it('returns only the mediaId derived from the engine temp asset URL', async () => {
    const response = await POST(uploadRequest(new File([PNG_BYTES], 'porto.png', { type: 'image/png' })));
    expect(response.status).toBe(200);
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload.success).toBe(true);
    expect(payload.mediaId).toBe('aabbccddeeff00112233445566778899.png');
    expect(payload.expiresInSeconds).toBe(3600);
    expect(payload).not.toHaveProperty('url');
    expect(JSON.stringify(payload)).not.toContain('temp_assets');
    const call = vi.mocked(uploadEngineTempAsset).mock.calls[0];
    expect(call?.[0]).toBe('user-uuid-1');
    expect(call?.[2]).toBe('png');
  });

  it('rejects a file whose real content is not an image', async () => {
    const response = await POST(
      uploadRequest(new File(['this is not an image at all'], 'porto.png', { type: 'image/png' })),
    );
    expect(response.status).toBe(400);
    expect(vi.mocked(uploadEngineTempAsset)).not.toHaveBeenCalled();
  });

  it('rejects a file over the 8MB engine photo limit', async () => {
    const big = new Uint8Array(8 * 1024 * 1024 + 1);
    big.set(PNG_BYTES);
    const response = await POST(uploadRequest(new File([big], 'big.png', { type: 'image/png' })));
    expect(response.status).toBe(413);
    expect(vi.mocked(uploadEngineTempAsset)).not.toHaveBeenCalled();
  });

  it('maps the detected type to the temp asset extension, not the filename', async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
    await POST(uploadRequest(new File([jpeg], 'porto.png', { type: 'image/png' })));
    expect(vi.mocked(uploadEngineTempAsset).mock.calls[0]?.[2]).toBe('jpg');
  });

  it('returns 502 when the engine temp asset upload fails', async () => {
    vi.mocked(uploadEngineTempAsset).mockResolvedValue(undefined);
    const response = await POST(uploadRequest(new File([PNG_BYTES], 'porto.png', { type: 'image/png' })));
    expect(response.status).toBe(502);
  });

  it('rejects unauthenticated callers before reading the upload', async () => {
    vi.mocked(requireSupabaseSession).mockResolvedValueOnce({
      auth: null,
      error: NextResponse.json({ success: false, error: 'Authentication required.' }, { status: 401 }),
    } as never);
    const response = await POST(uploadRequest(new File([PNG_BYTES], 'porto.png', { type: 'image/png' })));
    expect(response.status).toBe(401);
    expect(vi.mocked(uploadEngineTempAsset)).not.toHaveBeenCalled();
  });
});
