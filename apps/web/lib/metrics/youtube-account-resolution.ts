import 'server-only';

import { getYouTubeVideoInfo } from '@/lib/youtube';
import { videoSnippet } from '@/lib/youtube-analytics';
import { getAuthenticatedClient } from '@/lib/upload/handlers';
import { isPlaceholderProviderAccountId, listSocialAccounts } from '@/lib/social-accounts';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import type { MetricsTarget } from './post-metrics';

//---------------
// youtube-account-resolution — a YouTube metrics target whose account id
// is a placeholder ('unknown', left behind by the old OAuth flow when the
// channel lookup failed) resolves to the user's connected YouTube account
// at read time. The stored publish_results entry is never rewritten.
//
// One connected account: it owns the video. Several: the video's channel
// (videos.list snippet.channelId) decides which account owns it — the
// Analytics half of the snapshot only works with the owning account's
// token. No connected account, or no account owning the video: null, a
// terminal skip — the collector closes the window instead of retrying
// every hour a video that can never resolve.
//---------------

export async function resolveYouTubeMetricsTarget(
  userId: string,
  target: MetricsTarget,
): Promise<MetricsTarget | null> {
  if (target.provider !== 'youtube' || !isPlaceholderProviderAccountId(target.accountId)) {
    return target;
  }
  const accountIds = (await listSocialAccounts(createSupabaseServiceClient(), userId, 'youtube'))
    .map((account) => account.providerAccountId)
    .filter((accountId) => !isPlaceholderProviderAccountId(accountId));
  if (accountIds.length === 0) return null;
  if (accountIds.length === 1) return { ...target, accountId: accountIds[0] };
  // Any connected account's token reads public video info, so probe with
  // the most recently used one and match the video's channel against the
  // connected accounts.
  const probeClient = await getAuthenticatedClient(userId, accountIds[0]);
  const videoInfo = await getYouTubeVideoInfo(probeClient, target.externalId);
  const channelId = videoSnippet(videoInfo).channelId;
  const owner =
    typeof channelId === 'string'
      ? accountIds.find((accountId) => accountId === channelId)
      : undefined;
  return owner === undefined ? null : { ...target, accountId: owner };
}
