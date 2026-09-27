import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const { mockRequireSupabaseSession, mockApplyRateLimit, mockHandleYoutubeUpload, mockHandleInstagramUpload, mockBuildUploadErrorResponse } = vi.hoisted(() => {
  return {
    mockRequireSupabaseSession: vi.fn(),
    mockApplyRateLimit: vi.fn(),
    mockHandleYoutubeUpload: vi.fn(),
    mockHandleInstagramUpload: vi.fn(),
    mockBuildUploadErrorResponse: vi.fn(),
  };
});

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

vi.mock('@/lib/upload/handlers', () => ({
  handleYoutubeUpload: (...args: unknown[]) => mockHandleYoutubeUpload(...args),
  handleInstagramUpload: (...args: unknown[]) => mockHandleInstagramUpload(...args),
  buildUploadErrorResponse: (...args: unknown[]) => mockBuildUploadErrorResponse(...args),
}));

import { POST } from '@/app/api/upload-content/route';

const USER_ID = 'user-1';
const API_SECRET = 'engine-shared-secret';

function makeRequest(opts?: {
  provider?: string | null;
  authorization?: string;
  userId?: string;
}): NextRequest {
  const form = new FormData();
  if (opts?.provider !== null) form.append('provider', opts?.provider ?? 'youtube');
  if (opts?.provider === 'instagram') form.append('caption', 'hello');
  if (opts?.userId) form.append('userId', opts.userId);
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
  });

  it('retorna 401 sem sessão', async () => {
    mockRequireSupabaseSession.mockResolvedValue({
      auth: null,
      error: NextResponse.json({ success: false }, { status: 401 }),
    });

    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
    expect(mockHandleYoutubeUpload).not.toHaveBeenCalled();
  });

  it('usa a sessão do usuário e repassa o userId ao handler', async () => {
    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(mockHandleYoutubeUpload).toHaveBeenCalledTimes(1);
    const [, userId] = mockHandleYoutubeUpload.mock.calls[0] as unknown[];
    expect(userId).toBe(USER_ID);
  });

  it('aceita o segredo compartilhado (publish-back do engine) com userId no form', async () => {
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

  it('retorna 401 com segredo válido mas sem userId no form', async () => {
    mockRequireSupabaseSession.mockResolvedValue({
      auth: null,
      error: NextResponse.json({ success: false }, { status: 401 }),
    });

    const res = await POST(makeRequest({ authorization: `Bearer ${API_SECRET}` }));

    expect(res.status).toBe(401);
    expect(mockHandleYoutubeUpload).not.toHaveBeenCalled();
  });

  it('rejeita bearer que não é o segredo compartilhado', async () => {
    mockRequireSupabaseSession.mockResolvedValue({
      auth: null,
      error: NextResponse.json({ success: false }, { status: 401 }),
    });

    const res = await POST(makeRequest({ authorization: 'Bearer post-engineer_some-key' }));

    expect(res.status).toBe(401);
    expect(mockHandleYoutubeUpload).not.toHaveBeenCalled();
  });

  it('bearer de comprimento diferente do segredo não lança (comparação timing-safe)', async () => {
    mockRequireSupabaseSession.mockResolvedValue({
      auth: null,
      error: NextResponse.json({ success: false }, { status: 401 }),
    });

    const res = await POST(makeRequest({ authorization: 'Bearer x', userId: 'engine-owner' }));

    expect(res.status).toBe(401);
    expect(mockHandleYoutubeUpload).not.toHaveBeenCalled();
  });

  it('retorna 400 quando provider está ausente', async () => {
    const req = makeRequest({ provider: null });
    mockBuildUploadErrorResponse.mockReturnValue(
      NextResponse.json({ success: false, error: 'bad provider' }, { status: 400 }),
    );

    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(mockBuildUploadErrorResponse).toHaveBeenCalled();
  });

  it('rejeita provider desconhecido listando os providers suportados (sem hardcode)', async () => {
    const req = makeRequest({ provider: 'tiktok' });
    mockBuildUploadErrorResponse.mockReturnValue(
      NextResponse.json({ success: false, error: 'bad provider' }, { status: 400 }),
    );

    const res = await POST(req);

    expect(res.status).toBe(400);
    expect(mockBuildUploadErrorResponse).toHaveBeenCalled();
    const err = mockBuildUploadErrorResponse.mock.calls[0][0] as Error;
    expect(err.message).toBe('Invalid provider. Use one of: youtube, instagram, bluesky, linkedin');
  });

  it('aplica rate limit por usuário', async () => {
    const limited = NextResponse.json({ success: false }, { status: 429 });
    mockApplyRateLimit.mockResolvedValue(limited);

    const res = await POST(makeRequest());
    expect(res.status).toBe(429);
    expect(mockHandleYoutubeUpload).not.toHaveBeenCalled();
    const [, , identity] = mockApplyRateLimit.mock.calls[0] as unknown[];
    expect(identity).toBe(USER_ID);
  });

  it('trata upload instagram', async () => {
    const res = await POST(makeRequest({ provider: 'instagram' }));

    expect(mockHandleInstagramUpload).toHaveBeenCalledTimes(1);
    expect(mockHandleYoutubeUpload).not.toHaveBeenCalled();
    const body = (await res.json()) as { success: boolean; provider: string };
    expect(body).toEqual({ success: true, provider: 'instagram', results: [] });
  });

  it('responde com erro tratado quando o handler lança', async () => {
    mockHandleYoutubeUpload.mockRejectedValue(new Error('boom'));
    mockBuildUploadErrorResponse.mockReturnValue(
      NextResponse.json({ success: false, error: 'boom' }, { status: 500 }),
    );

    const res = await POST(makeRequest());
    expect(res.status).toBe(500);
    expect(mockBuildUploadErrorResponse).toHaveBeenCalled();
  });
});
