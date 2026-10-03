import { describe, it, expect, vi } from 'vitest';
import type { LookupAddress } from 'node:dns';
import {
  validateDcrMetadata,
  isCimdClientId,
  fetchCimdDocument,
  isBlockedIpAddress,
} from '../clients';

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

//---------------
// SSRF guards for fetchCimdDocument (CodeQL #17).
// The client_id URL is attacker-controlled: the fetch must never follow
// redirects and must never reach non-public IPs.
//---------------

function lookupReturning(...addresses: string[]) {
  return vi.fn(
    async (_hostname: string): Promise<LookupAddress[]> =>
      addresses.map((address) => ({ address, family: 4 })),
  );
}

function okFetch(body: unknown) {
  return vi.fn(
    async (
      _url: string | URL | Request,
      _init?: RequestInit,
    ): Promise<Response> =>
      ({ ok: true, json: async () => body }) as Response,
  );
}

describe('isBlockedIpAddress', () => {
  it.each([
    '127.0.0.1', // loopback
    '10.0.0.1', // private
    '172.16.0.1', // private
    '192.168.1.1', // private
    '169.254.169.254', // link-local (cloud metadata)
    '0.0.0.0', // this network
    '100.64.0.1', // CGNAT
    '224.0.0.1', // multicast
    '::1', // IPv6 loopback
    '::ffff:127.0.0.1', // IPv4-mapped loopback
    'fc00::1', // IPv6 unique local
    'fe80::1', // IPv6 link-local
    'ff02::1', // IPv6 multicast
  ])('blocks %s', (address) => {
    expect(isBlockedIpAddress(address)).toBe(true);
  });

  it.each(['93.184.216.34', '8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])(
    'allows public %s',
    (address) => {
      expect(isBlockedIpAddress(address)).toBe(false);
    },
  );
});

describe('fetchCimdDocument SSRF guards', () => {
  it('never follows redirects', async () => {
    const fetchImpl = okFetch({ redirect_uris: ['https://x/callback'] });
    await fetchCimdDocument(
      'https://public.example/.well-known/client.json',
      fetchImpl,
      lookupReturning('93.184.216.34'),
    );
    expect(fetchImpl).toHaveBeenCalledOnce();
    const init = fetchImpl.mock.calls[0]?.[1];
    expect(init?.redirect).toBe('error');
  });

  it('refuses hosts resolving to loopback without fetching', async () => {
    const fetchImpl = okFetch({ redirect_uris: ['https://x/callback'] });
    const result = await fetchCimdDocument(
      'https://evil.example/client.json',
      fetchImpl,
      lookupReturning('127.0.0.1'),
    );
    expect(result).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses the cloud metadata IP without fetching', async () => {
    const fetchImpl = okFetch({ redirect_uris: ['https://x/callback'] });
    const result = await fetchCimdDocument(
      'https://169.254.169.254/latest/meta-data/',
      fetchImpl,
      lookupReturning('169.254.169.254'),
    );
    expect(result).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses when any resolved address is non-public', async () => {
    const fetchImpl = okFetch({ redirect_uris: ['https://x/callback'] });
    const result = await fetchCimdDocument(
      'https://evil.example/client.json',
      fetchImpl,
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
      fetchImpl,
      lookupImpl,
    );
    expect(result).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fetches public hosts and returns the document', async () => {
    const fetchImpl = okFetch({ redirect_uris: ['https://x/callback'] });
    const result = await fetchCimdDocument(
      'https://public.example/.well-known/client.json',
      fetchImpl,
      lookupReturning('93.184.216.34'),
    );
    expect(result).toEqual({ redirect_uris: ['https://x/callback'] });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('still rejects non-https URLs', async () => {
    const fetchImpl = okFetch({ redirect_uris: ['https://x/callback'] });
    const result = await fetchCimdDocument(
      'http://public.example/client.json',
      fetchImpl,
      lookupReturning('93.184.216.34'),
    );
    expect(result).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns null when the response is not ok', async () => {
    const fetchImpl = vi.fn(
      async (): Promise<Response> => ({ ok: false }) as Response,
    );
    const result = await fetchCimdDocument(
      'https://public.example/client.json',
      fetchImpl,
      lookupReturning('93.184.216.34'),
    );
    expect(result).toBeNull();
  });
});
