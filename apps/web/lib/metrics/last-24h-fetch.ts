import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { isPlaceholderProviderAccountId } from '@/lib/social-accounts';
import type { Last24hQuery } from './metrics-query';
import { metricsTargets } from './post-metrics';
import { resolveYouTubeMetricsTarget } from './youtube-account-resolution';
import {
  LAST_24H_LOOKBACK_MS,
  accountOverrideKey,
  computeLast24h,
  readingFromRecord,
  type DailyReadingInput,
  type Last24hComputed,
  type Last24hPostInput,
} from './last-24h';

export const LAST_24H_READINGS_LIMIT = 1000;
const ID_CHUNK = 100;

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function loadPosts(
  supabase: SupabaseClient,
  userId: string,
  postIds: string[],
): Promise<Last24hPostInput[]> {
  const records: Array<Record<string, unknown>> = [];
  for (const ids of chunks(postIds, ID_CHUNK)) {
    const { data, error } = await supabase
      .from('scheduled_posts')
      .select('id, schedule_id, published_at, publish_outcomes, faceless')
      .eq('user_id', userId)
      .in('id', ids)
      .limit(ids.length);
    if (error) throw new Error(`last-24h posts lookup failed: ${error.message}`);
    if (Array.isArray(data)) records.push(...(data as Array<Record<string, unknown>>));
  }

  const scheduleIds = [...new Set(records
    .map((record) => (typeof record.schedule_id === 'string' ? record.schedule_id : null))
    .filter((id): id is string => id !== null))];
  const personaBySchedule = new Map<string, string | null>();
  for (const ids of chunks(scheduleIds, ID_CHUNK)) {
    const { data, error } = await supabase
      .from('schedules')
      .select('id, persona_id')
      .eq('user_id', userId)
      .in('id', ids)
      .limit(ids.length);
    if (error) throw new Error(`last-24h schedules lookup failed: ${error.message}`);
    for (const record of Array.isArray(data) ? data : []) {
      if (typeof record.id === 'string') {
        personaBySchedule.set(record.id, typeof record.persona_id === 'string' ? record.persona_id : null);
      }
    }
  }

  const posts: Last24hPostInput[] = [];
  for (const record of records) {
    if (typeof record.id !== 'string' || typeof record.published_at !== 'string') {
      logger.warn('[metrics-last-24h] skipped post with missing id or published_at', { postId: record.id });
      continue;
    }
    posts.push({
      id: record.id,
      personaId: typeof record.schedule_id === 'string' ? (personaBySchedule.get(record.schedule_id) ?? null) : null,
      publishedAt: record.published_at,
      outcomes: Array.isArray(record.publish_outcomes) ? record.publish_outcomes : [],
      faceless: record.faceless === true,
    });
  }
  return posts;
}

async function resolvePlaceholderAccounts(
  userId: string,
  readings: DailyReadingInput[],
  posts: Last24hPostInput[],
): Promise<Map<string, string>> {
  const postsById = new Map(posts.map((post) => [post.id, post]));
  const resolved = new Map<string, string>();
  const attempted = new Set<string>();
  for (const reading of readings) {
    if (reading.provider !== 'youtube') continue;
    const key = accountOverrideKey(reading.postId, reading.provider, reading.externalId);
    if (attempted.has(key)) continue;
    const post = postsById.get(reading.postId);
    if (post === undefined) continue;
    const target = metricsTargets(post.outcomes).targets.find(
      (candidate) => candidate.provider === reading.provider && candidate.externalId === reading.externalId,
    );
    if (target === undefined || !isPlaceholderProviderAccountId(target.accountId)) continue;
    attempted.add(key);
    try {
      const account = await resolveYouTubeMetricsTarget(userId, target);
      if (account !== null) resolved.set(key, account.accountId);
    } catch (error) {
      logger.warn('[metrics-last-24h] youtube placeholder account not resolved', {
        postId: reading.postId,
        externalId: reading.externalId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return resolved;
}

export async function fetchLast24h(
  supabase: SupabaseClient,
  userId: string,
  query: Last24hQuery,
  now: Date,
  options?: { personaIds?: ReadonlyArray<string> | null },
): Promise<Last24hComputed> {
  const since = new Date(now.getTime() - LAST_24H_LOOKBACK_MS);
  const { data, error } = await supabase
    .from('post_metrics_daily')
    .select('post_id, provider, external_id, collected_at, views, likes, comments, saves')
    .eq('user_id', userId)
    .gte('collected_at', since.toISOString())
    .order('collected_at', { ascending: false })
    .order('id', { ascending: true })
    .limit(LAST_24H_READINGS_LIMIT);
  if (error) throw new Error(`last-24h readings lookup failed: ${error.message}`);

  const records = Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
  const readingsTruncated = records.length >= LAST_24H_READINGS_LIMIT;
  if (readingsTruncated) {
    logger.warn('[metrics-last-24h] readings read hit its cap; older readings were not read', { userId });
  }
  const readings: DailyReadingInput[] = [];
  for (const record of records) {
    const reading = readingFromRecord(record);
    if (reading === null) {
      logger.warn('[metrics-last-24h] skipped reading with unknown provider or missing id', {
        provider: record.provider,
      });
      continue;
    }
    readings.push(reading);
  }

  const postIds = [...new Set(readings.map((reading) => reading.postId))];
  const posts = postIds.length === 0 ? [] : await loadPosts(supabase, userId, postIds);
  const resolvedAccountIds = await resolvePlaceholderAccounts(userId, readings, posts);
  const computed = computeLast24h({
    resolvedAccountIds,
    readings,
    posts,
    query,
    now,
    personaIds: options?.personaIds ?? null,
  });
  return { ...computed, truncated: computed.truncated || readingsTruncated };
}
