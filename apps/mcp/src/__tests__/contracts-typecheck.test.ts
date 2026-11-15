import { describe, expect, it, vi } from 'vitest';
import type { PostEngineerClient } from '../client.js';
import { createExperiment } from '../client-experiments.js';
import { getPrompt, listPrompts } from '../client-prompts.js';
import { getTokenBalance, listTokenTransactions } from '../client-billing.js';
import { getPost, getPostMetrics, getYouTubeRetentionCurve } from '../client-posts.js';

//---------------
// Type-level pins for the shared contracts, checked by
// `tsc -p tsconfig.spec.json` (part of the MCP typecheck): each
// ts-expect-error below must stay an error. If the contract stops
// rejecting `nome`, the directive is unused and typecheck fails.
//---------------

type CreateResult = Awaited<ReturnType<typeof createExperiment>>;
type ListPromptsResult = Awaited<ReturnType<typeof listPrompts>>;
type GetPromptResult = Awaited<ReturnType<typeof getPrompt>>;
type TokenBalanceResult = Awaited<ReturnType<typeof getTokenBalance>>;
type TokenTransactionsResult = Awaited<ReturnType<typeof listTokenTransactions>>;
type GetPostResult = Awaited<ReturnType<typeof getPost>>;
type PostMetricsResult = Awaited<ReturnType<typeof getPostMetrics>>;
type RetentionCurveResult = Awaited<ReturnType<typeof getYouTubeRetentionCurve>>;

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

  it('rejects unknown prompt fields at compile time', () => {
    const list = (result: ListPromptsResult): unknown => {
      // @ts-expect-error -- the list item field is `title`, not `name`
      return result[0]?.name;
    };
    const detail = (result: GetPromptResult): unknown => {
      // @ts-expect-error -- the detail field is `prompt`, not `text`
      return result.text;
    };
    expect(typeof list).toBe('function');
    expect(typeof detail).toBe('function');
  });

  it('rejects unknown billing fields at compile time', () => {
    const balance = (result: TokenBalanceResult): unknown => {
      // @ts-expect-error -- the balance field is `balance`, not `total`
      return result.total;
    };
    const ledger = (result: TokenTransactionsResult): unknown => {
      // @ts-expect-error -- the transaction field is `generationId`, not `generation_id`
      return result.transactions[0]?.generation_id;
    };
    expect(typeof balance).toBe('function');
    expect(typeof ledger).toBe('function');
  });

  it('rejects unknown post detail fields at compile time', () => {
    const detail = (result: GetPostResult): unknown => {
      if (result.kind !== 'generation') return undefined;
      // @ts-expect-error -- the generation field is `videoSubject`, not `subject`
      return result.generation.subject;
    };
    expect(typeof detail).toBe('function');
  });

  it('rejects unknown metrics fields at compile time', () => {
    const row = (result: PostMetricsResult): unknown => {
      // @ts-expect-error -- the row field is `postId`, not `post_id`
      return result.rows[0]?.post_id;
    };
    const curve = (result: RetentionCurveResult): unknown => {
      // @ts-expect-error -- the point field is `audienceWatchRatio`, not `watchRatio`
      return result.points[0]?.watchRatio;
    };
    expect(typeof row).toBe('function');
    expect(typeof curve).toBe('function');
  });
});
