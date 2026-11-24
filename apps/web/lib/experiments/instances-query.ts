import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';

import { ListExperimentsResponseSchema, type ExperimentProgress } from '@/lib/contracts/experiments';
import { notifyIfSessionExpired } from '@/lib/session-expiry';

export type ExperimentsFetchResult = { success: true; experiments: ExperimentProgress[] } | { success: false; error: string };

export async function fetchExperiments(): Promise<ExperimentsFetchResult> {
  try {
    const response = await fetch('/api/experiments/instances');
    notifyIfSessionExpired(response);
    if (!response.ok) return { success: false, error: `HTTP ${response.status}` };
    const body: unknown = await response.json().catch(() => null);
    const parsed = ListExperimentsResponseSchema.safeParse(body);
    return parsed.success ? parsed.data : { success: false, error: 'unexpected response' };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function useExperimentsQuery(): UseQueryResult<ExperimentsFetchResult, Error> {
  return useQuery<ExperimentsFetchResult, Error>({
    queryKey: ['experiments'],
    queryFn: () => fetchExperiments(),
    staleTime: 60_000,
  });
}

export function useCancelExperimentMutation(): UseMutationResult<boolean, Error, string> {
  const queryClient = useQueryClient();
  return useMutation<boolean, Error, string>({
    mutationFn: async (experimentId) => {
      const response = await fetch(`/api/experiments/instances?${new URLSearchParams({ id: experimentId }).toString()}`, { method: 'DELETE' });
      notifyIfSessionExpired(response);
      if (!response.ok) return false;
      const body: unknown = await response.json().catch(() => null);
      return typeof body === 'object' && body !== null && (body as { success?: unknown }).success === true;
    },
    onSuccess: (cancelled) => {
      if (cancelled) void queryClient.invalidateQueries({ queryKey: ['experiments'] });
    },
  });
}
