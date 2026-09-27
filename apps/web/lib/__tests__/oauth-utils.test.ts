import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  createOAuthState,
  decodeOAuthState,
  isLocalHostname,
  oauthPopupResponse,
  resolveOAuthRedirectUri,
} from '@/lib/oauth-utils';

describe('OAuth redirect resolution', () => {
  const originalLocal = process.env.TEST_REDIRECT_LOCAL;
  const originalProduction = process.env.TEST_REDIRECT_PRODUCTION;

  beforeEach(() => {
    process.env.TEST_REDIRECT_LOCAL = 'http://localhost:3434/callback';
    process.env.TEST_REDIRECT_PRODUCTION = 'https://post-engineer.com/callback';
  });

  afterEach(() => {
    if (originalLocal === undefined) delete process.env.TEST_REDIRECT_LOCAL;
    else process.env.TEST_REDIRECT_LOCAL = originalLocal;
    if (originalProduction === undefined) delete process.env.TEST_REDIRECT_PRODUCTION;
    else process.env.TEST_REDIRECT_PRODUCTION = originalProduction;
  });

  it.each(['localhost', '127.0.0.1', '[::1]'])('uses the local redirect for %s requests outside production', (hostname: string): void => {
    const request: NextRequest = new NextRequest(`http://${hostname}:3434/api/oauth/start`);
    expect(resolveOAuthRedirectUri(request, 'TEST_REDIRECT_LOCAL', 'TEST_REDIRECT_PRODUCTION')).toBe('http://localhost:3434/callback');
  });

  it('uses the production redirect for production requests', () => {
    const request = new NextRequest('https://post-engineer.com/api/oauth/start');
    expect(resolveOAuthRedirectUri(request, 'TEST_REDIRECT_LOCAL', 'TEST_REDIRECT_PRODUCTION')).toBe('https://post-engineer.com/callback');
  });

  it('uses the production redirect even for localhost requests when NODE_ENV is production (proxy behind reverse proxy)', () => {
    vi.stubEnv('NODE_ENV', 'production');
    try {
      const request = new NextRequest('http://localhost:3000/api/oauth/start');
      expect(resolveOAuthRedirectUri(request, 'TEST_REDIRECT_LOCAL', 'TEST_REDIRECT_PRODUCTION')).toBe('https://post-engineer.com/callback');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('fails explicitly when the selected redirect is missing', () => {
    delete process.env.TEST_REDIRECT_LOCAL;
    const request = new NextRequest('http://127.0.0.1:3434/api/oauth/start');
    expect(() => resolveOAuthRedirectUri(request, 'TEST_REDIRECT_LOCAL', 'TEST_REDIRECT_PRODUCTION')).toThrow('TEST_REDIRECT_LOCAL');
  });

  it.each(['localhost.example.com', '127.0.0.1.example.com', '[::2]', 'post-engineer.com'])('rejects non-local hostname %s', (hostname: string): void => {
    expect(isLocalHostname(hostname)).toBe(false);
  });

  it('preserves redirectUri inside the OAuth state payload', () => {
    const { state } = createOAuthState({ provider: 'linkedin', redirectUri: 'http://localhost:3434/callback' });
    expect(decodeOAuthState(state)).toMatchObject({
      provider: 'linkedin',
      redirectUri: 'http://localhost:3434/callback',
    });
  });
});

describe('oauthPopupResponse (XSS hardening)', () => {
  const adversarial = '</script><script>alert(1)</script>';

  function extractPayload(html: string): Record<string, unknown> {
    const match = /var payload = (\{[\s\S]*?\});/.exec(html);
    expect(match).not.toBeNull();
    return JSON.parse(match![1]) as Record<string, unknown>;
  }

  it('does not emit an unescaped </script> for an attacker-controlled error param', async () => {
    const response = oauthPopupResponse('youtube-oauth-error', {
      error: `OAuth error: ${adversarial}`,
    });
    const html = await response.text();
    expect(html).not.toContain(adversarial);
    expect(html).not.toContain('</script><script>');
  });

  it('does not emit an unescaped </script> for an attacker-controlled error_description', async () => {
    const response = oauthPopupResponse('instagram-oauth-error', {
      error: 'Instagram OAuth error: access_denied',
      detail: adversarial,
    });
    const html = await response.text();
    expect(html).not.toContain(adversarial);
  });

  it('keeps the payload JSON-decodable with the original attacker string intact', async () => {
    const response = oauthPopupResponse('linkedin-oauth-error', {
      error: `LinkedIn OAuth error: ${adversarial}`,
      detail: adversarial,
    });
    const html = await response.text();
    const payload = extractPayload(html);
    expect(payload['error']).toBe(`LinkedIn OAuth error: ${adversarial}`);
    expect(payload['detail']).toBe(adversarial);
  });

  it('sets the HTML content type and clears the nonce cookie', async () => {
    const response = oauthPopupResponse('ok', {});
    expect(response.headers.get('content-type')).toContain('text/html');
    const setCookie = response.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('oauth_state_nonce');
  });
});
