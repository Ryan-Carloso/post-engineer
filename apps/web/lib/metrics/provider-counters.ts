import 'server-only';

import { getYouTubeVideoInfo } from '@/lib/youtube';
import { getAuthenticatedClient } from '@/lib/upload/handlers';
import { getSocialAccountTokens } from '@/lib/social-accounts';
import { InstagramService } from '@/lib/instagram';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import type { MetricsCounters, MetricsTarget } from './post-metrics';

//---------------
// provider-counters — reads one published video's counters from its
// network with the owner's stored account tokens. Throws on any provider
// or token failure; the collector logs it and retries next hour.
//---------------

// YouTube reports counters as decimal strings; a missing one (e.g. likes
// hidden by the creator) stays null, never 0.
export function parseCount(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  return null;
}

export function youtubeCounters(videoInfo: unknown): MetricsCounters {
  const statistics =
    typeof videoInfo === 'object' && videoInfo !== null
      ? (videoInfo as { statistics?: unknown }).statistics
      : undefined;
  const stats = typeof statistics === 'object' && statistics !== null ? (statistics as Record<string, unknown>) : {};
  return {
    views: parseCount(stats.viewCount),
    likes: parseCount(stats.likeCount),
    comments: parseCount(stats.commentCount),
    // YouTube exposes no per-video save count.
    saves: null,
  };
}

export function instagramCounters(insights: Record<string, number>): MetricsCounters {
  const read = (name: string): number | null => (name in insights ? insights[name] : null);
  return {
    views: read('views'),
    likes: read('likes'),
    comments: read('comments'),
    saves: read('saved'),
  };
}

export async function fetchProviderCounters(userId: string, target: MetricsTarget): Promise<MetricsCounters> {
  if (target.provider === 'youtube') {
    const client = await getAuthenticatedClient(userId, target.accountId);
    return youtubeCounters(await getYouTubeVideoInfo(client, target.externalId));
  }
  // Ownership: getSocialAccountTokens only resolves the user's own accounts.
  const { tokens } = await getSocialAccountTokens(
    createSupabaseServiceClient(),
    userId,
    'instagram',
    target.accountId,
  );
  if (typeof tokens.access_token !== 'string' || tokens.access_token === '') {
    throw new Error('Instagram token not found');
  }
  if (typeof tokens.expiry_date === 'number' && Date.now() >= tokens.expiry_date) {
    throw new Error('Instagram token expired');
  }
  const insights = await new InstagramService().getMediaInsights(target.externalId, tokens.access_token);
  return instagramCounters(insights);
}
