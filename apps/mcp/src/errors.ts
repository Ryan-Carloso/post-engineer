export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export class ApiError extends Error {
  readonly code: string | null;
  readonly field: string | null;
  readonly status: number | null;
  readonly delivered: boolean;
  readonly postUrl: string | null;
  readonly retryAfterSeconds: number | null;

  constructor(
    message: string,
    code: string | null,
    field: string | null,
    status: number | null = null,
    delivered: boolean = false,
    postUrl: string | null = null,
    retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.field = field;
    this.status = status;
    this.delivered = delivered;
    this.postUrl = postUrl;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

import { MAX_PERSONA_PHOTO_MB, MAX_UPLOAD_VIDEO_GB } from './limits.js';

export class ImageTooLargeError extends Error {
  readonly path: string;
  readonly sizeBytes: number;

  constructor(path: string, sizeBytes: number) {
    super(`Image "${path}" is too large (${sizeBytes} bytes; max ${MAX_PERSONA_PHOTO_MB}MB).`);
    this.name = 'ImageTooLargeError';
    this.path = path;
    this.sizeBytes = sizeBytes;
  }
}

export class VideoTooLargeError extends Error {
  readonly path: string;
  readonly sizeBytes: number;

  constructor(path: string, sizeBytes: number) {
    super(`Video "${path}" is too large (${sizeBytes} bytes; max ${MAX_UPLOAD_VIDEO_GB}GB).`);
    this.name = 'VideoTooLargeError';
    this.path = path;
    this.sizeBytes = sizeBytes;
  }
}

const MAX_ERROR_BODY_CHARS = 200;

const TRIAL_EXPIRED_CODE = 'TRIAL_EXPIRED';
const SUBSCRIPTION_INACTIVE_CODE = 'SUBSCRIPTION_INACTIVE';

const ACCESS_BLOCKED_MESSAGES: Record<string, string> = {
  TRIAL_EXPIRED: 'The 7-day free trial has ended: scheduling and publishing are blocked, reading your data still works.',
  SUBSCRIPTION_INACTIVE:
    'The subscription covering this account is not active: scheduling and publishing are blocked, reading your data still works.',
};

function accessBlockedMessage(code: string, contactUrl: unknown): string {
  const base = ACCESS_BLOCKED_MESSAGES[code];
  if (typeof contactUrl !== 'string' || !contactUrl.startsWith('https://')) return `${base} Contact the Post Engineer team to continue.`;
  return `${base} Contact the Post Engineer team to continue: ${contactUrl.slice(0, 200)}`;
}

function listedErrorMessages(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: unknown): string[] => {
    if (typeof item !== 'object' || item === null || !('message' in item)) return [];
    return typeof item.message === 'string' ? [item.message] : [];
  });
}

export function readApiFailure(errorText: string): {
  detail: string;
  code: string | null;
  field: string | null;
  delivered: boolean;
  postUrl: string | null;
} {
  let code: string | null = null;
  let field: string | null = null;
  let delivered = false;
  let postUrl: string | null = null;
  let detail = errorText.slice(0, MAX_ERROR_BODY_CHARS);
  try {
    const parsed: unknown = JSON.parse(errorText);
    if (typeof parsed === 'object' && parsed !== null) {
      const record = parsed as Record<string, unknown>;
      if (typeof record.error === 'string' && record.error.length > 0) {
        detail = record.error.slice(0, MAX_ERROR_BODY_CHARS);
      }
      const listed = listedErrorMessages(record.errors);
      if (listed.length > 1) detail = listed.join(' ').slice(0, MAX_ERROR_BODY_CHARS);
      if (typeof record.code === 'string') code = record.code;
      if (typeof record.field === 'string') field = record.field;
      if (record.delivered === true) delivered = true;
      if (typeof record.postUrl === 'string') postUrl = record.postUrl;
      if (code === TRIAL_EXPIRED_CODE || code === SUBSCRIPTION_INACTIVE_CODE) {
        detail = accessBlockedMessage(code, record.contactUrl);
      }
    }
  } catch {
  }
  return { detail, code, field, delivered, postUrl };
}

export function parseRetryAfterSeconds(header: string | null): number | null {
  if (header === null || !/^\d+$/.test(header.trim())) return null;
  return Number(header.trim());
}

export async function apiErrorFromResponse(response: Response, action: string): Promise<ApiError> {
  const failure = readApiFailure(await response.text());
  return new ApiError(
    `Failed to ${action}: ${response.status} ${failure.detail}`,
    failure.code, failure.field, response.status, failure.delivered, failure.postUrl,
    parseRetryAfterSeconds(response.headers.get('retry-after')),
  );
}
