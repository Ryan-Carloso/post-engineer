import type { SupabaseClient } from '@supabase/supabase-js';

export async function deleteInsertedSlots(
  supabase: SupabaseClient,
  userId: string,
  inserted: ReadonlyArray<{ id: string }> | null,
): Promise<void> {
  const ids = (inserted ?? []).map((row) => row.id);
  if (ids.length === 0) return;
  await supabase.from('scheduled_posts').delete().in('id', ids).eq('user_id', userId);
}
