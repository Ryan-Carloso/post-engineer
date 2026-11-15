import { describe, expect, it, vi } from 'vitest';
import type { PostEngineerClient } from '../client.js';
import { createExperiment } from '../client-experiments.js';

//---------------
// Type-level pins for the shared contracts, checked by
// `tsc -p tsconfig.spec.json` (part of the MCP typecheck): each
// ts-expect-error below must stay an error. If the contract stops
// rejecting `nome`, the directive is unused and typecheck fails.
//---------------

type CreateResult = Awaited<ReturnType<typeof createExperiment>>;

describe('contracts typecheck', () => {
  it('rejects an unknown body field and an unknown response field at compile time', () => {
    const client = { request: vi.fn(), getHeaders: () => ({}) } as unknown as PostEngineerClient;
    const run = (): void => {
      // @ts-expect-error -- the create body field is `name`, not `nome`
      void createExperiment(client, { nome: 'x', variable: 'hook', targetPairs: 6, variants: [] });
    };
    const read = (result: CreateResult): unknown => {
      // @ts-expect-error -- the response experiment field is `name`, not `nome`
      return result.experiment.nome;
    };
    expect(typeof run).toBe('function');
    expect(typeof read).toBe('function');
    expect(vi.mocked(client.request)).not.toHaveBeenCalled();
  });
});
