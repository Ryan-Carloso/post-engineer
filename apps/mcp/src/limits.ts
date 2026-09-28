/**
 * Shared library-image size limits.
 *
 * Lives in its own module so both `client.ts` (enforcement) and
 * `errors.ts` (user-facing messages) can use the derived MB value without
 * a client<->errors import cycle.
 */

/** Max library image size in bytes (10MB). */
export const MAX_LIBRARY_IMAGE_BYTES = 10 * 1024 * 1024;

/**
 * Same limit in whole MB, derived from the byte limit so user-facing copy
 * (tool descriptions, error messages) can't drift from the enforced bound.
 */
export const MAX_LIBRARY_IMAGE_MB = MAX_LIBRARY_IMAGE_BYTES / (1024 * 1024);
