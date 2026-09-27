import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockCreateBrowserClient = vi.fn();

vi.mock('@supabase/ssr', () => ({
  createBrowserClient: (...args: unknown[]) => mockCreateBrowserClient(...args),
}));

describe('supabase/client', () => {
  const origUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const origKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  beforeEach(() => {
    mockCreateBrowserClient.mockReset();
    mockCreateBrowserClient.mockReturnValue({ auth: {} });
  });

  afterEach(() => {
    if (origUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = origUrl;
    if (origKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = origKey;
    vi.resetModules();
  });

  it('throws when NEXT_PUBLIC_SUPABASE_URL is missing', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
    const { createSupabaseClient } = await import('@/lib/supabase/client');
    expect(() => createSupabaseClient()).toThrow('NEXT_PUBLIC_SUPABASE_URL is not defined');
  });

  it('throws when NEXT_PUBLIC_SUPABASE_ANON_KEY is missing', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const { createSupabaseClient } = await import('@/lib/supabase/client');
    expect(() => createSupabaseClient()).toThrow('NEXT_PUBLIC_SUPABASE_ANON_KEY is not defined');
  });

  it('creates a browser client with url and anon key', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
    const { createSupabaseClient } = await import('@/lib/supabase/client');
    const client = createSupabaseClient();
    expect(mockCreateBrowserClient).toHaveBeenCalledWith(
      'https://test.supabase.co',
      'anon',
    );
    expect(client).toEqual({ auth: {} });
  });
});
