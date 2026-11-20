import { ApiError } from './errors.js';
import type { PostEngineerClient } from './client.js';
import { parseContractResponse } from './contract-response.js';
import {
  getPrompt as getPromptContract,
  listPrompts as listPromptsContract,
} from './contracts/prompts.js';
import type { ResponseOf } from './contracts/endpoint.js';
import type { PromptSource } from './contracts/prompts.js';

export type PromptSummary = ResponseOf<typeof listPromptsContract>['prompts'][number];
export type PromptDetail = ResponseOf<typeof getPromptContract>['prompt'];

export class UnknownPromptSlugError extends Error {
  constructor(readonly slug: string, readonly validSlugs: string[]) {
    super(`unknown prompt slug ${JSON.stringify(slug)}. Valid slugs: ${validSlugs.join(', ')}.`);
    this.name = 'UnknownPromptSlugError';
  }
}

export interface PromptListFilter {
  query?: string;
  source?: PromptSource;
}

export async function listPrompts(client: PostEngineerClient, filter: PromptListFilter = {}): Promise<PromptSummary[]> {
  const params = new URLSearchParams();
  if (filter.query !== undefined && filter.query.trim() !== '') params.set('q', filter.query.trim());
  if (filter.source !== undefined) params.set('source', filter.source);
  const search = params.size > 0 ? `?${params.toString()}` : '';
  const raw = await client.request(
    `/api/prompts${search}`,
    { method: 'GET', headers: client.getHeaders() },
    'list prompts',
  );
  return parseContractResponse(listPromptsContract, raw).prompts;
}

export async function getPrompt(client: PostEngineerClient, slug: string): Promise<PromptDetail> {
  let raw: unknown;
  try {
    raw = await client.request(
      `/api/prompts/${encodeURIComponent(slug)}`,
      { method: 'GET', headers: client.getHeaders() },
      'get prompt',
    );
  } catch (error) {
    if (error instanceof ApiError && error.code === 'PROMPT_NOT_FOUND') {
      throw new UnknownPromptSlugError(slug, (await listPrompts(client)).map((entry) => entry.slug));
    }
    throw error;
  }
  return parseContractResponse(getPromptContract, raw).prompt;
}
