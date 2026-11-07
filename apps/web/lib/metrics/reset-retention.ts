import 'server-only';

import { logger } from '@/lib/logger';
import { createSupabaseServiceClient } from '@/lib/supabase/service';

//---------------
// resetYouTubeRetentionWindows — after a YouTube reconnect, clear the done
// marks of snapshots that had no Analytics scope (or predate the Analytics
// columns) so the hourly job re-collects every window still inside its age
// range. Closed windows can never be back-filled: their stale scope_missing
// rows become no_data so the reconnect prompt stops. The service role is
// required: post_metrics_done has RLS on with no policy. A reset failure is
// logged, never hidden, and never fails the connect itself.
//---------------
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
