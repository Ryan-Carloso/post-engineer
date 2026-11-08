import type { PostEngineerClient } from './client.js';

//---------------
// /api/experiments — paired content A/B tests (issue #476). Standalone
// functions (not client methods) because client.ts is grandfathered over
// the 500-line cap and may not grow.
//---------------

export interface CreateExperimentInput {
  name: string;
  variable: 'hook';
  personaId: string | null;
  targetPairs: number;
  variants: Array<{ variantId: string; name: string; description: string }>;
}

export async function createExperiment(client: PostEngineerClient, input: CreateExperimentInput): Promise<unknown> {
  return client.request(
    '/api/experiments',
    { method: 'POST', headers: client.getHeaders(), body: JSON.stringify(input) },
    'create experiment',
  );
}

export async function listExperiments(client: PostEngineerClient): Promise<unknown> {
  return client.request('/api/experiments', { method: 'GET', headers: client.getHeaders() }, 'list experiments');
}

export async function getExperimentResults(
  client: PostEngineerClient,
  experimentId: string,
  window: string | undefined,
): Promise<unknown> {
  const query = window === undefined ? '' : `?${new URLSearchParams({ window }).toString()}`;
  return client.request(
    `/api/experiments/${encodeURIComponent(experimentId)}${query}`,
    { method: 'GET', headers: client.getHeaders() },
    'get experiment results',
  );
}
