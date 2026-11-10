import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import {
  isMetricsWindow,
  METRICS_WINDOWS,
  METRICS_WINDOW_LOOKBACK_HOURS,
  metricsWindowRange,
} from './metrics-query';
import type { DuePost, MetricsTarget, MetricsTargetsResult } from './post-metrics';

//---------------
// post-metrics-reopen — the late-target re-read (issue #525 item 4),
// extracted from post-metrics.ts so that file stays under the 500-line
// cap. Imported by post-metrics.ts; metricsTargets/targetKey arrive as
// parameters so the modules never import each other's values (a value
// import back would be a circular import).
//---------------

// How many published posts the re-open scan reads per run (newest first).
const REOPEN_SCAN_LIMIT = 200;
// Rows scale with published videos (a multi-video slot can repeat a
// provider), not with the 9 providers, so the worst case is unbounded
// per post. Hitting the cap aborts the re-open for the run (a truncated
// rows read could mistake a collected target for missing and snapshot
// it twice).
export const REOPEN_ROWS_LIMIT = 6000;

//---------------
// findReopenedPosts — the late-target re-read (issue #525 item 4). The
// due SQL never re-reads a post marked done, so a target that lands in
// publish_outcomes after the post was marked done — a retry, or a publish
// that only finished after the first collection — would miss its window
// silently. Re-check published posts while their windows are still open:
// a post is due again for a window when it has a measurable target with
// no collected snapshot row for that window (a YouTube snapshot without
// the Analytics scope is not collected — see the mirror below).
// Best-effort: any read failure logs
// and returns nothing, never failing the run. The (post, window) pairs
// the RPC already returned are excluded, so a post is never collected
// twice in one run.
//---------------
export async function findReopenedPosts(
  supabase: SupabaseClient,
  now: Date,
  seen: ReadonlySet<string>,
  budget: number,
  metricsTargets: (publishResults: unknown[]) => MetricsTargetsResult,
  targetKey: (target: Pick<MetricsTarget, 'provider' | 'externalId'>) => string,
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
    // The cap drops the oldest rows first (newest are kept). An old
    // collected target could read as missing and be snapshotted twice
    // (the upsert is idempotent, but the PostHog event would fire
    // twice). Skip the re-open this run.
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
    for (const provider of found.unknownProviders) {
      logger.warn('[post-metrics] unknown provider in re-opened publish outcomes', { postId: record.id, provider });
    }
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
