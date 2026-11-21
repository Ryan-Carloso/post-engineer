// @vitest-environment node

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
import { UploadMediaResponseSchema } from '@/lib/contracts/media';
import { lyingContentLengthRequest, multipartRequest, withoutContentLength } from '@/test/multipart-request';

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0]);

function uploadRequest(file: File): Promise<Request> {
  const form = new FormData();
  form.append('file', file);
  return multipartRequest('https://post-engineer.com/api/media/upload', form);
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
    const response = await POST(await uploadRequest(new File([PNG_BYTES], 'porto.png', { type: 'image/png' })));
    expect(response.status).toBe(200);
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload.success).toBe(true);
    expect(payload.mediaId).toBe('aabbccddeeff00112233445566778899.png');
    expect(payload.expiresInSeconds).toBe(3600);
    expect(UploadMediaResponseSchema.safeParse(payload).success).toBe(true);
    expect(payload).not.toHaveProperty('url');
    expect(JSON.stringify(payload)).not.toContain('temp_assets');
    const call = vi.mocked(uploadEngineTempAsset).mock.calls[0];
    expect(call?.[0]).toBe('user-uuid-1');
    expect(call?.[2]).toBe('png');
  });

  it('rejects a file whose real content is not an image', async () => {
    const response = await POST(
      await uploadRequest(new File(['this is not an image at all'], 'porto.png', { type: 'image/png' })),
    );
    expect(response.status).toBe(400);
    expect(vi.mocked(uploadEngineTempAsset)).not.toHaveBeenCalled();
  });

  it('rejects a file over the 8MB engine photo limit', async () => {
    const big = new Uint8Array(8 * 1024 * 1024 + 1);
    big.set(PNG_BYTES);
    const response = await POST(await uploadRequest(new File([big], 'big.png', { type: 'image/png' })));
    expect(response.status).toBe(413);
    expect(vi.mocked(uploadEngineTempAsset)).not.toHaveBeenCalled();
  });

  it('maps the detected type to the temp asset extension, not the filename', async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
    await POST(await uploadRequest(new File([jpeg], 'porto.png', { type: 'image/png' })));
    expect(vi.mocked(uploadEngineTempAsset).mock.calls[0]?.[2]).toBe('jpg');
  });

  it('returns 502 when the engine temp asset upload fails', async () => {
    vi.mocked(uploadEngineTempAsset).mockResolvedValue(undefined);
    const response = await POST(await uploadRequest(new File([PNG_BYTES], 'porto.png', { type: 'image/png' })));
    expect(response.status).toBe(502);
  });

  it('rejects unauthenticated callers before reading the upload', async () => {
    vi.mocked(requireSupabaseSession).mockResolvedValueOnce({
      auth: null,
      error: NextResponse.json({ success: false, error: 'Authentication required.' }, { status: 401 }),
    } as never);
    const response = await POST(await uploadRequest(new File([PNG_BYTES], 'porto.png', { type: 'image/png' })));
    expect(response.status).toBe(401);
    expect(vi.mocked(uploadEngineTempAsset)).not.toHaveBeenCalled();
  });
});

describe('body gate', () => {
  const GATE_URL = 'https://post-engineer.com/api/media/upload';
  const OVER_CAP = 9 * 1024 * 1024;

  it('answers 401 for an unauthenticated large body without reading it', async () => {
    vi.mocked(requireSupabaseSession).mockResolvedValueOnce({ auth: null, error: NextResponse.json({ success: false, error: 'Authentication required.' }, { status: 401 }) } as never);
    const formData = vi.spyOn(Request.prototype, 'formData');
    const response = await POST(await withoutContentLength(GATE_URL, { 'content-length': String(OVER_CAP * 10) }));
    expect(response.status).toBe(401);
    expect(formData).not.toHaveBeenCalled();
    formData.mockRestore();
  });

  it('answers 413 before parsing when Content-Length is over the cap', async () => {
    const formData = vi.spyOn(Request.prototype, 'formData');
    const response = await POST(await withoutContentLength(GATE_URL, { 'content-length': String(OVER_CAP + 1) }));
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ success: false, code: 'PAYLOAD_TOO_LARGE' });
    expect(formData).not.toHaveBeenCalled();
    expect(vi.mocked(uploadEngineTempAsset)).not.toHaveBeenCalled();
    formData.mockRestore();
  });

  it('aborts a body larger than its declared Content-Length', async () => {
    const response = await POST(await lyingContentLengthRequest(GATE_URL, OVER_CAP + 1024, 200));
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ success: false, code: 'PAYLOAD_TOO_LARGE' });
    expect(vi.mocked(uploadEngineTempAsset)).not.toHaveBeenCalled();
  });

  it('answers 411 when Content-Length is missing', async () => {
    const response = await POST(await withoutContentLength(GATE_URL));
    expect(response.status).toBe(411);
    expect(await response.json()).toMatchObject({ success: false, code: 'LENGTH_REQUIRED' });
    expect(vi.mocked(uploadEngineTempAsset)).not.toHaveBeenCalled();
  });
});
