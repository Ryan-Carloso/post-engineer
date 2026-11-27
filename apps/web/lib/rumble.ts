import { RumbleError } from '@/lib/errors';

export const RUMBLE_TITLE_MAX_LENGTH = 100;
export const RUMBLE_SIMPLE_UPLOAD_URL = 'https://rumble.com/api/simple-upload.php';
export const RUMBLE_LICENSE_TYPE_PERSONAL_USE = 0;
const RUMBLE_ACCESS_TOKEN_PATTERN = /^[0-9a-f]{40}$/i;
const RUMBLE_UPLOAD_TIMEOUT_MS = 600_000;
export const RUMBLE_VIDEO_MAX_BYTES = 4 * 1024 * 1024 * 1024;

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
