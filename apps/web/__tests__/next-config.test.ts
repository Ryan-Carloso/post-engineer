import { describe, expect, it } from 'vitest';
import nextConfig from '../next.config';

const headersFor = async (env: Record<string, string | undefined>): Promise<Array<{ key: string; value: string }>> => {
  const saved: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    saved[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    const { headers: loadHeaders } = nextConfig;
    if (loadHeaders === undefined) throw new Error('next.config has no headers()');
    const headerGroups = await loadHeaders();
    return headerGroups[0]?.headers ?? [];
  } finally {
    for (const key of Object.keys(env)) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  }
};

describe('next.config headers', () => {
  it('keeps script-src strict in production', async () => {
    const headers = await headersFor({ NODE_ENV: 'production', CYPRESS_COVERAGE: undefined });
    const csp = headers.find((h) => h.key === 'Content-Security-Policy')?.value ?? '';
    expect(csp).toContain("script-src 'self' 'unsafe-inline';");
    expect(csp).not.toContain('unsafe-eval');
    expect(headers).toContainEqual({ key: 'X-Frame-Options', value: 'DENY' });
  });

  it('allows unsafe-eval only in dev and in the coverage-instrumented build', async () => {
    for (const env of [
      { NODE_ENV: 'development' as const, CYPRESS_COVERAGE: undefined },
      { NODE_ENV: 'production' as const, CYPRESS_COVERAGE: '1' },
    ]) {
      const headers = await headersFor({ ...env });
      const csp = headers.find((h) => h.key === 'Content-Security-Policy')?.value ?? '';
      expect(csp).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval'");
    }
  });
});

describe('next.config redirects', () => {
  it('permanently redirects the old /api-keys page to the prompts hub', async () => {
    const { redirects: loadRedirects } = nextConfig;
    if (loadRedirects === undefined) throw new Error('next.config has no redirects()');
    const redirects = await loadRedirects();
    expect(redirects).toEqual([
      { source: '/api-keys', destination: '/recipes', permanent: true },
    ]);
  });
});

describe('next.config images', () => {
  it('allows every host the providers serve account avatars from', () => {
    const hosts = (nextConfig.images?.remotePatterns ?? []).map((pattern) =>
      pattern instanceof URL ? pattern.hostname : pattern.hostname,
    );
    for (const host of [
      'yt3.ggpht.com',
      'yt3.googleusercontent.com',
      '**.cdninstagram.com',
      '**.fbcdn.net',
      'cdn.bsky.app',
      'media.licdn.com',
    ]) {
      expect(hosts).toContain(host);
    }
  });
});
