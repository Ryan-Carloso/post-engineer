import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { METRICS_ROW_LIMIT } from '@/lib/metrics/metrics-query';
import { isSocialProvider, type SocialProvider } from '@/lib/providers/registry';
import {
  SHARE_POSTS_LIMIT,
  isSharePostStatus,
  type SharePost,
  type ShareProviderTotals,
  type ShareView,
} from './share-view-types';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ShareScope {
  userId: string;
  personaIds: string[] | null;
}

export function weekBounds(now: Date): { from: Date; to: Date } {
  const startOfDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const daysSinceMonday = (now.getUTCDay() + 6) % 7;
  const from = new Date(startOfDay - daysSinceMonday * DAY_MS);
  return { from, to: new Date(from.getTime() + 7 * DAY_MS) };
}

function counter(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

interface MetricRecord {
  provider: SocialProvider;
  views: number;
  engagement: number;
  collectedAt: string;
}

function narrowMetricRecord(raw: unknown): MetricRecord | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  if (!isSocialProvider(record.provider) || typeof record.collected_at !== 'string') return null;
  return {
    provider: record.provider,
    views: counter(record.views),
    engagement: counter(record.likes) + counter(record.comments) + counter(record.saves),
    collectedAt: record.collected_at,
  };
}

async function loadMetrics(
  supabase: SupabaseClient,
  scope: ShareScope,
): Promise<Pick<ShareView, 'summary' | 'byProvider' | 'asOf' | 'metricsTruncated'>> {
  let query = supabase
    .from('post_metrics')
    .select('provider, views, likes, comments, saves, collected_at')
    .eq('user_id', scope.userId)
    .eq('metrics_window', '7d');
  if (scope.personaIds !== null) query = query.in('persona_id', scope.personaIds);
  const { data, error } = await query
    .order('collected_at', { ascending: false })
    .order('id', { ascending: true })
    .limit(METRICS_ROW_LIMIT + 1);
  if (error) throw new Error(`share metrics query failed: ${error.message}`);

  const rows = Array.isArray(data) ? data : [];
  const totals = new Map<SocialProvider, ShareProviderTotals>();
  let asOf: string | null = null;
  let measurements = 0;
  let views = 0;
  let engagement = 0;
  for (const raw of rows.slice(0, METRICS_ROW_LIMIT)) {
    const record = narrowMetricRecord(raw);
    if (record === null) {
      logger.warn('[share-view] skipped a metrics row that could not be read');
      continue;
    }
    measurements += 1;
    views += record.views;
    engagement += record.engagement;
    if (asOf === null || record.collectedAt > asOf) asOf = record.collectedAt;
    const current = totals.get(record.provider) ?? { provider: record.provider, measurements: 0, views: 0, engagement: 0 };
    totals.set(record.provider, {
      provider: record.provider,
      measurements: current.measurements + 1,
      views: current.views + record.views,
      engagement: current.engagement + record.engagement,
    });
  }
  return {
    summary: { measurements, views, engagement },
    byProvider: [...totals.values()].sort((a, b) => b.views - a.views || a.provider.localeCompare(b.provider)),
    asOf,
    metricsTruncated: rows.length > METRICS_ROW_LIMIT,
  };
}

function narrowPost(raw: unknown): SharePost | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.slot_at !== 'string' || !isSharePostStatus(record.status)) return null;
  if (record.title !== null && typeof record.title !== 'string') return null;
  const providers = Array.isArray(record.providers) ? record.providers.filter(isSocialProvider) : [];
  return { title: record.title, slotAt: record.slot_at, status: record.status, providers };
}

async function loadWeekPosts(
  supabase: SupabaseClient,
  scope: ShareScope,
  week: { from: Date; to: Date },
): Promise<Pick<ShareView, 'posts' | 'postsTruncated'>> {
  const { data, error } = await supabase.rpc('share_week_posts', {
    p_user_id: scope.userId,
    p_persona_ids: scope.personaIds,
    p_from: week.from.toISOString(),
    p_to: week.to.toISOString(),
    p_limit: SHARE_POSTS_LIMIT + 1,
  });
  if (error) throw new Error(`share posts query failed: ${error.message}`);

  const rows: unknown[] = Array.isArray(data) ? data : [];
  const posts: SharePost[] = [];
  for (const raw of rows.slice(0, SHARE_POSTS_LIMIT)) {
    const post = narrowPost(raw);
    if (post === null) {
      logger.warn('[share-view] skipped a post row that could not be read');
      continue;
    }
    posts.push(post);
  }
  return { posts, postsTruncated: rows.length > SHARE_POSTS_LIMIT };
}

export async function loadShareView(supabase: SupabaseClient, scope: ShareScope, now: Date): Promise<ShareView> {
  const week = weekBounds(now);
  const [metrics, posts] = await Promise.all([loadMetrics(supabase, scope), loadWeekPosts(supabase, scope, week)]);
  return {
    window: '7d',
    weekStart: week.from.toISOString(),
    weekEnd: week.to.toISOString(),
    ...metrics,
    ...posts,
  };
}
