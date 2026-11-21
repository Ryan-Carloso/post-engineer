import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { PromptComparisonResponseSchema, type PromptComparisonResponse } from '@/lib/contracts/experiments';
import type { MetricsWindow } from '@/lib/contracts/metrics';
import { notifyIfSessionExpired } from '@/lib/session-expiry';

export type ComparisonFetchResult = PromptComparisonResponse | { success: false; error: string };

export async function fetchPromptComparison(window: MetricsWindow): Promise<ComparisonFetchResult> {
  try {
    const response = await fetch(`/api/experiments?${new URLSearchParams({ window }).toString()}`);
    notifyIfSessionExpired(response);
    if (!response.ok) return { success: false, error: `HTTP ${response.status}` };
    const body: unknown = await response.json().catch(() => null);
    const parsed = PromptComparisonResponseSchema.safeParse(body);
    return parsed.success ? parsed.data : { success: false, error: 'unexpected response' };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function usePromptComparisonQuery(window: MetricsWindow): UseQueryResult<ComparisonFetchResult, Error> {
  return useQuery<ComparisonFetchResult, Error>({
    queryKey: ['prompt-comparison', window],
    queryFn: () => fetchPromptComparison(window),
    staleTime: 60_000,
  });
}
