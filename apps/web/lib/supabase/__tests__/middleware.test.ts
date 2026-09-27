import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockCreateSupabaseServerClient = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: (...args: unknown[]) =>
    mockCreateSupabaseServerClient(...args),
}));

import { updateSession } from '@/lib/supabase/middleware';

describe('supabase/middleware', () => {
  beforeEach(() => {
    mockCreateSupabaseServerClient.mockReset();
  });

  it('returns response and user when a user is present', async () => {
    const getSession = vi.fn().mockResolvedValue({ data: { session: {} }, error: null });
    mockCreateSupabaseServerClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'u1' } },
          error: null,
        }),
        getSession,
      },
    } as never);

    const request = new NextRequest('http://localhost/some-path', {
      headers: { 'x-test': '1' },
    });
    const result = await updateSession(request);

    expect(result.user).toEqual({ id: 'u1' });
    expect(result.response).toBeDefined();
    expect(getSession).toHaveBeenCalledTimes(1);
  });

  it('returns response with null user when no user is present', async () => {
    mockCreateSupabaseServerClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
        getSession: vi.fn(),
      },
    } as never);

    const request = new NextRequest('http://localhost/some-path');
    const result = await updateSession(request);

    expect(result.user).toBeNull();
    expect(result.response).toBeDefined();
  });
});
