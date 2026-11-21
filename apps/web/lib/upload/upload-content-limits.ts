import { MAX_VIDEO_UPLOAD_BYTES } from '@/lib/contracts/upload-types';
import { FACEBOOK_VIDEO_MAX_BYTES } from '@/lib/facebook';
import { FANVUE_MAX_FILE_BYTES } from '@/lib/fanvue-media';
import { LINKEDIN_VIDEO_MAX_BYTES } from '@/lib/linkedin';
import { MAX_FILE_SIZE } from '@/lib/media/upload-schema';
import { PINTEREST_VIDEO_MAX_BYTES } from '@/lib/pinterest';
import { RUMBLE_VIDEO_MAX_BYTES } from '@/lib/rumble';
import { TELEGRAM_FILE_MAX_BYTES } from '@/lib/telegram';
import { THREADS_VIDEO_MAX_BYTES } from '@/lib/threads';
import { THREESPEAK_VIDEO_MAX_BYTES } from '@/lib/threespeak';
import { MULTIPART_OVERHEAD_BYTES } from '@/lib/upload/bounded-form-data';

export const PROVIDER_FILE_CAPS_BYTES: readonly number[] = [
  MAX_VIDEO_UPLOAD_BYTES,
  MAX_FILE_SIZE,
  FACEBOOK_VIDEO_MAX_BYTES,
  FANVUE_MAX_FILE_BYTES,
  LINKEDIN_VIDEO_MAX_BYTES,
  PINTEREST_VIDEO_MAX_BYTES,
  RUMBLE_VIDEO_MAX_BYTES,
  TELEGRAM_FILE_MAX_BYTES,
  THREADS_VIDEO_MAX_BYTES,
  THREESPEAK_VIDEO_MAX_BYTES,
];

export const UPLOAD_CONTENT_MAX_BODY_BYTES =
  Math.max(...PROVIDER_FILE_CAPS_BYTES) + MULTIPART_OVERHEAD_BYTES;
