import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import type { SocialProvider } from '@/lib/providers/registry';
import { isMetricsWindow, type AnalyticsStatus, type MetricsWindow } from './metrics-query';
import { findReopenedPosts } from './post-metrics-reopen';
import { classifySnapshotFailure, snapshotFailureDetails } from './snapshot-failure';

export type { MetricsWindow };
export type MeasuredProvider = SocialProvider;

export const MAX_POSTS_PER_RUN = 50;
export const RUN_TIME_BUDGET_MS = 45_000;

export interface MetricsCounters {
  views: number | null;
  likes: number | null;
  comments: number | null;
  saves: number | null;
  retention?: RetentionSnapshot;
}

export interface RetentionSnapshot {
  status: AnalyticsStatus;
  analyticsViews: number | null;
  engagedViews: number | null;
  averageViewDurationSeconds: number | null;
  averageViewPercentage: number | null;
  contentType: string | null;
  startDate: string | null;
  endDate: string | null;
}

export interface CounterContext {
  window: MetricsWindow;
  now: Date;
}

export interface DuePost {
  id: string;
  userId: string;
  publishOutcomes: unknown[];
  window: MetricsWindow;
  collectedKeys: Set<string>;
}

interface MetricsRow extends MetricsCounters {
  postId: string;
  userId: string;
  provider: MeasuredProvider;
  accountId: string;
  externalId: string;
  window: MetricsWindow;
}

export interface MetricsTarget {
  provider: MeasuredProvider;
  accountId: string;
  externalId: string;
}

interface PromptTag {
  promptVersionId: string | null;
}

export interface PostMetricsDeps {
  listDuePosts: (now: Date, limit: number) => Promise<DuePost[]>;
  fetchCounters: (userId: string, target: MetricsTarget, context: CounterContext) => Promise<MetricsCounters>;
  resolveTarget: (userId: string, target: MetricsTarget) => Promise<MetricsTarget | null>;
  saveMetrics: (row: MetricsRow) => Promise<PromptTag>;
  markDone: (postId: string, window: MetricsWindow) => Promise<void>;
  track: (event: string, properties: Record<string, unknown>) => void;
  now: () => Date;
}

export interface PostMetricsReport {
  checked: number;
  recorded: number;
  errors: string[];
  truncated: boolean;
}

function retentionColumns(retention: RetentionSnapshot | undefined): Record<string, string | number | null> {
  return {
    analytics_status: retention?.status ?? null,
    analytics_views: retention?.analyticsViews ?? null,
    engaged_views: retention?.engagedViews ?? null,
    average_view_duration_seconds: retention?.averageViewDurationSeconds ?? null,
    average_view_percentage: retention?.averageViewPercentage ?? null,
    content_type: retention?.contentType ?? null,
    analytics_start_date: retention?.startDate ?? null,
    analytics_end_date: retention?.endDate ?? null,
  };
}

function targetKey(target: Pick<MetricsTarget, 'provider' | 'externalId'>): string {
  return `${target.provider}:${target.externalId}`;
}

export function youtubeVideoId(link: string): string | null {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, '').replace(/^m\./, '');
  if (host === 'youtu.be') return url.pathname.slice(1) || null;
  if (host !== 'youtube.com') return null;
  const watchId = url.searchParams.get('v');
  if (watchId !== null && watchId !== '') return watchId;
  const shorts = url.pathname.match(/^\/shorts\/([^/]+)/);
  return shorts ? shorts[1] : null;
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

const TARGET_EXTRACTORS: Record<MeasuredProvider, (record: Record<string, unknown>) => string | null> = {
  youtube: (record) => {
    const link = readString(record, 'videoUrl');
    return link === null ? null : youtubeVideoId(link);
  },
  instagram: (record) => readString(record, 'postId'),
  bluesky: (record) => readString(record, 'postId'),
  linkedin: (record) => readString(record, 'postId'),
  threads: (record) => readString(record, 'postId'),
  facebook: (record) => readString(record, 'postId'),
  pinterest: (record) => readString(record, 'postId'),
  '3speak': (record) => readString(record, 'postId'),
  rumble: (record) => readString(record, 'postId'),
  fanvue: (record) => readString(record, 'postId'),
  telegram: (record) => readString(record, 'postId'),
};

function isMeasuredProvider(value: unknown): value is MeasuredProvider {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(TARGET_EXTRACTORS, value);
}

export interface MetricsTargetsResult {
  targets: MetricsTarget[];
  unknownProviders: string[];
}

export function metricsTargets(publishResults: unknown[]): MetricsTargetsResult {
  const result: MetricsTargetsResult = { targets: [], unknownProviders: [] };
  for (const entry of publishResults) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    if (record.status === 'failed') continue;
    if (!isMeasuredProvider(record.provider)) {
      result.unknownProviders.push(String(record.provider));
      continue;
    }
    const accountId = readString(record, 'accountId');
    if (accountId === null) continue;
    const externalId = TARGET_EXTRACTORS[record.provider](record);
    if (externalId !== null) result.targets.push({ provider: record.provider, accountId, externalId });
  }
  return result;
}

export async function collectPostMetrics(deps: PostMetricsDeps): Promise<PostMetricsReport> {
  const startedAt = deps.now();
  const report: PostMetricsReport = { checked: 0, recorded: 0, errors: [], truncated: false };

  const posts = await deps.listDuePosts(startedAt, MAX_POSTS_PER_RUN + 1);
  if (posts.length > MAX_POSTS_PER_RUN) report.truncated = true;

  for (const post of posts.slice(0, MAX_POSTS_PER_RUN)) {
    if (deps.now().getTime() - startedAt.getTime() > RUN_TIME_BUDGET_MS) {
      report.truncated = true;
      break;
    }
    report.checked += 1;

    const found = metricsTargets(post.publishOutcomes);
    const targets = found.targets;
    for (const provider of found.unknownProviders) {
      logger.warn('[post-metrics] unknown provider in publish outcomes', { postId: post.id, provider });
      report.errors.push(`${post.id}/${provider}: unknown provider`);
    }

    let failed = false;
    let missingAnalyticsScope = false;
    for (const target of targets) {
      if (post.collectedKeys.has(targetKey(target))) continue;
      try {
        const resolved = await deps.resolveTarget(post.userId, target);
        if (resolved === null) {
          logger.warn('[post-metrics] snapshot skipped', {
            postId: post.id,
            provider: target.provider,
            externalId: target.externalId,
            accountId: target.accountId,
          });
          continue;
        }
        const counters = await deps.fetchCounters(post.userId, resolved, { window: post.window, now: deps.now() });
        if (counters.retention?.status === 'scope_missing') missingAnalyticsScope = true;
        const tag = await deps.saveMetrics({
          postId: post.id, userId: post.userId, window: post.window, ...resolved, ...counters,
        });
        report.recorded += 1;
        deps.track('post_metrics_collected', {
          post_id: post.id,
          user_id: post.userId,
          provider: resolved.provider,
          window: post.window,
          views: counters.views,
          likes: counters.likes,
          comments: counters.comments,
          saves: counters.saves,
          engaged_views: counters.retention?.engagedViews ?? null,
          analytics_status: counters.retention?.status ?? null,
          prompt_version_id: tag.promptVersionId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const kind = classifySnapshotFailure(error);
        const { status, metaCode } = snapshotFailureDetails(error);
        if (kind === 'token_dead') {
          logger.warn('[post-metrics] snapshot failed: token dead', {
            postId: post.id,
            provider: target.provider,
            error: message,
            status,
            metaCode,
          });
          report.errors.push(`${post.id}/${target.provider}: snapshot failed`);
          failed = true;
        } else if (kind === 'media_gone') {
          logger.warn('[post-metrics] snapshot skipped', {
            postId: post.id,
            provider: target.provider,
            externalId: target.externalId,
            accountId: target.accountId,
            status,
            metaCode,
          });
        } else {
          logger.warn('[post-metrics] snapshot failed', {
            postId: post.id,
            provider: target.provider,
            error: message,
            status,
            metaCode,
          });
          report.errors.push(`${post.id}/${target.provider}: snapshot failed`);
          failed = true;
        }
      }
    }
    if (!failed && !missingAnalyticsScope) {
      try {
        await deps.markDone(post.id, post.window);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn('[post-metrics] mark done failed', { postId: post.id, error: message });
        report.errors.push(`${post.id}: mark done failed`);
      }
    }
  }
  return report;
}

export function createPostMetricsStore(
  supabase: SupabaseClient,
): Pick<PostMetricsDeps, 'listDuePosts' | 'saveMetrics' | 'markDone'> {
  return {
    async listDuePosts(now, limit) {
      const { data, error } = await supabase.rpc('find_post_metrics_due', {
        p_now: now.toISOString(),
        p_limit: limit,
      });
      if (error) throw new Error(`due posts lookup failed: ${error.message}`);
      const posts: DuePost[] = [];
      const seen = new Set<string>();
      for (const row of (Array.isArray(data) ? data : []) as Array<Record<string, unknown>>) {
        const window = row.metrics_window;
        if (
          typeof row.post_id !== 'string'
          || typeof row.user_id !== 'string'
          || !isMetricsWindow(window)
        ) {
          continue;
        }
        const keys = Array.isArray(row.collected_keys)
          ? row.collected_keys.filter((key): key is string => typeof key === 'string')
          : [];
        posts.push({
          id: row.post_id,
          userId: row.user_id,
          publishOutcomes: Array.isArray(row.publish_outcomes) ? row.publish_outcomes : [],
          window,
          collectedKeys: new Set(keys),
        });
        seen.add(`${row.post_id}:${window}`);
      }
      const reopened = await findReopenedPosts(
        supabase,
        now,
        seen,
        Math.max(0, MAX_POSTS_PER_RUN - posts.length),
        metricsTargets,
        targetKey,
      );
      return [...posts, ...reopened];
    },
    async saveMetrics(row) {
      const { data, error } = await supabase.from('post_metrics').upsert(
        {
          post_id: row.postId,
          user_id: row.userId,
          provider: row.provider,
          account_id: row.accountId,
          external_id: row.externalId,
          metrics_window: row.window,
          views: row.views,
          likes: row.likes,
          comments: row.comments,
          saves: row.saves,
          ...retentionColumns(row.retention),
        },
        { onConflict: 'post_id,provider,external_id,metrics_window' },
      )
        .select('prompt_version_id')
        .single();
      if (error) throw new Error(`metrics write failed: ${error.message}`);
      return { promptVersionId: data.prompt_version_id };
    },
    async markDone(postId, window) {
      const { error } = await supabase
        .from('post_metrics_done')
        .upsert({ post_id: postId, metrics_window: window }, { onConflict: 'post_id,metrics_window' });
      if (error) throw new Error(`mark done failed: ${error.message}`);
    },
  };
}
