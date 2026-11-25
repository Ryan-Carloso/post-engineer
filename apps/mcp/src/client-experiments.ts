import type { PostEngineerClient } from './client.js';
import { parseContractResponse } from './contract-response.js';
import {
  createExperiment as createExperimentContract,
  getPromptComparison as getPromptComparisonContract,
  type CreateExperimentBody,
} from './contracts/experiments.js';
import type { ResponseOf } from './contracts/endpoint.js';
import type { MetricsWindow } from './contracts/metrics.js';

const CREATE_EXPERIMENT_TIMEOUT_MS = 300_000;

export async function getPromptComparison(
  client: PostEngineerClient,
  window: MetricsWindow | undefined,
): Promise<ResponseOf<typeof getPromptComparisonContract>> {
  const query = window === undefined ? '' : `?${new URLSearchParams({ window }).toString()}`;
  const raw = await client.request(`/api/experiments${query}`, { method: 'GET', headers: client.getHeaders() }, 'compare prompts');
  return parseContractResponse(getPromptComparisonContract, raw);
}

export async function createExperiment(
  client: PostEngineerClient,
  body: CreateExperimentBody,
): Promise<ResponseOf<typeof createExperimentContract>> {
  const raw = await client.request(
    '/api/experiments',
    { method: 'POST', headers: client.getHeaders(), body: JSON.stringify(body) },
    'create experiment',
    CREATE_EXPERIMENT_TIMEOUT_MS,
  );
  return parseContractResponse(createExperimentContract, raw);
}
