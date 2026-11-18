import { ApiError } from './errors.js';
import type { PostEngineerClient } from './client.js';
import { parseContractResponse } from './contract-response.js';
import {
  getPrompt as getPromptContract,
  listPrompts as listPromptsContract,
} from './contracts/prompts.js';
import type { ResponseOf } from './contracts/endpoint.js';

export type PromptSummary = ResponseOf<typeof listPromptsContract>['prompts'][number];
export type PromptDetail = ResponseOf<typeof getPromptContract>['prompt'];

export class UnknownPromptSlugError extends Error {
  constructor(readonly slug: string, readonly validSlugs: string[]) {
    super(`unknown prompt slug ${JSON.stringify(slug)}. Valid slugs: ${validSlugs.join(', ')}.`);
    this.name = 'UnknownPromptSlugError';
  }
}

export async function listPrompts(client: PostEngineerClient): Promise<PromptSummary[]> {
  const raw = await client.request(
    '/api/prompts',
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
