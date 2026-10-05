// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  batchGenerationId,
  resolveGoneGenerationId,
} from '../gone-generation-reconcile';

//---------------
// Minimal PostgREST query-builder double. Each `.eq()` narrows the row set
// and is recorded, so a test can assert the fallback ORDER (task-id lookup
// first, then the slot/batch lookup). Fixtures declare the table they
// belong to, so the double scopes each query the way PostgREST does — a
// scheduled_posts row can never satisfy the token_transactions lookup.
//---------------
interface Row {
  [key: string]: unknown;
  table: string;
}

type Captures = { table: string; filters: [string, unknown][] }[];

function makeClient(rows: Row[], captures: Captures = []) {
  return {
    from(table: string) {
      captures.push({ table, filters: [] });
      const capture = captures[captures.length - 1];
      let matched = rows.filter((row) => row.table === table);
      const builder = {
        select(_cols: string) {
          return builder;
        },
        eq(column: string, value: unknown) {
          capture.filters.push([column, value]);
          matched = matched.filter((row) => row[column] === value);
          return builder;
        },
        limit(_n: number) {
          return builder;
        },
        maybeSingle() {
          return Promise.resolve({ data: matched[0] ?? null, error: null });
        },
      };
      return builder;
    },
  };
}

// The bare SupabaseClient is the project-blessed any-shaped double: the real
// client carries 25+ members no unit test needs to reproduce.
function asClient(client: unknown): SupabaseClient {
  return client as unknown as SupabaseClient;
}

const TASK_ID = 'task-abc';
const USER_ID = 'user-1';
const BATCH_ID = 'batch:11111111-2222-3333-4444-555555555555';

describe('batchGenerationId', () => {
  it('strips the :slot: suffix from a slot generation id', () => {
    expect(batchGenerationId(`${BATCH_ID}:slot:slot-uuid`)).toBe(BATCH_ID);
  });

  it('returns a plain batch generation id unchanged', () => {
    expect(batchGenerationId(BATCH_ID)).toBe(BATCH_ID);
  });

  it('returns a non-batch generation id unchanged', () => {
    expect(batchGenerationId('plain-generation-id')).toBe('plain-generation-id');
  });

  it('keeps the prefix up to the FIRST :slot: marker', () => {
    const odd = `${BATCH_ID}:slot:a:slot:b`;
    expect(batchGenerationId(odd)).toBe(BATCH_ID);
  });
});

describe('resolveGoneGenerationId', () => {
  it('prefers the row linked by engine_task_id', async () => {
    const client = makeClient([{ table: 'video_generations', user_id: USER_ID, generation_id: 'direct-gen', engine_task_id: TASK_ID }]);
    await expect(resolveGoneGenerationId(asClient(client), USER_ID, TASK_ID)).resolves.toBe('direct-gen');
  });

  it('scopes the task-id lookup to the user', async () => {
    const captures: Captures = [];
    const client = makeClient([{ table: 'video_generations', user_id: USER_ID, generation_id: 'direct-gen', engine_task_id: TASK_ID }], captures);
    await resolveGoneGenerationId(asClient(client), USER_ID, TASK_ID);
    const first = captures[0];
    expect(first.table).toBe('video_generations');
    expect(first.filters).toContainEqual(['user_id', USER_ID]);
    expect(first.filters).toContainEqual(['engine_task_id', TASK_ID]);
  });

  it('falls back to the prepaid batch charge when no row carries the task id', async () => {
    const scheduleId = '11111111-2222-3333-4444-555555555555';
    const client = makeClient([
      { table: 'scheduled_posts', user_id: USER_ID, schedule_id: scheduleId, task_id: TASK_ID },
      { table: 'token_transactions', user_id: USER_ID, generation_id: BATCH_ID, type: 'video_generation' },
    ]);
    await expect(resolveGoneGenerationId(asClient(client), USER_ID, TASK_ID)).resolves.toBe(BATCH_ID);
  });

  it('returns undefined when neither lookup finds a charge', async () => {
    const client = makeClient([]);
    await expect(resolveGoneGenerationId(asClient(client), USER_ID, TASK_ID)).resolves.toBeUndefined();
  });

  it('never reads a charge belonging to another user', async () => {
    const captures: Captures = [];
    const scheduleId = '11111111-2222-3333-4444-555555555555';
    const client = makeClient(
      [
        { table: 'scheduled_posts', schedule_id: scheduleId, task_id: TASK_ID, user_id: 'other-user' },
        { table: 'token_transactions', generation_id: BATCH_ID, type: 'video_generation', user_id: 'other-user' },
      ],
      captures,
    );
    await expect(resolveGoneGenerationId(asClient(client), USER_ID, TASK_ID)).resolves.toBeUndefined();
    expect(captures.every((c) => c.filters.some(([col, val]) => col === 'user_id' && val === USER_ID))).toBe(
      true,
    );
  });

  it('propagates a lookup error instead of silently reporting no charge', async () => {
    const client = {
      from() {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          limit() {
            return this;
          },
          maybeSingle() {
            return Promise.resolve({ data: null, error: new Error('supabase down') });
          },
        };
      },
    };
    await expect(resolveGoneGenerationId(asClient(client), USER_ID, TASK_ID)).rejects.toThrow(/supabase down/);
  });
});

describe('resolveGoneGenerationId — negative type guard', () => {
  it('rejects a non-string generation_id rather than coercing it', async () => {
    const client = makeClient([{ table: 'video_generations', user_id: USER_ID, generation_id: 42, engine_task_id: TASK_ID }]);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(resolveGoneGenerationId(asClient(client), USER_ID, TASK_ID)).resolves.toBeUndefined();
    } finally {
      spy.mockRestore();
    }
  });
});