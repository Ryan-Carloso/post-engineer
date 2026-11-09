// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/rate-limit', () => ({ applyRateLimit: vi.fn(async () => null), RATE_LIMITS: { pinterestBoards: {} } }));
vi.mock('@/lib/api-error-reporting', () => ({ withApiErrorReporting: (_route: string, handler: unknown) => handler, resolveReportingUserId: vi.fn() }));
vi.mock('@/lib/request-auth', () => ({ requireSupabaseSession: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ createSupabaseServiceClient: vi.fn(() => ({ __mock: 'service' })) }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/pinterest-tokens', () => ({ getValidPinterestAccessToken: vi.fn(async () => 'at-1') }));
vi.mock('@/lib/pinterest', () => ({ fetchPinterestBoards: vi.fn() }));

import { GET } from '@/app/api/pinterest/boards/route';
import { requireSupabaseSession } from '@/lib/request-auth';
import { getValidPinterestAccessToken } from '@/lib/pinterest-tokens';
import { fetchPinterestBoards } from '@/lib/pinterest';
import { PinterestError } from '@/lib/errors';

const BOARDS = 'https://app.example/api/pinterest/boards';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireSupabaseSession).mockResolvedValue({ auth: { userId: 'user-1' }, error: null } as never);
  vi.mocked(fetchPinterestBoards).mockResolvedValue([
    { id: 'b1', name: 'Board One', description: null },
    { id: 'b2', name: 'Board Two', description: 'd' },
  ]);
});

describe('GET /api/pinterest/boards', () => {
  it('lists the boards of the account with a refreshed token', async () => {
    const res = await GET(new NextRequest(`${BOARDS}?accountId=user-9`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; boards: unknown[] };
    expect(body).toEqual({
      success: true,
      boards: [
        { id: 'b1', name: 'Board One', description: null },
        { id: 'b2', name: 'Board Two', description: 'd' },
      ],
    });
    expect(getValidPinterestAccessToken).toHaveBeenCalledWith(expect.anything(), 'user-1', 'user-9');
    expect(fetchPinterestBoards).toHaveBeenCalledWith('at-1');
  });

  it('returns 400 without an accountId', async () => {
    const res = await GET(new NextRequest(BOARDS));
    expect(res.status).toBe(400);
    expect(fetchPinterestBoards).not.toHaveBeenCalled();
  });

  it('returns the session error when unauthenticated', async () => {
    const authError = NextResponse.json({ success: false, error: 'Authentication required.' }, { status: 401 });
    vi.mocked(requireSupabaseSession).mockResolvedValue({ auth: null, error: authError } as never);
    const res = await GET(new NextRequest(`${BOARDS}?accountId=user-9`));
    expect(res.status).toBe(401);
    expect(fetchPinterestBoards).not.toHaveBeenCalled();
  });

  it('returns 401 when Pinterest rejects the token', async () => {
    vi.mocked(fetchPinterestBoards).mockRejectedValue(new PinterestError('PINTEREST_BOARDS_FAILED: unauthorized', 401));
    const res = await GET(new NextRequest(`${BOARDS}?accountId=user-9`));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Failed to list Pinterest boards.');
  });

  it('returns 502 when Pinterest fails for another reason', async () => {
    vi.mocked(fetchPinterestBoards).mockRejectedValue(new PinterestError('PINTEREST_BOARDS_FAILED: boom', 500));
    const res = await GET(new NextRequest(`${BOARDS}?accountId=user-9`));
    expect(res.status).toBe(502);
  });
});
