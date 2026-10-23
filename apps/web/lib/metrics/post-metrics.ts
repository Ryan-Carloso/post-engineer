import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import type { SocialProvider } from '@/lib/providers/registry';

//---------------
// post-metrics — per-video performance snapshots for A/B content tests.
//
// Hourly (pg_cron -> POST /api/cron/post-metrics), every published slot is
// snapshotted twice: once 24-48h after publish ('24h') and once 168-192h
// after publish ('7d'). A window that was missed (engine down, token
// expired for the whole 24h) is skipped, never back-filled with a late
// number that would not be comparable. The windows live in SQL
// (public.find_post_metrics_due, migration 025).
//
// Every provider in SOCIAL_PROVIDERS is measured: TARGET_EXTRACTORS here
// and COUNTER_FETCHERS (provider-counters.ts) are exhaustive Records, so a
// new provider does not typecheck until it is measured too.
//
// Pure orchestration: the store and the provider fetchers are injected so
// tests never reach Supabase, the engine, or a social API.
//---------------

export type MetricsWindow = '24h' | '7d';
export type MeasuredProvider = SocialProvider;

// Bound the fan-out of one run: each post costs one engine read plus one
// provider call per published video. Which posts are due (the 24h/7d
// windows) is decided in SQL: public.find_post_metrics_due (migration 025).
export const MAX_POSTS_PER_RUN = 50;
export const RUN_TIME_BUDGET_MS = 45_000;

export interface MetricsCounters {
  views: number | null;
  likes: number | null;
  comments: number | null;
  saves: number | null;
}

export interface DuePost {
  id: string;
  userId: string;
  taskId: string;
  window: MetricsWindow;
  // `${provider}:${externalId}` of the videos already snapshotted for this
  // window: a partially collected post only retries the missing videos.
  collectedKeys: Set<string>;
}

export interface MetricsRow extends MetricsCounters {
  postId: string;
  // The engine's script angle for the post (null when none was recorded).
  scriptAngle: string | null;
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

export interface PostMetricsDeps {
  listDuePosts: (now: Date, limit: number) => Promise<DuePost[]>;
  fetchTaskSource: (taskId: string, userId: string) => Promise<{ publishResults: unknown[]; scriptAngle: string | null }>;
  fetchCounters: (userId: string, target: MetricsTarget) => Promise<MetricsCounters>;
  saveMetrics: (row: MetricsRow) => Promise<void>;
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

export function targetKey(target: Pick<MetricsTarget, 'provider' | 'externalId'>): string {
  return `${target.provider}:${target.externalId}`;
}

//---------------
// youtubeVideoId — the video id from a recorded YouTube link
// (watch?v=, youtu.be/, /shorts/). Null when the link is not YouTube.
//---------------
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

// TARGET_EXTRACTORS — the provider video id recorded in one publish_results
// entry (see lib/publish-links.ts for the per-provider shapes).
const TARGET_EXTRACTORS: Record<MeasuredProvider, (record: Record<string, unknown>) => string | null> = {
  youtube: (record) => {
    const link = readString(record, 'videoUrl');
    return link === null ? null : youtubeVideoId(link);
  },
  instagram: (record) => readString(record, 'postId'),
  bluesky: (record) => readString(record, 'postId'),
  linkedin: (record) => readString(record, 'postId'),
};

function isMeasuredProvider(value: unknown): value is MeasuredProvider {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(TARGET_EXTRACTORS, value);
}

export interface MetricsTargetsResult {
  targets: MetricsTarget[];
  // Providers in publish_results this collector does not know: reported,
  // never silently skipped.
  unknownProviders: string[];
}

//---------------
// metricsTargets — the measurable videos in an engine task's
// publish_results: every published entry with an account and a video id.
//---------------
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

//---------------
// collectPostMetrics — one cron run. Per-video failures are logged and
// reported, never thrown: one expired token must not block every other
// user's snapshot. The next hourly run retries while the window is open.
//---------------
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

    let targets: MetricsTarget[];
    let scriptAngle: string | null;
    try {
      const source = await deps.fetchTaskSource(post.taskId, post.userId);
      scriptAngle = source.scriptAngle;
      const found = metricsTargets(source.publishResults);
      targets = found.targets;
      for (const provider of found.unknownProviders) {
        logger.warn('[post-metrics] unknown provider in publish results', { postId: post.id, provider });
        report.errors.push(`${post.id}/${provider}: unknown provider`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn('[post-metrics] publish results unavailable', { postId: post.id, error: message });
      report.errors.push(`${post.id}: publish results unavailable`);
      continue;
    }

    let failed = false;
    for (const target of targets) {
      if (post.collectedKeys.has(targetKey(target))) continue;
      try {
        const counters = await deps.fetchCounters(post.userId, target);
        await deps.saveMetrics({
          postId: post.id, userId: post.userId, window: post.window, scriptAngle, ...target, ...counters,
        });
        report.recorded += 1;
        // script_angle lets PostHog break performance down by the angle the
        // script used (the same value the dashboard filters on). Deliberate
        // exception to analytics.ts's "ids, counts, validated enums" rule:
        // the angle is free-text model output, and breaking performance
        // down by it is the point of collecting it. trackApiEvent applies
        // scrubSecrets (key-name redaction), then redacts credential
        // fragments from string values and caps them at 500 chars before
        // capture.
        deps.track('post_metrics_collected', {
          task_id: post.taskId,
          script_angle: scriptAngle,
          post_id: post.id,
          user_id: post.userId,
          provider: target.provider,
          window: post.window,
          ...counters,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn('[post-metrics] snapshot failed', {
          postId: post.id,
          provider: target.provider,
          error: message,
        });
        report.errors.push(`${post.id}/${target.provider}: snapshot failed`);
        failed = true;
      }
    }
    // Every video is in (or there is none to measure): stop re-reading this
    // post for the window. A failed video keeps it open for the next run.
    if (!failed) {
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

//---------------
// createPostMetricsStore — Supabase-backed store (service role: the cron
// has no user session; every row carries the post owner's user_id).
//---------------
export function createPostMetricsStore(
  supabase: SupabaseClient,
): Pick<PostMetricsDeps, 'listDuePosts' | 'saveMetrics' | 'markDone'> {
  return {
    async listDuePosts(now, limit) {
      // supabase-js rpc() never throws: the error must be checked.
      const { data, error } = await supabase.rpc('find_post_metrics_due', {
        p_now: now.toISOString(),
        p_limit: limit,
      });
      if (error) throw new Error(`due posts lookup failed: ${error.message}`);
      const posts: DuePost[] = [];
      for (const row of (Array.isArray(data) ? data : []) as Array<Record<string, unknown>>) {
        const window = row.metrics_window;
        if (
          typeof row.post_id !== 'string'
          || typeof row.user_id !== 'string'
          || typeof row.task_id !== 'string'
          || (window !== '24h' && window !== '7d')
        ) {
          continue;
        }
        const keys = Array.isArray(row.collected_keys)
          ? row.collected_keys.filter((key): key is string => typeof key === 'string')
          : [];
        posts.push({
          id: row.post_id,
          userId: row.user_id,
          taskId: row.task_id,
          window,
          collectedKeys: new Set(keys),
        });
      }
      return posts;
    },
    async saveMetrics(row) {
      const { error } = await supabase.from('post_metrics').upsert(
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
          script_angle: row.scriptAngle,
        },
        { onConflict: 'post_id,provider,external_id,metrics_window' },
      );
      if (error) throw new Error(`metrics write failed: ${error.message}`);
    },
    async markDone(postId, window) {
      const { error } = await supabase
        .from('post_metrics_done')
        .upsert({ post_id: postId, metrics_window: window }, { onConflict: 'post_id,metrics_window' });
      if (error) throw new Error(`mark done failed: ${error.message}`);
    },
  };
}
