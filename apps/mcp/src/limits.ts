/**
 * Shared library-image size limits.
 *
 * Lives in its own module so both `client.ts` (enforcement) and
 * `errors.ts` (user-facing messages) can use the derived MB value without
 * a client<->errors import cycle.
 */

/**
 * Max caller text for preview_cloned_voice, in characters after trimming.
 * Same literal as the engine (app/services/cloned_voices/preview_text.py)
 * and the web preview route (preview/preview-text.ts), pinned by
 * __tests__/clone-preview-text-sync.test.ts.
 */
export const CLONE_PREVIEW_TEXT_MAX_CHARS = 300;

/**
 * Max caller text for preview_house_voice, in characters after trimming.
 * Same literal as the engine (the house preview reuses the cloned-voice
 * validator in app/services/cloned_voices/preview_text.py) and the web
 * house preview route (preview/preview-text.ts), pinned by
 * __tests__/clone-preview-text-sync.test.ts.
 */
export const HOUSE_PREVIEW_TEXT_MAX_CHARS = 300;

/**
 * Max voice clone reference audio size in bytes (20MB), for both the
 * audioUrl download and the local audioPath read. Same bound as the web
 * cloned-voices route.
 */
export const MAX_CLONE_AUDIO_BYTES = 20 * 1024 * 1024;

/** Same limit in whole MB, derived from the byte limit. */
export const MAX_CLONE_AUDIO_MB = MAX_CLONE_AUDIO_BYTES / (1024 * 1024);

/** Max library image size in bytes (10MB). */
export const MAX_LIBRARY_IMAGE_BYTES = 10 * 1024 * 1024;

/**
 * Same limit in whole MB, derived from the byte limit so user-facing copy
 * (tool descriptions, error messages) can't drift from the enforced bound.
 */
export const MAX_LIBRARY_IMAGE_MB = MAX_LIBRARY_IMAGE_BYTES / (1024 * 1024);

/**
 * Max segment media size in bytes (8MB). This is the engine photo
 * bottleneck (place_photos MAX_PHOTO_BYTES), NOT the persona library
 * limit: a larger segment upload could never render. The server
 * re-validates the same bound; this local guard only fails fast.
 */
export const MAX_SEGMENT_MEDIA_BYTES = 8 * 1024 * 1024;

/** Same limit in whole MB, derived from the byte limit. */
export const MAX_SEGMENT_MEDIA_MB = MAX_SEGMENT_MEDIA_BYTES / (1024 * 1024);

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
export const METRICS_WINDOWS = ['24h', '7d', '28d'] as const;
/**
 * GET /api/metrics/retention-curve `video` param, mirrored from VIDEO_ID in
 * `apps/web/lib/youtube-analytics.ts` (pinned by `metrics-query-sync.test.ts`).
 */
export const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{1,64}$/;
export const METRICS_PROVIDERS = ['youtube', 'instagram', 'bluesky', 'linkedin', 'threads', 'facebook', 'pinterest', 'rumble'] as const;

/**
 * What fills a video (`facelessMaterial`), mirroring the web's
 * FACELESS_MATERIALS (apps/web/lib/generation/faceless-materials.ts) that
 * POST /api/videos/generate-and-schedule and validate-script accept --
 * pinned by `faceless-material-sync.test.ts`.
 */
export const FACELESS_MATERIALS = ['broll', 'svg', 'images'] as const;

/**
 * Paired A/B experiment limits (issue #476), mirrored from
 * `apps/web/lib/experiments/limits.ts` (pinned by
 * `experiments-limits-sync.test.ts`).
 */
export const EXPERIMENT_TARGET_PAIRS_MIN = 3;
export const EXPERIMENT_TARGET_PAIRS_MAX = 20;
export const EXPERIMENT_NAME_MAX_LENGTH = 120;
export const EXPERIMENT_VARIANT_NAME_MAX_LENGTH = 80;
export const EXPERIMENT_VARIANT_DESCRIPTION_MAX_LENGTH = 500;
export const EXPERIMENT_VARIANT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,47}$/;

/**
 * Batch discount limits (issue #487), mirrored from
 * `apps/web/lib/billing/batch-discount.ts` (MAX_BATCH_VIDEOS,
 * BATCH_FREE_EVERY) and the batchKey rule of
 * `apps/web/app/api/videos/batch-discount/route.ts`. Pinned by
 * `batch-discount-sync.test.ts`.
 */
export const MAX_BATCH_VIDEOS = 12;
export const BATCH_FREE_EVERY = 6;
export const BATCH_WINDOW_MINUTES = 10;
export const BATCH_KEY_MAX_LENGTH = 100;
export const BATCH_KEY_PATTERN = /^[A-Za-z0-9_-]+$/;
