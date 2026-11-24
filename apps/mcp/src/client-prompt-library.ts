import type { PostEngineerClient } from './client.js';
import { parseContractResponse } from './contract-response.js';
import {
  createUserPrompt as createUserPromptContract,
  deleteUserPrompt as deleteUserPromptContract,
  getPromptVersion as getPromptVersionContract,
  listPromptVersions as listPromptVersionsContract,
  restorePromptVersion as restorePromptVersionContract,
  updateUserPrompt as updateUserPromptContract,
} from './contracts/prompts.js';
import type { BodyOf, ResponseOf } from './contracts/endpoint.js';

export async function createUserPrompt(
  client: PostEngineerClient,
  prompt: BodyOf<typeof createUserPromptContract>,
): Promise<ResponseOf<typeof createUserPromptContract>> {
  const raw = await client.request(
    '/api/prompts',
    { method: 'POST', headers: client.getHeaders(), body: JSON.stringify(prompt) },
    'create prompt',
  );
  return parseContractResponse(createUserPromptContract, raw);
}

export async function updateUserPrompt(
  client: PostEngineerClient,
  slug: string,
  changes: BodyOf<typeof updateUserPromptContract>,
): Promise<ResponseOf<typeof updateUserPromptContract>> {
  const raw = await client.request(
    `/api/prompts/${encodeURIComponent(slug)}`,
    { method: 'PATCH', headers: client.getHeaders(), body: JSON.stringify(changes) },
    'update prompt',
  );
  return parseContractResponse(updateUserPromptContract, raw);
}

export async function deleteUserPrompt(
  client: PostEngineerClient,
  slug: string,
): Promise<ResponseOf<typeof deleteUserPromptContract>> {
  const raw = await client.request(
    `/api/prompts/${encodeURIComponent(slug)}`,
    { method: 'DELETE', headers: client.getHeaders() },
    'delete prompt',
  );
  return parseContractResponse(deleteUserPromptContract, raw);
}

export interface PromptVersionsRequest {
  version?: number;
  limit?: number;
  before?: number;
}

export async function listPromptVersions(
  client: PostEngineerClient,
  slug: string,
  options: PromptVersionsRequest,
): Promise<ResponseOf<typeof listPromptVersionsContract> | ResponseOf<typeof getPromptVersionContract>> {
  if (options.version !== undefined) {
    const raw = await client.request(
      `/api/prompts/${encodeURIComponent(slug)}/versions/${options.version}`,
      { method: 'GET', headers: client.getHeaders() },
      'get prompt version',
    );
    return parseContractResponse(getPromptVersionContract, raw);
  }
  const params = new URLSearchParams();
  if (options.limit !== undefined) params.set('limit', String(options.limit));
  if (options.before !== undefined) params.set('before', String(options.before));
  const search = params.size > 0 ? `?${params.toString()}` : '';
  const raw = await client.request(
    `/api/prompts/${encodeURIComponent(slug)}/versions${search}`,
    { method: 'GET', headers: client.getHeaders() },
    'list prompt versions',
  );
  return parseContractResponse(listPromptVersionsContract, raw);
}

export async function restorePromptVersion(
  client: PostEngineerClient,
  slug: string,
  version: number,
  expectedCurrentVersion: number,
): Promise<ResponseOf<typeof restorePromptVersionContract>> {
  const body: BodyOf<typeof restorePromptVersionContract> = { expectedCurrentVersion };
  const raw = await client.request(
    `/api/prompts/${encodeURIComponent(slug)}/versions/${version}/restore`,
    { method: 'POST', headers: client.getHeaders(), body: JSON.stringify(body) },
    'restore prompt version',
  );
  return parseContractResponse(restorePromptVersionContract, raw);
}
