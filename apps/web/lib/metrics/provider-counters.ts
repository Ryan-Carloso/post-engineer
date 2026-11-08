import 'server-only';

import { getYouTubeVideoInfo } from '@/lib/youtube';
import { getAuthenticatedClient } from '@/lib/upload/handlers';
import { getSocialAccountTokens } from '@/lib/social-accounts';
import { InstagramService } from '@/lib/instagram';
import { getLinkedInSocialActions } from '@/lib/linkedin';
import { getThreadsInsights } from '@/lib/threads';
import { getFacebookVideoInsights } from '@/lib/facebook';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { PROVIDER_LABELS } from '@/lib/account-options';
import type { CounterContext, MeasuredProvider, MetricsCounters, MetricsTarget } from './post-metrics';
import { youtubeRetention } from './youtube-retention';

// Bluesky's public AppView serves post counters without authentication.
const BSKY_APPVIEW = 'https://public.api.bsky.app';

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

function readObject(value: unknown, key: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return {};
  const inner = (value as Record<string, unknown>)[key];
  return typeof inner === 'object' && inner !== null ? (inner as Record<string, unknown>) : {};
}

export function blueskyCounters(getPostsBody: unknown): MetricsCounters {
  const posts = typeof getPostsBody === 'object' && getPostsBody !== null
    ? (getPostsBody as { posts?: unknown }).posts
    : undefined;
  const post = Array.isArray(posts) && typeof posts[0] === 'object' && posts[0] !== null
    ? (posts[0] as Record<string, unknown>)
    : {};
  return {
    // Bluesky exposes no view or save count.
    views: null,
    likes: parseCount(post.likeCount),
    comments: parseCount(post.replyCount),
    saves: null,
  };
}

export function linkedinCounters(socialActions: unknown): MetricsCounters {
  return {
    // Member posts expose no view or save count to w_member_social apps.
    views: null,
    likes: parseCount(readObject(socialActions, 'likesSummary').totalLikes),
    comments: parseCount(readObject(socialActions, 'commentsSummary').aggregatedTotalComments),
    saves: null,
  };
}

export function threadsCounters(insights: Record<string, number>): MetricsCounters {
  return {
    views: parseCount(insights.views),
    likes: parseCount(insights.likes),
    comments: parseCount(insights.replies),
    // Threads exposes no save count.
    saves: null,
  };
}

export function facebookCounters(insights: Record<string, number>): MetricsCounters {
  return {
    views: parseCount(insights.total_video_views),
    likes: parseCount(insights.likes),
    comments: parseCount(insights.comments),
    // Facebook exposes no per-video save count.
    saves: null,
  };
}

// Ownership: getSocialAccountTokens only resolves the user's own accounts.
async function ownerAccessToken(userId: string, provider: 'instagram' | 'linkedin' | 'threads' | 'facebook', accountId: string): Promise<string> {
  const label = PROVIDER_LABELS[provider];
  const { tokens } = await getSocialAccountTokens(createSupabaseServiceClient(), userId, provider, accountId);
  if (typeof tokens.access_token !== 'string' || tokens.access_token === '') {
    throw new Error(`${label} token not found`);
  }
  if (typeof tokens.expiry_date === 'number' && Date.now() >= tokens.expiry_date) {
    throw new Error(`${label} token expired`);
  }
  return tokens.access_token;
}

type CounterFetcher = (userId: string, target: MetricsTarget, context: CounterContext) => Promise<MetricsCounters>;

// Exhaustive over SOCIAL_PROVIDERS: a new provider fails the typecheck
// until it has a fetcher here.
export const COUNTER_FETCHERS: Record<MeasuredProvider, CounterFetcher> = {
  async youtube(userId, target, context) {
    const client = await getAuthenticatedClient(userId, target.accountId);
    const videoInfo = await getYouTubeVideoInfo(client, target.externalId);
    return { ...youtubeCounters(videoInfo), retention: await youtubeRetention(client, videoInfo, target, context) };
  },
  async instagram(userId, target) {
    const token = await ownerAccessToken(userId, 'instagram', target.accountId);
    return instagramCounters(await new InstagramService().getMediaInsights(target.externalId, token));
  },
  async bluesky(_userId, target) {
    const url = new URL(`${BSKY_APPVIEW}/xrpc/app.bsky.feed.getPosts`);
    url.searchParams.set('uris', target.externalId);
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`Bluesky getPosts failed (${response.status})`);
    return blueskyCounters(await response.json());
  },
  async linkedin(userId, target) {
    const token = await ownerAccessToken(userId, 'linkedin', target.accountId);
    return linkedinCounters(await getLinkedInSocialActions(token, target.externalId));
  },
  async threads(userId, target) {
    const token = await ownerAccessToken(userId, 'threads', target.accountId);
    return threadsCounters(await getThreadsInsights(token, target.externalId));
  },
  async facebook(userId, target) {
    const token = await ownerAccessToken(userId, 'facebook', target.accountId);
    return facebookCounters(await getFacebookVideoInsights(token, target.externalId));
  },
};

export async function fetchProviderCounters(
  userId: string,
  target: MetricsTarget,
  context: CounterContext,
): Promise<MetricsCounters> {
  return COUNTER_FETCHERS[target.provider](userId, target, context);
}
