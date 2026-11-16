import { describe, expect, it, vi } from 'vitest';
import type { PostEngineerClient } from '../client.js';
import { createExperiment, getExperimentResults, listExperiments } from '../client-experiments.js';
import {
  createExperiment as createExperimentContract,
  getExperimentResults as getExperimentResultsContract,
  listExperiments as listExperimentsContract,
} from '../contracts/experiments.js';

//---------------
// Experiments client against the shared contract: each literal request
// site issues exactly its contract's method + path, and the response is
// parsed by the contract (a malformed 200 is an error).
//---------------

const EXPERIMENT_ID = '7b0e6c1e-0000-4000-8000-000000000001';
const VARIANTS = [
  { variantId: 'hook-calm', name: 'Calm', description: 'calm' },
  { variantId: 'hook-aggressive', name: 'Aggressive', description: 'direct' },
];
const CREATE_BODY = { name: 'Hook test', variable: 'hook' as const, personaId: null, targetPairs: 6, variants: VARIANTS };
const DETAIL = {
  success: true,
  experiment: { id: EXPERIMENT_ID, name: 'Hook test', variable: 'hook', personaId: null, targetPairs: 6, createdAt: '2026-11-07T00:00:00Z', variants: VARIANTS },
  window: '28d',
  videos: [],
  results: { targetPairs: 6, pairsCreated: 0, pairsPublished: 0, providers: [] },
  truncated: false,
};

function mockClient(response: unknown) {
  const request = vi.fn(async (_path: string, _init: RequestInit, _action: string) => response);
  const client = { request, getHeaders: () => ({ Authorization: 'Bearer token' }) };
  return { client: client as unknown as PostEngineerClient, request };
}

/** The template path with every `:param` replaced by its value. */
function contractPath(template: string, params: Record<string, string>): string {
  return template
    .split('/')
    .map((segment) => (segment.startsWith(':') ? encodeURIComponent(params[segment.slice(1)] ?? '') : segment))
    .join('/');
}

describe('client-experiments', () => {
  it('createExperiment posts the body to the contract method + path and parses the response', async () => {
    const { client, request } = mockClient({ success: true, experiment: { id: EXPERIMENT_ID, ...CREATE_BODY } });
    const result = await createExperiment(client, CREATE_BODY);
    expect(request).toHaveBeenCalledTimes(1);
    const [path, init, action] = request.mock.calls[0] ?? [];
    expect(path).toBe(createExperimentContract.path);
    expect(init?.method).toBe(createExperimentContract.method);
    expect(init?.body).toBe(JSON.stringify(CREATE_BODY));
    expect(action).toBe('create experiment');
    expect(result.experiment.id).toBe(EXPERIMENT_ID);
  });

  it('listExperiments gets the contract method + path', async () => {
    const { client, request } = mockClient({ success: true, experiments: [], truncated: false });
    const result = await listExperiments(client);
    const [path, init] = request.mock.calls[0] ?? [];
    expect(path).toBe(listExperimentsContract.path);
    expect(init?.method).toBe(listExperimentsContract.method);
    expect(result.truncated).toBe(false);
  });

  it('getExperimentResults encodes the id into the contract path and appends the window', async () => {
    const { client, request } = mockClient(DETAIL);
    await getExperimentResults(client, 'a/b', '28d');
    const [path, init] = request.mock.calls[0] ?? [];
    expect(path).toBe(`${contractPath(getExperimentResultsContract.path, { id: 'a/b' })}?window=28d`);
    expect(path).toBe('/api/experiments/a%2Fb?window=28d');
    expect(init?.method).toBe(getExperimentResultsContract.method);
  });

  it('getExperimentResults sends no query string without a window', async () => {
    const { client, request } = mockClient(DETAIL);
    await getExperimentResults(client, EXPERIMENT_ID, undefined);
    expect(request.mock.calls[0]?.[0]).toBe(`/api/experiments/${EXPERIMENT_ID}`);
  });

  it('rejects a malformed 200 naming the contract endpoint and field', async () => {
    const { client } = mockClient({ success: true });
    await expect(createExperiment(client, CREATE_BODY)).rejects.toThrow(
      'Malformed response from POST /api/experiments at experiment.',
    );
  });

  it('surfaces a client.request failure unchanged', async () => {
    const failure = new Error('Failed to create experiment: 400 Invalid request.');
    const client = { request: vi.fn(async () => { throw failure; }), getHeaders: () => ({}) } as unknown as PostEngineerClient;
    await expect(createExperiment(client, CREATE_BODY)).rejects.toBe(failure);
  });
});
