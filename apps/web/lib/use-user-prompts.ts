import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import {
  createPrompt,
  deletePrompt,
  fetchPromptVersion,
  fetchPrompts,
  restorePromptVersion,
  updatePrompt,
  type PromptCall,
  type PromptCallFailure,
  type PromptChanges,
  type PromptDraft,
} from '@/lib/user-prompts-client';

type Listing = Awaited<ReturnType<typeof fetchPrompts>>;

export const USER_PROMPTS_KEY = ['user-prompts'] as const;

export const userPromptDetailKey = (slug: string) => [...USER_PROMPTS_KEY, 'detail', slug] as const;

export const userPromptVersionsKey = (slug: string) => [...USER_PROMPTS_KEY, 'versions', slug] as const;

export const userPromptVersionKey = (slug: string, version: number) => [...userPromptVersionsKey(slug), version] as const;

export class PromptVersionReadError extends Error {
  constructor(readonly failure: PromptCallFailure) {
    super(`Reading a prompt version failed (status ${failure.status})`);
    this.name = 'PromptVersionReadError';
  }
}

export const promptVersionQueryOptions = (slug: string, version: number) => ({
  queryKey: userPromptVersionKey(slug, version),
  queryFn: async () => {
    const result = await fetchPromptVersion(slug, version);
    if (!result.success) throw new PromptVersionReadError(result);
    return result.body;
  },
  retry: false,
  staleTime: 60_000,
});

export function useUserPromptsQuery(): UseQueryResult<Listing, Error> {
  return useQuery<Listing, Error>({ queryKey: USER_PROMPTS_KEY, queryFn: fetchPrompts, staleTime: 30_000 });
}

function useInvalidatingMutation<Input, Body>(
  run: (input: Input) => Promise<PromptCall<Body>>,
): UseMutationResult<PromptCall<Body>, Error, Input> {
  const queryClient = useQueryClient();
  return useMutation<PromptCall<Body>, Error, Input>({
    mutationFn: run,
    onSuccess: async (result) => {
      if (!result.success) return;
      await queryClient.invalidateQueries({ queryKey: USER_PROMPTS_KEY });
    },
  });
}

export const useCreatePromptMutation = () => useInvalidatingMutation((draft: PromptDraft) => createPrompt(draft));

export const useUpdatePromptMutation = () =>
  useInvalidatingMutation((input: { slug: string; changes: PromptChanges }) => updatePrompt(input.slug, input.changes));

export const useDeletePromptMutation = () => useInvalidatingMutation((slug: string) => deletePrompt(slug));

export const useRestorePromptVersionMutation = () =>
  useInvalidatingMutation((input: { slug: string; version: number; expectedCurrentVersion: number }) =>
    restorePromptVersion(input.slug, input.version, input.expectedCurrentVersion),
  );
