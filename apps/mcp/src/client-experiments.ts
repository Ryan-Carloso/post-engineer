import type { PostEngineerClient } from './client.js';
import { parseContractResponse } from './contract-response.js';
import {
  createExperiment as createExperimentContract,
  getExperimentResults as getExperimentResultsContract,
  listExperiments as listExperimentsContract,
  type MetricsWindow,
} from './contracts/experiments.js';
import type { BodyOf, ResponseOf } from './contracts/endpoint.js';

export async function createExperiment(
  client: PostEngineerClient,
  input: BodyOf<typeof createExperimentContract>,
): Promise<ResponseOf<typeof createExperimentContract>> {
  const raw = await client.request(
    '/api/experiments',
    { method: 'POST', headers: client.getHeaders(), body: JSON.stringify(input) },
    'create experiment',
  );
  return parseContractResponse(createExperimentContract, raw);
}

export async function listExperiments(
  client: PostEngineerClient,
): Promise<ResponseOf<typeof listExperimentsContract>> {
  const raw = await client.request('/api/experiments', { method: 'GET', headers: client.getHeaders() }, 'list experiments');
  return parseContractResponse(listExperimentsContract, raw);
}

export async function getExperimentResults(
  client: PostEngineerClient,
  experimentId: string,
  window: MetricsWindow | undefined,
): Promise<ResponseOf<typeof getExperimentResultsContract>> {
  const query = window === undefined ? '' : `?${new URLSearchParams({ window }).toString()}`;
  const raw = await client.request(
    `/api/experiments/${encodeURIComponent(experimentId)}${query}`,
    { method: 'GET', headers: client.getHeaders() },
    'get experiment results',
  );
  return parseContractResponse(getExperimentResultsContract, raw);
}
