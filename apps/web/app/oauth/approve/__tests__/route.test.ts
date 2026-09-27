import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { generateKeyPair, exportPKCS8 } from 'jose';
import { POST } from '../route';
import { clearOAuthKeysCache, getOAuthKeys } from '@/lib/oauth/keys';
import { mintConsentRequest } from '@/lib/oauth/tokens';
import { getMcpResource } from '@/lib/oauth/config';

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { createSupabaseServerClient } from '@/lib/supabase/server';

const ENV_KEYS = ['MCP_OAUTH_PRIVATE_KEY_PEM', 'NEXT_PUBLIC_APP_URL'] as const;
const previousEnv: Record<string, string | undefined> = {};

beforeAll(async () => {
  for (const key of ENV_KEYS) previousEnv[key] = process.env[key];
  const { privateKey } = await generateKeyPair('ES256', { extractable: true });
  process.env.MCP_OAUTH_PRIVATE_KEY_PEM = await exportPKCS8(privateKey);
  process.env.NEXT_PUBLIC_APP_URL = 'https://post-engineer.test';
  clearOAuthKeysCache();
});

afterAll(() => {
  for (const key of ENV_KEYS) {
    if (previousEnv[key] === undefined) delete process.env[key];
    else process.env[key] = previousEnv[key];
  }
  clearOAuthKeysCache();
});

function sessionWith(user: { id: string } | null) {
  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }) },
  } as never);
}

async function consentToken(sub = 'user-1'): Promise<string> {
  const keys = await getOAuthKeys();
  return mintConsentRequest(keys, {
    sub,
    clientId: 'mcp_client_abc',
    redirectUri: 'https://chatgpt.com/connector/callback',
    scope: 'mcp:tools',
    resource: getMcpResource(),
    state: 'xyz',
    codeChallenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  });
}

function approveForm(request: string, decision: string): Request {
  const form = new FormData();
  form.set('request', request);
  form.set('decision', decision);
  return new Request('https://post-engineer.test/oauth/approve', {
    method: 'POST',
    body: form,
  });
}

describe('POST /oauth/approve', () => {
  it('issues a code on approval and denies with access_denied', async () => {
    sessionWith({ id: 'user-1' });

    const approved = await POST(approveForm(await consentToken(), 'approve'));
    expect(approved.status).toBe(307);
    const location = approved.headers.get('location') ?? '';
    expect(location).toContain('code=');
    expect(location).toContain('state=xyz');

    const denied = await POST(approveForm(await consentToken(), 'deny'));
    expect(denied.status).toBe(307);
    expect(denied.headers.get('location') ?? '').toContain('error=access_denied');
  });

  it('rejects mismatched sessions and invalid requests', async () => {
    sessionWith({ id: 'user-other' });
    const mismatch = await POST(approveForm(await consentToken(), 'approve'));
    expect(mismatch.status).toBe(401);

    sessionWith({ id: 'user-1' });
    const invalid = await POST(approveForm('not-a-token', 'approve'));
    expect(invalid.status).toBe(400);
  });
});
