import { describe, it, expect, vi } from 'vitest';
import { parseAuthorizeRequest, buildErrorRedirect } from '../authorize';
import { getMcpResource } from '../config';

vi.mock('../resolve-client', () => ({
  resolveClient: vi.fn(),
}));

import { resolveClient } from '../resolve-client';

const CLIENT = {
  clientName: 'ChatGPT',
  redirectUris: ['https://chatgpt.com/connector/callback'],
};

function authorizeUrl(extra: Record<string, string> = {}): URL {
  const url = new URL('https://post-engineer.com/oauth/authorize');
  const base: Record<string, string> = {
    response_type: 'code',
    client_id: 'mcp_client_abc',
    redirect_uri: 'https://chatgpt.com/connector/callback',
    scope: 'mcp:tools offline_access',
    state: 'xyz',
    code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    code_challenge_method: 'S256',
    resource: getMcpResource(),
  };
  for (const [key, value] of Object.entries({ ...base, ...extra })) {
    url.searchParams.set(key, value);
  }
  return url;
}

describe('parseAuthorizeRequest', () => {
  it('rejects a missing or empty MCP resource configuration', () => {
    const previousResource = process.env.MCP_RESOURCE;
    delete process.env.MCP_RESOURCE;
    expect(() => getMcpResource()).toThrow('MCP_RESOURCE is not defined');
    process.env.MCP_RESOURCE = '   ';
    expect(() => getMcpResource()).toThrow('MCP_RESOURCE is not defined');
    if (previousResource === undefined) delete process.env.MCP_RESOURCE;
    else process.env.MCP_RESOURCE = previousResource;
  });

  it('accepts a valid request', async () => {
    vi.mocked(resolveClient).mockResolvedValue(CLIENT);
    const result = await parseAuthorizeRequest(authorizeUrl(), {} as never);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.params.state).toBe('xyz');
      expect(result.params.scope).toEqual(['mcp:tools', 'offline_access']);
    }
  });

  it('rejects untrusted clients without a redirect target', async () => {
    vi.mocked(resolveClient).mockResolvedValue(null);
    const result = await parseAuthorizeRequest(authorizeUrl(), {} as never);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.redirectUri).toBeUndefined();
  });

  it('rejects unregistered redirect uris without redirecting', async () => {
    vi.mocked(resolveClient).mockResolvedValue(CLIENT);
    const url = authorizeUrl();
    url.searchParams.set('redirect_uri', 'https://evil.example/cb');
    const result = await parseAuthorizeRequest(url, {} as never);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.redirectUri).toBeUndefined();
  });

  it('redirects validation errors back to the client', async () => {
    vi.mocked(resolveClient).mockResolvedValue(CLIENT);
    const cases: Array<[Record<string, string>, string]> = [
      [{ response_type: 'token' }, 'unsupported_response_type'],
      [{ code_challenge_method: 'plain' }, 'invalid_request'],
      [{ resource: 'https://evil.example' }, 'invalid_target'],
      [{ scope: 'admin' }, 'invalid_scope'],
    ];
    for (const [override, error] of cases) {
      const url = authorizeUrl(override);
      const result = await parseAuthorizeRequest(url, {} as never);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.redirectUri).toBe('https://chatgpt.com/connector/callback');
        const redirect = buildErrorRedirect(result.redirectUri as string, error, 'xyz');
        expect(redirect).toContain(`error=${error}`);
      }
    }
  });
});
