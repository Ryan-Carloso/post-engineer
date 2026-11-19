// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { replaySchedule } from '../replay';

const SCHEDULE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = 'user-uuid-1';
const ROUTE = '/api/media/publish-existing';

interface StubQuery {
  select: (columns?: string) => StubQuery;
  eq: (column: string, value: unknown) => StubQuery;
  lt: (column: string, value: string) => StubQuery;
  order: (column: string) => StubQuery;
  delete: () => StubQuery;
  maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
  then: <TResult1 = unknown, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: unknown }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) => Promise<TResult1 | TResult2>;
}

interface StubCall {
  table: string;
  op: 'select' | 'delete';
  lt: { column: string; value: string } | null;
}

function stubSupabase(config: { schedule: Record<string, unknown> | null; slots: unknown[] }) {
  const calls: StubCall[] = [];
  const from = vi.fn((table: string) => {
    const ltFilters: Array<{ column: string; value: string }> = [];
    let op: 'select' | 'delete' = 'select';
    const query: StubQuery = {
      select: () => query,
      eq: () => query,
      lt: (column: string, value: string) => {
        ltFilters.push({ column, value });
        return query;
      },
      order: () => query,
      delete: () => {
        op = 'delete';
        return query;
      },
      maybeSingle: async () => ({ data: config.schedule, error: null }),
      then: (onfulfilled, onrejected) => {
        calls.push({ table, op, lt: ltFilters[0] ?? null });
        const result = { data: op === 'delete' ? null : config.slots, error: null };
        return Promise.resolve(result).then(onfulfilled, onrejected);
      },
    };
    return query;
  });
  return { client: { from } as unknown as SupabaseClient, calls };
}

describe('replaySchedule', () => {
  it('deletes a zero-slot schedule older than five minutes so the retry can proceed', async () => {
    const schedule = { id: SCHEDULE_ID, created_at: new Date(Date.now() - 10 * 60_000).toISOString() };
    const { client, calls } = stubSupabase({ schedule, slots: [] });
    const result = await replaySchedule(client, SCHEDULE_ID, USER_ID, ROUTE);
    expect(result).toBeNull();
    const deletes = calls.filter((call) => call.op === 'delete');
    expect(deletes).toHaveLength(1);
    expect(deletes[0]?.table).toBe('schedules');
    expect(deletes[0]?.lt?.column).toBe('created_at');
    const boundMs = Date.parse(deletes[0]?.lt?.value ?? '');
    expect(boundMs).toBeGreaterThan(Date.now() - 6 * 60_000);
    expect(boundMs).toBeLessThanOrEqual(Date.now() - 4 * 60_000);
  });

  it('leaves a fresh zero-slot schedule alone: a live first attempt may still be inserting slots', async () => {
    const schedule = { id: SCHEDULE_ID, created_at: new Date().toISOString() };
    const { client, calls } = stubSupabase({ schedule, slots: [] });
    const result = await replaySchedule(client, SCHEDULE_ID, USER_ID, ROUTE);
    expect(result).toBeNull();
    expect(calls.filter((call) => call.op === 'delete')).toHaveLength(0);
  });

  it('does not delete a zero-slot schedule with no created_at', async () => {
    const { client, calls } = stubSupabase({ schedule: { id: SCHEDULE_ID }, slots: [] });
    const result = await replaySchedule(client, SCHEDULE_ID, USER_ID, ROUTE);
    expect(result).toBeNull();
    expect(calls.filter((call) => call.op === 'delete')).toHaveLength(0);
  });

  it('replays a schedule that already has slots', async () => {
    const schedule = { id: SCHEDULE_ID, created_at: new Date(Date.now() - 10 * 60_000).toISOString() };
    const { client, calls } = stubSupabase({
      schedule,
      slots: [{ id: 'slot-1', slot_at: '2026-11-20T18:00:00Z', title: 'Ready video', status: 'ready' }],
    });
    const result = await replaySchedule(client, SCHEDULE_ID, USER_ID, ROUTE);
    expect(result).not.toBeNull();
    const body = await result?.json();
    expect(body.replayed).toBe(true);
    expect(body.slots).toHaveLength(1);
    expect(body.warnings).toBeUndefined();
    expect(calls.filter((call) => call.op === 'delete')).toHaveLength(0);
  });

  it('names a dead account on an idempotent replay', async () => {
    const schedule = { id: SCHEDULE_ID, created_at: new Date(Date.now() - 10 * 60_000).toISOString() };
    const { client } = stubSupabase({
      schedule,
      slots: [{ id: 'slot-1', slot_at: '2026-11-20T18:00:00Z', title: 'Ready video', status: 'ready' }],
    });
    const warning = {
      code: 'account_needs_reconnect' as const,
      accounts: [{ provider: 'youtube', accountId: 'UC1' }],
    };
    const result = await replaySchedule(client, SCHEDULE_ID, USER_ID, ROUTE, warning);
    const body = await result?.json();
    expect(body.warnings).toEqual([warning]);
    expect(JSON.stringify(body)).not.toMatch(/invalid_credentials|401|OAuthException/);
  });
});
