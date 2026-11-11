//---------------
// Fanvue — API client to connect accounts (OAuth 2.0 + PKCE S256) and
// publish videos as subscribers-only posts.
//
// Documentation (third-party summaries of the official docs; api.fanvue.com
// is not reachable from this sandbox): OAuth authorize at
// https://auth.fanvue.com/oauth2/auth -> POST
// https://auth.fanvue.com/oauth2/token (form-urlencoded) -> GET
// https://api.fanvue.com/users/me. Every API request needs
// Authorization: Bearer <token> plus the header
// X-Fanvue-API-Version: 2025-06-26. Access tokens are short-lived
// (~1 hour); the refresh token (offline_access scope) rotates on every
// use, so every refresh persists the new pair.
// Publishing a video is three steps: POST /media/create-upload-session
// -> PUT the file to the returned presigned URL(s) -> PATCH
// /media/complete-upload-session -> POST /posts with the media id.
// Posts are subscribers-only (isSubscribersOnly: true): Fanvue is an
// 18+ platform, so nothing is ever published public.
//
// UNVERIFIED DETAILS (flagged, designed defensively — the official docs
// could not be read directly, only third-party summaries):
//   (a) No documented write:media scope exists (only read:media) — the
//       scope is requested anyway per issue #551; if Fanvue rejects it,
//       drop write:media from FANVUE_SCOPES and re-check the Developer
//       Area scope list.
//   (b) POST /posts body field conflict in sources (content +
//       isSubscribersOnly vs text + audience) — this client sends
//       content + mediaIds + isSubscribersOnly: true.
//   (c) The create-upload-session response shape is undocumented — the
//       assumed shape is the FanvueUploadSession type below (one
//       presigned URL per part, or a single uploadUrl); each step is a
//       separately exported function so it can be tested in isolation.
//       The video is uploaded as a SINGLE part (partNumber 1) to keep
//       the flow simple.
// The exact scope set must match what the user selects in the Fanvue
// Developer Area: a scope requested here but not enabled there fails
// the authorize step, and a scope enabled there but missing here is
// never granted.
//
// Secrets stay out of URLs: the app secret travels in the Basic auth
// header (token exchange) and access tokens in the Authorization header,
// so neither can surface in a logged request URL.
//---------------

import { createHash, randomBytes } from 'node:crypto';
import { FanvueError } from '@/lib/errors';

// Scopes requested at authorize time. read:self is needed for GET
// /users/me at callback time; offline_access is the standard scope for
// refresh tokens. See the header note: this set must match the Fanvue
// Developer Area selection for the app.
export const FANVUE_SCOPES = [
  'read:self',
  'read:post',
  'write:post',
  'read:media',
  // UNVERIFIED (a): no documented write:media scope exists (only
  // read:media) — requested anyway per issue #551; drop it if Fanvue
  // rejects the authorize request.
  'write:media',
  'offline_access',
] as const;

export const FANVUE_API_BASE = 'https://api.fanvue.com';
export const FANVUE_AUTHORIZE_URL = 'https://auth.fanvue.com/oauth2/auth';
export const FANVUE_TOKEN_URL = 'https://auth.fanvue.com/oauth2/token';
// Required on every api.fanvue.com request (not on the auth host).
export const FANVUE_API_VERSION = '2025-06-26';
const REQUEST_TIMEOUT_MS = 15_000;
// The vault byte upload is not a JSON API call: a real video cannot cross
// in 15s. Give the transfer its own budget — the same 10 minutes the
// Pinterest client allows for uploads.
export const FANVUE_UPLOAD_TIMEOUT_MS = 10 * 60_000;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new FanvueError(`FANVUE_ENV_MISSING: ${name} is not defined`, 500);
  }
  return value;
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readOptionalString(body: JsonRecord, key: string): string | null {
  const value = body[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

function readOptionalNumber(body: JsonRecord, key: string): number | null {
  const value = body[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readOptionalBoolean(body: JsonRecord, key: string): boolean | null {
  const value = body[key];
  return typeof value === 'boolean' ? value : null;
}

// Only Fanvue's own error message is surfaced, never the request itself.
function describeFailure(body: JsonRecord | null, status: number): string {
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
// fanvueFetch — one api.fanvue.com call. Non-2xx, a non-JSON body (a
// proxy can answer with HTML) and a non-object body are all failures;
// the error message is "CODE: detail" so callers and telemetry read a
// stable code. Every call carries X-Fanvue-API-Version.
//---------------
async function fanvueFetch(code: string, url: string, init: RequestInit = {}): Promise<JsonRecord> {
  const headers = {
    'X-Fanvue-API-Version': FANVUE_API_VERSION,
    ...((init.headers as Record<string, string> | undefined) ?? {}),
  };
  const response = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  const parsed: unknown = await response.json().catch(() => null);
  const body = isRecord(parsed) ? parsed : null;
  if (!response.ok) {
    throw new FanvueError(`${code}: ${describeFailure(body, response.status)}`, response.status);
  }
  if (body === null) {
    throw new FanvueError(`${code}: invalid response body`, 502);
  }
  return body;
}

function bearer(accessToken: string): RequestInit {
  return { headers: { Authorization: `Bearer ${accessToken}` } };
}

function basicAuthHeader(): string {
  const clientId = requireEnv('FANVUE_CLIENT_ID');
  const clientSecret = requireEnv('FANVUE_CLIENT_SECRET');
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
    client_id: requireEnv('FANVUE_CLIENT_ID'),
    redirect_uri: redirectUriOverride ?? requireEnv('FANVUE_REDIRECT_URI'),
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
    throw new FanvueError(`FANVUE_TOKEN_FAILED: ${describeFailure(body, response.status)}`, response.status);
  }
  if (body === null) throw new FanvueError('FANVUE_TOKEN_FAILED: invalid response body', 502);
  return readToken(body, 'FANVUE_TOKEN_FAILED');
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
    redirect_uri: redirectUriOverride ?? requireEnv('FANVUE_REDIRECT_URI'),
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
// providerAccountId, the display name (falling back to the username) is
// the account name. Avatar/cover/bio are NOT managed here: Fanvue has
// no documented endpoints for them, and the public areas stay SFW by
// not managing them.
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
    username: readOptionalString(body, 'username'),
    displayName: readOptionalString(body, 'displayName'),
    email: readOptionalString(body, 'email'),
    avatarUrl: readOptionalString(body, 'avatarUrl'),
    isCreator: readOptionalBoolean(body, 'isCreator') ?? false,
    createdAt: readOptionalString(body, 'createdAt'),
  };
}

//---------------
// FanvueUploadSession — the assumed shape of the
// POST /media/create-upload-session response (UNVERIFIED (c): the shape
// is undocumented). One presigned URL per part; a single `uploadUrl`
// string is accepted as part 1. The session id is `uploadSessionId`
// (an `id` field is accepted as a fallback).
//---------------
export interface FanvueUploadSession {
  uploadSessionId: string;
  uploadUrls: { partNumber: number; url: string }[];
}

function readUploadSession(body: JsonRecord): FanvueUploadSession {
  const uploadSessionId =
    readOptionalString(body, 'uploadSessionId') ?? readOptionalString(body, 'id');
  if (uploadSessionId === null) {
    throw new FanvueError('FANVUE_UPLOAD_FAILED: missing uploadSessionId', 502);
  }
  const uploadUrls: { partNumber: number; url: string }[] = [];
  const singleUrl = readOptionalString(body, 'uploadUrl');
  if (singleUrl !== null) uploadUrls.push({ partNumber: 1, url: singleUrl });
  const list = body.uploadUrls;
  if (Array.isArray(list)) {
    for (const entry of list) {
      if (!isRecord(entry)) continue;
      const url = readOptionalString(entry, 'url');
      const partNumber = readOptionalNumber(entry, 'partNumber');
      if (url !== null && partNumber !== null) uploadUrls.push({ partNumber, url });
    }
  }
  if (uploadUrls.length === 0) {
    throw new FanvueError('FANVUE_UPLOAD_FAILED: missing uploadUrl', 502);
  }
  uploadUrls.sort((a, b) => a.partNumber - b.partNumber);
  return { uploadSessionId, uploadUrls };
}

//---------------
// createFanvueUploadSession — step 1 of the vault upload: registers the
// file (name, type, size) and returns the session id + presigned URL(s).
//---------------
export async function createFanvueUploadSession(
  accessToken: string,
  input: { filename: string; contentType: string; fileSize: number },
): Promise<FanvueUploadSession> {
  const body = await fanvueFetch(
    'FANVUE_UPLOAD_FAILED',
    `${FANVUE_API_BASE}/media/create-upload-session`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        filename: input.filename,
        contentType: input.contentType,
        fileSize: input.fileSize,
      }),
    },
  );
  return readUploadSession(body);
}

//---------------
// uploadFanvueUploadPart — step 2 of the vault upload: PUTs the bytes to
// one presigned URL and returns the ETag the complete step needs. The
// presigned URL already carries its authorization, so no Bearer header
// is sent. Only the status decides (a presigned endpoint may answer
// with an empty body); a missing ETag is a failure, not a guess.
//---------------
export async function uploadFanvueUploadPart(
  uploadUrl: string,
  video: Buffer,
  contentType: string,
): Promise<string> {
  // A setTimeout-driven AbortController, not AbortSignal.timeout: the
  // deadline must stay observable under vitest's fake timers, which do not
  // fake AbortSignal.timeout.
  const uploadController = new AbortController();
  const uploadDeadline = setTimeout(() => uploadController.abort(), FANVUE_UPLOAD_TIMEOUT_MS);
  let uploaded: Response;
  try {
    uploaded = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: new Blob([new Uint8Array(video)], { type: contentType }),
      signal: uploadController.signal,
    });
  } finally {
    clearTimeout(uploadDeadline);
  }
  if (!uploaded.ok) {
    throw new FanvueError(`FANVUE_UPLOAD_FAILED: status ${uploaded.status}`, uploaded.status);
  }
  const etag = uploaded.headers.get('etag');
  if (etag === null || etag === '') {
    throw new FanvueError('FANVUE_UPLOAD_FAILED: missing etag', 502);
  }
  return etag;
}

//---------------
// completeFanvueUploadSession — step 3 of the vault upload: tells Fanvue
// the parts landed; returns the media id the post needs. The completed
// media id is read as `mediaId` (an `id` field is accepted as a
// fallback) — part of the undocumented response shape (c).
//---------------
export async function completeFanvueUploadSession(
  accessToken: string,
  uploadSessionId: string,
  parts: { partNumber: number; etag: string }[],
): Promise<string> {
  const body = await fanvueFetch(
    'FANVUE_UPLOAD_FAILED',
    `${FANVUE_API_BASE}/media/complete-upload-session`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ uploadSessionId, parts }),
    },
  );
  const mediaId = readOptionalString(body, 'mediaId') ?? readOptionalString(body, 'id');
  if (mediaId === null) {
    throw new FanvueError('FANVUE_UPLOAD_FAILED: missing mediaId', 502);
  }
  return mediaId;
}

export interface UploadVideoToFanvueVaultInput {
  accessToken: string;
  video: Buffer;
  filename: string;
  contentType: string;
}

//---------------
// uploadVideoToFanvueVault — the three vault steps as one call: create
// the session, upload the video as a SINGLE part (partNumber 1 — the
// presigned URL for part 1, or the only URL when one is returned), then
// complete the session. Returns the media uuid for POST /posts.
//---------------
export async function uploadVideoToFanvueVault(
  input: UploadVideoToFanvueVaultInput,
): Promise<string> {
  const session = await createFanvueUploadSession(input.accessToken, {
    filename: input.filename,
    contentType: input.contentType,
    fileSize: input.video.length,
  });
  const firstPart = session.uploadUrls.find((entry) => entry.partNumber === 1) ?? session.uploadUrls[0];
  const etag = await uploadFanvueUploadPart(firstPart.url, input.video, input.contentType);
  return completeFanvueUploadSession(input.accessToken, session.uploadSessionId, [
    { partNumber: 1, etag },
  ]);
}

export interface CreateFanvuePostInput {
  accessToken: string;
  mediaId: string;
  content: string;
}

export interface FanvuePublishResult {
  postId: string;
}

//---------------
// createFanvuePost — publishes the uploaded video as a post. Every post
// is subscribers-only (isSubscribersOnly: true): Fanvue is an 18+
// platform, so a public post is never created. The body shape is the
// content + mediaIds + isSubscribersOnly form (UNVERIFIED (b): sources
// disagree with a text + audience form). No permalink is returned:
// Fanvue documents no public post URL.
//---------------
export async function createFanvuePost(
  input: CreateFanvuePostInput,
): Promise<FanvuePublishResult> {
  const body = await fanvueFetch(
    'FANVUE_PUBLISH_FAILED',
    `${FANVUE_API_BASE}/posts`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${input.accessToken}` },
      body: JSON.stringify({
        content: input.content,
        mediaIds: [input.mediaId],
        isSubscribersOnly: true,
      }),
    },
  );
  const postId = readOptionalString(body, 'id') ?? readOptionalString(body, 'uuid');
  if (postId === null) throw new FanvueError('FANVUE_PUBLISH_FAILED: missing id', 502);
  return { postId };
}
