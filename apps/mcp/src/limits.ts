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

/**
 * Max direct-publish video size in bytes (2GB). Mirrors the server-side
 * limit in POST /api/upload-content (youtube handler): the MCP fails fast
 * locally instead of uploading gigabytes the server would reject.
 */
export const MAX_UPLOAD_VIDEO_BYTES = 2 * 1024 * 1024 * 1024;

/**
 * Same limit in whole GB, derived from the byte limit so user-facing copy
 * can't drift from the enforced bound.
 */
export const MAX_UPLOAD_VIDEO_GB = MAX_UPLOAD_VIDEO_BYTES / (1024 * 1024 * 1024);

/**
 * Persona-hook layouts the server accepts, as an inline literal rather than
 * an enum: it feeds `z.enum(...)`, whose generic argument is a tuple.
 *
 * This list is duplicated in `apps/web/lib/persona-schema.ts` (the web zod
 * enum), in `supabase/migrations/019_personas-video-layout.sql` (the CHECK)
 * and in the engine's `VideoLayout` (apps/engine/app/models/schema.py).
 * Nothing shares a module across those four runtimes, so a one-sided edit
 * would silently teach agents a layout the database rejects at write time --
 * pinned by `persona-video-layout-sync.test.ts`.
 */
export const VIDEO_LAYOUTS = ['standard', 'react'] as const;

/**
 * GET /api/metrics query contract, mirrored from
 * `apps/web/lib/metrics/metrics-query.ts` (METRICS_FILTER_MAX_LENGTH,
 * METRICS_NONE, the window values) and `apps/web/lib/providers/registry.ts`
 * (SOCIAL_PROVIDERS). The MCP rejects what the route would 400 on before
 * the request goes out. Pinned by `metrics-query-sync.test.ts`.
 */
export const METRICS_FILTER_MAX_LENGTH = 200;
export const METRICS_NONE = '^@none';
export const METRICS_WINDOWS = ['24h', '7d'] as const;
export const METRICS_PROVIDERS = ['youtube', 'instagram', 'bluesky', 'linkedin'] as const;
