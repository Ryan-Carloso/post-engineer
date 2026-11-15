//---------------
// Existing-media resolution (issue #384): turn a caller-supplied media
// reference into verified bytes or a verified stored row, before any
// publish runs. Every lookup answers 404 for an unknown or foreign-owned
// id — the id's existence is itself owner-private, the same rule the
// signed-upload flow uses.
//---------------

import { randomUUID } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import { ERROR_CODES, formatErrorMessage } from '@/lib/error-codes';
import { logger } from '@/lib/logger';
import { engineAuthHeaders } from '@/lib/request-auth';
import { SAFE_TASK_ID } from '@/lib/video-urls';
import {
  type VideoUploadRow,
  type VideoUploadStore,
} from '@/lib/videos/signed-upload';

/** Same 2 GB ceiling as the signed video upload and /api/upload-content. */
export const MAX_VIDEO_DOWNLOAD_BYTES = 2 * 1024 * 1024 * 1024;

/** Task-record fetch budget (mirrors the progress lookup: 10 s). */
const TASK_RECORD_TIMEOUT_MS = 10_000;

/** Video download budget: a finished render is small, but the fetch must
 *  survive a slow R2 redirect hop. */
const VIDEO_DOWNLOAD_TIMEOUT_MS = 120_000;

/** Durable home for scheduled images: the `uploads` bucket, where the
 *  Instagram handler already stages media. */
export const SCHEDULED_IMAGE_BUCKET = 'uploads';
export const SCHEDULED_IMAGE_PREFIX = 'scheduled-media';

export class ExistingMediaError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = 'ExistingMediaError';
    this.status = status;
    this.code = code;
  }
}

export interface EngineTaskRecord {
  state: number | null;
  videos: string[];
  finalVideo: string | null;
  hasArchive: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function taskPayload(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const body = value.body;
  if (isRecord(body)) return body;
  return value;
}

function engineBaseUrl(): string {
  const baseUrl = process.env.MONEYPRINT_API_URL;
  if (!baseUrl) throw new Error('MONEYPRINT_API_URL is not defined');
  return baseUrl.replace(/\/+$/, '');
}

function withTimeout(ms: number): { controller: AbortController; done: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { controller, done: () => clearTimeout(timer) };
}

/**
 * Read an engine task record (videos, final video URI, archive flag).
 * Ownership is enforced by the engine: it 404s a task of another user, so
 * a null here means "unknown or not yours" and never leaks which one.
 * A non-404 failure is the engine being unreachable (502), never a 404.
 */
export async function fetchEngineTaskRecord(
  taskId: string,
  userId: string,
  fetchFn: typeof fetch = fetch,
): Promise<EngineTaskRecord | null> {
  if (!SAFE_TASK_ID.test(taskId)) {
    throw new ExistingMediaError('taskId is invalid.', 400, 'VALIDATION_FAILED');
  }
  const baseUrl = engineBaseUrl();
  const { controller, done } = withTimeout(TASK_RECORD_TIMEOUT_MS);
  try {
    const response = await fetchFn(`${baseUrl}/api/v1/tasks/${encodeURIComponent(taskId)}`, {
      headers: engineAuthHeaders(userId),
      cache: 'no-store',
      signal: controller.signal,
    });
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new ExistingMediaError('Video service is unavailable.', 502, 'ENGINE_UNAVAILABLE');
    }
    const task = taskPayload(await response.json().catch(() => null));
    if (task === null) {
      throw new ExistingMediaError('Video service returned an unreadable task.', 502, 'ENGINE_UNAVAILABLE');
    }
    const state = typeof task.state === 'number' ? task.state : null;
    const videos = Array.isArray(task.videos)
      ? task.videos.filter((video): video is string => typeof video === 'string')
      : [];
    const finalVideo = typeof task.final_video === 'string' ? task.final_video : null;
    return { state, videos, finalVideo, hasArchive: task.has_archive === true };
  } catch (error) {
    if (error instanceof ExistingMediaError) throw error;
    throw new ExistingMediaError('Video service is unavailable.', 502, 'ENGINE_UNAVAILABLE');
  } finally {
    done();
  }
}

/**
 * Download the finished video behind a task record's final_video URI.
 * The engine 302s to a signed R2 URL; the redirect is followed manually
 * WITHOUT the engine auth headers (the signed URL authenticates itself,
 * and the secret must never leave the engine's trust boundary for R2).
 */
export async function downloadEngineTaskVideo(
  record: EngineTaskRecord,
  userId: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ buffer: Buffer; contentType: string }> {
  const finalVideo = record.finalVideo;
  if (finalVideo === null || finalVideo.trim() === '') {
    throw new ExistingMediaError('Video file not found.', 404, 'MEDIA_NOT_FOUND');
  }
  const baseUrl = engineBaseUrl();
  const firstUrl = finalVideo.startsWith('http://') || finalVideo.startsWith('https://')
    ? finalVideo
    : `${baseUrl}/${finalVideo.replace(/^\/+/, '')}`;
  const { controller, done } = withTimeout(VIDEO_DOWNLOAD_TIMEOUT_MS);
  try {
    let response = await fetchFn(firstUrl, {
      headers: engineAuthHeaders(userId),
      cache: 'no-store',
      redirect: 'manual',
      signal: controller.signal,
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) {
        throw new ExistingMediaError('Video file not found.', 404, 'MEDIA_NOT_FOUND');
      }
      // No auth headers on the second hop: the R2 URL carries its own
      // signature, and the engine secret stays server-side.
      response = await fetchFn(location, { cache: 'no-store', signal: controller.signal });
    }
    if (response.status === 404) {
      throw new ExistingMediaError('Video file not found.', 404, 'MEDIA_NOT_FOUND');
    }
    if (!response.ok) {
      throw new ExistingMediaError('Video service is unavailable.', 502, 'ENGINE_UNAVAILABLE');
    }
    const declaredLength = response.headers.get('content-length');
    if (declaredLength !== null) {
      const length = Number.parseInt(declaredLength, 10);
      if (Number.isFinite(length) && length > MAX_VIDEO_DOWNLOAD_BYTES) {
        throw new ExistingMediaError('Video is too large. Maximum is 2GB.', 413, 'MEDIA_TOO_LARGE');
      }
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_VIDEO_DOWNLOAD_BYTES) {
      throw new ExistingMediaError('Video is too large. Maximum is 2GB.', 413, 'MEDIA_TOO_LARGE');
    }
    return { buffer, contentType: response.headers.get('content-type') ?? 'video/mp4' };
  } catch (error) {
    if (error instanceof ExistingMediaError) throw error;
    throw new ExistingMediaError('Video service is unavailable.', 502, 'ENGINE_UNAVAILABLE');
  } finally {
    done();
  }
}

/**
 * Load a signed-upload video row for publishing: owner-checked, ready,
 * and unexpired. Consumed and pending rows answer 409 (the single-use
 * claim is the publish step's job, not this lookup's).
 */
export async function loadReadyVideoUpload(
  store: VideoUploadStore,
  userId: string,
  uploadId: string,
  now: Date,
): Promise<VideoUploadRow> {
  const row = await store.getUpload(uploadId);
  if (row === null || row.user_id !== userId) {
    throw new ExistingMediaError('Video upload not found.', 404, 'VIDEO_UPLOAD_NOT_FOUND');
  }
  if (row.status === 'consumed') {
    throw new ExistingMediaError('This video upload was already used to publish.', 409, 'VIDEO_UPLOAD_CONSUMED');
  }
  if (Date.parse(row.expires_at) <= now.getTime()) {
    throw new ExistingMediaError('This video upload has expired. Mint a new one.', 410, 'VIDEO_UPLOAD_EXPIRED');
  }
  if (row.status === 'pending') {
    throw new ExistingMediaError(
      'This video upload is not completed yet. Complete it before publishing.',
      409,
      'VIDEO_UPLOAD_NOT_READY',
    );
  }
  return row;
}

/**
 * Store scheduled image bytes durably: the engine downloads them at
 * publish time, so a 1-hour temp asset cannot hold a post scheduled hours
 * ahead. The path (never a signed URL) rides the slot row; the object is
 * removed when the slot publishes, the schedule is cancelled, or the
 * slot insert fails (route.ts compensation). A crash between the image
 * upload and the slot insert can orphan the object; no sweeper covers it.
 */
export async function storeScheduledImage(
  supabase: SupabaseClient,
  userId: string,
  buffer: Buffer,
  contentType: 'image/jpeg' | 'image/png',
): Promise<string> {
  const extension = contentType === 'image/png' ? 'png' : 'jpg';
  const path = `${SCHEDULED_IMAGE_PREFIX}/${userId}/${randomUUID()}.${extension}`;
  const { data, error } = await supabase.storage
    .from(SCHEDULED_IMAGE_BUCKET)
    .upload(path, buffer, { contentType, upsert: false });
  if (error !== null || data === null) {
    // The upstream message stays server-side: the client gets the safe
    // generic message, never the storage provider's error text.
    logger.error('[publish-existing] scheduled image storage failed', error ?? undefined, { userId });
    throw new ExistingMediaError(
      formatErrorMessage(ERROR_CODES.INTERNAL_ERROR),
      500,
      'MEDIA_STORE_FAILED',
    );
  }
  return data.path;
}
