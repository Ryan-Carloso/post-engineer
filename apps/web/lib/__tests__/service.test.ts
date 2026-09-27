import { describe, it, expect, vi, afterEach } from 'vitest';

const mockCreateClient = vi.fn().mockReturnValue({ url: 'mock' });

vi.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}));

describe('supabase/service', () => {
  const origUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const origKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  afterEach(() => {
    if (origUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = origUrl;

    if (origKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = origKey;
  });

  it('throws when NEXT_PUBLIC_SUPABASE_URL is missing', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'key';
    vi.resetModules();
    const { createSupabaseServiceClient } = await import('@/lib/supabase/service');
    expect(() => createSupabaseServiceClient()).toThrow('NEXT_PUBLIC_SUPABASE_URL is not defined');
  });

  it('throws when SUPABASE_SERVICE_ROLE_KEY is missing', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    vi.resetModules();
    const { createSupabaseServiceClient } = await import('@/lib/supabase/service');
    expect(() => createSupabaseServiceClient()).toThrow('SUPABASE_SERVICE_ROLE_KEY is not defined');
  });

  it('creates client with correct options', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    vi.resetModules();
    mockCreateClient.mockClear();
    const { createSupabaseServiceClient } = await import('@/lib/supabase/service');
    createSupabaseServiceClient();

    expect(mockCreateClient).toHaveBeenCalledWith(
      'https://test.supabase.co',
      'test-key',
      expect.objectContaining({ auth: expect.objectContaining({ autoRefreshToken: false, persistSession: false }) })
    );
  });
});
