import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { isSocialProvider, type SocialProvider } from '@/lib/providers/registry';
import {
  METRICS_NONE,
  METRICS_ROW_LIMIT,
  METRICS_WINDOW_LOOKBACK_HOURS,
  metricsWindowRange,
  type CoverageItem,
  type CoverageReason,
  type MetricsQuery,
} from './metrics-query';
import { metricsTargets } from './post-metrics';
import { postInPersonaScope } from './post-scope';

export interface CoveragePostInput {
  id: string;
  personaId: string | null;
  publishedAt: string;
  outcomes: unknown[];
  voiceover: boolean;
}

export interface CoverageRowInput {
  postId: string;
  provider: SocialProvider;
  externalId: string;
}

const COVERAGE_ROWS_LIMIT = 5000;

function classifyReason(now: Date, opensAt: Date, closesAt: Date, done: boolean): CoverageReason {
  if (now.getTime() < opensAt.getTime()) return 'pending';
  if (now.getTime() < closesAt.getTime()) return 'retrying';
  return done ? 'no-target' : 'missed';
}

export function computeCoverage(input: {
  posts: CoveragePostInput[];
  rows: CoverageRowInput[];
  donePostIds: ReadonlySet<string>;
  query: MetricsQuery;
  now: Date;
  personaIds?: ReadonlyArray<string> | null;
}): { items: CoverageItem[]; truncated: boolean; unknownProviders: string[] } {
  const { posts, rows, donePostIds, query, now } = input;
  const scope = input.personaIds ?? null;
  const cutoff = now.getTime() - METRICS_WINDOW_LOOKBACK_HOURS * 60 * 60 * 1000;

  const collected = new Set<string>();
  for (const row of rows) {
    collected.add(`${row.postId}:${row.provider}:${row.externalId}`);
  }

  const items: CoverageItem[] = [];
  const unknownProviders: string[] = [];
  for (const post of posts) {
    const published = Date.parse(post.publishedAt);
    if (Number.isNaN(published)) continue;
    if (published < cutoff) continue;
    if (query.personaId === METRICS_NONE) {
      if (post.personaId !== null) continue;
    } else if (query.personaId !== null && post.personaId !== query.personaId) {
      continue;
    }
    if (!postInPersonaScope(post.personaId, post.voiceover, scope)) continue;
    const { opensAt, closesAt } = metricsWindowRange(query.window, new Date(published));
    const found = metricsTargets(post.outcomes);
    unknownProviders.push(...found.unknownProviders);
    for (const target of found.targets) {
      if (query.provider !== null && target.provider !== query.provider) continue;
      if (query.accountId !== null && target.accountId !== query.accountId) continue;
      if (collected.has(`${post.id}:${target.provider}:${target.externalId}`)) continue;
      items.push({
        postId: post.id,
        personaId: post.personaId,
        provider: target.provider,
        accountId: target.accountId,
        externalId: target.externalId,
        reason: classifyReason(now, opensAt, closesAt, donePostIds.has(post.id)),
        publishedAt: post.publishedAt,
        windowOpensAt: opensAt.toISOString(),
        windowClosesAt: closesAt.toISOString(),
      });
    }
    const failedSeen = new Set<string>();
    for (const entry of post.outcomes) {
      if (typeof entry !== 'object' || entry === null) continue;
      const record = entry as Record<string, unknown>;
      if (record.status !== 'failed') continue;
      if (!isSocialProvider(record.provider)) continue;
      const accountId = typeof record.accountId === 'string' && record.accountId !== '' ? record.accountId : null;
      if (accountId === null) continue;
      if (query.provider !== null && record.provider !== query.provider) continue;
      if (query.accountId !== null && accountId !== query.accountId) continue;
      const dedupeKey = `${record.provider}:${accountId}`;
      if (failedSeen.has(dedupeKey)) continue;
      failedSeen.add(dedupeKey);
      items.push({
        postId: post.id,
        personaId: post.personaId,
        provider: record.provider,
        accountId,
        externalId: null,
        reason: 'publish-failed',
        publishedAt: post.publishedAt,
        windowOpensAt: opensAt.toISOString(),
        windowClosesAt: closesAt.toISOString(),
      });
    }
  }
  items.sort(
    (a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.postId.localeCompare(b.postId),
  );
  const truncated = items.length > METRICS_ROW_LIMIT;
  return { items: items.slice(0, METRICS_ROW_LIMIT), truncated, unknownProviders };
}

export async function fetchCoverage(
  supabase: SupabaseClient,
  userId: string,
  query: MetricsQuery,
  now: Date,
  options?: { personaIds?: ReadonlyArray<string> | null },
): Promise<{ items: CoverageItem[]; truncated: boolean }> {
  const cutoff = new Date(now.getTime() - METRICS_WINDOW_LOOKBACK_HOURS * 60 * 60 * 1000);
  const { data: postData, error: postError } = await supabase
    .from('scheduled_posts')
    .select('id, schedule_id, user_id, status, published_at, publish_outcomes, voiceover')
    .eq('user_id', userId)
    .eq('status', 'published')
    .gte('published_at', cutoff.toISOString())
    .order('published_at', { ascending: false })
    .order('id', { ascending: true })
    .limit(METRICS_ROW_LIMIT + 1);
  if (postError) throw new Error(`coverage posts lookup failed: ${postError.message}`);
  const postRecords = Array.isArray(postData) ? postData : [];
  if (postRecords.length === 0) return { items: [], truncated: false };
  const postsTruncated = postRecords.length > METRICS_ROW_LIMIT;

  const scheduleIds = [...new Set(postRecords
    .map((record) => (typeof record.schedule_id === 'string' ? record.schedule_id : null))
    .filter((id): id is string => id !== null))];
  const personaBySchedule = new Map<string, string | null>();
  if (scheduleIds.length > 0) {
    const { data: scheduleData, error: scheduleError } = await supabase
      .from('schedules')
      .select('id, persona_id')
      .eq('user_id', userId)
      .in('id', scheduleIds)
      .limit(scheduleIds.length);
    if (scheduleError) throw new Error(`coverage schedules lookup failed: ${scheduleError.message}`);
    for (const record of Array.isArray(scheduleData) ? scheduleData : []) {
      if (typeof record.id === 'string') {
        personaBySchedule.set(record.id, typeof record.persona_id === 'string' ? record.persona_id : null);
      }
    }
  }

  const posts: CoveragePostInput[] = [];
  const postIds: string[] = [];
  for (const record of postRecords.slice(0, METRICS_ROW_LIMIT)) {
    if (typeof record.id !== 'string' || typeof record.published_at !== 'string') {
      logger.warn('[metrics-coverage] skipped post with missing id or published_at', { postId: record.id });
      continue;
    }
    posts.push({
      id: record.id,
      personaId: typeof record.schedule_id === 'string' ? (personaBySchedule.get(record.schedule_id) ?? null) : null,
      publishedAt: record.published_at,
      outcomes: Array.isArray(record.publish_outcomes) ? record.publish_outcomes : [],
      voiceover: record.voiceover === true,
    });
    postIds.push(record.id);
  }
  if (postIds.length === 0) return { items: [], truncated: postsTruncated };

  const { data: doneData, error: doneError } = await supabase
    .from('post_metrics_done')
    .select('post_id')
    .eq('metrics_window', query.window)
    .in('post_id', postIds)
    .limit(METRICS_ROW_LIMIT + 1);
  if (doneError) throw new Error(`coverage done lookup failed: ${doneError.message}`);
  const donePostIds = new Set<string>();
  for (const record of Array.isArray(doneData) ? doneData : []) {
    if (typeof record.post_id === 'string') donePostIds.add(record.post_id);
  }

  const { data: rowData, error: rowError } = await supabase
    .from('post_metrics')
    .select('post_id, provider, external_id')
    .eq('user_id', userId)
    .eq('metrics_window', query.window)
    .in('post_id', postIds)
    .order('collected_at', { ascending: false })
    .limit(COVERAGE_ROWS_LIMIT);
  if (rowError) throw new Error(`coverage rows lookup failed: ${rowError.message}`);
  const rows: CoverageRowInput[] = [];
  for (const record of Array.isArray(rowData) ? rowData : []) {
    if (
      typeof record.post_id !== 'string'
      || !isSocialProvider(record.provider)
      || typeof record.external_id !== 'string'
    ) {
      logger.warn('[metrics-coverage] skipped row with unknown provider or missing id', { provider: record.provider });
      continue;
    }
    rows.push({
      postId: record.post_id,
      provider: record.provider,
      externalId: record.external_id,
    });
  }
  if (Array.isArray(rowData) && rowData.length >= COVERAGE_ROWS_LIMIT) {
    logger.warn('[metrics-coverage] rows read hit its cap; coverage may overstate missing snapshots', {
      userId,
      window: query.window,
    });
  }

  const { items, truncated, unknownProviders } = computeCoverage({
    posts,
    rows,
    donePostIds,
    query,
    now,
    personaIds: options?.personaIds ?? null,
  });
  for (const provider of unknownProviders) {
    logger.warn('[metrics-coverage] unknown provider in publish outcomes', { provider });
  }
  return { items, truncated: postsTruncated || truncated };
}
