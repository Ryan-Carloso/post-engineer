import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: vi.fn().mockReturnValue({}),
}));

vi.mock('@/lib/billing/token-check', () => ({
  checkAndDeductTokens: vi.fn(),
}));

 
import { checkAndDeductTokens } from '@/lib/billing/token-check';
import { POST } from '@/app/api/billing/check-tokens/route';

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

  it('retorna 401 quando secret não confere', async () => {
    const res = await POST(makePostRequest({ userId: 'u1' }, { 'x-engine-secret': 'wrong' }));
    expect(res.status).toBe(401);
  });

  it('retorna 400 quando userId falta', async () => {
    const res = await POST(makePostRequest({ faceMixPercent: 50 }));
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

    const res = await POST(makePostRequest({ userId: 'u1', faceMixPercent: 50, faceQuality: 'ok' }));
    expect(res.status).toBe(402);
  });

  it('retorna 200 com cost quando tokens OK', async () => {
    vi.mocked(checkAndDeductTokens).mockResolvedValue({ ok: true, cost: 1.5 });

    const res = await POST(makePostRequest({ userId: 'u1', faceMixPercent: 50, faceQuality: 'ok' }));
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; cost: number };
    expect(body.success).toBe(true);
    expect(body.cost).toBe(1.5);
  });

  it('chama checkAndDeductTokens com parâmetros corretos', async () => {
    vi.mocked(checkAndDeductTokens).mockResolvedValue({ ok: true, cost: 2 });

    await POST(makePostRequest({ userId: 'u1-abc', faceMixPercent: 75, faceQuality: 'very_good' }));

    expect(checkAndDeductTokens).toHaveBeenCalledWith(
      expect.anything(),
      'u1-abc',
      expect.any(String),
      75,
      'very_good',
    );
  });

  it('usa faceMixPercent=0 e quality=ok como default', async () => {
    vi.mocked(checkAndDeductTokens).mockResolvedValue({ ok: true, cost: 0.5 });

    await POST(makePostRequest({ userId: 'u1' }));

    expect(checkAndDeductTokens).toHaveBeenCalledWith(
      expect.anything(),
      'u1',
      expect.any(String),
      0,
      'ok',
    );
  });
});
