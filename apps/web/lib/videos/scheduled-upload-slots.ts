import type { SupabaseClient } from '@supabase/supabase-js';

export const LIVE_UPLOAD_SLOT_STATUSES = ['pending', 'generating', 'ready', 'publishing'] as const;

export async function listLiveUploadSlotTimes(
  supabase: SupabaseClient,
  uploadIds: readonly string[],
): Promise<Map<string, string>> {
  const latest = new Map<string, string>();
  if (uploadIds.length === 0) return latest;
  const { data, error } = await supabase
    .from('scheduled_posts')
    .select('media_ref, slot_at')
    .eq('media_kind', 'upload')
    .in('media_ref', [...uploadIds])
    .in('status', [...LIVE_UPLOAD_SLOT_STATUSES]);
  if (error !== null) throw new Error(`Failed to list scheduled upload slots: ${error.message}`);
  for (const row of Array.isArray(data) ? data : []) {
    const record: Record<string, unknown> = typeof row === 'object' && row !== null ? { ...row } : {};
    const ref = record.media_ref;
    const slotAt = record.slot_at;
    if (typeof ref !== 'string' || typeof slotAt !== 'string' || Number.isNaN(Date.parse(slotAt))) continue;
    const current = latest.get(ref);
    if (current === undefined || Date.parse(slotAt) > Date.parse(current)) latest.set(ref, slotAt);
  }
  return latest;
}
