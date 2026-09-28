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
 * Thrown when a library image exceeds the size limit. Carries the path and
 * the observed size so the catch block in imageFormFile can discriminate by
 * type (`instanceof`) instead of sniffing the error message text — message
 * sniffing misclassifies any future error whose prose happens to match, or
 * silently re-wraps the size error if the message is ever reworded.
 */
export class ImageTooLargeError extends Error {
  /** Full local path of the oversized image. */
  readonly path: string;
  /** Observed size in bytes (from stat, or from the read buffer). */
  readonly sizeBytes: number;

  constructor(path: string, sizeBytes: number, maxBytes: number) {
    // The max is derived from the enforced limit (never a hardcoded
    // literal) so the message can't drift from the bound.
    super(`Image "${path}" is too large (${sizeBytes} bytes; max ${maxBytes / (1024 * 1024)}MB).`);
    this.name = 'ImageTooLargeError';
    this.path = path;
    this.sizeBytes = sizeBytes;
  }
}
