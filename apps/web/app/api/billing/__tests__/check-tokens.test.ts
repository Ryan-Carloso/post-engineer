import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: vi.fn().mockReturnValue({}),
}));

vi.mock('@/lib/billing/token-check', () => ({
  checkAndDeductTokens: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

 
import { checkAndDeductTokens } from '@/lib/billing/token-check';
import { POST } from '@/app/api/billing/check-tokens/route';
import { logger } from '@/lib/logger';

function makePostRequest(body: unknown, headers?: Record<string, string>): NextRequest {
  return new NextRequest('http://localhost/api/billing/check-tokens', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-engine-secret': 'test-secret',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/billing/check-tokens', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.MONEYPRINT_API_SECRET = 'test-secret';
  });

  it('retorna 500 quando MONEYPRINT_API_SECRET não está configurado', async () => {
    delete process.env.MONEYPRINT_API_SECRET;
    const res = await POST(makePostRequest({ userId: 'u1' }));
    expect(res.status).toBe(500);
  });

  it('logs the missing-secret misconfiguration via logger.error', async () => {
    delete process.env.MONEYPRINT_API_SECRET;
    await POST(makePostRequest({ userId: 'u1' }));
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('engine secret not configured'),
      expect.anything(),
    );
  });

  it('retorna 401 quando secret não confere', async () => {
    const res = await POST(makePostRequest({ userId: 'u1' }, { 'x-engine-secret': 'wrong' }));
    expect(res.status).toBe(401);
  });

  it('retorna 400 quando userId falta', async () => {
    const res = await POST(makePostRequest({}));
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('userId');
  });

  it('retorna 402 quando tokens insuficientes', async () => {
    vi.mocked(checkAndDeductTokens).mockResolvedValue({
      ok: false,
      error: 'Insufficient tokens.',
      statusCode: 402,
      freeExhausted: false,
    });

    const res = await POST(makePostRequest({ userId: 'u1', videoType: 'hook_lipsync', faceQuality: 'ok' }));
    expect(res.status).toBe(402);
  });

  it('retorna 200 com cost quando tokens OK', async () => {
    vi.mocked(checkAndDeductTokens).mockResolvedValue({ ok: true, cost: 2 });

    const res = await POST(makePostRequest({ userId: 'u1', videoType: 'hook_lipsync', faceQuality: 'ok' }));
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; cost: number };
    expect(body.success).toBe(true);
    expect(body.cost).toBe(2);
  });

  it('chama checkAndDeductTokens com parâmetros corretos', async () => {
    vi.mocked(checkAndDeductTokens).mockResolvedValue({ ok: true, cost: 3 });

    await POST(makePostRequest({ userId: 'u1-abc', videoType: 'hook_lipsync', faceQuality: 'very_good' }));

    expect(checkAndDeductTokens).toHaveBeenCalledWith(
      expect.anything(),
      'u1-abc',
      expect.any(String),
      'hook_lipsync',
      'very_good',
    );
  });

  it('forwards videoType faceless when the request is faceless', async () => {
    vi.mocked(checkAndDeductTokens).mockResolvedValue({ ok: true, cost: 1 });

    await POST(makePostRequest({ userId: 'u1', videoType: 'faceless', faceQuality: 'ok' }));

    expect(checkAndDeductTokens).toHaveBeenCalledWith(
      expect.anything(),
      'u1',
      expect.any(String),
      'faceless',
      'ok',
    );
  });

  it('retorna 400 com os modos válidos quando videoType é desconhecido', async () => {
    // An unknown mode is rejected with the modes and their costs, never
    // silently priced as another mode — and no charge is attempted.
    vi.mocked(checkAndDeductTokens).mockResolvedValue({ ok: true, cost: 2 });

    const res = await POST(makePostRequest({ userId: 'u1', videoType: 'sideways' }));

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("unknown video_type 'sideways'");
    expect(body.error).toContain('full_lipsync (8/15)');
    expect(checkAndDeductTokens).not.toHaveBeenCalled();
  });
});
