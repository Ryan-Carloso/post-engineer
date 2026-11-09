//---------------
// Rumble — Simple Upload API client.
//
// Documentation (2026): https://help.rumble.com/Rumble-Upload-API.html
// (verified via its public summary 2026-11-09; the help domain itself is
// not fetchable from this sandbox, so the response field names below are
// read tolerantly — see uploadRumbleVideo).
//
// One multipart endpoint, no OAuth, no self-service signup, no sandbox:
//   POST https://rumble.com/api/simple-upload.php
//   -F access_token=<40-char token> -F title=... -F description=...
//   -F license_type=0 -F channel_id=... -F video=@video.mp4
//   -F thumb=@thumb.jpg (optional) -F cc_en=@captions.srt (optional)
//
// Access is gated: the token is issued manually by emailing
// bd@rumble.com with a use case. There is no rotation endpoint, no
// scoped tokens, and no read API (no video metadata, stats, comments or
// analytics endpoint), no webhooks, and no event stream — the upload
// response is the only confirmation a publish ever gets.
//
// Secrets stay out of URLs: the access token travels as a multipart form
// field, never as a query param, so it cannot surface in a logged
// request URL.
//---------------

import { RumbleError } from '@/lib/errors';

// Rumble's upload-form ceiling; the engine (publish_rumble.py) and the
// draft scorer pin the same value.
export const RUMBLE_TITLE_MAX_LENGTH = 100;
export const RUMBLE_SIMPLE_UPLOAD_URL = 'https://rumble.com/api/simple-upload.php';
// Rumble's documented license values: 0 = Personal Use / not for sale,
// 6 = Rumble Only. Only 0 is ever sent: 6 locks the video into an
// exclusivity license that cannot be changed after upload.
export const RUMBLE_LICENSE_TYPE_PERSONAL_USE = 0;
// The access token is a static 40-char hex string, issued manually.
export const RUMBLE_ACCESS_TOKEN_PATTERN = /^[0-9a-f]{40}$/i;
// Video bytes ride the request body, so the timeout covers the upload
// itself (same 10-minute budget the engine allows the internal upload API).
const RUMBLE_UPLOAD_TIMEOUT_MS = 600_000;

export function isValidRumbleAccessToken(value: string): boolean {
  return RUMBLE_ACCESS_TOKEN_PATTERN.test(value);
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readOptionalString(body: JsonRecord, key: string): string | null {
  const value = body[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

//---------------
// uploadRumbleVideo — posts the video to the channel and returns the
// video id plus its public URL (null when Rumble did not return one).
// The response shape is read tolerantly: the documented fields are a
// success flag, a video id, a monetized URL and embed HTML/JS, but the
// exact JSON keys are not pinned by a fetchable doc, so every alias the
// API is known to use is tried in order. An error object (or a
// success:false flag) is a RumbleError, never a silent success — and a
// message naming an invalid token carries the 'invalid_token' code so
// the publish handler can report the dead account for reconnecting.
//---------------
export interface RumblePublishResult {
  videoId: string;
  url: string | null;
}

export interface UploadRumbleVideoInput {
  accessToken: string;
  channelId: string;
  title: string;
  description: string;
  video: Blob;
  filename: string;
  contentType: string;
}

function describeFailure(body: JsonRecord | null, status: number): string {
  if (body === null) return `status ${status}`;
  const error = body.error;
  if (typeof error === 'string' && error !== '') return error;
  if (isRecord(error)) {
    const message = readOptionalString(error, 'message');
    if (message !== null) return message;
  }
  return readOptionalString(body, 'message') ?? `status ${status}`;
}

function isInvalidTokenMessage(message: string): boolean {
  return /invalid.*(access_)?token|unauthorized|access denied/i.test(message);
}

export async function uploadRumbleVideo(input: UploadRumbleVideoInput): Promise<RumblePublishResult> {
  const form = new FormData();
  form.append('access_token', input.accessToken);
  form.append('title', input.title);
  form.append('description', input.description);
  form.append('license_type', String(RUMBLE_LICENSE_TYPE_PERSONAL_USE));
  form.append('channel_id', input.channelId);
  form.append('video', input.video, input.filename);

  let response: Response;
  try {
    response = await fetch(RUMBLE_SIMPLE_UPLOAD_URL, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(RUMBLE_UPLOAD_TIMEOUT_MS),
    });
  } catch (error) {
    throw new RumbleError('upload_failed', `RUMBLE_PUBLISH_FAILED: ${error instanceof Error ? error.message : String(error)}`, 502);
  }
  const parsed: unknown = await response.json().catch(() => null);
  const body = isRecord(parsed) ? parsed : null;
  if (!response.ok) {
    const detail = describeFailure(body, response.status);
    throw new RumbleError(
      isInvalidTokenMessage(detail) ? 'invalid_token' : 'upload_failed',
      `RUMBLE_PUBLISH_FAILED: ${detail}`,
      response.status,
    );
  }
  if (body === null) {
    throw new RumbleError('upload_failed', 'RUMBLE_PUBLISH_FAILED: invalid response body', 502);
  }
  if (body.success === false) {
    const detail = describeFailure(body, response.status);
    throw new RumbleError(
      isInvalidTokenMessage(detail) ? 'invalid_token' : 'upload_failed',
      `RUMBLE_PUBLISH_FAILED: ${detail}`,
      response.status,
    );
  }
  if (body.error !== undefined && body.error !== null) {
    const detail = describeFailure(body, response.status);
    throw new RumbleError(
      isInvalidTokenMessage(detail) ? 'invalid_token' : 'upload_failed',
      `RUMBLE_PUBLISH_FAILED: ${detail}`,
      response.status,
    );
  }
  const videoId =
    readOptionalString(body, 'video_id') ??
    readOptionalString(body, 'videoId') ??
    readOptionalString(body, 'id');
  if (videoId === null) {
    throw new RumbleError('upload_failed', 'RUMBLE_PUBLISH_FAILED: missing video id', 502);
  }
  const url =
    readOptionalString(body, 'url') ??
    readOptionalString(body, 'video_url') ??
    readOptionalString(body, 'monetized_url') ??
    readOptionalString(body, 'permalink');
  return { videoId, url };
}
