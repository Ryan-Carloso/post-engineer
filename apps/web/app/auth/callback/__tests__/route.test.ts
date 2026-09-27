import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockCreateServerClient = vi.fn();

vi.mock('@supabase/ssr', () => ({
  createServerClient: (...args: unknown[]) => mockCreateServerClient(...args),
}));

import { GET, safeNextPath } from '@/app/auth/callback/route';

function makeRequest(url: string): NextRequest {
  return new NextRequest(url);
}

describe('safeNextPath', () => {
  it('allows safe relative paths', () => {
    expect(safeNextPath('/dashboard')).toBe('/dashboard');
    expect(safeNextPath('/settings/profile')).toBe('/settings/profile');
    expect(safeNextPath('/videos?page=2')).toBe('/videos?page=2');
  });

  it('falls back to / when value is missing or empty', () => {
    expect(safeNextPath(null)).toBe('/');
    expect(safeNextPath(undefined as unknown as string)).toBe('/');
    expect(safeNextPath('')).toBe('/');
  });

  it('rejects protocol-relative URLs starting with //', () => {
    expect(safeNextPath('//evil.com')).toBe('/');
    expect(safeNextPath('//evil.com/phish')).toBe('/');
  });

  it('rejects backslash-based open redirect vectors', () => {
    expect(safeNextPath('/\\evil.com')).toBe('/');
    expect(safeNextPath('/\\evil.com/phish')).toBe('/');
    expect(safeNextPath('/dashboard\\evil.com')).toBe('/');
    expect(safeNextPath('\\evil.com')).toBe('/');
  });

  it('rejects absolute URLs with scheme', () => {
    expect(safeNextPath('https://evil.com')).toBe('/');
    expect(safeNextPath('http://evil.com/login')).toBe('/');
    expect(safeNextPath('javascript:alert(1)')).toBe('/');
  });
});

describe('GET /auth/callback', () => {
  const origUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const origKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
  });

  afterEach(() => {
    if (origUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = origUrl;
    if (origKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = origKey;
  });

  it('redirects to login when no code is present', async () => {
    const res = await GET(makeRequest('http://localhost/auth/callback'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://localhost/login?error=auth');
  });

  it('maps provider access_denied to a cancelled login notice', async () => {
    const res = await GET(
      makeRequest('http://localhost/auth/callback?error=access_denied&error_description=The+user+denied+access'),
    );
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://localhost/login?error=cancelled');
    expect(mockCreateServerClient).not.toHaveBeenCalled();
  });

  it('maps other provider errors to a generic login error', async () => {
    const res = await GET(
      makeRequest('http://localhost/auth/callback?error=server_error'),
    );
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://localhost/login?error=auth');
    expect(mockCreateServerClient).not.toHaveBeenCalled();
  });

  it.each(['localhost', '127.0.0.1', '[::1]'])('passes code through to a %s dev callback URL', async (hostname: string): Promise<void> => {
    const localUrl: string = `http://${hostname}:3434/auth/callback`;
    const requestUrl = `${localUrl}?code=abc123&next=${encodeURIComponent(localUrl)}`;
    const res = await GET(makeRequest(requestUrl));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(`${localUrl}?code=abc123`);
    expect(mockCreateServerClient).not.toHaveBeenCalled();
  });

  it('passes code through correctly even when relay URL already has query parameters', async () => {
    const localUrl = 'http://localhost:3434/auth/callback?param=1';
    const requestUrl = `http://localhost:3434/auth/callback?code=abc123&next=${encodeURIComponent(localUrl)}`;
    const res = await GET(makeRequest(requestUrl));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://localhost:3434/auth/callback?param=1&code=abc123');
    expect(mockCreateServerClient).not.toHaveBeenCalled();
  });

  it('does NOT pass code through for local dev URLs lacking /auth/callback', async () => {
    const next = 'http://localhost:3000/dashboard';
    const requestUrl = `http://localhost/auth/callback?code=abc&next=${encodeURIComponent(next)}`;
    mockCreateServerClient.mockReturnValue({
      auth: {
        exchangeCodeForSession: vi.fn().mockResolvedValue({ error: null }),
      },
    });

    const res = await GET(makeRequest(requestUrl));
    const cookiesCfg = mockCreateServerClient.mock.calls[0][2].cookies;
    cookiesCfg.set('sb-token', 'v', {});
    cookiesCfg.remove('sb-token', {});
    expect(res.status).toBe(307);
    // Absolute URL that is not a code-relay target: open redirect closed.
    expect(res.headers.get('location')).toBe('http://localhost/');
  });

  it('redirects to next and returns response on successful exchange', async () => {
    const next = '/dashboard';
    const requestUrl = `http://localhost/auth/callback?code=abc&next=${encodeURIComponent(next)}`;
    mockCreateServerClient.mockReturnValue({
      auth: {
        exchangeCodeForSession: vi.fn().mockResolvedValue({ error: null }),
      },
    });

    const res = await GET(makeRequest(requestUrl));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://localhost/dashboard');
    expect(mockCreateServerClient).toHaveBeenCalledTimes(1);
  });

  it('redirects to login when exchangeCodeForSession returns an error', async () => {
    const requestUrl =
      'http://localhost/auth/callback?code=abc&next=' + encodeURIComponent('/dashboard');
    mockCreateServerClient.mockReturnValue({
      auth: {
        exchangeCodeForSession: vi
          .fn()
          .mockResolvedValue({ error: { message: 'bad code' } }),
      },
    });

    const res = await GET(makeRequest(requestUrl));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(
      'http://localhost/login?error=auth',
    );
  });
});

describe('GET /auth/callback — Vercel preview relay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
  });

  it('passes code through to a vercel.app preview callback URL', async () => {
    const previewUrl = 'https://post-enginner-git-fix-xyz-ryan-carlosos-projects.vercel.app/auth/callback';
    const requestUrl = `https://post-engineer.com/auth/callback?code=abc123&next=${encodeURIComponent(previewUrl)}`;
    const res = await GET(makeRequest(requestUrl));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(`${previewUrl}?code=abc123`);
    expect(mockCreateServerClient).not.toHaveBeenCalled();
  });

  it('does NOT relay to a vercel.app URL with a different path', async () => {
    const target = 'https://post-enginner-git-fix-xyz-ryan-carlosos-projects.vercel.app/dashboard';
    const requestUrl = `https://post-engineer.com/auth/callback?code=abc&next=${encodeURIComponent(target)}`;
    mockCreateServerClient.mockReturnValue({
      auth: {
        exchangeCodeForSession: vi.fn().mockResolvedValue({ error: null }),
      },
    });

    const res = await GET(makeRequest(requestUrl));
    // Not a code-relay target AND not a safe relative path: falls back to '/'.
    expect(res.headers.get('location')).toBe('https://post-engineer.com/');
    expect(mockCreateServerClient).toHaveBeenCalledTimes(1);
  });

  it('does NOT relay to a non-vercel https host', async () => {
    const target = 'https://evil.example.com/auth/callback';
    const requestUrl = `https://post-engineer.com/auth/callback?code=abc&next=${encodeURIComponent(target)}`;
    mockCreateServerClient.mockReturnValue({
      auth: {
        exchangeCodeForSession: vi.fn().mockResolvedValue({ error: null }),
      },
    });

    const res = await GET(makeRequest(requestUrl));
    // Open redirect closed: absolute external URLs fall back to '/'.
    expect(res.headers.get('location')).toBe('https://post-engineer.com/');
    expect(mockCreateServerClient).toHaveBeenCalledTimes(1);
  });

  it('does NOT relay to a third-party vercel.app host', async () => {
    const target = 'https://attacker-app.vercel.app/auth/callback';
    const requestUrl = `https://post-engineer.com/auth/callback?code=***&next=${encodeURIComponent(target)}`;
    mockCreateServerClient.mockReturnValue({
      auth: {
        exchangeCodeForSession: vi.fn().mockResolvedValue({ error: null }),
      },
    });

    const res = await GET(makeRequest(requestUrl));
    expect(res.headers.get('location')).toBe('https://post-engineer.com/');
    expect(mockCreateServerClient).toHaveBeenCalledTimes(1);
  });

  it('does NOT relay to a lookalike vercel domain', async () => {
    const target = 'https://vercel.app.evil.com/auth/callback';
    const requestUrl = `https://post-engineer.com/auth/callback?code=abc&next=${encodeURIComponent(target)}`;
    mockCreateServerClient.mockReturnValue({
      auth: {
        exchangeCodeForSession: vi.fn().mockResolvedValue({ error: null }),
      },
    });

    const res = await GET(makeRequest(requestUrl));
    expect(res.headers.get('location')).toBe('https://post-engineer.com/');
    expect(mockCreateServerClient).toHaveBeenCalledTimes(1);
  });
});

describe('GET /auth/callback — next redirect validation (open redirect)', () => {
  const origUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const origKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
  });

  afterEach(() => {
    if (origUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = origUrl;
    if (origKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = origKey;
  });

  function exchangeSucceeds(): void {
    mockCreateServerClient.mockReturnValue({
      auth: {
        exchangeCodeForSession: vi.fn().mockResolvedValue({ error: null }),
      },
    });
  }

  it('redirects to a safe relative next path', async () => {
    exchangeSucceeds();
    const res = await GET(
      makeRequest('http://localhost/auth/callback?code=abc&next=/dashboard'),
    );
    expect(res.headers.get('location')).toBe('http://localhost/dashboard');
  });

  it('does NOT redirect to an absolute external URL', async () => {
    exchangeSucceeds();
    const res = await GET(
      makeRequest(
        `http://localhost/auth/callback?code=abc&next=${encodeURIComponent('https://evil.example/phish')}`,
      ),
    );
    expect(res.headers.get('location')).toBe('http://localhost/');
  });

  it('does NOT redirect to a protocol-relative URL', async () => {
    exchangeSucceeds();
    const res = await GET(
      makeRequest(
        `http://localhost/auth/callback?code=abc&next=${encodeURIComponent('//evil.example/phish')}`,
      ),
    );
    const location = res.headers.get('location') ?? '';
    expect(location).not.toContain('evil.example');
  });

  it('does NOT redirect to a backslash-based URL', async () => {
    exchangeSucceeds();
    const res = await GET(
      makeRequest(
        `http://localhost/auth/callback?code=abc&next=${encodeURIComponent('/\\evil.example/phish')}`,
      ),
    );
    const location = res.headers.get('location') ?? '';
    expect(location).not.toContain('evil.example');
    expect(location).toBe('http://localhost/');
  });

  it('does NOT redirect to a javascript: URL', async () => {
    exchangeSucceeds();
    const res = await GET(
      makeRequest(
        `http://localhost/auth/callback?code=abc&next=${encodeURIComponent('javascript:alert(1)')}`,
      ),
    );
    const location = res.headers.get('location') ?? '';
    expect(location).not.toContain('javascript:');
  });

  it('still relays the code to a validated localhost code-relay target', async () => {
    const localUrl = 'http://localhost:3434/auth/callback';
    const res = await GET(
      makeRequest(`${localUrl}?code=abc123&next=${encodeURIComponent(localUrl)}`),
    );
    expect(res.headers.get('location')).toBe(`${localUrl}?code=abc123`);
    expect(mockCreateServerClient).not.toHaveBeenCalled();
  });
});
