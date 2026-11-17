/**
 * Shared library-image size limits.
 *
 * Lives in its own module so both `client.ts` (enforcement) and
 * `errors.ts` (user-facing messages) can use the derived MB value without
 * a client<->errors import cycle.
 */

import { MAX_VIDEO_UPLOAD_BYTES } from './contracts/videos.js';

/**
 * Max caller text for voices (action: preview_clone), in characters after trimming.
 * Same literal as the engine (app/services/cloned_voices/preview_text.py)
 * and the web preview route (preview/preview-text.ts), pinned by
 * __tests__/clone-preview-text-sync.test.ts.
 */
export const CLONE_PREVIEW_TEXT_MAX_CHARS = 300;

/**
 * Max caller text for voices (action: preview), in characters after trimming.
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

/**
 * Direct publish budget: the request uploads the video and, on Fanvue,
 * waits for the server to transcode it before creating the post. Match
 * the engine's 600s publish budget (DEFAULT_TIMEOUT_SECONDS in
 * app/services/upload_publisher.py): aborting earlier reports a failure
 * while the server keeps publishing, and a retry would duplicate the post.
 */
export const DIRECT_PUBLISH_TIMEOUT_MS = 600_000;

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
 * Max direct-publish video size in bytes (2GB). Lives in the shared videos
 * contract (`shared/contracts/videos.ts`): the MCP fails fast locally
 * instead of uploading gigabytes the server would reject.
 */
export { MAX_VIDEO_UPLOAD_BYTES as MAX_UPLOAD_VIDEO_BYTES };

/**
 * Same limit in whole GB, derived from the byte limit so user-facing copy
 * can't drift from the enforced bound.
 */
export const MAX_UPLOAD_VIDEO_GB = MAX_VIDEO_UPLOAD_BYTES / (1024 * 1024 * 1024);

/**
 * Persona-hook layouts the server accepts. The list lives in the shared
 * personas contract (`shared/contracts/personas.ts`) — the web zod enum
 * and the MCP schemas share that one literal now. The DB CHECK
 * (migration 019) and the engine's VideoLayout enum are still independent
 * literals, pinned by `persona-video-layout-migration.test.ts`.
 */
export { VIDEO_LAYOUTS } from './contracts/personas.js';

/**
 * GET /api/metrics query contract, re-exported from the shared contract
 * (`shared/contracts/metrics.ts`) so the MCP and the web routes cannot
 * drift. Existing importers keep importing from this path. Pinned by
 * `metrics-query-sync.test.ts`.
 */
export {
  METRICS_FILTER_MAX_LENGTH,
  METRICS_NONE,
  METRICS_WINDOWS,
  YOUTUBE_VIDEO_ID,
} from './contracts/metrics.js';
export { SOCIAL_PROVIDERS as METRICS_PROVIDERS } from './contracts/providers.js';

/**
 * Paired A/B experiment limits (issue #476), re-exported from the shared
 * contract (`shared/contracts/experiments.ts`) so the MCP and the web
 * routes cannot drift. Existing importers keep importing from this path.
 */
export {
  EXPERIMENT_NAME_MAX_LENGTH,
  EXPERIMENT_TARGET_PAIRS_MAX,
  EXPERIMENT_TARGET_PAIRS_MIN,
  EXPERIMENT_VARIABLES,
  EXPERIMENT_VARIANT_COUNT,
  EXPERIMENT_VARIANT_DESCRIPTION_MAX_LENGTH,
  EXPERIMENT_VARIANT_ID_PATTERN,
  EXPERIMENT_VARIANT_NAME_MAX_LENGTH,
} from './contracts/experiments.js';
export type { ExperimentVariable } from './contracts/experiments.js';

/**
 * Batch discount limits (issue #487). MAX_BATCH_VIDEOS and the batchKey
 * rule live in the shared videos contract (`shared/contracts/videos.ts`);
 * BATCH_FREE_EVERY and the window stay mirrored from
 * `apps/web/lib/billing/batch-discount.ts`. Pinned by
 * `batch-discount-sync.test.ts`.
 */
export { BATCH_KEY_MAX_LENGTH, BATCH_KEY_PATTERN, MAX_BATCH_VIDEOS } from './contracts/videos.js';
export const BATCH_FREE_EVERY = 6;
export const BATCH_WINDOW_MINUTES = 10;
