import { ApiError } from './errors.js';
import type { PostEngineerClient } from './client.js';

//---------------
// Recipe prompts (GET /api/prompts and GET /api/prompts/[slug]) — HTTP
// calls plus response narrowing. The web hub is the single source of the
// recipes, so a recipe edit reaches every install without a package
// release. Standalone functions because client.ts is grandfathered over
// the 500-line cap and may not grow.
//---------------

export interface PromptSummary {
  slug: string;
  title: string;
  description: string;
}

export interface PromptDetail extends PromptSummary {
  prompt: string;
}

// Thrown by getPrompt on a 404: carries the valid slugs from the API body
// so the agent can recover without another call.
export class UnknownPromptSlugError extends Error {
  constructor(readonly slug: string, readonly validSlugs: string[]) {
    super(`unknown prompt slug ${JSON.stringify(slug)}. Valid slugs: ${validSlugs.join(', ')}.`);
    this.name = 'UnknownPromptSlugError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function narrowSummary(value: unknown): PromptSummary {
  if (
    !isRecord(value) ||
    typeof value.slug !== 'string' ||
    typeof value.title !== 'string' ||
    typeof value.description !== 'string'
  ) {
    throw new Error('Malformed prompts response from the API.');
  }
  return { slug: value.slug, title: value.title, description: value.description };
}

export async function listPrompts(client: PostEngineerClient): Promise<PromptSummary[]> {
  const payload = await client.request(
    '/api/prompts',
    { method: 'GET', headers: client.getHeaders() },
    'list prompts',
  );
  if (!isRecord(payload) || payload.success !== true || !Array.isArray(payload.prompts)) {
    throw new Error('Malformed prompts response from the API.');
  }
  return payload.prompts.map(narrowSummary);
}

export async function getPrompt(client: PostEngineerClient, slug: string): Promise<PromptDetail> {
  let payload: unknown;
  try {
    payload = await client.request(
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
  const prompt = isRecord(payload) && payload.success === true ? payload.prompt : undefined;
  if (!isRecord(prompt) || typeof prompt.prompt !== 'string') {
    throw new Error('Malformed prompt response from the API.');
  }
  return { ...narrowSummary(prompt), prompt: prompt.prompt };
}
