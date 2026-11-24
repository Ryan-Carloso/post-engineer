import type { PostEngineerClient } from './client.js';
import { parseContractResponse } from './contract-response.js';
import {
  cancelExperiment as cancelExperimentContract,
  createExperiment as createExperimentContract,
  getPromptComparison as getPromptComparisonContract,
  listExperiments as listExperimentsContract,
  type CreateExperimentBody,
} from './contracts/experiments.js';
import type { ResponseOf } from './contracts/endpoint.js';
import type { MetricsWindow } from './contracts/metrics.js';

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
  const raw = await client.request('/api/experiments', { method: 'POST', headers: client.getHeaders(), body: JSON.stringify(body) }, 'create experiment');
  return parseContractResponse(createExperimentContract, raw);
}

export async function listExperiments(
  client: PostEngineerClient,
): Promise<ResponseOf<typeof listExperimentsContract>> {
  const raw = await client.request('/api/experiments/instances', { method: 'GET', headers: client.getHeaders() }, 'list experiments');
  return parseContractResponse(listExperimentsContract, raw);
}

export async function cancelExperiment(
  client: PostEngineerClient,
  experimentId: string,
): Promise<ResponseOf<typeof cancelExperimentContract>> {
  const query = `?${new URLSearchParams({ id: experimentId }).toString()}`;
  const raw = await client.request(`/api/experiments/instances${query}`, { method: 'DELETE', headers: client.getHeaders() }, 'cancel experiment');
  return parseContractResponse(cancelExperimentContract, raw);
}
