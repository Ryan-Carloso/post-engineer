//---------------
// Fanvue — OAuth 2.0 + PKCE (S256) client for connecting creator accounts.
//
// Verified against the official docs (api.fanvue.com/docs):
//   - Authorize at https://auth.fanvue.com/oauth2/auth
//   - Exchange at https://auth.fanvue.com/oauth2/token (form-urlencoded,
//     HTTP Basic client auth — Fanvue rejects client_secret_post)
//   - GET https://api.fanvue.com/users/me (read:self)
// Access tokens are short-lived (~1 hour); the refresh token (offline_access)
// rotates on every use, so every refresh persists the new pair.
//
// openid, offline_access and offline are system scopes: Fanvue adds them to
// every grant, and offline_access is what returns the refresh token.
//
// The vault upload lives in lib/fanvue-media.ts and post creation in
// lib/fanvue-posts.ts; lib/fanvue-http.ts owns the shared API plumbing.
//
// Secrets stay out of URLs: the app secret travels in the Basic auth
// header (token exchange) and access tokens in the Authorization header,
// so neither can surface in a logged request URL.
//---------------

import { createHash, randomBytes } from 'node:crypto';
import { FanvueError } from '@/lib/errors';
import {
  FANVUE_API_BASE,
  bearer,
  fanvueFetch,
  isRecord,
  readOptionalBoolean,
  readOptionalNumber,
  readOptionalString,
  requireFanvueEnv,
  type JsonRecord,
} from '@/lib/fanvue-http';

// Scopes requested at authorize time. Every one except the system scopes
// must also be selected on the app's Authentication tab in the Fanvue
// Developer Area: a scope requested here but not enabled there fails the
// authorize step with invalid_scope, and a scope enabled there but missing
// here is never granted.
//
// read:self  -> GET /users/me at connect time
// read:post  -> read/verify posts
// write:post -> POST /posts
// read:media -> read vault media
// write:media -> create the upload session and sign its parts
export const FANVUE_SCOPES = [
  'read:self',
  'read:post',
  'write:post',
  'read:media',
  'write:media',
  'offline_access',
] as const;

export const FANVUE_AUTHORIZE_URL = 'https://auth.fanvue.com/oauth2/auth';
export const FANVUE_TOKEN_URL = 'https://auth.fanvue.com/oauth2/token';
const REQUEST_TIMEOUT_MS = 15_000;

function basicAuthHeader(): string {
  const clientId = requireFanvueEnv('FANVUE_CLIENT_ID');
  const clientSecret = requireFanvueEnv('FANVUE_CLIENT_SECRET');
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
}

//---------------
// PKCE (RFC 7636, S256) — the verifier is 32 random bytes, base64url
// (43 chars); the challenge is base64url(SHA-256(verifier)). The verifier
// is stored server-side (httpOnly cookie for the web flow, the
// oauth_states row for the MCP flow) and never embedded in the
// client-visible state.
//---------------
export function generateFanvueCodeVerifier(): string {
  return randomBytes(32).toString('base64url');
}

export function fanvueCodeChallenge(codeVerifier: string): string {
  return createHash('sha256').update(codeVerifier, 'utf8').digest('base64url');
}

//---------------
// buildFanvueAuthUrl — OAuth consent URL. Returns the URL and the PKCE
// code verifier the callback must present at the token exchange; the
// caller stores the verifier (never the URL alone).
//---------------
export function buildFanvueAuthUrl(
  state: string,
  redirectUriOverride?: string,
): { authUrl: string; codeVerifier: string } {
  const codeVerifier = generateFanvueCodeVerifier();
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: requireFanvueEnv('FANVUE_CLIENT_ID'),
    redirect_uri: redirectUriOverride ?? requireFanvueEnv('FANVUE_REDIRECT_URI'),
    scope: FANVUE_SCOPES.join(' '),
    state,
    code_challenge: fanvueCodeChallenge(codeVerifier),
    code_challenge_method: 'S256',
  });
  return { authUrl: `${FANVUE_AUTHORIZE_URL}?${params.toString()}`, codeVerifier };
}

//---------------
// FanvueToken — the /oauth2/token response. The access token is
// short-lived (~1 hour); the refresh token rotates on every use:
// callers must persist the returned pair, never keep the old refresh
// token.
//---------------
export interface FanvueToken {
  access_token: string;
  refresh_token: string | null;
  expires_in: number;
  token_type: string;
}

function readToken(body: JsonRecord, code: string): FanvueToken {
  const accessToken = readOptionalString(body, 'access_token');
  if (accessToken === null) throw new FanvueError(`${code}: missing access_token`, 502);
  return {
    access_token: accessToken,
    refresh_token: readOptionalString(body, 'refresh_token'),
    // Fanvue access tokens live ~1 hour; the default keeps the stored
    // expiry honest when the response omits expires_in.
    expires_in: readOptionalNumber(body, 'expires_in') ?? 3600,
    token_type: readOptionalString(body, 'token_type') ?? 'Bearer',
  };
}

async function exchangeToken(params: Record<string, string>): Promise<FanvueToken> {
  const response = await fetch(FANVUE_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: basicAuthHeader(),
    },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const parsed: unknown = await response.json().catch(() => null);
  const body = isRecord(parsed) ? parsed : null;
  if (!response.ok) {
    throw new FanvueError(`FANVUE_TOKEN_FAILED: ${describeTokenFailure(body, response.status)}`, response.status);
  }
  if (body === null) throw new FanvueError('FANVUE_TOKEN_FAILED: invalid response body', 502);
  return readToken(body, 'FANVUE_TOKEN_FAILED');
}

// Only Fanvue's own error message is surfaced, never the request itself.
function describeTokenFailure(body: JsonRecord | null, status: number): string {
  const message =
    body === null
      ? null
      : (readOptionalString(body, 'message') ??
        readOptionalString(body, 'error_description') ??
        readOptionalString(body, 'error'));
  if (message !== null) return message;
  return `status ${status}`;
}

//---------------
// exchangeFanvueCode — authorization code + PKCE verifier -> access
// token (~1 hour) + refresh token. The verifier must be the one
// buildFanvueAuthUrl returned for this flow.
//---------------
export async function exchangeFanvueCode(
  code: string,
  codeVerifier: string,
  redirectUriOverride?: string,
): Promise<FanvueToken> {
  return exchangeToken({
    grant_type: 'authorization_code',
    code,
    code_verifier: codeVerifier,
    redirect_uri: redirectUriOverride ?? requireFanvueEnv('FANVUE_REDIRECT_URI'),
  });
}

//---------------
// refreshFanvueAccessToken — refresh token -> fresh access token.
// The refresh token rotates: the caller must persist the returned pair.
//---------------
export async function refreshFanvueAccessToken(refreshToken: string): Promise<FanvueToken> {
  return exchangeToken({ grant_type: 'refresh_token', refresh_token: refreshToken });
}

//---------------
// FanvueUserProfile — the connected account: the /users/me uuid is the
// providerAccountId, the display name (falling back to the unique
// @handle — /users/me has no `username` field) is the account name.
// Avatar/cover/bio are NOT managed here: Fanvue documents no endpoints
// for them, and the public areas stay SFW by not managing them.
//---------------
export interface FanvueUserProfile {
  uuid: string;
  username: string | null;
  displayName: string | null;
  email: string | null;
  avatarUrl: string | null;
  isCreator: boolean;
  createdAt: string | null;
}

export async function fetchFanvueProfile(accessToken: string): Promise<FanvueUserProfile> {
  const body = await fanvueFetch(
    'FANVUE_PROFILE_FAILED',
    `${FANVUE_API_BASE}/users/me`,
    bearer(accessToken),
  );
  const uuid = readOptionalString(body, 'uuid');
  if (uuid === null) throw new FanvueError('FANVUE_PROFILE_FAILED: missing uuid', 502);
  return {
    uuid,
    // The API field is `handle`; it is exposed as `username` so the
    // stored account metadata keeps one name for every provider.
    username: readOptionalString(body, 'handle'),
    displayName: readOptionalString(body, 'displayName'),
    email: readOptionalString(body, 'email'),
    avatarUrl: readOptionalString(body, 'avatarUrl'),
    isCreator: readOptionalBoolean(body, 'isCreator') ?? false,
    createdAt: readOptionalString(body, 'createdAt'),
  };
}
