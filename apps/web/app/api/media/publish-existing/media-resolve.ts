import { randomUUID } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import { isScopedApiKey } from '@/lib/api-keys';
import { ERROR_CODES, formatErrorMessage } from '@/lib/error-codes';
import { logger } from '@/lib/logger';
import { engineAuthHeaders } from '@/lib/request-auth';
import { SAFE_TASK_ID } from '@/lib/video-urls';
import { isTaskVisibleToScopedKey, resolveTaskScope } from '@/lib/video-task-scope';
import {
  type VideoUploadRow,
  type VideoUploadStore,
} from '@/lib/videos/signed-upload';

export const MAX_VIDEO_DOWNLOAD_BYTES = 2 * 1024 * 1024 * 1024;

const TASK_RECORD_TIMEOUT_MS = 10_000;

const VIDEO_DOWNLOAD_TIMEOUT_MS = 120_000;

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

export async function fetchScopedEngineTask(
  supabase: SupabaseClient,
  auth: { userId: string; isApiKey?: boolean; personaIds?: string[] | null },
  taskId: string,
  fetchFn: typeof fetch = fetch,
): Promise<EngineTaskRecord | null> {
  if (isScopedApiKey(auth)) {
    try {
      const scope = await resolveTaskScope(supabase, auth.userId, taskId);
      if (!isTaskVisibleToScopedKey(scope, auth.personaIds)) return null;
    } catch (error) {
      logger.error('[publish-existing] task scope lookup failed', error, { taskId });
      throw new ExistingMediaError('Failed to load video task.', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }
  return fetchEngineTaskRecord(taskId, auth.userId, fetchFn);
}

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
    logger.error('[publish-existing] scheduled image storage failed', error ?? undefined, { userId });
    throw new ExistingMediaError(
      formatErrorMessage(ERROR_CODES.INTERNAL_ERROR),
      500,
      'MEDIA_STORE_FAILED',
    );
  }
  return data.path;
}
