import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/request-auth', () => ({
  requireSupabaseSession: vi.fn(),
}));

import { GET } from '@/app/api/moneyprint/health/route';
import { requireSupabaseSession } from '@/lib/request-auth';
import { NextResponse } from 'next/server';

//---------------
// GET /api/moneyprint/health — diagnóstico do proxy até o motor.
// API interna: exige sessão Supabase.
//---------------

const fetchMock = vi.fn<typeof fetch>();

describe('GET /api/moneyprint/health', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('MONEYPRINT_API_URL', 'http://moneyprint.internal:8080');
    vi.mocked(requireSupabaseSession).mockResolvedValue({
      auth: { userId: 'user-1', accessToken: 'sb-token' },
      error: null,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('retorna 401 sem sessão', async () => {
    vi.mocked(requireSupabaseSession).mockResolvedValue({
      auth: null,
      error: NextResponse.json({ success: false }, { status: 401 }),
    });

    const res = await GET();
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('retorna ok quando o motor responde', async () => {
    fetchMock.mockResolvedValue(new Response('ok', { status: 200 }));

    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('ok');
  });

  it('retorna 500 sem MONEYPRINT_API_URL', async () => {
    vi.stubEnv('MONEYPRINT_API_URL', '');

    const res = await GET();
    expect(res.status).toBe(500);
  });

  it('retorna 502 quando o motor está inacessível', async () => {
    fetchMock.mockRejectedValue(new Error('refused'));

    const res = await GET();
    expect(res.status).toBe(502);
  });
});
