import { describe, expect, it, vi } from 'vitest';
import type { PostEngineerClient } from '../client.js';
import { call } from '../client-call.js';
import { createExperiment } from '../contracts/experiments.js';
import type { BodyOf, ResponseOf } from '../contracts/endpoint.js';

//---------------
// Type-level pins for the shared contracts: renaming a contract field
// makes this file fail typecheck (tsc -p tsconfig.spec.json). The
// The ts-expect-error pins below must stay errors; removing a pin or the
// contract field makes the file fail to typecheck, which is the point.
//---------------

type CreateBody = BodyOf<typeof createExperiment>;
type CreateResponse = ResponseOf<typeof createExperiment>;

describe('contracts typecheck', () => {
  it('pins BodyOf and ResponseOf field names', () => {
    const validBody: CreateBody = {
      name: 'Hook test',
      variable: 'hook',
      targetPairs: 6,
      variants: [
        { variantId: 'hook-calm', name: 'Calm', description: 'calm' },
        { variantId: 'hook-aggressive', name: 'Aggressive', description: 'direct' },
      ],
    };
    expect(validBody.name).toBe('Hook test');

    // @ts-expect-error -- strict body: `nome` is not a field of the create body
    const badBody: CreateBody = { nome: 'x', variable: 'hook', targetPairs: 6, variants: [] };
    expect(badBody).toBeDefined();

    const response = { success: true, experiment: { id: '1', name: 'Hook test', variable: 'hook', personaId: null as string | null, targetPairs: 6, variants: [] } } as CreateResponse;
    expect(response.experiment.name).toBe('Hook test');

    // @ts-expect-error -- response experiment field is `name`, not `nome`
    const badName = response.experiment.nome;
    expect(badName).toBeUndefined();

    const client = { request: vi.fn(), getHeaders: () => ({}) } as unknown as PostEngineerClient;
    if (false) {
      // @ts-expect-error -- strict body: `nome` is not accepted by call()
      void call(client, createExperiment, { body: { nome: 'x', variable: 'hook', targetPairs: 6, variants: [] } });
    }
    expect(vi.mocked(client.request)).not.toHaveBeenCalled();
  });
});
