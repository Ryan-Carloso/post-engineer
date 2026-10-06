import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from './logger';

//---------------
// schedule-progress-history — persistent per-post (progress, stage)
// observation log over public.scheduled_post_progress_history.
//
// Generation progress is read live from the engine task, so without this
// log a regression (e.g. 40% -> 0%) leaves no trace. GET
// /api/schedule/status records one row per post only when the observed
// (progress, stage) differs from the last recorded one — change-only, so a
// generation leaves ~10-15 rows instead of one per poll. Rows die with
// their post (ON DELETE CASCADE).
//---------------

export interface ProgressSample {
  postId: string;
  progress: number;
  stage: string | null;
}

interface HistoryRow {
  post_id: string;
  progress: number;
  stage: string | null;
}

interface HistoryInsert {
  post_id: string;
  user_id: string;
  progress: number;
  stage: string | null;
}

//---------------
// latestByPost — the history select returns newest-first; keep the first
// row seen per post_id. Malformed rows are skipped.
//---------------
function latestByPost(rows: HistoryRow[]): Map<string, HistoryRow> {
  const latest = new Map<string, HistoryRow>();
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue;
    if (typeof row.post_id !== 'string') continue;
    if (!latest.has(row.post_id)) latest.set(row.post_id, row);
  }
  return latest;
}

//---------------
// sampleChanged — a sample is only recorded when it differs from the last
// recorded one; only real transitions append rows.
//---------------
function sampleChanged(sample: ProgressSample, last: HistoryRow | undefined): boolean {
  if (!last) return true;
  return last.progress !== sample.progress || (last.stage ?? null) !== sample.stage;
}

//---------------
// recordProgressHistory — best-effort, never throws: a history write must
// not fail the status request it rides on. Malformed samples are skipped.
//---------------
export async function recordProgressHistory(
  supabase: SupabaseClient,
  userId: string,
  samples: ProgressSample[],
): Promise<void> {
  // Dedupe by post, keeping the last sample per post (callers pass list order).
  const byPost = new Map<string, ProgressSample>();
  for (const sample of samples) {
    if (typeof sample.postId !== 'string' || sample.postId.length === 0) continue;
    if (typeof sample.progress !== 'number' || !Number.isFinite(sample.progress)) continue;
    byPost.set(sample.postId, {
      postId: sample.postId,
      progress: sample.progress,
      stage: typeof sample.stage === 'string' ? sample.stage : null,
    });
  }
  if (byPost.size === 0) return;

  try {
    const { data, error } = await supabase
      .from('scheduled_post_progress_history')
      .select('post_id, progress, stage')
      .in('post_id', [...byPost.keys()])
      .order('recorded_at', { ascending: false });
    if (error) {
      logger.warn('[schedule-progress-history] latest lookup failed', { error });
      return;
    }
    const latest = latestByPost(Array.isArray(data) ? (data as HistoryRow[]) : []);
    const inserts: HistoryInsert[] = [];
    for (const sample of byPost.values()) {
      if (sampleChanged(sample, latest.get(sample.postId))) {
        inserts.push({
          post_id: sample.postId,
          user_id: userId,
          progress: sample.progress,
          stage: sample.stage,
        });
      }
    }
    if (inserts.length === 0) return;
    const { error: insertError } = await supabase
      .from('scheduled_post_progress_history')
      .insert(inserts);
    if (insertError) {
      logger.warn('[schedule-progress-history] insert failed', { error: insertError });
    }
  } catch (error) {
    logger.warn('[schedule-progress-history] recording failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
