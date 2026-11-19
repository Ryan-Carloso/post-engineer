import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from './logger';

export async function lookupSlotIdForTask(
  supabase: SupabaseClient,
  userId: string,
  taskId: string,
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('scheduled_posts')
      .select('id')
      .eq('user_id', userId)
      .eq('task_id', taskId)
      .maybeSingle();
    if (error) {
      logger.warn('[slot-by-task] slot lookup failed', { taskId, error });
      return null;
    }
    const id = (data as { id?: unknown } | null)?.id;
    return typeof id === 'string' ? id : null;
  } catch (error) {
    logger.warn('[slot-by-task] slot lookup failed', {
      taskId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
