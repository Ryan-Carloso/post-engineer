//---------------
// 3Speak (Hive) — publish videos to the Hive-based video platform.
//
// Documented flow (verified 2026-11-09, issue #512), from 3Speak dev
// @sagarkothari88's Ecency-integration write-up and the open-source sample
// (github.com/spknetwork/legacy-studio-frontend-poc-react, legacy.3speak.tv):
//   1. GET studio.3speak.tv/mobile/login?username=<user> -> { memo }
//   2. Decrypt the memo with the Hive POSTING key (hive.memo.decode, or Hive
//      Keychain requestVerifyKey in a browser) -> JWT access token.
//   3. TUS resumable upload of the video file to uploads.3speak.tv/files/
//      (tus-js-client in the sample; no auth header on the TUS calls).
//   4. POST studio.3speak.tv/mobile/api/upload_info {filename (TUS URL),
//      oFilename, size, duration, thumbnail, owner, isReel} + Bearer JWT.
//   5. POST studio.3speak.tv/mobile/api/update_info {videoId, title,
//      description, tags, thumbnail, beneficiaries, isNsfwContent,
//      communityID} + Bearer JWT — this publishes the Hive post.
//
// Auth is key-based, not OAuth: the user pastes their Hive posting key
// (like the Bluesky app password), it is validated against Studio before
// saving and stored encrypted. The posting key can post and vote but cannot
// move funds. There is no refresh endpoint documented: every publish mints
// a fresh JWT with the stored key.
//
// Caveat from the author: these APIs "may get deprecated in near future" —
// 3Speak is rewriting its backend. The newer embed-upload service
// (embed.3speak.tv/uploads) needs a team-issued API key and is not used
// here; switching to it is a follow-up, not part of this provider.
//---------------

import { Memo, PrivateKey } from '@hiveio/dhive';

export const THREESPEAK_STUDIO_ENDPOINT = 'https://studio.3speak.tv';
export const THREESPEAK_TUS_ENDPOINT = 'https://uploads.3speak.tv/files/';
export const THREESPEAK_WATCH_ORIGIN = 'https://3speak.tv';
// The 3Speak community id, per the sample code ("it's threespeak
// community-id. It can be anything" — the community the post is filed in).
export const THREESPEAK_COMMUNITY_ID = 'hive-181335';

// Our own title truncation for update_info, not a platform cap: Hive post
// titles are conventionally short, and the caption's first line is the
// title. The description carries the full caption.
export const THREESPEAK_TITLE_MAX_CHARS = 200;

// Upload size cap, enforced before buffering: 3Speak documents no cap,
// so this matches the MCP direct-publish cap (2GB) and the YouTube handler.
export const THREESPEAK_VIDEO_MAX_BYTES = 2 * 1024 * 1024 * 1024;

const JSON_TIMEOUT_MS = 30_000;
const TUS_TIMEOUT_MS = 120_000;
const TUS_CHUNK_BYTES = 5 * 1024 * 1024;

//---------------
// ThreespeakError — errors with a classifiable cause, mirroring
// BlueskyError. 'invalid_credentials' is the dead-key signal: the
// connect route maps it to 422 and the publish handler reports the
// account through publish_account_unauthorized.
//---------------
export class ThreespeakError extends Error {
  readonly code: 'invalid_credentials' | 'login_failed' | 'upload_failed' | 'register_failed' | 'publish_failed' | 'unknown';
  readonly status?: number;

  constructor(code: ThreespeakError['code'], message: string, options?: { cause?: unknown; status?: number }) {
    super(message);
    this.name = 'ThreespeakError';
    this.code = code;
    if (options?.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
    if (options?.status !== undefined) this.status = options.status;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

//---------------
// Hive usernames: 3-16 chars, lowercase letters/digits/dots/dashes,
// starting with a letter, never ending in (or doubling) a dot or dash.
// The login call would reject a bad name anyway; this fails fast with a
// clear message before any network call.
//---------------
const HIVE_USERNAME_PATTERN = /^[a-z]([a-z0-9]|[-.][a-z0-9]){2,15}$/;

export function normalizeHiveUsername(username: string): string {
  const normalized = username.trim().toLowerCase();
  if (!HIVE_USERNAME_PATTERN.test(normalized)) {
    throw new ThreespeakError('invalid_credentials', 'Invalid Hive username.');
  }
  return normalized;
}

function readString(body: Record<string, unknown>, key: string): string | null {
  const value = body[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

async function readJsonBody(response: Response): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return {};
  }
  return typeof body === 'object' && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
}

//---------------
// loginToThreespeak — mint a Studio JWT: GET the encrypted memo, decrypt
// it with the posting key. The decrypted memo is the JWT; the sample's
// Keychain path strips a leading '#' from the decoded message, so this
// does the same. The key and the token never appear in an error message.
//---------------
export async function loginToThreespeak(
  username: string,
  postingKey: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ username: string; accessToken: string }> {
  const normalized = normalizeHiveUsername(username);
  let privateKey: InstanceType<typeof PrivateKey>;
  try {
    privateKey = PrivateKey.fromString(postingKey.trim());
  } catch {
    throw new ThreespeakError('invalid_credentials', 'Invalid Hive posting key.');
  }

  let response: Response;
  try {
    response = await fetchFn(
      `${THREESPEAK_STUDIO_ENDPOINT}/mobile/login?username=${encodeURIComponent(normalized)}`,
      {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(JSON_TIMEOUT_MS),
      },
    );
  } catch (error) {
    throw new ThreespeakError('login_failed', `3Speak login failed: ${errorMessage(error)}`, { cause: error });
  }
  if (response.status === 404) {
    throw new ThreespeakError('invalid_credentials', 'Unknown Hive username.');
  }
  if (!response.ok) {
    throw new ThreespeakError('login_failed', `3Speak login failed (HTTP ${response.status}).`, { status: response.status });
  }
  const memo = readString(await readJsonBody(response), 'memo');
  if (memo === null) {
    throw new ThreespeakError('login_failed', '3Speak login returned no memo.');
  }
  let accessToken: string;
  try {
    accessToken = Memo.decode(privateKey, memo);
  } catch {
    throw new ThreespeakError(
      'invalid_credentials',
      'Could not decrypt the 3Speak login memo with this posting key.',
    );
  }
  // The decoded message carries a leading '#' (see the sample's
  // `response.result.replace("#", "")`); the JWT itself has none.
  if (accessToken.startsWith('#')) accessToken = accessToken.slice(1);
  if (accessToken === '') {
    throw new ThreespeakError('invalid_credentials', '3Speak login returned an empty access token.');
  }
  return { username: normalized, accessToken };
}

//---------------
// parseMp4DurationSeconds — duration from the moov/mvhd box (timescale +
// duration), version 0 (32-bit) and version 1 (64-bit). The engine videos
// are MP4; returns null when the bytes are not a parseable MP4 so the
// caller can fall back instead of failing the publish.
//---------------
export function parseMp4DurationSeconds(buffer: Buffer): number | null {
  let offset = 0;
  while (offset + 8 <= buffer.length) {
    const size = buffer.readUInt32BE(offset);
    const type = buffer.toString('latin1', offset + 4, offset + 8);
    if (size < 8 || offset + size > buffer.length) return null;
    if (type === 'moov') return parseMvhd(buffer.subarray(offset + 8, offset + size));
    offset += size;
  }
  return null;
}

function parseMvhd(moov: Buffer): number | null {
  let offset = 0;
  while (offset + 8 <= moov.length) {
    const size = moov.readUInt32BE(offset);
    const type = moov.toString('latin1', offset + 4, offset + 8);
    if (size < 8 || offset + size > moov.length) return null;
    if (type === 'mvhd') {
      const box = moov.subarray(offset, offset + size);
      // version (1) + flags (3) + creation (4/8) + modification (4/8).
      if (box.length < 9) return null;
      const version = box.readUInt8(8);
      if (version === 0) {
        if (box.length < 28) return null;
        const timescale = box.readUInt32BE(20);
        if (timescale === 0) return null;
        return box.readUInt32BE(24) / timescale;
      }
      if (version === 1) {
        if (box.length < 40) return null;
        const timescale = box.readUInt32BE(28);
        if (timescale === 0) return null;
        const duration = box.readBigUInt64BE(32);
        return Number(duration) / timescale;
      }
      return null;
    }
    offset += size;
  }
  return null;
}

//---------------
// TUS upload — minimal TUS 1.0.0 client over fetch, following the sample
// (tus-js-client): POST creation with Upload-Length + Upload-Metadata
// (filename/filetype, base64), then PATCH chunks with Upload-Offset. A
// failed PATCH HEADs the upload URL once and resumes from the server's
// offset instead of restarting. Returns the video URL the sample passes
// to upload_info: the upload URL with the endpoint prefix stripped.
//---------------
function tusMetadata(filename: string, contentType: string): string {
  const encode = (value: string): string => Buffer.from(value, 'utf8').toString('base64');
  return `filename ${encode(filename)},filetype ${encode(contentType)}`;
}

async function tusHeadOffset(uploadUrl: string, fetchFn: typeof fetch): Promise<number> {
  const response = await fetchFn(uploadUrl, {
    method: 'HEAD',
    headers: { 'Tus-Resumable': '1.0.0' },
    signal: AbortSignal.timeout(TUS_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new ThreespeakError('upload_failed', `3Speak upload status check failed (HTTP ${response.status}).`, {
      status: response.status,
    });
  }
  const offset = Number(response.headers.get('Upload-Offset'));
  if (!Number.isFinite(offset) || offset < 0) {
    throw new ThreespeakError('upload_failed', '3Speak upload returned no offset.');
  }
  return offset;
}

export async function tusUploadVideo(
  video: Buffer,
  filename: string,
  contentType: string,
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  let createResponse: Response;
  try {
    createResponse = await fetchFn(THREESPEAK_TUS_ENDPOINT, {
      method: 'POST',
      headers: {
        'Tus-Resumable': '1.0.0',
        'Upload-Length': String(video.length),
        'Upload-Metadata': tusMetadata(filename, contentType),
      },
      signal: AbortSignal.timeout(TUS_TIMEOUT_MS),
    });
  } catch (error) {
    throw new ThreespeakError('upload_failed', `3Speak upload failed: ${errorMessage(error)}`, { cause: error });
  }
  if (createResponse.status !== 201) {
    throw new ThreespeakError('upload_failed', `3Speak upload creation failed (HTTP ${createResponse.status}).`, {
      status: createResponse.status,
    });
  }
  const location = createResponse.headers.get('Location');
  if (location === null || location === '') {
    throw new ThreespeakError('upload_failed', '3Speak upload creation returned no location.');
  }
  const uploadUrl = location.startsWith('http') ? location : `${THREESPEAK_TUS_ENDPOINT}${location.replace(/^\//, '')}`;

  let offset = 0;
  let resumed = false;
  while (offset < video.length) {
    const chunk = video.subarray(offset, Math.min(video.length, offset + TUS_CHUNK_BYTES));
    let response: Response;
    try {
      response = await fetchFn(uploadUrl, {
        method: 'PATCH',
        headers: {
          'Tus-Resumable': '1.0.0',
          'Content-Type': 'application/offset+octet-stream',
          'Upload-Offset': String(offset),
        },
        body: chunk as unknown as BodyInit,
        signal: AbortSignal.timeout(TUS_TIMEOUT_MS),
      });
    } catch (error) {
      if (resumed) {
        throw new ThreespeakError('upload_failed', `3Speak upload failed: ${errorMessage(error)}`, { cause: error });
      }
      // One resume: ask the server where it got to and continue from there.
      resumed = true;
      offset = await tusHeadOffset(uploadUrl, fetchFn);
      continue;
    }
    if (response.status !== 204) {
      if (!resumed) {
        resumed = true;
        offset = await tusHeadOffset(uploadUrl, fetchFn);
        continue;
      }
      throw new ThreespeakError('upload_failed', `3Speak upload failed (HTTP ${response.status}).`, {
        status: response.status,
      });
    }
    const serverOffset = Number(response.headers.get('Upload-Offset'));
    offset = Number.isFinite(serverOffset) && serverOffset > offset ? serverOffset : offset + chunk.length;
  }

  // The sample passes upload.url with the endpoint stripped as upload_info's
  // `filename` — the upload id, not a public URL.
  return uploadUrl.startsWith(THREESPEAK_TUS_ENDPOINT)
    ? uploadUrl.slice(THREESPEAK_TUS_ENDPOINT.length)
    : uploadUrl;
}

//---------------
// registerThreespeakVideo — POST /mobile/api/upload_info. The sample's
// payload, with real size/duration instead of its hardcoded constants.
// Returns the video id the sample stores for update_info.
//---------------
export interface ThreespeakUploadInfoInput {
  videoUrl: string;
  oFilename: string;
  size: number;
  duration: number;
  thumbnail: string;
  owner: string;
  isReel: boolean;
}

export async function registerThreespeakVideo(
  accessToken: string,
  input: ThreespeakUploadInfoInput,
  fetchFn: typeof fetch = fetch,
): Promise<{ videoId: string; thumbnail: string | null }> {
  let response: Response;
  try {
    response = await fetchFn(`${THREESPEAK_STUDIO_ENDPOINT}/mobile/api/upload_info`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        filename: input.videoUrl,
        oFilename: input.oFilename,
        size: input.size,
        duration: input.duration,
        thumbnail: input.thumbnail,
        owner: input.owner,
        isReel: input.isReel,
      }),
      signal: AbortSignal.timeout(JSON_TIMEOUT_MS),
    });
  } catch (error) {
    throw new ThreespeakError('register_failed', `3Speak upload_info failed: ${errorMessage(error)}`, { cause: error });
  }
  if (!response.ok) {
    throw new ThreespeakError('register_failed', `3Speak upload_info failed (HTTP ${response.status}).`, {
      status: response.status,
    });
  }
  const body = await readJsonBody(response);
  const videoId = readString(body, '_id');
  if (videoId === null) {
    throw new ThreespeakError('register_failed', '3Speak upload_info returned no video id.');
  }
  return { videoId, thumbnail: readString(body, 'thumbnail') };
}

//---------------
// updateThreespeakVideoInfo — POST /mobile/api/update_info: the call that
// publishes the Hive post for the uploaded video. The permlink is read
// best-effort: the sample logs the response without using it, and the
// watch URL needs it. A null permlink still counts as published — the
// handler returns the video id.
//---------------
export interface ThreespeakPublishMetadataInput {
  videoId: string;
  title: string;
  description: string;
  tags: string[];
  thumbnail: string;
}

export async function updateThreespeakVideoInfo(
  accessToken: string,
  input: ThreespeakPublishMetadataInput,
  fetchFn: typeof fetch = fetch,
): Promise<{ permlink: string | null }> {
  let response: Response;
  try {
    response = await fetchFn(`${THREESPEAK_STUDIO_ENDPOINT}/mobile/api/update_info`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        beneficiaries: '',
        description: input.description,
        videoId: input.videoId,
        title: input.title,
        isNsfwContent: false,
        tags: input.tags.join(','),
        thumbnail: input.thumbnail,
        communityID: THREESPEAK_COMMUNITY_ID,
      }),
      signal: AbortSignal.timeout(JSON_TIMEOUT_MS),
    });
  } catch (error) {
    throw new ThreespeakError('publish_failed', `3Speak update_info failed: ${errorMessage(error)}`, { cause: error });
  }
  if (!response.ok) {
    throw new ThreespeakError('publish_failed', `3Speak update_info failed (HTTP ${response.status}).`, {
      status: response.status,
    });
  }
  return { permlink: readString(await readJsonBody(response), 'permlink') };
}

//---------------
// extractHashtags — #tag tokens from the caption, lowercased and deduped.
// The post always carries 'threespeak' so it surfaces in the 3Speak feed.
//---------------
export function extractHashtags(caption: string): string[] {
  const tags: string[] = [];
  for (const match of caption.matchAll(/#([A-Za-z0-9_-]+)/g)) {
    const tag = match[1].toLowerCase();
    if (!tags.includes(tag)) tags.push(tag);
  }
  return tags;
}

export function threespeakWatchUrl(owner: string, permlink: string): string {
  return `${THREESPEAK_WATCH_ORIGIN}/watch?v=${owner}/${permlink}`;
}

//---------------
// publishThreespeakVideo — the whole flow: login, TUS upload, upload_info,
// update_info. Duration comes from the MP4 header when parseable (the
// sample hardcodes it); engine videos carry no thumbnail, so upload_info
// gets an empty one. The title is the caption's first line, truncated —
// the description carries the full caption.
//---------------
export interface PublishThreespeakVideoInput {
  username: string;
  postingKey: string;
  video: Buffer;
  filename: string;
  contentType: string;
  caption: string;
}

export async function publishThreespeakVideo(
  input: PublishThreespeakVideoInput,
  fetchFn: typeof fetch = fetch,
): Promise<{ videoId: string; permalink: string | null }> {
  const { username, accessToken } = await loginToThreespeak(input.username, input.postingKey, fetchFn);
  const videoUrl = await tusUploadVideo(input.video, input.filename, input.contentType, fetchFn);
  const duration = parseMp4DurationSeconds(input.video) ?? 0;
  const { videoId } = await registerThreespeakVideo(
    accessToken,
    {
      videoUrl,
      oFilename: input.filename,
      size: input.video.length,
      duration,
      thumbnail: '',
      owner: username,
      isReel: false,
    },
    fetchFn,
  );
  const title = input.caption.split('\n')[0].trim().slice(0, THREESPEAK_TITLE_MAX_CHARS);
  const tags = ['threespeak', ...extractHashtags(input.caption)];
  const { permlink } = await updateThreespeakVideoInfo(
    accessToken,
    {
      videoId,
      title: title === '' ? videoId : title,
      description: input.caption,
      tags,
      thumbnail: '',
    },
    fetchFn,
  );
  return { videoId, permalink: permlink === null ? null : threespeakWatchUrl(username, permlink) };
}
