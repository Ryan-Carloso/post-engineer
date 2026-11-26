import { randomUUID } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import { ERROR_CODES, formatErrorMessage } from '@/lib/error-codes';
import { logger } from '@/lib/logger';
import {
  type VideoUploadRow,
  type VideoUploadStore,
} from '@/lib/videos/signed-upload';

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
