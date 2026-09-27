import 'server-only';

import crypto from 'crypto';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import type { OAuthProvider } from '@/lib/providers/registry';
import { isOAuthProvider } from '@/lib/providers/registry';

//---------------
// OAuth State — encode/decode of the OAuth `state` parameter.
// Stores a random nonce tied to an httpOnly cookie (CSRF protection:
// the callback only accepts the flow if state.nonce === cookie).
// The list of OAuth providers derives from the registry (supportsOAuthCallback).
//---------------

export const OAUTH_NONCE_COOKIE = 'oauth_state_nonce';

// Nonce cookie TTL: 10 minutes covers the OAuth flow with margin
const OAUTH_NONCE_MAX_AGE = 600;

export interface OAuthStatePayload {
  provider: OAuthProvider;
  nonce?: string;
  redirectUri?: string;
}

//---------------
// createOAuthState — generates a random nonce + state encoded with it.
// The nonce MUST be stored in an httpOnly cookie on the /start route.
//---------------

export function createOAuthState(
  base: Omit<OAuthStatePayload, 'nonce'>
): { state: string; nonce: string } {
  const nonce = crypto.randomBytes(16).toString('hex');
  const state = Buffer.from(
    JSON.stringify({ ...base, nonce }),
    'utf-8'
  ).toString('base64url');
  return { state, nonce };
}

//---------------
// setOAuthNonceCookie — stores the nonce in an httpOnly cookie on the /start response
//---------------

export function setOAuthNonceCookie(response: NextResponse, nonce: string): void {
  response.cookies.set({
    name: OAUTH_NONCE_COOKIE,
    value: nonce,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: OAUTH_NONCE_MAX_AGE,
  });
}

//---------------
// verifyOAuthNonce — compares the state nonce with the httpOnly cookie nonce.
// An attacker can forge the state (it is just base64), but cannot set
// the httpOnly cookie in the victim's browser — only this server can.
//---------------

export function verifyOAuthNonce(
  request: NextRequest,
  statePayload: OAuthStatePayload | null
): boolean {
  const cookieNonce = request.cookies.get(OAUTH_NONCE_COOKIE)?.value;
  const stateNonce = statePayload?.nonce;

  if (!cookieNonce || !stateNonce) return false;
  if (cookieNonce.length !== stateNonce.length) return false;

  // Constant-time comparison to prevent timing attacks
  return crypto.timingSafeEqual(Buffer.from(cookieNonce), Buffer.from(stateNonce));
}

export function decodeOAuthState(state: string | null): OAuthStatePayload | null {
  if (!state) return null;
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(state, 'base64url').toString('utf-8')
    );
    if (typeof parsed !== 'object' || parsed === null) return null;
    const payload = parsed as Partial<OAuthStatePayload>;
    if (!isOAuthProvider(payload.provider)) {
      return null;
    }
    return {
      provider: payload.provider,
      nonce: typeof payload.nonce === 'string' ? payload.nonce : undefined,
      redirectUri: typeof payload.redirectUri === 'string' ? payload.redirectUri : undefined,
    };
  } catch {
    return null;
  }
}

//---------------
// isLocalHostname — recognizes local hosts in the format returned by URL.hostname.
//---------------
export function isLocalHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

//---------------
// resolveOAuthRedirectUri — selects the registered callback for the environment.
// The decision is based on NODE_ENV (not the request hostname: behind a
// Next sees the internal localhost host and would pick the local callback in
// proxy the prod value may be wrong). The used value is recorded in the state to be replayed in the token exchange.
//---------------
export function resolveOAuthRedirectUri(
  request: NextRequest,
  localEnvName: string,
  productionEnvName: string,
): string {
  const envName: string = process.env.NODE_ENV === 'production'
    ? productionEnvName
    : isLocalHostname(new URL(request.url).hostname)
      ? localEnvName
      : productionEnvName;
  const redirectUri = process.env[envName];
  if (!redirectUri) {
    throw new Error(`${envName} environment variable is required for OAuth`);
  }
  return redirectUri;
}

//---------------
// OAuth Popup Response — HTML that notifies the opener (parent window) and closes.
// Used by the callbacks because the provider redirect lands directly on the API.
//---------------

export function oauthPopupResponse(
  messageType: string,
  data: Record<string, unknown>
): NextResponse {
  // XSS hardening: the payload can carry attacker-controlled strings (e.g.
  // the OAuth provider's `error` / `error_description` query params, which
  // reach this sink before any state validation). JSON.stringify does not
  // escape `<`, so a payload containing `</script>` would break out of the
  // inline <script> block. Escaping `<` as \u003c keeps the JSON decodable
  // (JSON.parse restores the original string) while making breakout
  // impossible. This is the single sink for every OAuth popup callback.
  const payload = JSON.stringify({ type: messageType, ...data }).replace(
    /</g,
    '\\u003c'
  );
  const html = `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <title>Conectando...</title>
    <style>
      body { font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #fafafa; color: #171717; }
      .card { text-align: center; padding: 24px; }
      .spinner { width: 40px; height: 40px; margin: 0 auto 16px; border: 4px solid #e5e5e5; border-top-color: #dc2626; border-radius: 50%; animation: spin 0.8s linear infinite; }
      @keyframes spin { to { transform: rotate(360deg); } }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="spinner"></div>
      <p>Finishing connection...</p>
    </div>
    <script>
      var payload = ${payload};
      if (window.opener) {
        window.opener.postMessage(payload, window.location.origin);
      }
      window.close();
    </script>
  </body>
</html>`;

  const response = new NextResponse(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });

  // The nonce is single-use: clears the cookie on any outcome
  response.cookies.set({
    name: OAUTH_NONCE_COOKIE,
    value: '',
    httpOnly: true,
    path: '/',
    maxAge: 0,
  });

  return response;
}
