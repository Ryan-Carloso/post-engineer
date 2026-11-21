import { EventEmitter } from 'node:events';
import https from 'node:https';
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { LookupAddress } from 'node:dns';

const realRequestPinned = vi.hoisted(() => ({ current: null as null | typeof import('@/lib/ssrf/pinned-request').requestPinned }));

vi.mock('@/lib/ssrf/pinned-request', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ssrf/pinned-request')>();
  realRequestPinned.current = actual.requestPinned;
  return { ...actual, requestPinned: vi.fn(actual.requestPinned) };
});

import { requestPinned } from '@/lib/ssrf/pinned-request';
import {
  validateDcrMetadata,
  isCimdClientId,
  fetchCimdDocument,
  isBlockedIpAddress,
} from '../clients';
import {
  DCR_MAX_CLIENT_NAME_LENGTH,
  DCR_MAX_REDIRECT_URIS,
  DCR_MAX_REDIRECT_URI_LENGTH,
} from '../dcr-limits';

describe('oauth clients', () => {
  it('accepts valid dynamic client registration metadata', () => {
    const result = validateDcrMetadata({
      redirect_uris: ['https://chatgpt.com/connector/callback'],
      client_name: 'ChatGPT',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.redirectUris).toEqual(['https://chatgpt.com/connector/callback']);
      expect(result.clientName).toBe('ChatGPT');
    }
  });

  it('allows http localhost redirects for native clients', () => {
    const result = validateDcrMetadata({
      redirect_uris: ['http://127.0.0.1:54321/callback'],
    });
    expect(result.ok).toBe(true);
  });

  it('rejects fragments, non-https remotes and empty lists', () => {
    expect(
      validateDcrMetadata({ redirect_uris: ['https://app.example/cb#frag'] }).ok,
    ).toBe(false);
    expect(validateDcrMetadata({ redirect_uris: ['http://app.example/cb'] }).ok).toBe(false);
    expect(validateDcrMetadata({ redirect_uris: [] }).ok).toBe(false);
    expect(validateDcrMetadata({}).ok).toBe(false);
  });

  it('detects client ID metadata documents vs registered ids', () => {
    expect(isCimdClientId('https://chatgpt.com/mcp-client-metadata.json')).toBe(true);
    expect(isCimdClientId('mcp_client_abc123')).toBe(false);
    expect(isCimdClientId('')).toBe(false);
  });
});

function lookupReturning(...addresses: string[]) {
  return vi.fn(
    async (_hostname: string): Promise<LookupAddress[]> =>
      addresses.map((address) => ({ address, family: 4 })),
  );
}

function okFetch(body: unknown) {
  return vi.mocked(requestPinned).mockClear().mockImplementation(
    async (): Promise<Response> => new Response(JSON.stringify(body), { status: 200 }),
  );
}

describe('validateDcrMetadata size caps', () => {
  const uriOfLength = (length: number): string => {
    const prefix = 'https://a.example/';
    return `${prefix}${'x'.repeat(length - prefix.length)}`;
  };

  it('accepts the maximum number of redirect_uris', () => {
    const uris = Array.from({ length: DCR_MAX_REDIRECT_URIS }, (_, i) => `https://a.example/${i}`);
    const result = validateDcrMetadata({ redirect_uris: uris });
    expect(result).toEqual({ ok: true, redirectUris: uris, clientName: 'MCP client' });
  });

  it('rejects one redirect_uri over the count cap', () => {
    const uris = Array.from({ length: DCR_MAX_REDIRECT_URIS + 1 }, (_, i) => `https://a.example/${i}`);
    expect(validateDcrMetadata({ redirect_uris: uris })).toEqual({
      ok: false,
      error: `redirect_uris must contain at most ${DCR_MAX_REDIRECT_URIS} entries.`,
    });
  });

  it('accepts a redirect_uri of exactly the maximum length', () => {
    const uri = uriOfLength(DCR_MAX_REDIRECT_URI_LENGTH);
    expect(uri.length).toBe(DCR_MAX_REDIRECT_URI_LENGTH);
    expect(validateDcrMetadata({ redirect_uris: [uri] }).ok).toBe(true);
  });

  it('rejects a redirect_uri one character over the length cap instead of truncating it', () => {
    const uri = uriOfLength(DCR_MAX_REDIRECT_URI_LENGTH + 1);
    expect(validateDcrMetadata({ redirect_uris: ['https://a.example/ok', uri] })).toEqual({
      ok: false,
      error: `Each redirect_uri must be at most ${DCR_MAX_REDIRECT_URI_LENGTH} characters.`,
    });
  });

  it('accepts a client_name of exactly the maximum length', () => {
    const name = 'n'.repeat(DCR_MAX_CLIENT_NAME_LENGTH);
    const result = validateDcrMetadata({ redirect_uris: ['https://a.example/cb'], client_name: name });
    expect(result).toEqual({ ok: true, redirectUris: ['https://a.example/cb'], clientName: name });
  });

  it('rejects an over-length client_name instead of truncating it', () => {
    const name = 'n'.repeat(DCR_MAX_CLIENT_NAME_LENGTH + 1);
    expect(
      validateDcrMetadata({ redirect_uris: ['https://a.example/cb'], client_name: name }),
    ).toEqual({
      ok: false,
      error: `client_name must be at most ${DCR_MAX_CLIENT_NAME_LENGTH} characters.`,
    });
  });
});

describe('isBlockedIpAddress', () => {
  it.each([
    '127.0.0.1',
    '10.0.0.1',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '0.0.0.0',
    '100.64.0.1',
    '224.0.0.1',
    '::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    'fc00::1',
    'fe80::1',
    'ff02::1',
    '198.18.0.1',
    '192.0.0.8',
    '[::1]',
  ])('blocks %s', (address) => {
    expect(isBlockedIpAddress(address)).toBe(true);
  });

  it.each([
    '93.184.216.34',
    '8.8.8.8',
    '1.1.1.1',
    '2606:4700:4700::1111',
    '192.0.0.9',
    '192.0.0.10',
    '[2606:4700:4700::1111]',
  ])('allows public %s', (address) => {
    expect(isBlockedIpAddress(address)).toBe(false);
  });
});

describe('fetchCimdDocument SSRF guards', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    const real = realRequestPinned.current;
    if (real === null) throw new Error('pinned-request mock did not load');
    vi.mocked(requestPinned).mockReset().mockImplementation(real);
  });
  it('never follows redirects', async () => {
    const fetchImpl = vi.mocked(requestPinned).mockImplementation(
      async (): Promise<Response> => new Response(null, { status: 302, headers: { location: 'https://evil.example/x' } }),
    );
    const result = await fetchCimdDocument(
      'https://public.example/.well-known/client.json',
      lookupReturning('93.184.216.34'),
    );
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls[0]?.[1]).toEqual(['93.184.216.34']);
    expect(result).toBeNull();
  });

  it('refuses hosts resolving to loopback without fetching', async () => {
    const fetchImpl = okFetch({ redirect_uris: ['https://x/callback'] });
    const result = await fetchCimdDocument(
      'https://evil.example/client.json',
      lookupReturning('127.0.0.1'),
    );
    expect(result).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses the cloud metadata IP without fetching', async () => {
    const fetchImpl = okFetch({ redirect_uris: ['https://x/callback'] });
    const result = await fetchCimdDocument(
      'https://169.254.169.254/latest/meta-data/',
      lookupReturning('169.254.169.254'),
    );
    expect(result).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses when any resolved address is non-public', async () => {
    const fetchImpl = okFetch({ redirect_uris: ['https://x/callback'] });
    const result = await fetchCimdDocument(
      'https://evil.example/client.json',
      lookupReturning('93.184.216.34', '10.0.0.5'),
    );
    expect(result).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails closed when DNS resolution fails', async () => {
    const fetchImpl = okFetch({ redirect_uris: ['https://x/callback'] });
    const lookupImpl = vi.fn(async (): Promise<LookupAddress[]> => {
      throw new Error('ENOTFOUND');
    });
    const result = await fetchCimdDocument(
      'https://public.example/client.json',
      lookupImpl,
    );
    expect(result).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fetches public hosts and returns the document', async () => {
    const fetchImpl = okFetch({ redirect_uris: ['https://x/callback'] });
    const result = await fetchCimdDocument(
      'https://public.example/.well-known/client.json',
      lookupReturning('93.184.216.34'),
    );
    expect(result).toEqual({ redirect_uris: ['https://x/callback'] });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('still rejects non-https URLs', async () => {
    const fetchImpl = okFetch({ redirect_uris: ['https://x/callback'] });
    const result = await fetchCimdDocument(
      'http://public.example/client.json',
      lookupReturning('93.184.216.34'),
    );
    expect(result).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects credentials, fragments and non-default ports without fetching', async () => {
    for (const url of [
      'https://user:pass@public.example/client.json',
      'https://public.example/client.json#frag',
      'https://public.example:8443/client.json',
    ]) {
      const fetchImpl = okFetch({ redirect_uris: ['https://x/callback'] });
      const result = await fetchCimdDocument(
        url,
        lookupReturning('93.184.216.34'),
      );
      expect(result).toBeNull();
      expect(fetchImpl).not.toHaveBeenCalled();
    }
  });

  it('fetches the normalized URL without a default port', async () => {
    const fetchImpl = okFetch({ redirect_uris: ['https://x/callback'] });
    const result = await fetchCimdDocument(
      'https://public.example:443/client.json',
      lookupReturning('93.184.216.34'),
    );
    expect(result).toEqual({ redirect_uris: ['https://x/callback'] });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://public.example/client.json');
  });

  it.each(['198.18.0.1', '192.0.0.8', '::ffff:7f00:1'])(
    'refuses %s without fetching',
    async (address) => {
      const fetchImpl = okFetch({ redirect_uris: ['https://x/callback'] });
      const result = await fetchCimdDocument(
        'https://evil.example/client.json',
        lookupReturning(address),
      );
      expect(result).toBeNull();
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

  it('pins the document fetch to the validated address', async () => {
    const lookup = lookupReturning('93.184.216.34');
    let capturedLookup: ((
      hostname: string,
      options: { all?: boolean },
      callback: (error: NodeJS.ErrnoException | null, address: unknown, family?: number) => void,
    ) => void) | undefined;
    vi.spyOn(https, 'request').mockImplementation(((
      _url: URL,
      options: { lookup?: typeof capturedLookup },
      callback: (incoming: EventEmitter) => void,
    ) => {
      capturedLookup = options.lookup;
      const req = new EventEmitter() as EventEmitter & { end: () => void; destroy: () => void };
      req.destroy = () => undefined;
      req.end = () => {
        const incoming = new EventEmitter() as EventEmitter & {
          statusCode: number;
          headers: Record<string, string>;
          resume: () => void;
        };
        incoming.statusCode = 200;
        incoming.headers = { 'content-type': 'application/json' };
        incoming.resume = () => undefined;
        callback(incoming);
        queueMicrotask(() => {
          incoming.emit(
            'data',
            Buffer.from(JSON.stringify({ redirect_uris: ['https://x/callback'] })),
          );
          incoming.emit('end');
          req.emit('close');
        });
      };
      return req;
    }) as never);
    const fetchSpy = vi.fn();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchSpy as typeof fetch;
    try {
      const result = await fetchCimdDocument(
        'https://public.example/client.json',
        lookup,
      );
      expect(result).toEqual({ redirect_uris: ['https://x/callback'] });
      expect(fetchSpy).not.toHaveBeenCalled();
      if (capturedLookup === undefined) {
        throw new Error('document fetch did not install a pinned lookup');
      }
      const pinnedLookup = capturedLookup;
      const pinned = await new Promise<{ error: unknown; address: unknown }>((resolve) => {
        pinnedLookup('attacker.example', { all: true }, (error, address) => {
          resolve({ error, address });
        });
      });
      expect(pinned.error).toBeNull();
      expect(pinned.address).toEqual([{ address: '93.184.216.34', family: 4 }]);
      expect(JSON.stringify(pinned.address)).not.toContain('127.0.0.1');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it.each([
    ['javascript:alert(1)'],
    ['data:text/html,x'],
    ['http://evil.example/cb'],
    ['https://ok.example/cb#frag'],
    ['not a url'],
  ])('rejects a document whose redirect_uris contain %s', async (unsafe) => {
    const fetchImpl = okFetch({ redirect_uris: ['https://ok.example/cb', unsafe] });
    const result = await fetchCimdDocument(
      'https://public.example/client.json',
      lookupReturning('93.184.216.34'),
    );
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(result).toBeNull();
  });

  it('rejects a document with an empty or non-string redirect_uris list', async () => {
    for (const redirectUris of [[], ['https://ok.example/cb', 42], 'https://ok.example/cb']) {
      const fetchImpl = okFetch({ redirect_uris: redirectUris });
      const result = await fetchCimdDocument(
        'https://public.example/client.json',
        lookupReturning('93.184.216.34'),
      );
      expect(fetchImpl).toHaveBeenCalledOnce();
      expect(result).toBeNull();
    }
  });

  it('accepts https and loopback http redirect_uris', async () => {
    const uris = ['https://ok.example/cb', 'http://127.0.0.1:33418/cb', 'http://localhost/cb'];
    okFetch({ redirect_uris: uris });
    const result = await fetchCimdDocument(
      'https://public.example/client.json',
      lookupReturning('93.184.216.34'),
    );
    expect(result).toEqual({ redirect_uris: uris });
  });

  it('returns null when the response is not ok', async () => {
    vi.mocked(requestPinned).mockImplementation(async (): Promise<Response> => new Response(null, { status: 500 }));
    const result = await fetchCimdDocument(
      'https://public.example/client.json',
      lookupReturning('93.184.216.34'),
    );
    expect(result).toBeNull();
  });
});
