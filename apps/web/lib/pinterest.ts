import { PinterestError } from '@/lib/errors';

export const PINTEREST_TITLE_MAX_CHARS = 100;
export const PINTEREST_DESCRIPTION_MAX_CHARS = 800;
export const PINTEREST_VIDEO_MAX_BYTES = 2 * 1024 * 1024 * 1024;

export const PINTEREST_SCOPES = [
  'boards:read',
  'boards:write',
  'pins:read',
  'pins:write',
  'user_accounts:read',
] as const;

const PINTEREST_API = 'https://api.pinterest.com/v5';
const PINTEREST_OAUTH_URL = 'https://www.pinterest.com/oauth/';
const REQUEST_TIMEOUT_MS = 15_000;
export const PINTEREST_UPLOAD_TIMEOUT_MS = 10 * 60_000;
export const PINTEREST_MEDIA_MAX_POLLS = 24;
export const PINTEREST_MEDIA_POLL_INTERVAL_MS = 5_000;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new PinterestError(`PINTEREST_ENV_MISSING: ${name} is not defined`, 500);
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

function describeFailure(body: JsonRecord | null, status: number): string {
  const message = body === null ? null : readOptionalString(body, 'message');
  const code = body === null ? null : readOptionalNumber(body, 'code');
  if (message !== null) return code === null ? message : `${code}: ${message}`;
  return `status ${status}`;
}

async function pinterestFetch(code: string, url: string, init: RequestInit = {}): Promise<JsonRecord> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  const parsed: unknown = await response.json().catch(() => null);
  const body = isRecord(parsed) ? parsed : null;
  if (!response.ok) {
    throw new PinterestError(`${code}: ${describeFailure(body, response.status)}`, response.status);
  }
  if (body === null) {
    throw new PinterestError(`${code}: invalid response body`, 502);
  }
  return body;
}

function bearer(accessToken: string): RequestInit {
  return { headers: { Authorization: `Bearer ${accessToken}` } };
}

function basicAuthHeader(): string {
  const clientId = requireEnv('PINTEREST_CLIENT_ID');
  const clientSecret = requireEnv('PINTEREST_CLIENT_SECRET');
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
}

export function buildPinterestAuthorizationUrl(state: string, redirectUriOverride?: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: requireEnv('PINTEREST_CLIENT_ID'),
    redirect_uri: redirectUriOverride ?? requireEnv('PINTEREST_REDIRECT_URI'),
    state,
    scope: PINTEREST_SCOPES.join(','),
  });
  return `${PINTEREST_OAUTH_URL}?${params.toString()}`;
}

export interface PinterestToken {
  access_token: string;
  refresh_token: string | null;
  expires_in: number;
  token_type: string;
}

function readToken(body: JsonRecord, code: string): PinterestToken {
  const accessToken = readOptionalString(body, 'access_token');
  if (accessToken === null) throw new PinterestError(`${code}: missing access_token`, 502);
  return {
    access_token: accessToken,
    refresh_token: readOptionalString(body, 'refresh_token'),
    expires_in: readOptionalNumber(body, 'expires_in') ?? 30 * 24 * 60 * 60,
    token_type: readOptionalString(body, 'token_type') ?? 'Bearer',
  };
}

async function exchangeToken(params: Record<string, string>): Promise<PinterestToken> {
  const response = await fetch(`${PINTEREST_API}/oauth/token`, {
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
    throw new PinterestError(`PINTEREST_TOKEN_FAILED: ${describeFailure(body, response.status)}`, response.status);
  }
  if (body === null) throw new PinterestError('PINTEREST_TOKEN_FAILED: invalid response body', 502);
  return readToken(body, 'PINTEREST_TOKEN_FAILED');
}

export async function exchangePinterestCodeForToken(
  code: string,
  redirectUriOverride?: string,
): Promise<PinterestToken> {
  return exchangeToken({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUriOverride ?? requireEnv('PINTEREST_REDIRECT_URI'),
  });
}

export async function refreshPinterestAccessToken(refreshToken: string): Promise<PinterestToken> {
  return exchangeToken({ grant_type: 'refresh_token', refresh_token: refreshToken });
}

export interface PinterestUserProfile {
  id: string;
  username: string | null;
  profileImage: string | null;
}

export async function fetchPinterestUserProfile(accessToken: string): Promise<PinterestUserProfile> {
  const body = await pinterestFetch(
    'PINTEREST_PROFILE_FAILED',
    `${PINTEREST_API}/user_account`,
    bearer(accessToken),
  );
  const id = readOptionalString(body, 'id');
  if (id === null) throw new PinterestError('PINTEREST_PROFILE_FAILED: missing id', 502);
  return {
    id,
    username: readOptionalString(body, 'username'),
    profileImage: readOptionalString(body, 'profile_image'),
  };
}

export interface PinterestBoard {
  id: string;
  name: string | null;
  description: string | null;
}

export const MAX_BOARD_LIST_PAGES = 5;

export async function fetchPinterestBoards(accessToken: string): Promise<PinterestBoard[]> {
  const boards: PinterestBoard[] = [];
  let bookmark: string | null = null;

  for (let index = 0; index < MAX_BOARD_LIST_PAGES; index += 1) {
    const query = new URLSearchParams({ page_size: '100' });
    if (bookmark !== null) query.set('bookmark', bookmark);
    const body: JsonRecord = await pinterestFetch(
      'PINTEREST_BOARDS_FAILED',
      `${PINTEREST_API}/boards?${query.toString()}`,
      bearer(accessToken),
    );
    const entries: unknown[] = Array.isArray(body.items) ? body.items : [];
    for (const entry of entries) {
      if (!isRecord(entry)) continue;
      const id = readOptionalString(entry, 'id');
      if (id === null) continue;
      boards.push({
        id,
        name: readOptionalString(entry, 'name'),
        description: readOptionalString(entry, 'description'),
      });
    }
    bookmark = readOptionalString(body, 'bookmark');
    if (bookmark === null) break;
  }
  return boards;
}

export interface PublishPinterestVideoInput {
  accessToken: string;
  boardId: string;
  video: Buffer;
  filename: string;
  contentType: string;
  title?: string;
  description?: string;
  coverImageUrl?: string;
  coverImageKeyFrameTime?: number;
  maxPolls?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface PinterestPublishResult {
  pinId: string;
  permalink: string;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function readUploadParameters(body: JsonRecord): { uploadUrl: string; parameters: Record<string, string> } {
  const uploadUrl = readOptionalString(body, 'upload_url');
  const mediaId = readOptionalString(body, 'media_id');
  const parameters = body.upload_parameters;
  if (uploadUrl === null || mediaId === null || !isRecord(parameters)) {
    throw new PinterestError('PINTEREST_MEDIA_FAILED: missing upload_url, media_id or upload_parameters', 502);
  }
  const flat: Record<string, string> = {};
  for (const [key, value] of Object.entries(parameters)) {
    if (typeof value === 'string') flat[key] = value;
  }
  return { uploadUrl, parameters: flat };
}

export async function publishPinterestVideo(
  input: PublishPinterestVideoInput,
): Promise<PinterestPublishResult> {
  const maxPolls = input.maxPolls ?? PINTEREST_MEDIA_MAX_POLLS;
  const sleep = input.sleep ?? defaultSleep;

  const registered = await pinterestFetch(
    'PINTEREST_MEDIA_FAILED',
    `${PINTEREST_API}/media`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${input.accessToken}` },
      body: JSON.stringify({ media_type: 'video' }),
    },
  );
  const mediaId = readOptionalString(registered, 'media_id');
  if (mediaId === null) throw new PinterestError('PINTEREST_MEDIA_FAILED: missing media_id', 502);
  const { uploadUrl, parameters } = readUploadParameters(registered);

  const form = new FormData();
  for (const [key, value] of Object.entries(parameters)) form.append(key, value);
  form.append('file', new Blob([new Uint8Array(input.video)], { type: input.contentType }), input.filename);
  const uploadController = new AbortController();
  const uploadDeadline = setTimeout(() => uploadController.abort(), PINTEREST_UPLOAD_TIMEOUT_MS);
  let uploaded: Response;
  try {
    uploaded = await fetch(uploadUrl, {
      method: 'POST',
      body: form,
      signal: uploadController.signal,
    });
  } finally {
    clearTimeout(uploadDeadline);
  }
  if (!uploaded.ok) {
    throw new PinterestError(`PINTEREST_UPLOAD_FAILED: status ${uploaded.status}`, uploaded.status);
  }

  for (let poll = 0; poll < maxPolls; poll += 1) {
    const media = await pinterestFetch(
      'PINTEREST_MEDIA_FAILED',
      `${PINTEREST_API}/media/${encodeURIComponent(mediaId)}`,
      bearer(input.accessToken),
    );
    const status = readOptionalString(media, 'status');
    if (status === 'succeeded') break;
    if (status === 'failed') {
      throw new PinterestError('PINTEREST_MEDIA_FAILED: media processing failed', 502);
    }
    if (poll === maxPolls - 1) {
      throw new PinterestError('PINTEREST_MEDIA_FAILED: media processing timed out', 504);
    }
    await sleep(PINTEREST_MEDIA_POLL_INTERVAL_MS);
  }

  const pinBody: Record<string, unknown> = {
    board_id: input.boardId,
    media_source: { source_type: 'video_id', media_id: mediaId },
  };
  if (typeof input.title === 'string' && input.title !== '') pinBody.title = input.title;
  if (typeof input.description === 'string' && input.description !== '') pinBody.description = input.description;
  if (typeof input.coverImageUrl === 'string' && input.coverImageUrl !== '') {
    pinBody.cover_image_url = input.coverImageUrl;
  } else {
    pinBody.cover_image_key_frame_time = input.coverImageKeyFrameTime ?? 0;
  }
  return createPin(input.accessToken, pinBody);
}

async function createPin(accessToken: string, pinBody: Record<string, unknown>): Promise<PinterestPublishResult> {
  const created = await pinterestFetch(
    'PINTEREST_PUBLISH_FAILED',
    `${PINTEREST_API}/pins`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(pinBody),
    },
  );
  const pinId = readOptionalString(created, 'id');
  if (pinId === null) throw new PinterestError('PINTEREST_PUBLISH_FAILED: missing id', 502);
  return { pinId, permalink: `https://www.pinterest.com/pin/${pinId}/` };
}

export interface PublishPinterestImageInput {
  accessToken: string;
  boardId: string;
  image: Buffer;
  contentType: 'image/jpeg' | 'image/png';
  title?: string;
  description?: string;
}

export async function publishPinterestImage(input: PublishPinterestImageInput): Promise<PinterestPublishResult> {
  const pinBody: Record<string, unknown> = {
    board_id: input.boardId,
    media_source: { source_type: 'image_base64', content_type: input.contentType, data: input.image.toString('base64') },
  };
  if (typeof input.title === 'string' && input.title !== '') pinBody.title = input.title;
  if (typeof input.description === 'string' && input.description !== '') pinBody.description = input.description;
  return createPin(input.accessToken, pinBody);
}
