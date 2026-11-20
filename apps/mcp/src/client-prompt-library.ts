import type { PostEngineerClient } from './client.js';
import { parseContractResponse } from './contract-response.js';
import {
  createUserPrompt as createUserPromptContract,
  deleteUserPrompt as deleteUserPromptContract,
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
