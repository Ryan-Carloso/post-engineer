import 'server-only';

import type { OAuth2Client } from 'google-auth-library';
import { getYouTubeClient } from '@/lib/youtube';

const YOUTUBE_CHANNEL_TIMEOUT_MS = 15_000;

export interface YouTubeChannelProfile {
  id: string;
  title: string | null;
  thumbnail: string | null;
  customUrl: string | null;
  statistics: {
    subscriberCount?: string;
    viewCount?: string;
    videoCount?: string;
    hiddenSubscriberCount: boolean;
  } | null;
}

function nonEmpty(value: string | null | undefined): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

export async function fetchYouTubeChannel(
  authClient: OAuth2Client,
  channel: { mine: true } | { id: string },
): Promise<YouTubeChannelProfile | null> {
  const youtube = getYouTubeClient(authClient);
  const response = await youtube.channels.list(
    {
      part: ['snippet', 'statistics'],
      ...('mine' in channel ? { mine: true } : { id: [channel.id] }),
    },
    { timeout: YOUTUBE_CHANNEL_TIMEOUT_MS },
  );
  const item = response.data.items?.[0];
  const id = nonEmpty(item?.id);
  if (item === undefined || id === null) return null;
  const thumbnails = item.snippet?.thumbnails;
  const stats = item.statistics;
  return {
    id,
    title: nonEmpty(item.snippet?.title),
    thumbnail: nonEmpty(thumbnails?.medium?.url) ?? nonEmpty(thumbnails?.default?.url),
    customUrl: nonEmpty(item.snippet?.customUrl),
    statistics: stats
      ? {
        subscriberCount: nonEmpty(stats.subscriberCount) ?? undefined,
        viewCount: nonEmpty(stats.viewCount) ?? undefined,
        videoCount: nonEmpty(stats.videoCount) ?? undefined,
        hiddenSubscriberCount: stats.hiddenSubscriberCount === true,
      }
      : null,
  };
}
