import type { PostEngineerClient } from './client.js';
import { parseContractResponse } from './contract-response.js';
import { getPromptComparison as getPromptComparisonContract } from './contracts/experiments.js';
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
