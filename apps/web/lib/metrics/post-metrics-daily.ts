import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import type {
  CounterContext,
  MeasuredProvider,
  MetricsCounters,
  MetricsTarget,
  MetricsTargetsResult,
} from './post-metrics';
import { classifySnapshotFailure, snapshotFailureDetails } from './snapshot-failure';

export const MAX_DAILY_POSTS_PER_RUN = 50;
export const DAILY_RUN_TIME_BUDGET_MS = 45_000;

export interface DailyDuePost {
  id: string;
  userId: string;
  taskId: string;
}

export interface DailyReading {
  postId: string;
  userId: string;
  provider: MeasuredProvider;
  externalId: string;
  snapshotDate: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  saves: number | null;
}

export interface PostMetricsDailyDeps {
  listDuePosts: (now: Date, limit: number) => Promise<DailyDuePost[]>;
  fetchTaskSource: (taskId: string, userId: string) => Promise<{ publishResults: unknown[] }>;
  fetchCounters: (userId: string, target: MetricsTarget, context: CounterContext) => Promise<MetricsCounters>;
  resolveTarget: (userId: string, target: MetricsTarget) => Promise<MetricsTarget | null>;
  saveReading: (reading: DailyReading) => Promise<void>;
  metricsTargets: (publishResults: unknown[]) => MetricsTargetsResult;
  now: () => Date;
  budgetMs?: number;
}

export interface PostMetricsDailyReport {
  checked: number;
  recorded: number;
  errors: string[];
  truncated: boolean;
}

export function utcSnapshotDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export async function collectPostMetricsDaily(deps: PostMetricsDailyDeps): Promise<PostMetricsDailyReport> {
  const startedAt = deps.now();
  const budgetMs = deps.budgetMs ?? DAILY_RUN_TIME_BUDGET_MS;
  const snapshotDate = utcSnapshotDate(startedAt);
  const report: PostMetricsDailyReport = { checked: 0, recorded: 0, errors: [], truncated: false };

  const posts = await deps.listDuePosts(startedAt, MAX_DAILY_POSTS_PER_RUN + 1);
  if (posts.length > MAX_DAILY_POSTS_PER_RUN) report.truncated = true;

  for (const post of posts.slice(0, MAX_DAILY_POSTS_PER_RUN)) {
    if (deps.now().getTime() - startedAt.getTime() > budgetMs) {
      report.truncated = true;
      break;
    }
    report.checked += 1;

    let targets: MetricsTarget[];
    try {
      const source = await deps.fetchTaskSource(post.taskId, post.userId);
      const found = deps.metricsTargets(source.publishResults);
      targets = found.targets;
      for (const provider of found.unknownProviders) {
        logger.warn('[post-metrics-daily] unknown provider in publish results', { postId: post.id, provider });
        report.errors.push(`${post.id}/${provider}: unknown provider`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn('[post-metrics-daily] publish results unavailable', { postId: post.id, error: message });
      report.errors.push(`${post.id}: publish results unavailable`);
      continue;
    }

    const seen = new Set<string>();
    for (const target of targets) {
      const key = `${target.provider}:${target.externalId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      try {
        const resolved = await deps.resolveTarget(post.userId, target);
        if (resolved === null) {
          logger.warn('[post-metrics-daily] reading skipped', {
            postId: post.id,
            provider: target.provider,
            externalId: target.externalId,
            accountId: target.accountId,
          });
          continue;
        }
        const counters = await deps.fetchCounters(post.userId, resolved, { window: '24h', now: deps.now() });
        await deps.saveReading({
          postId: post.id,
          userId: post.userId,
          provider: resolved.provider,
          externalId: resolved.externalId,
          snapshotDate,
          views: counters.views,
          likes: counters.likes,
          comments: counters.comments,
          saves: counters.saves,
        });
        report.recorded += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const { status, metaCode } = snapshotFailureDetails(error);
        if (classifySnapshotFailure(error) === 'media_gone') {
          logger.warn('[post-metrics-daily] reading skipped', {
            postId: post.id,
            provider: target.provider,
            externalId: target.externalId,
            accountId: target.accountId,
            status,
            metaCode,
          });
          continue;
        }
        logger.warn('[post-metrics-daily] reading failed', {
          postId: post.id,
          provider: target.provider,
          error: message,
          status,
          metaCode,
        });
        report.errors.push(`${post.id}/${target.provider}: reading failed`);
      }
    }
  }
  return report;
}

export function createPostMetricsDailyStore(
  supabase: SupabaseClient,
): Pick<PostMetricsDailyDeps, 'listDuePosts' | 'saveReading'> {
  return {
    async listDuePosts(now, limit) {
      const { data, error } = await supabase.rpc('find_post_metrics_daily_due', {
        p_now: now.toISOString(),
        p_limit: limit,
      });
      if (error) throw new Error(`daily due posts lookup failed: ${error.message}`);
      const posts: DailyDuePost[] = [];
      for (const row of (Array.isArray(data) ? data : []) as Array<Record<string, unknown>>) {
        if (typeof row.post_id !== 'string' || typeof row.user_id !== 'string' || typeof row.task_id !== 'string') {
          continue;
        }
        posts.push({ id: row.post_id, userId: row.user_id, taskId: row.task_id });
      }
      return posts;
    },
    async saveReading(reading) {
      const { error } = await supabase.from('post_metrics_daily').upsert(
        {
          post_id: reading.postId,
          user_id: reading.userId,
          provider: reading.provider,
          external_id: reading.externalId,
          snapshot_date: reading.snapshotDate,
          views: reading.views,
          likes: reading.likes,
          comments: reading.comments,
          saves: reading.saves,
          collected_at: new Date().toISOString(),
        },
        { onConflict: 'post_id,provider,external_id,snapshot_date' },
      );
      if (error) throw new Error(`daily reading write failed: ${error.message}`);
    },
  };
}
