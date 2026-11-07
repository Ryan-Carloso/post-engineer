import 'server-only';

import type { OAuth2Client } from 'google-auth-library';
import { logger } from '@/lib/logger';
import { analyticsDate, queryVideoStats, videoSnippet } from '@/lib/youtube-analytics';
import { ANALYTICS_PROVISIONAL_DAYS } from './metrics-query';
import type { MetricsTarget, MetricsWindow, RetentionSnapshot } from './post-metrics';

//---------------
// youtube-retention — the Analytics half of a YouTube snapshot: engaged
// views and watch time for the owner's own video over publish date ..
// end date. The Data API counters are saved either way; a transient
// Analytics failure throws, so the collector retries the whole snapshot
// next hour.
//---------------

// Analytics data is provisional for ~48-72h. The '28d' window queries up to
// collection - 3 days so its values are final; '24h'/'7d' query up to the
// collection day and are shown as provisional.
const DAY_MS = 24 * 60 * 60 * 1000;

export function analyticsEndDate(window: MetricsWindow, now: Date): string {
  const lag = window === '28d' ? ANALYTICS_PROVISIONAL_DAYS : 0;
  return analyticsDate(new Date(now.getTime() - lag * DAY_MS));
}

function emptySnapshot(status: RetentionSnapshot['status']): RetentionSnapshot {
  return {
    status,
    analyticsViews: null,
    engagedViews: null,
    averageViewDurationSeconds: null,
    averageViewPercentage: null,
    contentType: null,
    startDate: null,
    endDate: null,
  };
}

export async function youtubeRetention(
  client: OAuth2Client,
  videoInfo: unknown,
  target: MetricsTarget,
  context: { window: MetricsWindow; now: Date },
): Promise<RetentionSnapshot> {
  const snippet = videoSnippet(videoInfo);
  // Ownership: target.accountId is the connected channel id
  // (social_accounts.provider_account_id). A video on any other channel is
  // never sent to the Analytics API.
  if (snippet.channelId !== target.accountId) {
    logger.warn('[post-metrics] video is not on the account channel; analytics skipped', {
      accountId: target.accountId,
      externalId: target.externalId,
    });
    return emptySnapshot('not_owned');
  }
  const publishedAt = typeof snippet.publishedAt === 'string' ? new Date(snippet.publishedAt) : null;
  if (publishedAt === null || Number.isNaN(publishedAt.getTime())) return emptySnapshot('no_data');

  const startDate = analyticsDate(publishedAt);
  const endDate = analyticsEndDate(context.window, context.now);
  if (endDate < startDate) return emptySnapshot('no_data');

  const result = await queryVideoStats(client, { videoId: target.externalId, startDate, endDate });
  if (result.kind !== 'ok') return emptySnapshot(result.kind);
  return {
    status: 'ok',
    analyticsViews: result.stats.views,
    engagedViews: result.stats.engagedViews,
    averageViewDurationSeconds: result.stats.averageViewDurationSeconds,
    averageViewPercentage: result.stats.averageViewPercentage,
    contentType: result.stats.contentType,
    startDate,
    endDate,
  };
}
