import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import type { SocialProvider } from '@/lib/providers/registry';
import { isMetricsWindow, METRICS_WINDOWS, METRICS_WINDOW_LOOKBACK_HOURS, metricsWindowRange, type AnalyticsStatus, type MetricsWindow } from './metrics-query';

//---------------
// post-metrics — per-video performance snapshots for A/B content tests.
//
// Hourly (in-app scheduler -> runPostMetricsTick in lib/scheduler-jobs.ts), every published slot is
// snapshotted three times: 24-48h after publish ('24h'), 168-192h after
// publish ('7d'), and 672-696h after publish ('28d', when YouTube
// Analytics numbers are final). A window that was missed (engine down, token
// expired for the whole 24h) is skipped, never back-filled with a late
// number that would not be comparable. The windows live in SQL
// (public.find_post_metrics_due, migrations 025 and 039).
//
// Every provider in SOCIAL_PROVIDERS is measured: TARGET_EXTRACTORS here
// and COUNTER_FETCHERS (provider-counters.ts) are exhaustive Records, so a
// new provider does not typecheck until it is measured too.
//
// Pure orchestration: the store and the provider fetchers are injected so
// tests never reach Supabase, the engine, or a social API.
//---------------

export type { MetricsWindow };
export type MeasuredProvider = SocialProvider;

// Bound the fan-out of one run: each post costs one engine read plus one
// provider call per published video. Which posts are due (the 24h/7d/28d
// windows) is decided in SQL: public.find_post_metrics_due (migration 039).
export const MAX_POSTS_PER_RUN = 50;
export const RUN_TIME_BUDGET_MS = 45_000;
// How many published posts the re-open scan reads per run (newest first).
const REOPEN_SCAN_LIMIT = 200;
// Rows scale with published videos (a multi-video slot can repeat a
// provider), not with the 9 providers, so the worst case is unbounded
// per post. Hitting the cap aborts the re-open for the run (a truncated
// rows read could mistake a collected target for missing and snapshot
// it twice).
export const REOPEN_ROWS_LIMIT = 6000;

export interface MetricsCounters {
  views: number | null;
  likes: number | null;
  comments: number | null;
  saves: number | null;
  // YouTube only: the Analytics API half of the snapshot (youtube-retention.ts).
  retention?: RetentionSnapshot;
}

export interface RetentionSnapshot {
  status: AnalyticsStatus;
  analyticsViews: number | null;
  engagedViews: number | null;
  averageViewDurationSeconds: number | null;
  averageViewPercentage: number | null;
  contentType: string | null;
  // YYYY-MM-DD range the Analytics numbers cover; null when not queried.
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

/** The snapshot's experiment link, filled by the post_metrics trigger (migration 041). */
export interface ExperimentTag {
  experimentId: string | null;
  variantId: string | null;
  experimentPair: number | null;
}

export interface PostMetricsDeps {
  listDuePosts: (now: Date, limit: number) => Promise<DuePost[]>;
  fetchTaskSource: (taskId: string, userId: string) => Promise<{ publishResults: unknown[]; scriptAngle: string | null }>;
  fetchCounters: (userId: string, target: MetricsTarget, context: CounterContext) => Promise<MetricsCounters>;
  saveMetrics: (row: MetricsRow) => Promise<ExperimentTag>;
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

// The 039 columns: null for every non-YouTube row (no retention snapshot).
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
  threads: (record) => readString(record, 'postId'),
  facebook: (record) => readString(record, 'postId'),
  pinterest: (record) => readString(record, 'postId'),
  // The 3Speak publish result stores the video id as postId, like the
  // other non-YouTube providers (see lib/threespeak.ts).
  '3speak': (record) => readString(record, 'postId'),
  rumble: (record) => readString(record, 'postId'),
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
    // A token without yt-analytics.readonly is not terminal: leave the
    // window open so the next hourly run retries with the new token after
    // the user reconnects. The Data API counters are already saved.
    let missingAnalyticsScope = false;
    for (const target of targets) {
      if (post.collectedKeys.has(targetKey(target))) continue;
      try {
        const counters = await deps.fetchCounters(post.userId, target, { window: post.window, now: deps.now() });
        if (counters.retention?.status === 'scope_missing') missingAnalyticsScope = true;
        const tag = await deps.saveMetrics({
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
          views: counters.views,
          likes: counters.likes,
          comments: counters.comments,
          saves: counters.saves,
          engaged_views: counters.retention?.engagedViews ?? null,
          analytics_status: counters.retention?.status ?? null,
          // Paired A/B split (issue #476): ids only, never variant names.
          experiment_id: tag.experimentId,
          variant_id: tag.variantId,
          experiment_pair: tag.experimentPair,
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
    // post for the window. A failed video and a missing Analytics scope keep
    // it open for the next run.
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

//---------------
// findReopenedPosts — the late-target re-read (issue #525 item 4). The
// due SQL never re-reads a post marked done, so a target that lands in
// publish_outcomes after the post was marked done — a retry, or a publish
// that only finished after the first collection — would miss its window
// silently. Re-check published posts while their windows are still open:
// a post is due again for a window when it has a measurable target with
// no snapshot row for that window. Best-effort: any read failure logs
// and returns nothing, never failing the run. The (post, window) pairs
// the RPC already returned are excluded, so a post is never collected
// twice in one run.
//---------------
async function findReopenedPosts(
  supabase: SupabaseClient,
  now: Date,
  seen: ReadonlySet<string>,
  budget: number,
): Promise<DuePost[]> {
  if (budget <= 0) return [];
  const cutoff = new Date(now.getTime() - METRICS_WINDOW_LOOKBACK_HOURS * 60 * 60 * 1000);
  const { data: postData, error: postError } = await supabase
    .from('scheduled_posts')
    .select('id, user_id, task_id, status, published_at, publish_outcomes')
    .eq('status', 'published')
    .gte('published_at', cutoff.toISOString())
    .order('published_at', { ascending: false })
    .order('id', { ascending: true })
    .limit(REOPEN_SCAN_LIMIT);
  if (postError) {
    logger.warn('[post-metrics] reopen scan failed', { error: postError.message });
    return [];
  }
  const records = Array.isArray(postData) ? postData : [];
  const postIds = records
    .map((record) => (typeof record.id === 'string' ? record.id : null))
    .filter((id): id is string => id !== null);
  if (postIds.length === 0) return [];

  const { data: rowData, error: rowError } = await supabase
    .from('post_metrics')
    .select('post_id, provider, external_id, metrics_window, analytics_status')
    .in('post_id', postIds)
    .order('collected_at', { ascending: false })
    .limit(REOPEN_ROWS_LIMIT);
  if (rowError) {
    logger.warn('[post-metrics] reopen rows lookup failed', { error: rowError.message });
    return [];
  }
  const rows = Array.isArray(rowData) ? rowData : [];
  if (rows.length >= REOPEN_ROWS_LIMIT) {
    // The cap drops the oldest rows first: a collected target could read
    // as missing and be snapshotted twice (the upsert is idempotent, but
    // the PostHog event would fire twice). Skip the re-open this run.
    logger.warn('[post-metrics] reopen rows read hit its cap; skipping the re-open this run');
    return [];
  }
  const collectedByPostWindow = new Map<string, Set<string>>();
  for (const record of rows) {
    if (
      typeof record.post_id !== 'string'
      || typeof record.provider !== 'string'
      || typeof record.external_id !== 'string'
      || !isMetricsWindow(record.metrics_window)
    ) {
      continue;
    }
    // Mirror the due SQL (migration 039): a YouTube snapshot without the
    // Analytics scope is not "collected" — the run retries it until the
    // token is reconnected or the window closes.
    if (
      record.provider === 'youtube'
      && (record.analytics_status === null || record.analytics_status === 'scope_missing')
    ) {
      continue;
    }
    const key = `${record.post_id}:${record.metrics_window}`;
    const keys = collectedByPostWindow.get(key) ?? new Set<string>();
    keys.add(`${record.provider}:${record.external_id}`);
    collectedByPostWindow.set(key, keys);
  }

  const reopened: DuePost[] = [];
  for (const record of records) {
    if (
      typeof record.id !== 'string'
      || typeof record.user_id !== 'string'
      || typeof record.task_id !== 'string'
      || typeof record.published_at !== 'string'
    ) {
      continue;
    }
    const published = Date.parse(record.published_at);
    if (Number.isNaN(published)) continue;
    const outcomes = Array.isArray(record.publish_outcomes) ? record.publish_outcomes : [];
    const found = metricsTargets(outcomes);
    if (found.targets.length === 0) continue;
    for (const window of METRICS_WINDOWS) {
      if (seen.has(`${record.id}:${window}`)) continue;
      const { opensAt, closesAt } = metricsWindowRange(window, new Date(published));
      if (now.getTime() < opensAt.getTime() || now.getTime() >= closesAt.getTime()) continue;
      const collectedKeys = collectedByPostWindow.get(`${record.id}:${window}`) ?? new Set<string>();
      if (!found.targets.some((target) => !collectedKeys.has(targetKey(target)))) continue;
      reopened.push({ id: record.id, userId: record.user_id, taskId: record.task_id, window, collectedKeys });
      if (reopened.length >= budget) return reopened;
    }
  }
  return reopened;
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
      const seen = new Set<string>();
      for (const row of (Array.isArray(data) ? data : []) as Array<Record<string, unknown>>) {
        const window = row.metrics_window;
        if (
          typeof row.post_id !== 'string'
          || typeof row.user_id !== 'string'
          || typeof row.task_id !== 'string'
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
          taskId: row.task_id,
          window,
          collectedKeys: new Set(keys),
        });
        seen.add(`${row.post_id}:${window}`);
      }
      const reopened = await findReopenedPosts(supabase, now, seen, Math.max(0, limit - posts.length));
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
          script_angle: row.scriptAngle,
          ...retentionColumns(row.retention),
        },
        { onConflict: 'post_id,provider,external_id,metrics_window' },
      )
        // The trigger fills the experiment link; reading it back here
        // saves a second query per snapshot.
        .select('experiment_id, variant_id, experiment_pair')
        .single();
      if (error) throw new Error(`metrics write failed: ${error.message}`);
      return { experimentId: data.experiment_id, variantId: data.variant_id, experimentPair: data.experiment_pair };
    },
    async markDone(postId, window) {
      const { error } = await supabase
        .from('post_metrics_done')
        .upsert({ post_id: postId, metrics_window: window }, { onConflict: 'post_id,metrics_window' });
      if (error) throw new Error(`mark done failed: ${error.message}`);
    },
  };
}
