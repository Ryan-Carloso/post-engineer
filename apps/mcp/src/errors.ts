/**
 * Shared error-formatting helpers.
 *
 * Lives in its own module because both `client.ts` and `tools.ts` need it:
 * `tools.ts` already imports the exported limit constants from `client.ts`,
 * so defining it in `tools.ts` would create a client↔tools import cycle.
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Thrown by the client's request() for non-2xx API responses whose body is
 * the platform's structured error contract ({ success: false, error,
 * code, field?, errorId? }). Carries the stable machine code (and the
 * offending field, when named) so handlers can surface { code, message,
 * field } instead of rewording the platform's own human message.
 */
export class ApiError extends Error {
  /** Stable machine code from the API error body (e.g. TOPICS_REQUIRED). */
  readonly code: string | null;
  /** Dot-path of the offending input field, when the API names one. */
  readonly field: string | null;

  constructor(message: string, code: string | null, field: string | null) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.field = field;
  }
}

/**
 * Thrown when a library image exceeds the size limit. Carries the path and
 * the observed size so the catch block in imageFormFile can discriminate by
 * type (`instanceof`) instead of sniffing the error message text — message
 * sniffing misclassifies any future error whose prose happens to match, or
 * silently re-wraps the size error if the message is ever reworded.
 */
import { MAX_LIBRARY_IMAGE_MB, MAX_UPLOAD_VIDEO_GB } from './limits.js';

export class ImageTooLargeError extends Error {
  /** Full local path of the oversized image. */
  readonly path: string;
  /** Observed size in bytes (from stat, or from the read buffer). */
  readonly sizeBytes: number;

  constructor(path: string, sizeBytes: number) {
    // The max is the shared derived constant (never a hardcoded literal
    // or a locally recomputed divisor) so the message can't drift from the
    // enforced bound.
    super(`Image "${path}" is too large (${sizeBytes} bytes; max ${MAX_LIBRARY_IMAGE_MB}MB).`);
    this.name = 'ImageTooLargeError';
    this.path = path;
    this.sizeBytes = sizeBytes;
  }
}

/**
 * Thrown when a direct-publish video exceeds the size limit. Carries the
 * path and the observed size so the catch block in videoFormFile can
 * discriminate by type (`instanceof`) instead of sniffing the error
 * message text.
 */
export class VideoTooLargeError extends Error {
  /** Full local path of the oversized video. */
  readonly path: string;
  /** Observed size in bytes (from stat, or from the read buffer). */
  readonly sizeBytes: number;

  constructor(path: string, sizeBytes: number) {
    super(`Video "${path}" is too large (${sizeBytes} bytes; max ${MAX_UPLOAD_VIDEO_GB}GB).`);
    this.name = 'VideoTooLargeError';
    this.path = path;
    this.sizeBytes = sizeBytes;
  }
}
