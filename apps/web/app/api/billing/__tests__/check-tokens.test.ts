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
    const res = await POST(makePostRequest({ faceless: true }));
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

    const res = await POST(makePostRequest({ userId: 'u1', faceless: false, faceQuality: 'ok' }));
    expect(res.status).toBe(402);
  });

  it('retorna 200 com cost quando tokens OK', async () => {
    vi.mocked(checkAndDeductTokens).mockResolvedValue({ ok: true, cost: 2 });

    const res = await POST(makePostRequest({ userId: 'u1', faceless: false, faceQuality: 'ok' }));
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; cost: number };
    expect(body.success).toBe(true);
    expect(body.cost).toBe(2);
  });

  it('chama checkAndDeductTokens com parâmetros corretos', async () => {
    vi.mocked(checkAndDeductTokens).mockResolvedValue({ ok: true, cost: 3 });

    await POST(makePostRequest({ userId: 'u1-abc', faceless: false, faceQuality: 'very_good' }));

    expect(checkAndDeductTokens).toHaveBeenCalledWith(
      expect.anything(),
      'u1-abc',
      expect.any(String),
      false,
      'very_good',
    );
  });

  it('encaminha faceless: true quando o pedido é sem rosto', async () => {
    vi.mocked(checkAndDeductTokens).mockResolvedValue({ ok: true, cost: 1 });

    await POST(makePostRequest({ userId: 'u1', faceless: true, faceQuality: 'ok' }));

    expect(checkAndDeductTokens).toHaveBeenCalledWith(
      expect.anything(),
      'u1',
      expect.any(String),
      true,
      'ok',
    );
  });

  it('trata qualquer valor não-true de faceless como "com rosto" (nunca cobra menos)', async () => {
    // Only the literal true means faceless: a malformed value must fall back
    // to the pricier faced case, never silently under-charge a generation.
    vi.mocked(checkAndDeductTokens).mockResolvedValue({ ok: true, cost: 2 });

    await POST(makePostRequest({ userId: 'u1', faceless: 'yes' } as Record<string, unknown>));

    expect(checkAndDeductTokens).toHaveBeenCalledWith(
      expect.anything(),
      'u1',
      expect.any(String),
      false,
      'ok',
    );
  });
});
