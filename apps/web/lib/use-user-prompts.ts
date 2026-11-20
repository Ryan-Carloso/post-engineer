import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import {
  createPrompt,
  deletePrompt,
  fetchPrompts,
  fetchReviewQueue,
  reviewPrompt,
  setPromptVisibility,
  updatePrompt,
  type PromptCall,
  type PromptChanges,
  type PromptDraft,
  type PromptReview,
} from '@/lib/user-prompts-client';

type Listing = Awaited<ReturnType<typeof fetchPrompts>>;
type Queue = Awaited<ReturnType<typeof fetchReviewQueue>>;

export const USER_PROMPTS_KEY = ['user-prompts'] as const;
export const PROMPT_REVIEW_QUEUE_KEY = ['prompt-review-queue'] as const;

export function useUserPromptsQuery(): UseQueryResult<Listing, Error> {
  return useQuery<Listing, Error>({ queryKey: USER_PROMPTS_KEY, queryFn: fetchPrompts, staleTime: 30_000 });
}

export function useReviewQueueQuery(): UseQueryResult<Queue, Error> {
  return useQuery<Queue, Error>({ queryKey: PROMPT_REVIEW_QUEUE_KEY, queryFn: fetchReviewQueue, staleTime: 0, retry: false });
}

function useInvalidatingMutation<Input, Body>(
  run: (input: Input) => Promise<PromptCall<Body>>,
  keys: ReadonlyArray<readonly string[]>,
): UseMutationResult<PromptCall<Body>, Error, Input> {
  const queryClient = useQueryClient();
  return useMutation<PromptCall<Body>, Error, Input>({
    mutationFn: run,
    onSuccess: async (result) => {
      if (!result.success) return;
      await Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
    },
  });
}

export const useCreatePromptMutation = () =>
  useInvalidatingMutation((draft: PromptDraft) => createPrompt(draft), [USER_PROMPTS_KEY]);

export const useUpdatePromptMutation = () =>
  useInvalidatingMutation(
    (input: { slug: string; changes: PromptChanges }) => updatePrompt(input.slug, input.changes),
    [USER_PROMPTS_KEY],
  );

export const useDeletePromptMutation = () =>
  useInvalidatingMutation((slug: string) => deletePrompt(slug), [USER_PROMPTS_KEY]);

export const useSetPromptVisibilityMutation = () =>
  useInvalidatingMutation(
    (input: { slug: string; visibility: 'public' | 'private' }) => setPromptVisibility(input.slug, input.visibility),
    [USER_PROMPTS_KEY],
  );

export const useReviewPromptMutation = () =>
  useInvalidatingMutation(
    (input: { id: string; review: PromptReview }) => reviewPrompt(input.id, input.review),
    [PROMPT_REVIEW_QUEUE_KEY],
  );
