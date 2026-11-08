import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import type { SupabaseClient } from '@supabase/supabase-js';
import { refundsAfterClawback, type ClawbackSlot } from '../batch-clawback';
import { logger } from '@/lib/logger';
import { createFakeSupabase, slotRow, type Row } from '@/app/api/videos/batch-discount/__tests__/fake-supabase';

//---------------
// The cancel side of the batch discount (issue #487): a cancel that leaves
// the batch below 6 face videos takes the free video's discount back out
// of the cancelled video's refund, so "create 6, cancel the 5 paid ones,
// keep the free one" nets the user nothing.
//---------------

const USER_ID = 'user-1';
const SCHEDULE = 'sched-1';
const BATCH = '22222222-2222-4222-8222-222222222222';

function batchSlot(id: string, overrides: Row = {}): Row {
  return slotRow(id, { batch_id: BATCH, ...overrides });
}

function client(fake: ReturnType<typeof createFakeSupabase>): SupabaseClient {
  return fake.client as unknown as SupabaseClient;
}

function removed(id: string, chargedTokens: number, batchId: string | null = BATCH): ClawbackSlot {
  return { id, batchId, chargedTokens, taskId: `task-${id}` };
}

function settle(fake: ReturnType<typeof createFakeSupabase>, slots: ClawbackSlot[]) {
  return refundsAfterClawback(client(fake), USER_ID, slots, SCHEDULE);
}

function expectNet(
  result: Awaited<ReturnType<typeof refundsAfterClawback>>,
  net: [string, number][],
  settled: string[] = [],
) {
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.refundBySlot).toEqual(new Map(net));
  expect([...result.settledSlotIds].sort()).toEqual([...settled].sort());
}

beforeEach(() => vi.clearAllMocks());

describe('refundsAfterClawback', () => {
  it('refunds the full charge of a slot outside any batch without reading anything', async () => {
    const fake = createFakeSupabase({ tables: { scheduled_posts: [] } });
    const result = await settle(fake, [removed('x', 3, null)]);
    expectNet(result, [['x', 3]]);
    expect(fake.updates).toEqual([]);
    expect(fake.rpcCalls).toEqual([]);
  });

  it('withholds the free video discount when the batch drops below 6 face videos', async () => {
    // After the delete: 4 paid + the free one remain (the cancelled paid
    // slot is already gone).
    const remaining = [
      ...['1', '2', '3', '4'].map((id) => batchSlot(id)),
      batchSlot('free', { charged_tokens: 0, discount_tokens: 2 }),
    ];
    const fake = createFakeSupabase({ tables: { scheduled_posts: remaining } });
    const result = await settle(fake, [removed('5', 2)]);
    expectNet(result, [['5', 0]], ['5']);
    const call = fake.rpcCalls.find((entry) => entry.name === 'settle_batch_clawback');
    const refunds = call?.params.p_refunds as { amount: number; refund_key: string }[];
    const recharges = call?.params.p_recharges as { discount_key: string; take: number }[];
    expect(refunds).toEqual([
      expect.objectContaining({
        slot_id: '5',
        amount: 2,
        generation_id: `batch:${SCHEDULE}`,
        refund_key: `batch:${SCHEDULE}:slot:5`,
        reason: 'Schedule cancelled before publish; video refunded',
      }),
    ]);
    expect(recharges?.[0]?.take).toBe(2);
    expect(recharges?.[0]?.discount_key).toContain(':slot:free:discount');
    // The free video is paid again: its discount moved into its charge.
    expect(fake.tables.scheduled_posts?.find((row) => row.id === 'free')).toMatchObject({
      charged_tokens: 2,
      discount_tokens: 0,
    });
  });

  it('nets the user nothing when all 5 paid videos are cancelled one by one', async () => {
    const rows = [
      ...['1', '2', '3', '4', '5'].map((id) => batchSlot(id)),
      batchSlot('free', { charged_tokens: 0, discount_tokens: 2 }),
    ];
    const fake = createFakeSupabase({ tables: { scheduled_posts: rows } });
    let refunded = 0;
    for (const id of ['1', '2', '3', '4', '5']) {
      // Simulate the route's delete, then ask for the refund.
      const table = fake.tables.scheduled_posts ?? [];
      table.splice(table.findIndex((row) => row.id === id), 1);
      const result = await settle(fake, [removed(id, 2)]);
      if (!result.ok) throw new Error('clawback failed');
      refunded += result.refundBySlot.get(id) ?? 0;
    }
    // Paid 10 for 6 videos; 5 cancelled; the one left is no longer free.
    expect(refunded).toBe(8);
    expect(fake.tables.scheduled_posts).toEqual([
      expect.objectContaining({ id: 'free', charged_tokens: 2, discount_tokens: 0 }),
    ]);
  });

  it('keeps the discount when the batch still earns it', async () => {
    const remaining = [
      ...['1', '2', '3', '4', '5', '6'].map((id) => batchSlot(id)),
      batchSlot('free', { charged_tokens: 0, discount_tokens: 2 }),
    ];
    const fake = createFakeSupabase({ tables: { scheduled_posts: remaining } });
    const result = await settle(fake, [removed('7', 2)]);
    expectNet(result, [['7', 2]]);
    expect(fake.updates).toEqual([]);
  });

  it('cancelling the free video itself refunds nothing and claws nothing', async () => {
    const remaining = ['1', '2', '3', '4', '5'].map((id) => batchSlot(id));
    const fake = createFakeSupabase({ tables: { scheduled_posts: remaining } });
    const result = await settle(fake, [removed('free', 0)]);
    expectNet(result, [['free', 0]]);
    expect(fake.updates).toEqual([]);
  });

  it('withholds only what the cancelled refund can cover', async () => {
    const remaining = [
      ...['1', '2', '3', '4'].map((id) => batchSlot(id, { charged_tokens: 3 })),
      batchSlot('free', { charged_tokens: 0, discount_tokens: 3 }),
    ];
    const fake = createFakeSupabase({ tables: { scheduled_posts: remaining } });
    const result = await settle(fake, [removed('5', 2)]);
    expectNet(result, [['5', 0]], ['5']);
    expect(fake.tables.scheduled_posts?.find((row) => row.id === 'free')).toMatchObject({
      charged_tokens: 2,
      discount_tokens: 1,
    });
  });

  it('does not withhold when a concurrent cancel already took the discount back', async () => {
    const remaining = [
      ...['1', '2', '3', '4'].map((id) => batchSlot(id)),
      batchSlot('free', { charged_tokens: 0, discount_tokens: 2 }),
    ];
    const fake = createFakeSupabase({ tables: { scheduled_posts: remaining } });
    // The other cancel's update lands after our read, inside the settlement
    // RPC: the predicate must see the moved discount and skip the recharge.
    const original = fake.client.rpc.bind(fake.client);
    fake.client.rpc = async (name: string, params: Record<string, unknown>) => {
      const free = fake.tables.scheduled_posts?.find((row) => row.id === 'free');
      if (free) Object.assign(free, { charged_tokens: 2, discount_tokens: 0 });
      return original(name, params);
    };
    const result = await settle(fake, [removed('5', 2)]);
    expectNet(result, [['5', 2]], ['5']);
    // The concurrent writer's values stand: nothing was clawed back twice.
    expect(fake.tables.scheduled_posts?.find((row) => row.id === 'free')).toMatchObject({
      charged_tokens: 2,
      discount_tokens: 0,
    });
  });

  it('fails closed when the batch cannot be read', async () => {
    const fake = createFakeSupabase({ tables: { scheduled_posts: [] }, selectError: { scheduled_posts: { message: 'down' } } });
    const result = await settle(fake, [removed('5', 2)]);
    expect(result).toEqual({ ok: false, error: { message: 'down' } });
  });

  it('fails closed on an unreadable batch row', async () => {
    const fake = createFakeSupabase({ tables: { scheduled_posts: [batchSlot('1', { charged_tokens: null })] } });
    const result = await settle(fake, [removed('5', 2)]);
    expect(result.ok).toBe(false);
  });

  it('fails closed and logs when the settlement fails', async () => {
    const remaining = [
      ...['1', '2', '3', '4'].map((id) => batchSlot(id)),
      batchSlot('free', { charged_tokens: 0, discount_tokens: 2 }),
    ];
    const fake = createFakeSupabase({
      tables: { scheduled_posts: remaining },
      rpc: () => ({ data: null, error: { message: 'write down' } }),
    });
    const result = await settle(fake, [removed('5', 2)]);
    expect(result).toEqual({ ok: false, error: { message: 'write down' } });
    expect(logger.error).toHaveBeenCalledWith(
      '[api/schedule] batch clawback settlement failed',
      { message: 'write down' },
      expect.objectContaining({ batchId: BATCH, userId: USER_ID }),
    );
    // The free slot is untouched: a failed settlement must not re-charge it.
    expect(fake.tables.scheduled_posts?.find((row) => row.id === 'free')).toMatchObject({
      charged_tokens: 0,
      discount_tokens: 2,
    });
  });

  it('does not claw back a free video that already failed', async () => {
    const remaining = [
      ...['1', '2', '3', '4'].map((id) => batchSlot(id)),
      batchSlot('free', { charged_tokens: 0, discount_tokens: 2, status: 'failed' }),
    ];
    const fake = createFakeSupabase({ tables: { scheduled_posts: remaining } });
    const result = await settle(fake, [removed('5', 2)]);
    expectNet(result, [['5', 2]]);
    expect(fake.rpcCalls).toEqual([]);
    expect(fake.tables.scheduled_posts?.find((row) => row.id === 'free')).toMatchObject({
      charged_tokens: 0,
      discount_tokens: 2,
    });
  });
});
