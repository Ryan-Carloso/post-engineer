import { describe, expect, it, vi } from 'vitest';
import type { PostEngineerClient } from '../client.js';
import { call } from '../client-call.js';
import {
  createExperiment,
  getExperimentResults,
  listExperiments,
} from '../contracts/experiments.js';

//---------------
// Typed contract calls: path building, query building, headers,
// delegation to client.request and response parsing (a malformed 200
// is an error, never a silent success).
//---------------

const EXPERIMENT_ID = '7b0e6c1e-0000-4000-8000-000000000001';
const VARIANTS = [
  { variantId: 'hook-calm', name: 'Calm', description: 'calm' },
  { variantId: 'hook-aggressive', name: 'Aggressive', description: 'direct' },
];
const CREATE_BODY = { name: 'Hook test', variable: 'hook' as const, personaId: null as string | null, targetPairs: 6, variants: VARIANTS };

function mockClient(response: unknown) {
  const client = {
    request: vi.fn(async () => response),
    getHeaders: () => ({ Authorization: 'Bearer token', 'Content-Type': 'application/json' }),
  };
  return client as unknown as PostEngineerClient & typeof client;
}

describe('call', () => {
  it('posts the body to the contract path and parses the response', async () => {
    const client = mockClient({ success: true, experiment: { id: EXPERIMENT_ID, name: 'Hook test', variable: 'hook', personaId: null, targetPairs: 6, variants: VARIANTS } });
    const result = await call(client, createExperiment, { body: CREATE_BODY });
    expect(client.request).toHaveBeenCalledWith(
      '/api/experiments',
      expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer token' }), body: JSON.stringify(CREATE_BODY) }),
      'create experiment',
    );
    expect(result.experiment.name).toBe('Hook test');
  });

  it('gets the list without a query string', async () => {
    const client = mockClient({ success: true, experiments: [], truncated: false });
    const result = await call(client, listExperiments, {});
    expect(client.request).toHaveBeenCalledWith(
      '/api/experiments',
      expect.objectContaining({ method: 'GET' }),
      'list experiments',
    );
    expect(result.truncated).toBe(false);
  });

  it('encodes the id param and appends the window query', async () => {
    const detail = { success: true, experiment: { id: EXPERIMENT_ID, name: 'Hook test', variable: 'hook', personaId: null, targetPairs: 6, createdAt: '2026-11-07T00:00:00Z', variants: VARIANTS }, window: '28d', videos: [], results: { targetPairs: 6, pairsCreated: 0, pairsPublished: 0, providers: [] }, truncated: false };
    const client = mockClient(detail);
    await call(client, getExperimentResults, { params: { id: EXPERIMENT_ID }, query: { window: '28d' } });
    expect(client.request).toHaveBeenCalledWith(
      `/api/experiments/${EXPERIMENT_ID}?window=28d`,
      expect.objectContaining({ method: 'GET' }),
      'get experiment results',
    );
  });

  it('omits the query string when no window is given and encodes special ids', async () => {
    const detail = { success: true, experiment: { id: 'a/b', name: 'Hook test', variable: 'hook', personaId: null, targetPairs: 6, createdAt: '2026-11-07T00:00:00Z', variants: VARIANTS }, window: '7d', videos: [], results: { targetPairs: 6, pairsCreated: 0, pairsPublished: 0, providers: [] }, truncated: false };
    const client = mockClient(detail);
    await call(client, getExperimentResults, { params: { id: 'a/b' } });
    expect((client.request.mock.calls as unknown as Array<[string, unknown]>)[0]?.[0]).toBe('/api/experiments/a%2Fb');
  });

  it('throws when the id param is missing', async () => {
    const client = mockClient({});
    await expect(
      call(client, getExperimentResults, { params: {} as never } as never),
    ).rejects.toThrow('Missing path param "id"');
  });

  it('rejects a malformed 200 instead of returning it', async () => {
    const client = mockClient({ success: true });
    await expect(call(client, createExperiment, { body: CREATE_BODY })).rejects.toThrow();
  });

  it('surfaces a client.request failure unchanged', async () => {
    const failure = new Error('Failed to create experiment: 400 Invalid request.');
    const client = { request: vi.fn(async () => { throw failure; }), getHeaders: () => ({}) } as unknown as PostEngineerClient;
    await expect(call(client, createExperiment, { body: CREATE_BODY })).rejects.toBe(failure);
  });
});
