import { MAX_VIDEO_UPLOAD_BYTES } from './contracts/videos.js';

export const CLONE_PREVIEW_TEXT_MAX_CHARS = 300;

export const HOUSE_PREVIEW_TEXT_MAX_CHARS = 300;

export const MAX_CLONE_AUDIO_BYTES = 20 * 1024 * 1024;

export const MAX_CLONE_AUDIO_MB = MAX_CLONE_AUDIO_BYTES / (1024 * 1024);

export const DIRECT_PUBLISH_TIMEOUT_MS = 600_000;

export const MAX_LIBRARY_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_LIBRARY_IMAGE_MB = MAX_LIBRARY_IMAGE_BYTES / (1024 * 1024);

export const MAX_SEGMENT_MEDIA_BYTES = 8 * 1024 * 1024;

export const MAX_SEGMENT_MEDIA_MB = MAX_SEGMENT_MEDIA_BYTES / (1024 * 1024);

export { MAX_VIDEO_UPLOAD_BYTES as MAX_UPLOAD_VIDEO_BYTES };

export const MAX_UPLOAD_VIDEO_GB = MAX_VIDEO_UPLOAD_BYTES / (1024 * 1024 * 1024);

export { VIDEO_LAYOUTS } from './contracts/personas.js';

export {
  PERSONA_CTA_INSTRUCTION_MAX_LENGTH,
  PERSONA_CTA_TYPES,
  PERSONA_CTA_URL_MAX_LENGTH,
} from './contracts/personas.js';

export {
  METRICS_FILTER_MAX_LENGTH,
  METRICS_NONE,
  METRICS_WINDOWS,
  YOUTUBE_VIDEO_ID,
} from './contracts/metrics.js';
export { SOCIAL_PROVIDERS as METRICS_PROVIDERS } from './contracts/providers.js';

export { BATCH_KEY_MAX_LENGTH, BATCH_KEY_PATTERN, MAX_BATCH_VIDEOS } from './contracts/videos.js';
export const BATCH_FREE_EVERY = 6;
export const BATCH_WINDOW_MINUTES = 10;
