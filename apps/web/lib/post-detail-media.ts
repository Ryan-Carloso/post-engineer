import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from './logger';
import type { SlotMedia } from './slot-detail';

const SIGNED_URL_TTL_SECONDS = 60 * 60;
const PREVIEW_STATUSES = new Set(['ready', 'publishing']);

export interface SlotMediaRow {
  media_kind: string | null;
  media_ref: string | null;
  media_content_type: string | null;
  status: string;
}

interface UploadRow {
  storage_path: string;
  user_id: string;
  status: string;
}

function isUploadRow(value: unknown): value is UploadRow {
  if (typeof value !== 'object' || value === null) return false;
  const record: Record<string, unknown> = { ...value };
  return typeof record.storage_path === 'string' && typeof record.user_id === 'string' && typeof record.status === 'string';
}

async function signMediaUrl(
  service: SupabaseClient,
  bucket: string,
  path: string,
  slotId: string,
): Promise<string | null> {
  const { data, error } = await service.storage.from(bucket).createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error !== null || data === null) {
    logger.warn('[post-detail] media preview signing failed', { slotId, bucket, error: error?.message ?? 'no url' });
    return null;
  }
  return data.signedUrl;
}

export async function resolveSlotMedia(
  service: SupabaseClient,
  slotId: string,
  userId: string,
  row: SlotMediaRow,
): Promise<SlotMedia | null> {
  const kind = row.media_kind === 'upload' || row.media_kind === 'image' ? row.media_kind : null;
  if (kind === null || typeof row.media_ref !== 'string' || row.media_ref.length === 0) return null;
  const media: SlotMedia = { kind, url: null, contentType: row.media_content_type ?? null };
  if (!PREVIEW_STATUSES.has(row.status)) return media;
  try {
    if (kind === 'image') {
      if (!row.media_ref.startsWith(`scheduled-media/${userId}/`)) return media;
      media.url = await signMediaUrl(service, 'uploads', row.media_ref, slotId);
      return media;
    }
    const { data, error } = await service
      .from('video_uploads')
      .select('storage_path, user_id, status')
      .eq('id', row.media_ref)
      .maybeSingle();
    if (error !== null) {
      logger.warn('[post-detail] media upload lookup failed', { slotId, error: error.message });
      return media;
    }
    if (!isUploadRow(data) || data.user_id !== userId || data.status === 'consumed') return media;
    media.url = await signMediaUrl(service, 'videos', data.storage_path, slotId);
    return media;
  } catch (error) {
    logger.warn('[post-detail] media preview lookup failed', {
      slotId,
      error: error instanceof Error ? error.message : String(error),
    });
    return media;
  }
}
