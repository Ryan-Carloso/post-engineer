import type { PostEngineerClient } from './client.js';
import { parseContractResponse } from './contract-response.js';
import {
  createUserPrompt as createUserPromptContract,
  deleteUserPrompt as deleteUserPromptContract,
  listPromptReviewQueue as listPromptReviewQueueContract,
  reviewPrompt as reviewPromptContract,
  setPromptVisibility as setPromptVisibilityContract,
  updateUserPrompt as updateUserPromptContract,
} from './contracts/prompts.js';
import type { BodyOf, ResponseOf } from './contracts/endpoint.js';

function promptPath(slug: string): string {
  return `/api/prompts/${encodeURIComponent(slug)}`;
}

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
    promptPath(slug),
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
    promptPath(slug),
    { method: 'DELETE', headers: client.getHeaders() },
    'delete prompt',
  );
  return parseContractResponse(deleteUserPromptContract, raw);
}

export async function setPromptVisibility(
  client: PostEngineerClient,
  slug: string,
  visibility: BodyOf<typeof setPromptVisibilityContract>['visibility'],
): Promise<ResponseOf<typeof setPromptVisibilityContract>> {
  const raw = await client.request(
    `${promptPath(slug)}/visibility`,
    { method: 'POST', headers: client.getHeaders(), body: JSON.stringify({ visibility }) },
    'set prompt visibility',
  );
  return parseContractResponse(setPromptVisibilityContract, raw);
}

export async function listPromptReviewQueue(
  client: PostEngineerClient,
): Promise<ResponseOf<typeof listPromptReviewQueueContract>> {
  const raw = await client.request(
    '/api/admin/prompts',
    { method: 'GET', headers: client.getHeaders() },
    'list prompts waiting for review',
  );
  return parseContractResponse(listPromptReviewQueueContract, raw);
}

export async function reviewPrompt(
  client: PostEngineerClient,
  id: string,
  decision: BodyOf<typeof reviewPromptContract>,
): Promise<ResponseOf<typeof reviewPromptContract>> {
  const raw = await client.request(
    `/api/admin/prompts/${encodeURIComponent(id)}/review`,
    { method: 'POST', headers: client.getHeaders(), body: JSON.stringify(decision) },
    'review prompt',
  );
  return parseContractResponse(reviewPromptContract, raw);
}
