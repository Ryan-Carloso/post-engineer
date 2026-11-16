//---------------
// One live slot per signed upload (migration 065). A signed upload is
// single-use: the engine claims it when its slot publishes. A second
// schedule of the same upload id would answer "scheduled" and then fail
// at publish time, and an immediate publish of an upload a slot already
// holds would steal it from that slot. Both callers check here first; the
// partial unique index `scheduled_posts_upload_media_ref_key` is the
// race-proof backstop for two concurrent schedules.
//---------------

import type { SupabaseClient } from '@supabase/supabase-js';

import { ERROR_CODES, formatErrorMessage } from '@/lib/error-codes';
import { VideoUploadError } from '@/lib/videos/signed-upload';

/** The partial unique index from migration 065. */
export const UPLOAD_SLOT_REFERENCE_INDEX = 'scheduled_posts_upload_media_ref_key';

export function uploadAlreadyScheduledError(): VideoUploadError {
  return new VideoUploadError(
    formatErrorMessage(ERROR_CODES.VIDEO_UPLOAD_SCHEDULED),
    409,
    ERROR_CODES.VIDEO_UPLOAD_SCHEDULED,
  );
}

/**
 * Throws VideoUploadError 409 VIDEO_UPLOAD_SCHEDULED when a live (not
 * failed) slot of this user already references the upload. A failed read
 * throws a plain Error: the caller answers 500 instead of publishing blind.
 */
export async function assertUploadNotScheduled(
  supabase: SupabaseClient,
  userId: string,
  uploadId: string,
): Promise<void> {
  // Service role bypasses RLS: the user_id filter re-checks ownership.
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
