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

export const FANVUE_SCOPES = [
  'read:self',
  'read:post',
  'write:post',
  'read:media',
  'write:media',
  'offline_access',
] as const;

const FANVUE_AUTHORIZE_URL = 'https://auth.fanvue.com/oauth2/auth';
const FANVUE_TOKEN_URL = 'https://auth.fanvue.com/oauth2/token';
const REQUEST_TIMEOUT_MS = 15_000;

function basicAuthHeader(): string {
  const clientId = requireFanvueEnv('FANVUE_CLIENT_ID');
  const clientSecret = requireFanvueEnv('FANVUE_CLIENT_SECRET');
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
}

export function generateFanvueCodeVerifier(): string {
  return randomBytes(32).toString('base64url');
}

export function fanvueCodeChallenge(codeVerifier: string): string {
  return createHash('sha256').update(codeVerifier, 'utf8').digest('base64url');
}

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

export async function refreshFanvueAccessToken(refreshToken: string): Promise<FanvueToken> {
  return exchangeToken({ grant_type: 'refresh_token', refresh_token: refreshToken });
}

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
    username: readOptionalString(body, 'handle'),
    displayName: readOptionalString(body, 'displayName'),
    email: readOptionalString(body, 'email'),
    avatarUrl: readOptionalString(body, 'avatarUrl'),
    isCreator: readOptionalBoolean(body, 'isCreator') ?? false,
    createdAt: readOptionalString(body, 'createdAt'),
  };
}
