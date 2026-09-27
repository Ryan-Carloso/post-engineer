import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockCreateServerClient = vi.fn();
const mockCookieGet = vi.fn();
const mockCookieSet = vi.fn();

vi.mock('@supabase/ssr', () => ({
  createServerClient: (...args: unknown[]) => mockCreateServerClient(...args),
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: mockCookieGet,
    set: mockCookieSet,
  }),
}));

describe('supabase/server', () => {
  const origUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const origKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  beforeEach(() => {
    mockCreateServerClient.mockReset();
    mockCreateServerClient.mockReturnValue({ auth: {} });
    mockCookieGet.mockReset();
    mockCookieSet.mockReset();
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
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'key';
    const { createSupabaseServerClient } = await import('@/lib/supabase/server');
    await expect(createSupabaseServerClient()).rejects.toThrow(
      'NEXT_PUBLIC_SUPABASE_URL is not defined',
    );
  });

  it('throws when NEXT_PUBLIC_SUPABASE_ANON_KEY is missing', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const { createSupabaseServerClient } = await import('@/lib/supabase/server');
    await expect(createSupabaseServerClient()).rejects.toThrow(
      'NEXT_PUBLIC_SUPABASE_ANON_KEY is not defined',
    );
  });

  it('creates a server client passing cookies handlers', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'key';
    mockCookieGet.mockReturnValue({ value: 'cookie-value' });

    const { createSupabaseServerClient } = await import('@/lib/supabase/server');
    const client = await createSupabaseServerClient();

    expect(client).toEqual({ auth: {} });

    const callArgs = mockCreateServerClient.mock.calls[0];
    const cookiesConfig = callArgs[2].cookies;

    expect(cookiesConfig.get('sb-token')).toBe('cookie-value');
    expect(mockCookieGet).toHaveBeenCalledWith('sb-token');

    cookiesConfig.set('sb-token', 'v', { maxAge: 60 });
    expect(mockCookieSet).toHaveBeenCalledWith({
      name: 'sb-token',
      value: 'v',
      maxAge: 60,
    });

    cookiesConfig.remove('sb-token', { path: '/' });
    expect(mockCookieSet).toHaveBeenCalledWith({
      name: 'sb-token',
      value: '',
      path: '/',
    });
  });

  it('swallows errors thrown when setting cookies from a Server Component', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'key';
    mockCookieSet.mockImplementation(() => {
      throw new Error('Could not set cookie');
    });

    const { createSupabaseServerClient } = await import('@/lib/supabase/server');
    await createSupabaseServerClient();

    const callArgs = mockCreateServerClient.mock.calls[0];
    const cookiesConfig = callArgs[2].cookies;

    expect(() => {
      cookiesConfig.set('sb-token', 'v', {});
    }).not.toThrow();
    expect(() => {
      cookiesConfig.remove('sb-token', {});
    }).not.toThrow();
  });

  it('returns undefined value when cookie store has no cookie', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'key';
    mockCookieGet.mockReturnValue(undefined);

    const { createSupabaseServerClient } = await import('@/lib/supabase/server');
    await createSupabaseServerClient();

    const callArgs = mockCreateServerClient.mock.calls[0];
    const cookiesConfig = callArgs[2].cookies;
    expect(cookiesConfig.get('missing')).toBeUndefined();
  });
});
