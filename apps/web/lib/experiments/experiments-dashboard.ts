import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { notifyIfSessionExpired } from '@/lib/session-expiry';
import type { ExperimentResultLabel } from './results';

//---------------
// experiments-dashboard — client-side data for the /experiments page:
// the React Query hooks over GET /api/experiments and
// GET /api/experiments/[id]?live=1. Same never-throw contract as the
// metrics dashboard: a bad status or an unexpected body is
// { success: false, error }, never a thrown fetch.
//---------------

export type ExperimentsWindow = '24h' | '7d';

export interface ExperimentVariantView {
  variantId: string;
  name: string;
  description: string;
}

export interface ExperimentListItem {
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

export interface ExperimentPairComparison {
  pair: number;
  values: Record<string, { views: number | null; likes: number | null; comments: number | null; averageViewDurationSeconds: number | null }>;
  winner: string | null;
}

export interface ExperimentProviderResult {
  provider: string;
  comparisons: ExperimentPairComparison[];
  wins: Record<string, number>;
  ties: number;
  pValue: number | null;
  leader: string | null;
  label: ExperimentResultLabel;
}

export interface ExperimentDetailResult {
  success: true;
  experiment: ExperimentListItem;
  window: ExperimentsWindow;
  videos: ExperimentVideoView[];
  results: {
    targetPairs: number;
    pairsCreated: number;
    pairsPublished: number;
    providers: ExperimentProviderResult[];
  };
  truncated: boolean;
  source: 'live' | 'partial' | 'snapshot';
  liveAt: string | null;
  liveFailures: Array<{ postId: string; provider: string }>;
  frozen: boolean;
}

export type ExperimentsFetchResult =
  | { success: true; experiments: ExperimentListItem[]; truncated: boolean }
  | { success: false; error: string };

export type ExperimentDetailFetchResult =
  | ExperimentDetailResult
  | { success: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isVariant(value: unknown): value is ExperimentVariantView {
  return (
    isRecord(value)
    && typeof value.variantId === 'string'
    && typeof value.name === 'string'
    && typeof value.description === 'string'
  );
}

function isExperiment(value: unknown): value is ExperimentListItem {
  return (
    isRecord(value)
    && typeof value.id === 'string'
    && typeof value.name === 'string'
    && typeof value.variable === 'string'
    && (typeof value.personaId === 'string' || value.personaId === null)
    && typeof value.targetPairs === 'number'
    && typeof value.createdAt === 'string'
    && Array.isArray(value.variants)
    && value.variants.every(isVariant)
  );
}

function isLabel(value: unknown): value is ExperimentResultLabel {
  return value === 'pending' || value === 'indicative' || value === 'clear';
}

function isDetailResponse(value: unknown): value is ExperimentDetailResult {
  if (!isRecord(value) || value.success !== true || !isExperiment(value.experiment)) return false;
  if (value.window !== '24h' && value.window !== '7d') return false;
  if (!Array.isArray(value.videos) || typeof value.truncated !== 'boolean') return false;
  if (value.source !== 'live' && value.source !== 'partial' && value.source !== 'snapshot') return false;
  if (value.liveAt !== null && typeof value.liveAt !== 'string') return false;
  if (typeof value.frozen !== 'boolean' || !Array.isArray(value.liveFailures)) return false;
  const results = value.results;
  if (
    !isRecord(results)
    || typeof results.targetPairs !== 'number'
    || typeof results.pairsCreated !== 'number'
    || typeof results.pairsPublished !== 'number'
    || !Array.isArray(results.providers)
  ) {
    return false;
  }
  return results.providers.every(
    (provider) =>
      isRecord(provider)
      && typeof provider.provider === 'string'
      && Array.isArray(provider.comparisons)
      && isRecord(provider.wins)
      && typeof provider.ties === 'number'
      && (typeof provider.pValue === 'number' || provider.pValue === null)
      && (typeof provider.leader === 'string' || provider.leader === null)
      && isLabel(provider.label),
  );
}

async function fetchJson(path: string): Promise<unknown> {
  const response = await fetch(path);
  notifyIfSessionExpired(response);
  return response.json().catch(() => null);
}

export async function fetchExperiments(): Promise<ExperimentsFetchResult> {
  try {
    const body = await fetchJson('/api/experiments');
    if (!isRecord(body) || body.success !== true || !Array.isArray(body.experiments) || typeof body.truncated !== 'boolean') {
      return { success: false, error: 'unexpected response' };
    }
    if (!body.experiments.every(isExperiment)) return { success: false, error: 'unexpected response' };
    return { success: true, experiments: body.experiments, truncated: body.truncated };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function fetchExperimentDetail(id: string, window: ExperimentsWindow): Promise<ExperimentDetailFetchResult> {
  try {
    const params = new URLSearchParams({ window, live: '1' });
    const body = await fetchJson(`/api/experiments/${encodeURIComponent(id)}?${params.toString()}`);
    if (!isDetailResponse(body)) return { success: false, error: 'unexpected response' };
    return body;
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function useExperimentsQuery(): UseQueryResult<ExperimentsFetchResult, Error> {
  return useQuery<ExperimentsFetchResult, Error>({
    queryKey: ['experiments'],
    queryFn: fetchExperiments,
    staleTime: 60_000,
  });
}

export function useExperimentDetailQuery(
  id: string | null,
  window: ExperimentsWindow,
): UseQueryResult<ExperimentDetailFetchResult, Error> {
  return useQuery<ExperimentDetailFetchResult, Error>({
    queryKey: ['experiments', id, window, 'live'],
    queryFn: () => fetchExperimentDetail(id as string, window),
    enabled: id !== null,
    staleTime: 30_000,
    // Live while any video is still inside its window: poll once a
    // minute, even after a failed read (the server cache expires after
    // 5 minutes, so a retry can pick up a recovered provider). Frozen
    // results never poll.
    refetchInterval: (query) => {
      const data = query.state.data;
      return data !== undefined && data.success && !data.frozen ? 60_000 : false;
    },
  });
}
