import { ApiError } from './errors.js';
import type { PostEngineerClient } from './client.js';
import { parseContractResponse } from './contract-response.js';
import {
  getPrompt as getPromptContract,
  listPrompts as listPromptsContract,
} from './contracts/prompts.js';
import type { ResponseOf } from './contracts/endpoint.js';

//---------------
// Recipe prompts (GET /api/prompts and GET /api/prompts/[slug]) — HTTP
// calls plus response parsing against the shared contract
// (shared/contracts/prompts.ts). The web hub is the single source of the
// recipes, so a recipe edit reaches every install without a package
// release. Standalone functions because client.ts is grandfathered over
// the 500-line cap and may not grow. The request sites stay literal for
// the parity gate.
//---------------

export type PromptSummary = ResponseOf<typeof listPromptsContract>['prompts'][number];
export type PromptDetail = ResponseOf<typeof getPromptContract>['prompt'];

// Thrown by getPrompt on a 404: fetches the valid slugs with a follow-up
// listPrompts request so the agent can recover.
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
