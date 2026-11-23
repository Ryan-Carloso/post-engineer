import 'server-only';

import { logger } from '@/lib/logger';
import { isSocialProvider, type SocialProvider } from '@/lib/providers/registry';
import {
  METRICS_NONE,
  METRICS_ROW_LIMIT,
  numericOrNull,
  type Last24hQuery,
  type Last24hResponse,
  type Last24hRowView,
} from './metrics-query';
import { metricsTargets } from './post-metrics';
import { postInPersonaScope } from './post-scope';

const HOUR_MS = 60 * 60 * 1000;

export const LAST_24H_WINDOW_MS = 24 * HOUR_MS;
export const LAST_24H_BASELINE_MIN_AGE_MS = 20 * HOUR_MS;
export const LAST_24H_BASELINE_MAX_AGE_MS = 28 * HOUR_MS;
export const LAST_24H_LATEST_MAX_AGE_MS = 36 * HOUR_MS;
export const LAST_24H_LOOKBACK_MS = LAST_24H_LATEST_MAX_AGE_MS + LAST_24H_BASELINE_MAX_AGE_MS;

export interface DailyReadingInput {
  postId: string;
  provider: SocialProvider;
  externalId: string;
  collectedAt: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  saves: number | null;
}

export interface Last24hPostInput {
  id: string;
  personaId: string | null;
  publishedAt: string;
  outcomes: unknown[];
  voiceover: boolean;
}

export function accountOverrideKey(postId: string, provider: SocialProvider, externalId: string): string {
  return `${postId}:${provider}:${externalId}`;
}

export type Last24hComputed = Omit<Last24hResponse, 'success'>;

const COUNTERS = ['views', 'likes', 'comments', 'saves'] as const;
type Counter = (typeof COUNTERS)[number];

function readingTime(reading: DailyReadingInput): number {
  return Date.parse(reading.collectedAt);
}

function pickBaseline(history: DailyReadingInput[], latest: DailyReadingInput): DailyReadingInput | null {
  const target = readingTime(latest) - LAST_24H_WINDOW_MS;
  let best: DailyReadingInput | null = null;
  for (const reading of history) {
    const age = readingTime(latest) - readingTime(reading);
    if (age < LAST_24H_BASELINE_MIN_AGE_MS || age > LAST_24H_BASELINE_MAX_AGE_MS) continue;
    if (best === null || Math.abs(readingTime(reading) - target) < Math.abs(readingTime(best) - target)) {
      best = reading;
    }
  }
  return best;
}

function deltaOf(
  latest: DailyReadingInput,
  baseline: DailyReadingInput | null,
): { values: Record<Counter, number | null>; resets: number } {
  const values: Record<Counter, number | null> = { views: null, likes: null, comments: null, saves: null };
  let resets = 0;
  for (const counter of COUNTERS) {
    const current = latest[counter];
    const previous = baseline === null ? 0 : baseline[counter];
    if (current === null || previous === null) continue;
    if (current < previous) {
      values[counter] = 0;
      resets += 1;
      continue;
    }
    values[counter] = current - previous;
  }
  return { values, resets };
}

function compareRows(a: Last24hRowView, b: Last24hRowView): number {
  if (a.views === null && b.views !== null) return 1;
  if (a.views !== null && b.views === null) return -1;
  if (a.views !== null && b.views !== null && a.views !== b.views) return b.views - a.views;
  return b.collectedAt.localeCompare(a.collectedAt)
    || a.postId.localeCompare(b.postId)
    || a.provider.localeCompare(b.provider)
    || a.externalId.localeCompare(b.externalId);
}

function postMatchesQuery(post: Last24hPostInput, query: Last24hQuery): boolean {
  if (query.personaId === METRICS_NONE) return post.personaId === null;
  if (query.personaId !== null) return post.personaId === query.personaId;
  return true;
}

export function computeLast24h(input: {
  readings: DailyReadingInput[];
  posts: Last24hPostInput[];
  query: Last24hQuery;
  now: Date;
  personaIds?: ReadonlyArray<string> | null;
  resolvedAccountIds?: ReadonlyMap<string, string>;
}): Last24hComputed {
  const { readings, query, now } = input;
  const scope = input.personaIds ?? null;
  const postsById = new Map(input.posts.map((post) => [post.id, post]));

  const groups = new Map<string, DailyReadingInput[]>();
  for (const reading of readings) {
    if (Number.isNaN(readingTime(reading))) continue;
    const key = `${reading.postId}:${reading.provider}:${reading.externalId}`;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [reading]);
    else group.push(reading);
  }

  const rows: Last24hRowView[] = [];
  const skipped = { noBaseline: 0, stale: 0 };
  let counterResets = 0;

  for (const history of groups.values()) {
    history.sort((a, b) => readingTime(b) - readingTime(a));
    const latest = history[0];
    const post = postsById.get(latest.postId);
    if (post === undefined) {
      logger.warn('[metrics-last-24h] reading skipped: post not found', { postId: latest.postId });
      continue;
    }
    if (!postInPersonaScope(post.personaId, post.voiceover, scope)) continue;
    if (!postMatchesQuery(post, query)) continue;
    if (query.provider !== null && latest.provider !== query.provider) continue;
    const target = metricsTargets(post.outcomes).targets.find(
      (candidate) => candidate.provider === latest.provider && candidate.externalId === latest.externalId,
    );
    if (target === undefined) {
      logger.warn('[metrics-last-24h] reading skipped: no publish target', {
        postId: latest.postId,
        provider: latest.provider,
        externalId: latest.externalId,
      });
      continue;
    }
    const accountId = input.resolvedAccountIds?.get(accountOverrideKey(latest.postId, latest.provider, latest.externalId))
      ?? target.accountId;
    if (query.accountId !== null && accountId !== query.accountId) continue;

    const latestAt = readingTime(latest);
    if (now.getTime() - latestAt > LAST_24H_LATEST_MAX_AGE_MS) {
      skipped.stale += 1;
      continue;
    }

    const published = Date.parse(post.publishedAt);
    const publishedInsideWindow = !Number.isNaN(published) && published > latestAt - LAST_24H_WINDOW_MS;
    const baseline = publishedInsideWindow ? null : pickBaseline(history, latest);
    if (baseline === null && !publishedInsideWindow) {
      skipped.noBaseline += 1;
      continue;
    }

    const delta = deltaOf(latest, baseline);
    if (delta.resets > 0) {
      counterResets += delta.resets;
      logger.warn('[metrics-last-24h] counter went backwards; clamped to 0', {
        postId: latest.postId,
        provider: latest.provider,
        externalId: latest.externalId,
        resets: delta.resets,
      });
    }
    rows.push({
      postId: latest.postId,
      personaId: post.personaId,
      provider: latest.provider,
      accountId,
      externalId: latest.externalId,
      publishedAt: post.publishedAt,
      ...delta.values,
      baseline: baseline === null ? 'lifetime' : 'reading',
      collectedAt: latest.collectedAt,
      baselineCollectedAt: baseline === null ? null : baseline.collectedAt,
    });
  }

  rows.sort(compareRows);
  const truncated = rows.length > METRICS_ROW_LIMIT;
  const kept = rows.slice(0, METRICS_ROW_LIMIT);
  let views = 0;
  let engagement = 0;
  for (const row of kept) {
    views += row.views ?? 0;
    engagement += (row.likes ?? 0) + (row.comments ?? 0) + (row.saves ?? 0);
  }
  return {
    rows: kept,
    totals: {
      views,
      engagement,
      videos: new Set(kept.map((row) => row.postId)).size,
      measurements: kept.length,
    },
    skipped,
    counterResets,
    truncated,
    asOf: kept.reduce<string | null>(
      (max, row) => (max === null || row.collectedAt > max ? row.collectedAt : max),
      null,
    ),
  };
}

export function readingFromRecord(record: Record<string, unknown>): DailyReadingInput | null {
  if (
    typeof record.post_id !== 'string'
    || !isSocialProvider(record.provider)
    || typeof record.external_id !== 'string'
    || typeof record.collected_at !== 'string'
  ) {
    return null;
  }
  return {
    postId: record.post_id,
    provider: record.provider,
    externalId: record.external_id,
    collectedAt: record.collected_at,
    views: numericOrNull(record.views),
    likes: numericOrNull(record.likes),
    comments: numericOrNull(record.comments),
    saves: numericOrNull(record.saves),
  };
}
