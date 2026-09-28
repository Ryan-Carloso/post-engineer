import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/request-auth', () => ({
  requireSupabaseSession: vi.fn(),
}));

vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { GET } from '@/app/api/health/route';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { requireSupabaseSession } from '@/lib/request-auth';
import { logger } from '@/lib/logger';
import { NextResponse } from 'next/server';

describe('GET /api/health', () => {
  beforeEach(() => {
    vi.mocked(createSupabaseServiceClient).mockReset();
    vi.mocked(requireSupabaseSession).mockReset();
    vi.mocked(requireSupabaseSession).mockResolvedValue({
      auth: { userId: 'user-1', accessToken: 'sb-token' },
      error: null,
    });
  });

  it('retorna 401 sem sessão (API interna: só o app acessa)', async () => {
    vi.mocked(requireSupabaseSession).mockResolvedValue({
      auth: null,
      error: NextResponse.json({ success: false }, { status: 401 }),
    });

    const res = await GET();
    expect(res.status).toBe(401);
    expect(createSupabaseServiceClient).not.toHaveBeenCalled();
  });

  it('returns ok when supabase is reachable', async () => {
    vi.mocked(createSupabaseServiceClient).mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn().mockResolvedValue({ error: null }),
      })),
    } as never);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; uptimeSeconds: number };
    expect(body.status).toBe('ok');
    expect(typeof body.uptimeSeconds).toBe('number');
  });

  it('returns degraded when supabase reports error', async () => {
    vi.mocked(createSupabaseServiceClient).mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn().mockResolvedValue({ error: { message: 'db down' } }),
      })),
    } as never);

    const res = await GET();
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('degraded');
  });

  it('returns 500 when the client throws', async () => {
    vi.mocked(createSupabaseServiceClient).mockImplementation(() => {
      throw new Error('boom');
    });

    const res = await GET();
    expect(res.status).toBe(500);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('error');
  });

  it('logs when the health check throws', async () => {
    vi.mocked(createSupabaseServiceClient).mockImplementation(() => {
      throw new Error('boom');
    });

    await GET();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('health check failed'),
      expect.objectContaining({ message: 'boom' }),
    );
  });
});
