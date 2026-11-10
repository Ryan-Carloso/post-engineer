//---------------
// Experiment reads for /api/experiments (issue #476). Service role bypasses
// RLS: every query filters by user_id explicitly, and a persona-scoped API
// key sees only experiments of its personas (or with no persona) — an
// out-of-scope experiment is a 404 like an unknown id.
//
// Reads are bounded: list LIST_LIMIT experiments, SLOT_LIMIT slots and
// METRIC_ROW_LIMIT metric rows per experiment, deterministic order, with
// `truncated` exposed when a cap was hit.
//---------------

import type { SupabaseClient } from '@supabase/supabase-js';

import { computeExperimentResults, type ExperimentMetricFact, type ExperimentResults } from './results';
import type { MetricsWindow } from '@/lib/metrics/metrics-query';
import { numericOrNull, UUID } from '@/lib/metrics/metrics-query';

export const LIST_LIMIT = 100;
export const SLOT_LIMIT = 100;
export const METRIC_ROW_LIMIT = 1000;

export interface ExperimentVariantView {
  variantId: string;
  name: string;
  description: string;
}

export interface ExperimentView {
  id: string;
  name: string;
  variable: string;
  personaId: string | null;
  targetPairs: number;
  createdAt: string;
  variants: ExperimentVariantView[];
}

export interface ExperimentVideoView {
  postId: string;
  variantId: string;
  pair: number;
  status: string;
  title: string | null;
  slotAt: string;
  publishedAt: string | null;
}

export type ReadResult<T> = { ok: true; value: T } | { ok: false; status: 404 | 500; cause?: unknown };

interface ExperimentRow {
  id: string;
  name: string;
  variable: string;
  persona_id: string | null;
  target_pairs: number;
  created_at: string;
}

function inScope(scope: readonly string[] | null, personaId: string | null): boolean {
  return scope === null || personaId === null || scope.includes(personaId);
}

async function variantsOf(
  supabase: SupabaseClient,
  ids: string[],
): Promise<Map<string, ExperimentVariantView[]> | { error: unknown }> {
  const byExperiment = new Map<string, ExperimentVariantView[]>();
  if (ids.length === 0) return byExperiment;
  const { data, error } = await supabase
    .from('experiment_variants')
    .select('experiment_id, variant_id, name, description, position')
    .in('experiment_id', ids)
    .order('position', { ascending: true });
  if (error) return { error };
  for (const row of data ?? []) {
    const list = byExperiment.get(row.experiment_id) ?? [];
    list.push({ variantId: row.variant_id, name: row.name, description: row.description });
    byExperiment.set(row.experiment_id, list);
  }
  return byExperiment;
}

function view(row: ExperimentRow, variants: ExperimentVariantView[]): ExperimentView {
  return {
    id: row.id,
    name: row.name,
    variable: row.variable,
    personaId: row.persona_id,
    targetPairs: row.target_pairs,
    createdAt: row.created_at,
    variants,
  };
}

export async function listExperiments(
  supabase: SupabaseClient,
  userId: string,
  scope: readonly string[] | null,
): Promise<ReadResult<{ experiments: ExperimentView[]; truncated: boolean }>> {
  let select = supabase
    .from('experiments')
    .select('id, name, variable, persona_id, target_pairs, created_at')
    .eq('user_id', userId);
  if (scope !== null) {
    // Same policy as GET /api/metrics: a scoped key sees its personas'
    // rows plus persona-less ones. Only UUIDs reach the filter string, so a
    // malformed stored id cannot corrupt the PostgREST syntax.
    const personaIds = scope.filter((id) => UUID.test(id));
    select = personaIds.length > 0
      ? select.or(`persona_id.in.(${personaIds.join(',')}),persona_id.is.null`)
      : select.is('persona_id', null);
  }
  const { data, error } = await select
    .order('created_at', { ascending: false })
    .order('id', { ascending: true })
    .limit(LIST_LIMIT + 1);
  if (error) return { ok: false, status: 500, cause: error };
  const page = (data ?? []).slice(0, LIST_LIMIT);
  const variants = await variantsOf(supabase, page.map((row) => row.id));
  if (!(variants instanceof Map)) return { ok: false, status: 500, cause: variants.error };
  return {
    ok: true,
    value: {
      experiments: page.map((row) => view(row, variants.get(row.id) ?? [])),
      truncated: (data ?? []).length > LIST_LIMIT,
    },
  };
}

export interface ExperimentDetail {
  experiment: ExperimentView;
  window: MetricsWindow;
  videos: ExperimentVideoView[];
  results: ExperimentResults;
  truncated: boolean;
}

//---------------
// ExperimentFacts — the raw rows behind a detail read: the snapshot
// metric facts per post/provider. loadExperimentResults computes the
// paired results from these; the live read (lib/experiments/live.ts)
// swaps snapshot facts for freshly fetched provider counters and
// recomputes from the same facts, so both paths share one loader.
//---------------
export interface ExperimentFacts {
  experiment: ExperimentView;
  window: MetricsWindow;
  videos: ExperimentVideoView[];
  metrics: ExperimentMetricFact[];
  truncated: boolean;
}

export async function loadExperimentFacts(
  supabase: SupabaseClient,
  input: { userId: string; experimentId: string; scope: readonly string[] | null; window: MetricsWindow },
): Promise<ReadResult<ExperimentFacts>> {
  const { userId, experimentId } = input;
  const { data: row, error } = await supabase
    .from('experiments')
    .select('id, name, variable, persona_id, target_pairs, created_at')
    .eq('id', experimentId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) return { ok: false, status: 500, cause: error };
  if (row === null || !inScope(input.scope, row.persona_id)) return { ok: false, status: 404 };

  const variants = await variantsOf(supabase, [row.id]);
  if (!(variants instanceof Map)) return { ok: false, status: 500, cause: variants.error };
  const variantViews = variants.get(row.id) ?? [];
  if (variantViews.length !== 2) return { ok: false, status: 500, cause: new Error('experiment has no two variants') };

  const { data: slots, error: slotsError } = await supabase
    .from('scheduled_posts')
    .select('id, variant_id, experiment_pair, status, title, slot_at, published_at')
    .eq('user_id', userId)
    .eq('experiment_id', experimentId)
    .order('experiment_pair', { ascending: true })
    .order('id', { ascending: true })
    .limit(SLOT_LIMIT + 1);
  if (slotsError) return { ok: false, status: 500, cause: slotsError };

  const { data: metrics, error: metricsError } = await supabase
    .from('post_metrics')
    .select('post_id, provider, views, likes, comments, average_view_duration_seconds')
    .eq('user_id', userId)
    .eq('experiment_id', experimentId)
    .eq('metrics_window', input.window)
    .order('collected_at', { ascending: false })
    .order('id', { ascending: true })
    .limit(METRIC_ROW_LIMIT + 1);
  if (metricsError) return { ok: false, status: 500, cause: metricsError };

  const videos: ExperimentVideoView[] = [];
  for (const slot of (slots ?? []).slice(0, SLOT_LIMIT)) {
    if (slot.variant_id === null || slot.experiment_pair === null) continue;
    videos.push({
      postId: slot.id,
      variantId: slot.variant_id,
      pair: slot.experiment_pair,
      status: slot.status,
      title: slot.title,
      slotAt: slot.slot_at,
      publishedAt: slot.published_at,
    });
  }
  const metricFacts = (metrics ?? []).slice(0, METRIC_ROW_LIMIT).map((metric) => ({
    postId: metric.post_id,
    provider: metric.provider,
    views: metric.views,
    likes: metric.likes,
    comments: metric.comments,
    // numeric columns come back from PostgREST as numbers or strings.
    averageViewDurationSeconds: numericOrNull(metric.average_view_duration_seconds),
  }));
  return {
    ok: true,
    value: {
      experiment: view(row, variantViews),
      window: input.window,
      videos,
      metrics: metricFacts,
      truncated: (slots ?? []).length > SLOT_LIMIT || (metrics ?? []).length > METRIC_ROW_LIMIT,
    },
  };
}

//---------------
// loadExperimentTaskIds — the engine task id per slot of an experiment.
// The live read needs it to fetch publish_results (the provider video
// ids); the snapshot read never does, so it stays a separate query
// instead of leaking task ids into the detail response.
//---------------
export async function loadExperimentTaskIds(
  supabase: SupabaseClient,
  input: { userId: string; experimentId: string },
): Promise<Map<string, string | null> | { error: unknown }> {
  const { data, error } = await supabase
    .from('scheduled_posts')
    .select('id, task_id')
    .eq('user_id', input.userId)
    .eq('experiment_id', input.experimentId)
    .order('id', { ascending: true })
    .limit(SLOT_LIMIT + 1);
  if (error) return { error };
  const taskIds = new Map<string, string | null>();
  for (const row of (data ?? []).slice(0, SLOT_LIMIT)) {
    taskIds.set(row.id, typeof row.task_id === 'string' && row.task_id !== '' ? row.task_id : null);
  }
  return taskIds;
}

export async function loadExperimentResults(
  supabase: SupabaseClient,
  input: { userId: string; experimentId: string; scope: readonly string[] | null; window: MetricsWindow },
): Promise<ReadResult<ExperimentDetail>> {
  const facts = await loadExperimentFacts(supabase, input);
  if (!facts.ok) return facts;
  const { experiment, window, videos, metrics, truncated } = facts.value;
  const [first, second] = experiment.variants;
  return {
    ok: true,
    value: {
      experiment,
      window,
      videos,
      results: computeExperimentResults({
        variantIds: [first.variantId, second.variantId],
        targetPairs: experiment.targetPairs,
        slots: videos.map((video) => ({ postId: video.postId, variantId: video.variantId, pair: video.pair, status: video.status })),
        metrics,
      }),
      truncated,
    },
  };
}
