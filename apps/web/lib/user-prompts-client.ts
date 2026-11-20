import type { z } from 'zod';
import {
  DeleteUserPromptResponseSchema,
  GetPromptResponseSchema,
  ListPromptReviewQueueResponseSchema,
  ListPromptsResponseSchema,
  ReviewPromptResponseSchema,
  type PromptVisibilitySchema,
} from '@/lib/contracts/prompts';
import type { TranslationKey } from '@/lib/i18n';
import { notifyIfSessionExpired } from '@/lib/session-expiry';

export interface PromptCallFailure {
  success: false;
  status: number;
  code: string | null;
}

export type PromptCall<Body> = { success: true; body: Body } | PromptCallFailure;

export interface PromptDraft {
  slug: string;
  title: string;
  description: string;
  prompt: string;
}

export type PromptChanges = Partial<Omit<PromptDraft, 'slug'>>;

export type PromptReview =
  | { decision: 'approve'; contentHash: string }
  | { decision: 'reject'; contentHash: string; reason: string };

const NETWORK_FAILURE: PromptCallFailure = { success: false, status: 0, code: null };

function codeOf(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('code' in body)) return null;
  return typeof body.code === 'string' ? body.code : null;
}

async function call<Schema extends z.ZodType>(
  path: string,
  schema: Schema,
  init?: { method: string; body?: unknown },
): Promise<PromptCall<z.output<Schema>>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: init?.method ?? 'GET',
      headers: init?.body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    return NETWORK_FAILURE;
  }
  notifyIfSessionExpired(response);
  const parsed: unknown = await response.json().catch(() => null);
  if (!response.ok) return { success: false, status: response.status, code: codeOf(parsed) };
  const checked = schema.safeParse(parsed);
  if (!checked.success) return { success: false, status: response.status, code: null };
  return { success: true, body: checked.data };
}

const promptPath = (slug: string): string => `/api/prompts/${encodeURIComponent(slug)}`;

export const fetchPrompts = (): Promise<PromptCall<z.output<typeof ListPromptsResponseSchema>>> =>
  call('/api/prompts', ListPromptsResponseSchema);

export const fetchPrompt = (slug: string): Promise<PromptCall<z.output<typeof GetPromptResponseSchema>>> =>
  call(promptPath(slug), GetPromptResponseSchema);

export const createPrompt = (draft: PromptDraft): Promise<PromptCall<z.output<typeof GetPromptResponseSchema>>> =>
  call('/api/prompts', GetPromptResponseSchema, { method: 'POST', body: draft });

export const updatePrompt = (
  slug: string,
  changes: PromptChanges,
): Promise<PromptCall<z.output<typeof GetPromptResponseSchema>>> =>
  call(promptPath(slug), GetPromptResponseSchema, { method: 'PATCH', body: changes });

export const deletePrompt = (slug: string): Promise<PromptCall<z.output<typeof DeleteUserPromptResponseSchema>>> =>
  call(promptPath(slug), DeleteUserPromptResponseSchema, { method: 'DELETE' });

export const setPromptVisibility = (
  slug: string,
  visibility: z.output<typeof PromptVisibilitySchema>,
): Promise<PromptCall<z.output<typeof GetPromptResponseSchema>>> =>
  call(`${promptPath(slug)}/visibility`, GetPromptResponseSchema, { method: 'POST', body: { visibility } });

export const fetchReviewQueue = (): Promise<PromptCall<z.output<typeof ListPromptReviewQueueResponseSchema>>> =>
  call('/api/admin/prompts', ListPromptReviewQueueResponseSchema);

export const reviewPrompt = (
  id: string,
  review: PromptReview,
): Promise<PromptCall<z.output<typeof ReviewPromptResponseSchema>>> =>
  call(`/api/admin/prompts/${encodeURIComponent(id)}/review`, ReviewPromptResponseSchema, { method: 'POST', body: review });

export function promptFailureKey(failure: PromptCallFailure): TranslationKey {
  switch (failure.code) {
    case 'PROMPT_SLUG_TAKEN':
      return 'userPrompts.errorSlugTaken';
    case 'PROMPT_SLUG_RESERVED':
      return 'userPrompts.errorSlugReserved';
    case 'PROMPT_STATE_CONFLICT':
      return 'userPrompts.errorStateConflict';
    case 'VALIDATION_FAILED':
      return 'userPrompts.errorValidation';
    default:
      break;
  }
  if (failure.status === 429) return 'userPrompts.errorRateLimited';
  if (failure.status === 403) return 'userPrompts.errorForbidden';
  return 'userPrompts.errorGeneric';
}
