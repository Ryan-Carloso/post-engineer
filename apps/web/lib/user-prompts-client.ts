import type { z } from 'zod';
import {
  DeleteUserPromptResponseSchema,
  GetPromptResponseSchema,
  GetPromptVersionResponseSchema,
  ListPromptVersionsResponseSchema,
  ListPromptsResponseSchema,
  RestorePromptVersionResponseSchema,
  type PromptVisibility,
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
  visibility: PromptVisibility;
}

export type PromptChanges = Partial<Omit<PromptDraft, 'slug'>>;

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

export const fetchPromptVersions = (
  slug: string,
  options: { before?: number } = {},
): Promise<PromptCall<z.output<typeof ListPromptVersionsResponseSchema>>> =>
  call(
    `${promptPath(slug)}/versions${options.before === undefined ? '' : `?before=${options.before}`}`,
    ListPromptVersionsResponseSchema,
  );

export const fetchPromptVersion = (
  slug: string,
  version: number,
): Promise<PromptCall<z.output<typeof GetPromptVersionResponseSchema>>> =>
  call(`${promptPath(slug)}/versions/${version}`, GetPromptVersionResponseSchema);

export const restorePromptVersion = (
  slug: string,
  version: number,
  expectedCurrentVersion: number,
): Promise<PromptCall<z.output<typeof RestorePromptVersionResponseSchema>>> =>
  call(`${promptPath(slug)}/versions/${version}/restore`, RestorePromptVersionResponseSchema, {
    method: 'POST',
    body: { expectedCurrentVersion },
  });

export const createPrompt = (draft: PromptDraft): Promise<PromptCall<z.output<typeof GetPromptResponseSchema>>> =>
  call('/api/prompts', GetPromptResponseSchema, { method: 'POST', body: draft });

export const updatePrompt = (
  slug: string,
  changes: PromptChanges,
): Promise<PromptCall<z.output<typeof GetPromptResponseSchema>>> =>
  call(promptPath(slug), GetPromptResponseSchema, { method: 'PATCH', body: changes });

export const deletePrompt = (slug: string): Promise<PromptCall<z.output<typeof DeleteUserPromptResponseSchema>>> =>
  call(promptPath(slug), DeleteUserPromptResponseSchema, { method: 'DELETE' });

export function promptFailureKey(failure: PromptCallFailure): TranslationKey {
  switch (failure.code) {
    case 'PROMPT_SLUG_TAKEN':
      return 'userPrompts.errorSlugTaken';
    case 'VALIDATION_FAILED':
      return 'userPrompts.errorValidation';
    case 'PROMPT_VERSION_CONFLICT':
      return 'userPrompts.errorVersionConflict';
    case 'PROMPT_VERSION_NOT_FOUND':
      return 'userPrompts.errorVersionNotFound';
    default:
      break;
  }
  if (failure.status === 429) return 'userPrompts.errorRateLimited';
  if (failure.status === 403) return 'userPrompts.errorForbidden';
  return 'userPrompts.errorGeneric';
}
