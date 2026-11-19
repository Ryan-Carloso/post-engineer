import 'server-only';

import { getYouTubeVideoInfo } from '@/lib/youtube';
import { videoSnippet } from '@/lib/youtube-analytics';
import { getAuthenticatedClient } from '@/lib/upload/handlers';
import { isPlaceholderProviderAccountId, listSocialAccounts } from '@/lib/social-accounts';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import type { MetricsTarget } from './post-metrics';

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
  const probeClient = await getAuthenticatedClient(userId, accountIds[0]);
  const videoInfo = await getYouTubeVideoInfo(probeClient, target.externalId);
  const channelId = videoSnippet(videoInfo).channelId;
  const owner =
    typeof channelId === 'string'
      ? accountIds.find((accountId) => accountId === channelId)
      : undefined;
  return owner === undefined ? null : { ...target, accountId: owner };
}
