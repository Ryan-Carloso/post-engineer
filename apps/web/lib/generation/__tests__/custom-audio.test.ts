// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lookup } from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import { checkCustomAudioUrl, isHttpUrl } from '../custom-audio';
import { logger } from '@/lib/logger';

vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// lookup() is overloaded; the source calls it with { all: true }, which
// resolves LookupAddress[]. Re-type the mock to that overload so
// mockResolvedValue accepts address arrays.
const mockLookup = vi.mocked(
  lookup as unknown as (hostname: string, options: { all: true }) => Promise<LookupAddress[]>,
);
const warn = vi.mocked(logger.warn);

function headResponse(status: number, headers: Record<string, string> = {}): Response {
  return new Response(null, { status, headers });
}

function stubHead(responses: Array<Response | Error>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let index = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const next = responses[Math.min(index, responses.length - 1)];
      index += 1;
      if (next instanceof Error) throw next;
      return next;
    }),
  );
  return calls;
}

function audioHead(contentLength = '1234', contentType = 'audio/mpeg'): Response {
  return headResponse(200, { 'content-type': contentType, 'content-length': contentLength });
}

describe('isHttpUrl', () => {
  it('accepts http and https URLs', () => {
    expect(isHttpUrl('http://example.com/a.mp3')).toBe(true);
    expect(isHttpUrl('https://example.com/a.mp3')).toBe(true);
  });

  it('rejects other schemes and unparseable input', () => {
    expect(isHttpUrl('ftp://example.com/a.mp3')).toBe(false);
    expect(isHttpUrl('not a url')).toBe(false);
    expect(isHttpUrl('')).toBe(false);
  });
});

describe('checkCustomAudioUrl — happy path', () => {
  beforeEach(() => {
    mockLookup.mockReset();
    warn.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('accepts a public literal IP with a valid audio HEAD', async () => {
    const calls = stubHead([audioHead()]);
    const result = await checkCustomAudioUrl('http://93.184.216.34/audio.mp3');
    expect(result).toEqual({ ok: true });
    expect(mockLookup).not.toHaveBeenCalled();
    expect(calls[0].init.method).toBe('HEAD');
    expect(calls[0].init.redirect).toBe('manual');
  });

  it('resolves a hostname and accepts it when every address is public', async () => {
    mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    stubHead([audioHead()]);
    const result = await checkCustomAudioUrl('https://audio.example.com/a.mp3?token=abc');
    expect(result).toEqual({ ok: true });
    expect(mockLookup).toHaveBeenCalledWith('audio.example.com', { all: true });
  });

  it('tolerates parameters on the content-type header', async () => {
    stubHead([audioHead('1234', 'audio/mpeg; charset=binary')]);
    const result = await checkCustomAudioUrl('http://93.184.216.34/a.mp3');
    expect(result).toEqual({ ok: true });
  });

  it('rejects a hostname that fails DNS resolution', async () => {
    mockLookup.mockRejectedValue(new Error('ENOTFOUND'));
    stubHead([audioHead()]);
    const result = await checkCustomAudioUrl('https://nope.invalid/a.mp3');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('could not be resolved');
  });

  it('rejects a hostname with no resolved addresses', async () => {
    mockLookup.mockResolvedValue([]);
    stubHead([audioHead()]);
    const result = await checkCustomAudioUrl('https://empty.invalid/a.mp3');
    expect(result.ok).toBe(false);
  });

  it('rejects when any resolved address is private', async () => {
    mockLookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '10.1.2.3', family: 4 },
    ]);
    const calls = stubHead([audioHead()]);
    const result = await checkCustomAudioUrl('https://mixed.example.com/a.mp3');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('public address');
    expect(calls).toHaveLength(0);
  });

  it('rejects an unparseable URL before any network call', async () => {
    const calls = stubHead([audioHead()]);
    const result = await checkCustomAudioUrl('not a url');
    expect(result).toEqual({ ok: false, error: 'audio_url must be a valid http(s) URL.' });
    expect(calls).toHaveLength(0);
  });
});

describe('checkCustomAudioUrl — private IPv4 ranges', () => {
  beforeEach(() => {
    mockLookup.mockReset();
    warn.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ['http://0.0.0.0/a.mp3', 'this network'],
    ['http://127.0.0.1/a.mp3', 'loopback'],
    ['http://10.1.2.3/a.mp3', '10/8'],
    ['http://172.16.0.1/a.mp3', '172.16/12 low edge'],
    ['http://172.31.255.255/a.mp3', '172.16/12 high edge'],
    ['http://192.168.1.1/a.mp3', '192.168/16'],
    ['http://169.254.169.254/a.mp3', 'link-local metadata'],
    ['http://192.0.2.1/a.mp3', 'documentation 192.0.2/24'],
    ['http://198.51.100.1/a.mp3', 'documentation 198.51.100/24'],
    ['http://203.0.113.1/a.mp3', 'documentation 203.0.113/24'],
    ['http://224.0.0.1/a.mp3', 'multicast'],
    ['http://240.0.0.1/a.mp3', 'reserved'],
  ])('blocks %s (%s)', async (url) => {
    const calls = stubHead([audioHead()]);
    const result = await checkCustomAudioUrl(url);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('public address');
    expect(calls).toHaveLength(0);
  });

  it.each([
    'http://172.15.0.1/a.mp3',
    'http://172.32.0.1/a.mp3',
    'http://8.8.8.8/a.mp3',
    'http://1.1.1.1/a.mp3',
  ])('treats %s as public', async (url) => {
    stubHead([audioHead()]);
    const result = await checkCustomAudioUrl(url);
    expect(result).toEqual({ ok: true });
  });

  it.each([
    'http://8.20.0.1/a.mp3',
    'http://1.25.0.1/a.mp3',
  ])('treats %s as public — 172.16/12 needs the 172 first octet', async (url) => {
    // Regression: the b>=16 && b<=31 range check must not fire without
    // a===172, or whole public /8s would be rejected.
    stubHead([audioHead()]);
    const result = await checkCustomAudioUrl(url);
    expect(result).toEqual({ ok: true });
  });
});

describe('checkCustomAudioUrl — IPv6', () => {
  beforeEach(() => {
    mockLookup.mockReset();
    warn.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // IPv6 branches of isPublicIp are exercised through DNS-resolved
  // addresses: URL.hostname keeps the brackets on literals, so literals
  // take the DNS path (fail closed when unresolvable).
  it.each([
    ['::1', 'loopback'],
    ['::', 'unspecified'],
    ['::ffff:127.0.0.1', 'mapped IPv4 loopback'],
    ['fe80::1', 'link-local'],
    ['fc00::1', 'unique-local'],
    ['ff02::1', 'multicast'],
  ])('blocks resolved %s (%s)', async (address) => {
    mockLookup.mockResolvedValue([{ address, family: 6 }]);
    const calls = stubHead([audioHead()]);
    const result = await checkCustomAudioUrl('https://v6.example.com/a.mp3');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('public address');
    expect(calls).toHaveLength(0);
  });

  it('accepts a resolved public IPv6 address', async () => {
    mockLookup.mockResolvedValue([{ address: '2606:4700:4700::1111', family: 6 }]);
    stubHead([audioHead()]);
    const result = await checkCustomAudioUrl('https://v6.example.com/a.mp3');
    expect(result).toEqual({ ok: true });
  });

  it('accepts a mapped public IPv4 behind ::ffff:', async () => {
    mockLookup.mockResolvedValue([{ address: '::ffff:8.8.8.8', family: 6 }]);
    stubHead([audioHead()]);
    const result = await checkCustomAudioUrl('https://v6.example.com/a.mp3');
    expect(result).toEqual({ ok: true });
  });

  it('fails closed on an IPv6 literal, which takes the DNS path', async () => {
    // new URL('http://[::1]/a.mp3').hostname keeps the brackets, so
    // isIP() does not recognize it and the code falls through to DNS.
    mockLookup.mockRejectedValue(new Error('ENOTFOUND'));
    const calls = stubHead([audioHead()]);
    const result = await checkCustomAudioUrl('http://[::1]/a.mp3');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('could not be resolved');
    expect(calls).toHaveLength(0);
  });
});

describe('checkCustomAudioUrl — HEAD failures and content checks', () => {
  beforeEach(() => {
    mockLookup.mockReset();
    warn.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fails closed and redacts the query string when HEAD is unreachable', async () => {
    stubHead([new Error('connection refused')]);
    const result = await checkCustomAudioUrl('http://93.184.216.34/a.mp3?token=secret');
    expect(result).toEqual({ ok: false, error: 'audio_url must point to an accessible audio file.' });
    expect(warn).toHaveBeenCalledTimes(1);
    const metadata = warn.mock.calls[0][1] as { url: string };
    expect(metadata.url).toBe('http://93.184.216.34/a.mp3');
    expect(metadata.url).not.toContain('secret');
  });

  it('follows a redirect chain, re-checking each hop', async () => {
    const calls = stubHead([
      headResponse(302, { location: 'http://93.184.216.35/b.mp3' }),
      audioHead(),
    ]);
    const result = await checkCustomAudioUrl('http://93.184.216.34/a.mp3');
    expect(result).toEqual({ ok: true });
    expect(calls.map((c) => c.url)).toEqual([
      'http://93.184.216.34/a.mp3',
      'http://93.184.216.35/b.mp3',
    ]);
  });

  it('resolves relative redirect targets against the current URL', async () => {
    const calls = stubHead([headResponse(302, { location: '/b.mp3' }), audioHead()]);
    const result = await checkCustomAudioUrl('http://93.184.216.34/a.mp3');
    expect(result).toEqual({ ok: true });
    expect(calls[1].url).toBe('http://93.184.216.34/b.mp3');
  });

  it('rejects a redirect to a private address', async () => {
    stubHead([headResponse(302, { location: 'http://10.0.0.1/z.mp3' }), audioHead()]);
    const result = await checkCustomAudioUrl('http://93.184.216.34/a.mp3');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('public address');
  });

  it('rejects a redirect to a non-http(s) URL', async () => {
    stubHead([headResponse(302, { location: 'ftp://example.com/z.mp3' })]);
    const result = await checkCustomAudioUrl('http://93.184.216.34/a.mp3');
    expect(result).toEqual({ ok: false, error: 'audio_url must redirect to an http(s) URL.' });
  });

  it('rejects an unparseable redirect target', async () => {
    stubHead([headResponse(302, { location: 'http://[::1' })]);
    const result = await checkCustomAudioUrl('http://93.184.216.34/a.mp3');
    expect(result).toEqual({ ok: false, error: 'audio_url has an invalid redirect target.' });
  });

  it('rejects a redirect loop after the hop limit', async () => {
    const hop = () => headResponse(302, { location: 'http://93.184.216.35/loop.mp3' });
    stubHead([hop(), hop(), hop(), hop(), hop(), hop(), hop()]);
    const result = await checkCustomAudioUrl('http://93.184.216.34/a.mp3');
    expect(result).toEqual({ ok: false, error: 'audio_url redirected too many times.' });
  });

  it('reports the upstream status when HEAD fails', async () => {
    stubHead([headResponse(500)]);
    const result = await checkCustomAudioUrl('http://93.184.216.34/a.mp3');
    expect(result).toEqual({
      ok: false,
      error: 'audio_url returned HTTP 500 during verification.',
    });
  });

  it('rejects non-audio content types, naming the received type', async () => {
    stubHead([audioHead('1234', 'text/html')]);
    const result = await checkCustomAudioUrl('http://93.184.216.34/a.mp3');
    expect(result).toEqual({
      ok: false,
      error: 'audio_url must point to an audio file (content-type: text/html).',
    });
  });

  it.each([['missing', {}], ['zero', '0'], ['garbage', 'abc']])(
    'rejects a %s content-length',
    async (_label, contentLength) => {
      const headers: Record<string, string> =
        typeof contentLength === 'string' && contentLength !== 'missing'
          ? { 'content-type': 'audio/mpeg', 'content-length': contentLength }
          : { 'content-type': 'audio/mpeg' };
      stubHead([headResponse(200, headers)]);
      const result = await checkCustomAudioUrl('http://93.184.216.34/a.mp3');
      expect(result).toEqual({
        ok: false,
        error: 'audio_url must report a valid content-length.',
      });
    },
  );

  it('rejects files over the 20 MB limit', async () => {
    stubHead([audioHead(String(21 * 1024 * 1024))]);
    const result = await checkCustomAudioUrl('http://93.184.216.34/a.mp3');
    expect(result).toEqual({
      ok: false,
      error: 'audio_url exceeds the 20 MB size limit.',
    });
  });
});
