import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: vi.fn(),
}));

vi.mock('@/lib/request-auth', () => ({
  requireSupabaseSession: vi.fn(),
}));

import { GET } from '../list/route';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServiceClient } from '@/lib/supabase/service';

describe('GET /api/persona/list — explicit user_id filter (defense in depth)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://supabase.local');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
    vi.mocked(requireSupabaseSession).mockResolvedValue({
      auth: { userId: 'user-1', accessToken: 'token' },
      error: null,
    });
  });

  it('filtra explicitamente por user_id além da RLS', async () => {
    const mockOrder = vi.fn().mockResolvedValue({ data: [], error: null });
    const mockEq = vi.fn().mockReturnValue({ order: mockOrder });
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
    const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });

    const serviceClient = {
      from: mockFrom,
      storage: { from: vi.fn().mockReturnValue({ createSignedUrl: vi.fn().mockResolvedValue({ data: { signedUrl: null } }) }) },
    };
    vi.mocked(createSupabaseServiceClient).mockReturnValue(serviceClient as never);

    await GET(new Request('http://localhost:3434/api/persona/list'));

    // Verifica que .eq('user_id', user.id) foi chamado
    expect(mockSelect).toHaveBeenCalled();
    expect(mockEq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(mockOrder).toHaveBeenCalledWith('created_at', { ascending: false });
  });
});
