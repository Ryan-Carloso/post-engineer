import 'server-only';

import { logger } from '@/lib/logger';
import { createSupabaseServiceClient } from '@/lib/supabase/service';

export async function resetYouTubeRetentionWindows(userId: string, channelId: string): Promise<void> {
  try {
    const supabase = createSupabaseServiceClient();
    const { error } = await supabase.rpc('reset_post_metrics_windows', {
      p_user_id: userId,
      p_account_id: channelId,
    });
    if (error) {
      logger.error('[youtube-oauth] retention windows reset failed', {
        userId,
        channelId,
        error: error.message,
      });
    }
  } catch (error) {
    logger.error('[youtube-oauth] retention windows reset threw', {
      userId,
      channelId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
