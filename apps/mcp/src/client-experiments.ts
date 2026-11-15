import type { PostEngineerClient } from './client.js';
import { call } from './client-call.js';
import {
  createExperiment as createExperimentContract,
  getExperimentResults as getExperimentResultsContract,
  listExperiments as listExperimentsContract,
  type MetricsWindow,
} from './contracts/experiments.js';
import type { BodyOf, ResponseOf } from './contracts/endpoint.js';

//---------------
// /api/experiments — paired content A/B tests (issue #476). Standalone
// functions (not client methods) because client.ts is grandfathered over
// the 500-line cap and may not grow. Requests and responses are typed
// from the shared contract (shared/contracts/experiments.ts).
//---------------

export async function createExperiment(
  client: PostEngineerClient,
  input: BodyOf<typeof createExperimentContract>,
): Promise<ResponseOf<typeof createExperimentContract>> {
  return call(client, createExperimentContract, { body: input });
}

export async function listExperiments(
  client: PostEngineerClient,
): Promise<ResponseOf<typeof listExperimentsContract>> {
  return call(client, listExperimentsContract, {});
}

export async function getExperimentResults(
  client: PostEngineerClient,
  experimentId: string,
  window: MetricsWindow | undefined,
): Promise<ResponseOf<typeof getExperimentResultsContract>> {
  return call(client, getExperimentResultsContract, {
    params: { id: experimentId },
    ...(window === undefined ? {} : { query: { window } }),
  });
}
