import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { MetricsWindow } from '@/lib/contracts/metrics';
import { COMPARISON_ROW_LIMIT } from './comparison-limits';
import { comparePrompts, type AccountResult, type ComparedVideo, type PromptVersionFacts } from './prompt-comparison';

export interface ComparisonQuery {
  userId: string;
  window: MetricsWindow;
  personaIds: string[] | null;
}

interface ComparisonView {
  window: MetricsWindow;
  accounts: AccountResult[];
  truncated: boolean;
}

export type ComparisonOutcome = { ok: true; value: ComparisonView } | { ok: false; cause: unknown };

interface MetricsRow {
  provider: string;
  account_id: string;
  views: number | null;
  prompt_version_id: string | null;
}

function toVideo(row: MetricsRow): ComparedVideo | null {
  if (row.views === null) return null;
  return { provider: row.provider, accountId: row.account_id, views: row.views, promptVersionId: row.prompt_version_id };
}

function isSource(value: string): value is PromptVersionFacts['source'] {
  return value === 'official' || value === 'user';
}

export async function readPromptComparison(supabase: SupabaseClient, query: ComparisonQuery): Promise<ComparisonOutcome> {
  if (query.personaIds !== null && query.personaIds.length === 0) {
    return { ok: true, value: { window: query.window, accounts: [], truncated: false } };
  }
  let select = supabase
    .from('post_metrics')
    .select('provider, account_id, views, prompt_version_id')
    .eq('user_id', query.userId)
    .eq('metrics_window', query.window);
  if (query.personaIds !== null) select = select.in('persona_id', query.personaIds);
  const { data: rows, error } = await select
    .order('collected_at', { ascending: false })
    .order('id', { ascending: true })
    .limit(COMPARISON_ROW_LIMIT + 1);
  if (error !== null) return { ok: false, cause: error };
  const metricsRows: MetricsRow[] = rows ?? [];
  const truncated = metricsRows.length > COMPARISON_ROW_LIMIT;
  const videos = metricsRows
    .slice(0, COMPARISON_ROW_LIMIT)
    .map(toVideo)
    .filter((video): video is ComparedVideo => video !== null);
  const versionIds = [...new Set(videos.map((video) => video.promptVersionId).filter((id): id is string => id !== null))];
  let versions: PromptVersionFacts[] = [];
  if (versionIds.length > 0) {
    const { data, error: versionsError } = await supabase
      .from('prompt_versions')
      .select('id, slug, title, version, source')
      .in('id', versionIds);
    if (versionsError !== null) return { ok: false, cause: versionsError };
    versions = (data ?? []).flatMap((row: { id: string; slug: string; title: string; version: number; source: string }) =>
      isSource(row.source) ? [{ versionId: row.id, slug: row.slug, title: row.title, version: row.version, source: row.source }] : [],
    );
  }
  return { ok: true, value: { window: query.window, accounts: comparePrompts(videos, versions), truncated } };
}
