import { describe, expect, it, vi } from 'vitest';
import type { PostEngineerClient } from '../client.js';
import { getTokenBalance, listTokenTransactions } from '../client-billing.js';

function mockClient(payload: unknown): PostEngineerClient {
  return {
    request: vi.fn(async () => payload),
    getHeaders: () => ({ Authorization: 'Bearer k' }),
  } as unknown as PostEngineerClient;
}

describe('billing client', () => {
  it('rejects a malformed balance 200', async () => {
    const client = mockClient({ success: true, balance: '8' });
    await expect(getTokenBalance(client)).rejects.toThrow('Malformed response from GET /api/billing/tokens');
  });

  it('rejects a malformed ledger 200', async () => {
    const client = mockClient({
      success: true,
      transactions: [{ id: 'tx-1', amount: -1 }],
      total: 42,
      limit: 20,
      offset: 0,
    });
    await expect(listTokenTransactions(client)).rejects.toThrow('Malformed response from GET /api/billing/transactions');
  });

  it('parses a well-formed ledger 200', async () => {
    const client = mockClient({
      success: true,
      transactions: [
        {
          id: 'tx-1',
          amount: -1,
          type: 'spend',
          description: 'Video generation',
          reason: 'generation_completed',
          generationId: 'gen-1',
          createdAt: '2026-10-08T10:00:00Z',
        },
      ],
      total: 42,
      limit: 20,
      offset: 0,
    });
    const result = await listTokenTransactions(client, 20, 0);
    expect(result.transactions).toHaveLength(1);
    expect(result.total).toBe(42);
  });
});
