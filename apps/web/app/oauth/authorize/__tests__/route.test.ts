import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { generateKeyPair, exportPKCS8 } from 'jose';
import { GET } from '../route';
import { clearOAuthKeysCache } from '@/lib/oauth/keys';

vi.mock('@/lib/oauth/resolve-client', () => ({
  resolveClient: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: vi.fn().mockReturnValue({}),
}));

import { resolveClient } from '@/lib/oauth/resolve-client';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getMcpResource } from '@/lib/oauth/config';

const ENV_KEYS = ['MCP_OAUTH_PRIVATE_KEY_PEM', 'NEXT_PUBLIC_APP_URL'] as const;
const previousEnv: Record<string, string | undefined> = {};

beforeAll(async () => {
  for (const key of ENV_KEYS) previousEnv[key] = process.env[key];
  const { privateKey } = await generateKeyPair('ES256', { extractable: true });
  process.env.MCP_OAUTH_PRIVATE_KEY_PEM = await exportPKCS8(privateKey);
  process.env.NEXT_PUBLIC_APP_URL = 'https://oauth-tunnel.ngrok.app';
  clearOAuthKeysCache();
});

afterAll(() => {
  for (const key of ENV_KEYS) {
    if (previousEnv[key] === undefined) delete process.env[key];
    else process.env[key] = previousEnv[key];
  }
  clearOAuthKeysCache();
});

const CLIENT = {
  clientName: 'ChatGPT',
  redirectUris: ['https://chatgpt.com/connector/callback'],
};

function authorizeUrl(origin = 'https://post-engineer.test'): string {
  const url = new URL('/oauth/authorize', origin);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', 'mcp_client_abc');
  url.searchParams.set('redirect_uri', 'https://chatgpt.com/connector/callback');
  url.searchParams.set('scope', 'mcp:tools');
  url.searchParams.set('state', 'xyz');
  url.searchParams.set('code_challenge', 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('resource', getMcpResource());
  return url.toString();
}

function sessionWith(user: { id: string } | null) {
  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }) },
  } as never);
}

describe('GET /oauth/authorize', () => {
  it('rejects untrusted clients without redirecting', async () => {
    vi.mocked(resolveClient).mockResolvedValue(null);
    const response = await GET(new Request(authorizeUrl()));
    expect(response.status).toBe(400);
  });

  it('sends anonymous users to login preserving the request', async () => {
    vi.mocked(resolveClient).mockResolvedValue(CLIENT);
    sessionWith(null);
    const response = await GET(new Request(authorizeUrl('http://localhost:3434')));
    expect(response.status).toBe(307);
    const location = response.headers.get('location') ?? '';
    expect(location).toContain('https://oauth-tunnel.ngrok.app/login?next=');
    expect(decodeURIComponent(location)).toContain('next=/oauth/authorize?');
  });

  it('sends authenticated users to consent with a signed request', async () => {
    vi.mocked(resolveClient).mockResolvedValue(CLIENT);
    sessionWith({ id: 'user-1' });
    const response = await GET(new Request(authorizeUrl('http://localhost:3434')));
    expect(response.status).toBe(307);
    const location = response.headers.get('location') ?? '';
    expect(location).toContain('https://oauth-tunnel.ngrok.app/oauth/consent?request=');
  });
});
