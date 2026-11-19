import type { SupabaseClient } from '@supabase/supabase-js';

import { ERROR_CODES, formatErrorMessage } from '@/lib/error-codes';
import { VideoUploadError } from '@/lib/videos/signed-upload';

export const UPLOAD_SLOT_REFERENCE_INDEX = 'scheduled_posts_upload_media_ref_key';

export function uploadAlreadyScheduledError(): VideoUploadError {
  return new VideoUploadError(
    formatErrorMessage(ERROR_CODES.VIDEO_UPLOAD_SCHEDULED),
    409,
    ERROR_CODES.VIDEO_UPLOAD_SCHEDULED,
  );
}

export async function assertUploadNotScheduled(
  supabase: SupabaseClient,
  userId: string,
  uploadId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from('scheduled_posts')
    .select('id')
    .eq('user_id', userId)
    .eq('media_kind', 'upload')
    .eq('media_ref', uploadId)
    .neq('status', 'failed')
    .limit(1);
  if (error) {
    throw new Error(`scheduled upload lookup failed: ${error.message}`);
  }
  if (Array.isArray(data) && data.length > 0) {
    throw uploadAlreadyScheduledError();
  }
}
