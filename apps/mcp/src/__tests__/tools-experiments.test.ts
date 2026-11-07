import { describe, expect, it, vi } from 'vitest';
import type { PostEngineerClient } from '../client.js';
import {
  CreateExperimentSchema,
  handleCreateExperiment,
  handleGetExperimentResults,
  handleListExperiments,
} from '../tools-experiments.js';

//---------------
// Paired A/B experiment tools (issue #476). The client is mocked at its
// boundary: request() for the /api/experiments routes.
//---------------

const EXPERIMENT_ID = '7b0e6c1e-0000-4000-8000-000000000001';

function mockClient(overrides: Partial<Record<'request', ReturnType<typeof vi.fn>>> = {}) {
  const client = {
    request: overrides.request ?? vi.fn(async () => ({ success: true })),
    getHeaders: () => ({ Authorization: 'Bearer k' }),
  };
  return client as unknown as PostEngineerClient & typeof client;
}

describe('create / list / results tools', () => {
  it('create_experiment posts the hook variable, null persona when omitted and both variants', async () => {
    const client = mockClient();
    const args = CreateExperimentSchema.parse({
      name: 'Hook test',
      variants: [
        { variantId: 'hook-calm', name: 'Calm', description: 'calm' },
        { variantId: 'hook-aggressive', name: 'Aggressive', description: 'direct' },
      ],
    });
    expect(args.targetPairs).toBe(6);
    await handleCreateExperiment(client, args);
    const [path, init] = client.request.mock.calls[0];
    expect(path).toBe('/api/experiments');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ name: 'Hook test', variable: 'hook', personaId: null, targetPairs: 6, variants: args.variants });
    expect(() => CreateExperimentSchema.parse({ ...args, variants: [{ variantId: 'A', name: 'a', description: 'a' }, args.variants[1]] })).toThrow();
  });

  it('list_experiments and get_experiment_results call their routes', async () => {
    const client = mockClient();
    await handleListExperiments(client);
    await handleGetExperimentResults(client, { experimentId: EXPERIMENT_ID, window: '28d' });
    await handleGetExperimentResults(client, { experimentId: EXPERIMENT_ID });
    expect(client.request.mock.calls.map((call) => [call[0], call[1].method])).toEqual([
      ['/api/experiments', 'GET'],
      [`/api/experiments/${EXPERIMENT_ID}?window=28d`, 'GET'],
      [`/api/experiments/${EXPERIMENT_ID}`, 'GET'],
    ]);
  });

  it('surfaces a route error as a tool error', async () => {
    const client = mockClient({ request: vi.fn(async () => { throw new Error('Experiment not found.'); }) });
    const response = await handleGetExperimentResults(client, { experimentId: EXPERIMENT_ID });
    expect(response.isError).toBe(true);
    expect(response.content[0]).toMatchObject({ text: expect.stringContaining('Experiment not found.') });
  });
});
