//---------------
// Tests for lib/billing/reconcile — daily billing reconciliation.
//
// The store (Supabase) and the engine HTTP check are the mocked
// boundaries; the orchestration decisions are real and fully
// deterministic — there is no human review queue:
//   - zombie schedule (0 slots, old, spent, no videos) -> auto-refund
//   - stuck generation + engine task gone + no published slot -> auto-refund
//   - stuck generation + engine failed -> auto-refund with the
//     categorized engine reason
//   - stuck generation + engine complete -> backfill completed, no refund
//   - stuck generation + active/unreachable inside the day limit ->
//     deferred to the next run (no refund, no settle)
//   - stuck generation + active/unreachable past the day limit ->
//     auto-refund (no provable delivery)
//   - stuck generation + no engine task id -> refund unless a published
//     slot proves value was delivered
//---------------

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { findRepoRoot } from '@/test/repo-root';

vi.mock('@/lib/posthog-server', () => ({ getPostHogServer: vi.fn() }));

vi.mock('@/lib/request-auth', () => ({ engineAuthHeaders: vi.fn() }));

import { getPostHogServer } from '@/lib/posthog-server';
import { engineAuthHeaders } from '@/lib/request-auth';
import {
  ZOMBIE_SCHEDULE_AGE_HOURS,
  ZOMBIE_REFUND_REASON,
  STUCK_REFUND_REASON,
  STUCK_FAILED_REFUND_REASON_PREFIX,
  STUCK_NO_TASK_REFUND_REASON,
  STUCK_MAX_DEFAULT_DAYS,
  stuckGenerationAgeHours,
  stuckMaxDays,
  stuckUnresolvedRefundReason,
  stuckUnverifiableRefundReason,
  checkEngineTask,
  runBillingReconciliation,
  type ReconcileStore,
  type ZombieCandidate,
  type StuckGeneration,
  type SettleGenerationInput,
} from '../reconcile';

const captureAs = vi.fn();
const mockEngineAuthHeaders = vi.mocked(engineAuthHeaders);

function mockPostHog() {
  vi.mocked(getPostHogServer).mockReturnValue({
    capture: vi.fn(),
    captureAs,
    captureException: vi.fn(),
  });
}

function zombie(over: Partial<ZombieCandidate> = {}): ZombieCandidate {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    userId: 'user-uuid-1',
    generationId: 'batch:11111111-1111-1111-1111-111111111111',
    tokensSpent: 3,
    createdAt: new Date(Date.now() - 48 * 3600 * 1000).toISOString(),
    ...over,
  };
}

function stuck(over: Partial<StuckGeneration> = {}): StuckGeneration {
  return {
    id: '22222222-2222-2222-2222-222222222222',
    userId: 'user-uuid-1',
    generationId: 'gen-stuck-1',
    engineTaskId: 'task-abc-123',
    createdAt: new Date(Date.now() - 12 * 3600 * 1000).toISOString(),
    ...over,
  };
}

function stuckDaysAgo(days: number, over: Partial<StuckGeneration> = {}): StuckGeneration {
  return stuck({
    createdAt: new Date(Date.now() - days * 24 * 3600 * 1000).toISOString(),
    ...over,
  });
}

function fakeStore(over: Partial<ReconcileStore> = {}): ReconcileStore & {
  calls: {
    refund: Array<[string, string, string]>;
    settled: SettleGenerationInput[];
  };
} {
  const calls = {
    refund: [] as Array<[string, string, string]>,
    settled: [] as SettleGenerationInput[],
  };
  const store: ReconcileStore = {
    findZombieCandidates: async () => [],
    findStuckGenerations: async () => [],
    refund: async (userId, generationId, reason) => {
      calls.refund.push([userId, generationId, reason]);
      return true;
    },
    hasPublishedSlotForTask: async () => false,
    hasPublishedSlotForGeneration: async () => false,
    settleGeneration: async (input) => {
      calls.settled.push(input);
    },
    ...over,
  };
  return Object.assign(store, { calls });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  mockPostHog();
  mockEngineAuthHeaders.mockReturnValue({ Authorization: 'Bearer engine-secret' });
  delete process.env.MONEYPRINT_API_URL;
  delete process.env.RECONCILE_STUCK_HOURS;
  delete process.env.RECONCILE_STUCK_MAX_DAYS;
});

describe('constants', () => {
  it('treats schedules older than 24h as zombie-eligible', () => {
    expect(ZOMBIE_SCHEDULE_AGE_HOURS).toBe(24);
  });

  it('uses a stable, greppable refund reason for zombies', () => {
    expect(ZOMBIE_REFUND_REASON).toBe('zombie_schedule_no_slots');
  });

  it('uses a stable, greppable refund reason for dead stuck generations', () => {
    expect(STUCK_REFUND_REASON).toBe('stuck_generation_task_gone');
  });

  it('prefixes engine-failure refund reasons for categorization', () => {
    expect(STUCK_FAILED_REFUND_REASON_PREFIX).toBe('stuck_generation_failed');
  });

  it('uses a stable refund reason when the engine never accepted the job', () => {
    expect(STUCK_NO_TASK_REFUND_REASON).toBe('stuck_generation_no_task_no_value');
  });

  it('time-boxes unresolved stuck generations at 3 days by default', () => {
    expect(STUCK_MAX_DEFAULT_DAYS).toBe(3);
    expect(stuckUnresolvedRefundReason()).toBe('stuck_unresolved_after_3_days');
    expect(stuckUnverifiableRefundReason()).toBe('stuck_unverifiable_after_3_days');
  });
});

describe('stuckGenerationAgeHours', () => {
  it('defaults to 6h', () => {
    expect(stuckGenerationAgeHours()).toBe(6);
  });

  it('honors RECONCILE_STUCK_HOURS when positive', () => {
    process.env.RECONCILE_STUCK_HOURS = '12';
    expect(stuckGenerationAgeHours()).toBe(12);
  });

  it('falls back to the default on garbage input', () => {
    process.env.RECONCILE_STUCK_HOURS = 'not-a-number';
    expect(stuckGenerationAgeHours()).toBe(6);
    process.env.RECONCILE_STUCK_HOURS = '-3';
    expect(stuckGenerationAgeHours()).toBe(6);
  });
});

describe('stuckMaxDays', () => {
  it('defaults to 3 days', () => {
    expect(stuckMaxDays()).toBe(3);
  });

  it('honors RECONCILE_STUCK_MAX_DAYS when positive', () => {
    process.env.RECONCILE_STUCK_MAX_DAYS = '5';
    expect(stuckMaxDays()).toBe(5);
    expect(stuckUnresolvedRefundReason()).toBe('stuck_unresolved_after_5_days');
    expect(stuckUnverifiableRefundReason()).toBe('stuck_unverifiable_after_5_days');
  });

  it('falls back to the default on garbage input', () => {
    process.env.RECONCILE_STUCK_MAX_DAYS = 'soon';
    expect(stuckMaxDays()).toBe(3);
    process.env.RECONCILE_STUCK_MAX_DAYS = '0';
    expect(stuckMaxDays()).toBe(3);
  });
});

describe('checkEngineTask', () => {
  const TASK = 'task-abc-123';
  const USER = 'user-uuid-1';

  function mockFetch(status: number, body?: unknown, jsonThrows = false) {
    const fetchMock = vi.fn().mockResolvedValue({
      status,
      ok: status >= 200 && status < 300,
      json: jsonThrows ? async () => { throw new Error('bad json'); } : async () => body,
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  function engineUp() {
    process.env.MONEYPRINT_API_URL = 'https://engine.example';
  }

  it('returns gone on engine 404', async () => {
    engineUp();
    mockFetch(404);
    await expect(checkEngineTask(TASK, USER)).resolves.toEqual({ kind: 'gone' });
  });

  it('returns failed with the engine error on state -1', async () => {
    engineUp();
    mockFetch(200, { body: { state: -1, error: 'GPU ran out of memory' } });
    await expect(checkEngineTask(TASK, USER)).resolves.toEqual({
      kind: 'failed',
      error: 'GPU ran out of memory',
    });
  });

  it('returns failed with a null error when the body carries none', async () => {
    engineUp();
    mockFetch(200, { body: { state: -1 } });
    await expect(checkEngineTask(TASK, USER)).resolves.toEqual({ kind: 'failed', error: null });
  });

  it('reads the unwrapped task shape too', async () => {
    engineUp();
    mockFetch(200, { state: -1, error: 'engine restart during render' });
    await expect(checkEngineTask(TASK, USER)).resolves.toEqual({
      kind: 'failed',
      error: 'engine restart during render',
    });
  });

  it('returns complete on state 1', async () => {
    engineUp();
    mockFetch(200, { body: { state: 1, progress: 100 } });
    await expect(checkEngineTask(TASK, USER)).resolves.toEqual({ kind: 'complete' });
  });

  it('returns active on queued/processing states', async () => {
    engineUp();
    mockFetch(200, { body: { state: 3 } });
    await expect(checkEngineTask(TASK, USER)).resolves.toEqual({ kind: 'active' });
    mockFetch(200, { body: { state: 4, progress: 42 } });
    await expect(checkEngineTask(TASK, USER)).resolves.toEqual({ kind: 'active' });
  });

  it('returns unknown on engine 500 (never treat as gone)', async () => {
    engineUp();
    mockFetch(500);
    await expect(checkEngineTask(TASK, USER)).resolves.toEqual({ kind: 'unknown' });
  });

  it('returns unknown when the fetch throws (engine unreachable)', async () => {
    engineUp();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')));
    await expect(checkEngineTask(TASK, USER)).resolves.toEqual({ kind: 'unknown' });
  });

  it('returns unknown when the body is not JSON', async () => {
    engineUp();
    mockFetch(200, undefined, true);
    await expect(checkEngineTask(TASK, USER)).resolves.toEqual({ kind: 'unknown' });
  });

  it('returns unknown when the body carries no readable state', async () => {
    engineUp();
    mockFetch(200, { body: { progress: 10 } });
    await expect(checkEngineTask(TASK, USER)).resolves.toEqual({ kind: 'unknown' });
  });

  it('returns unknown when the engine URL is not configured', async () => {
    await expect(checkEngineTask(TASK, USER)).resolves.toEqual({ kind: 'unknown' });
  });

  it('returns unknown for an unsafe task id without calling the engine', async () => {
    engineUp();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(checkEngineTask('../../etc/passwd', USER)).resolves.toEqual({ kind: 'unknown' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('runBillingReconciliation — zombies', () => {
  it('refunds every zombie candidate and emits refund_issued attributed to the user', async () => {
    const z = zombie();
    const store = fakeStore({ findZombieCandidates: async () => [z] });

    const report = await runBillingReconciliation(store);

    expect(store.calls.refund).toEqual([[z.userId, z.generationId, ZOMBIE_REFUND_REASON]]);
    expect(captureAs).toHaveBeenCalledWith(
      z.userId,
      'refund_issued',
      expect.objectContaining({
        kind: 'zombie_schedule',
        schedule_id: z.id,
        reason: ZOMBIE_REFUND_REASON,
        tokens: z.tokensSpent,
      }),
    );
    expect(report.zombiesRefunded).toHaveLength(1);
  });

  it('does nothing when there are no candidates', async () => {
    const store = fakeStore();
    const report = await runBillingReconciliation(store);
    expect(store.calls.refund).toHaveLength(0);
    expect(captureAs).not.toHaveBeenCalled();
    expect(report.zombiesRefunded).toHaveLength(0);
  });

  it('treats an idempotent no-op refund (already refunded) as settled without a PostHog event', async () => {
    const z = zombie();
    const refundCalls: Array<[string, string, string]> = [];
    const store = fakeStore({
      findZombieCandidates: async () => [z],
      refund: async (userId, generationId, reason) => {
        refundCalls.push([userId, generationId, reason]);
        return false;
      },
    });

    const report = await runBillingReconciliation(store);

    // The RPC was attempted exactly once; its refunded=false is the
    // idempotent "already settled" answer, not an error.
    expect(refundCalls).toEqual([[z.userId, z.generationId, ZOMBIE_REFUND_REASON]]);
    expect(captureAs).not.toHaveBeenCalledWith(
      z.userId,
      'refund_issued',
      expect.anything(),
    );
    expect(report.zombiesRefunded).toHaveLength(0);
    expect(report.zombiesAlreadySettled).toHaveLength(1);
  });

  it('keeps refunding other zombies when one refund throws', async () => {
    const z1 = zombie({
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      generationId: 'batch:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    });
    const z2 = zombie({
      id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      generationId: 'batch:bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    });
    const store = fakeStore({
      findZombieCandidates: async () => [z1, z2],
      refund: async (userId, generationId) => {
        if (generationId === z1.generationId) throw new Error('db down');
        return true;
      },
    });

    const report = await runBillingReconciliation(store);

    expect(report.zombiesRefunded.map((r) => r.scheduleId)).toEqual([z2.id]);
    expect(report.errors).toHaveLength(1);
    expect(captureAs).toHaveBeenCalledTimes(1);
  });
});

describe('runBillingReconciliation — stuck generations', () => {
  function engine404() {
    process.env.MONEYPRINT_API_URL = 'https://engine.example';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ status: 404, ok: false, json: async () => ({}) }),
    );
  }

  function engineBody(body: unknown) {
    process.env.MONEYPRINT_API_URL = 'https://engine.example';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ status: 200, ok: true, json: async () => body }),
    );
  }

  function engineDown() {
    process.env.MONEYPRINT_API_URL = 'https://engine.example';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));
  }

  it('auto-refunds a stuck generation whose engine task is gone and has no published slot', async () => {
    engine404();
    const s = stuck();
    const store = fakeStore({ findStuckGenerations: async () => [s] });

    const report = await runBillingReconciliation(store);

    expect(store.calls.refund).toEqual([[s.userId, s.generationId, STUCK_REFUND_REASON]]);
    expect(store.calls.settled).toEqual([
      expect.objectContaining({ generationId: s.generationId, status: 'failed', refunded: true }),
    ]);
    expect(captureAs).toHaveBeenCalledWith(
      s.userId,
      'refund_issued',
      expect.objectContaining({ kind: 'stuck_generation', reason: STUCK_REFUND_REASON }),
    );
    expect(report.stuckAutoRefunded).toHaveLength(1);
    expect(report.stuckAutoRefunded[0].reason).toBe(STUCK_REFUND_REASON);
  });

  it('marks completed without refund when a published slot exists for a gone task', async () => {
    engine404();
    const s = stuck();
    const store = fakeStore({
      findStuckGenerations: async () => [s],
      hasPublishedSlotForTask: async () => true,
    });

    const report = await runBillingReconciliation(store);

    expect(store.calls.refund).toHaveLength(0);
    expect(store.calls.settled).toEqual([
      expect.objectContaining({ generationId: s.generationId, status: 'completed', refunded: false }),
    ]);
    expect(captureAs).not.toHaveBeenCalled();
    expect(report.stuckSkippedValueDelivered).toHaveLength(1);
  });

  it('auto-refunds with the categorized engine reason when the task failed', async () => {
    engineBody({ body: { state: -1, error: 'engine restart during render' } });
    const s = stuck();
    const store = fakeStore({ findStuckGenerations: async () => [s] });

    const report = await runBillingReconciliation(store);

    const reason = `${STUCK_FAILED_REFUND_REASON_PREFIX}:engine_restart`;
    expect(store.calls.refund).toEqual([[s.userId, s.generationId, reason]]);
    expect(store.calls.settled).toEqual([
      expect.objectContaining({
        generationId: s.generationId,
        status: 'failed',
        errorCode: 'engine_restart',
        errorMessage: 'engine restart during render',
        refunded: true,
      }),
    ]);
    expect(captureAs).toHaveBeenCalledWith(
      s.userId,
      'refund_issued',
      expect.objectContaining({ kind: 'stuck_generation', reason }),
    );
    expect(report.stuckAutoRefunded).toHaveLength(1);
  });

  it('categorizes an unrecognized engine error as unknown', async () => {
    engineBody({ body: { state: -1, error: 'GPU exploded mysteriously' } });
    const s = stuck();
    const store = fakeStore({ findStuckGenerations: async () => [s] });

    await runBillingReconciliation(store);

    expect(store.calls.refund).toEqual([
      [s.userId, s.generationId, `${STUCK_FAILED_REFUND_REASON_PREFIX}:unknown`],
    ]);
    expect(store.calls.settled[0]).toMatchObject({ errorCode: 'unknown' });
  });

  it('backfills completed without refund when the engine finished the task', async () => {
    engineBody({ body: { state: 1, progress: 100 } });
    const s = stuck();
    const store = fakeStore({ findStuckGenerations: async () => [s] });

    const report = await runBillingReconciliation(store);

    expect(store.calls.refund).toHaveLength(0);
    expect(store.calls.settled).toEqual([
      expect.objectContaining({ generationId: s.generationId, status: 'completed', refunded: false }),
    ]);
    expect(captureAs).not.toHaveBeenCalled();
    expect(report.stuckCompletedBackfilled).toHaveLength(1);
  });

  it('defers (no refund, no settle) an active task inside the day limit', async () => {
    engineBody({ body: { state: 3 } });
    const s = stuck(); // 12h old — past the 6h stuck bar, inside the 3-day box
    const store = fakeStore({ findStuckGenerations: async () => [s] });

    const report = await runBillingReconciliation(store);

    expect(store.calls.refund).toHaveLength(0);
    expect(store.calls.settled).toHaveLength(0);
    expect(captureAs).not.toHaveBeenCalled();
    expect(report.stuckDeferred).toHaveLength(1);
  });

  it('auto-refunds an active task past the day limit', async () => {
    engineBody({ body: { state: 4, progress: 61 } });
    const s = stuckDaysAgo(4);
    const store = fakeStore({ findStuckGenerations: async () => [s] });

    const report = await runBillingReconciliation(store);

    expect(store.calls.refund).toEqual([
      [s.userId, s.generationId, 'stuck_unresolved_after_3_days'],
    ]);
    expect(store.calls.settled).toEqual([
      expect.objectContaining({ generationId: s.generationId, status: 'failed', refunded: true }),
    ]);
    expect(captureAs).toHaveBeenCalledWith(
      s.userId,
      'refund_issued',
      expect.objectContaining({ reason: 'stuck_unresolved_after_3_days' }),
    );
    expect(report.stuckAutoRefunded).toHaveLength(1);
  });

  it('defers (no refund, no settle) an unreachable engine inside the day limit', async () => {
    engineDown();
    const s = stuck();
    const store = fakeStore({ findStuckGenerations: async () => [s] });

    const report = await runBillingReconciliation(store);

    expect(store.calls.refund).toHaveLength(0);
    expect(store.calls.settled).toHaveLength(0);
    expect(captureAs).not.toHaveBeenCalled();
    expect(report.stuckDeferred).toHaveLength(1);
  });

  it('auto-refunds an unreachable engine past the day limit, with an audit event', async () => {
    engineDown();
    const s = stuckDaysAgo(4);
    const store = fakeStore({ findStuckGenerations: async () => [s] });

    const report = await runBillingReconciliation(store);

    expect(store.calls.refund).toEqual([
      [s.userId, s.generationId, 'stuck_unverifiable_after_3_days'],
    ]);
    expect(captureAs).toHaveBeenCalledWith(
      s.userId,
      'refund_issued',
      expect.objectContaining({ reason: 'stuck_unverifiable_after_3_days' }),
    );
    expect(report.stuckAutoRefunded).toHaveLength(1);
  });

  it('honors a custom day limit in the time-boxed refund reason', async () => {
    process.env.RECONCILE_STUCK_MAX_DAYS = '5';
    engineDown();
    const s = stuckDaysAgo(6);
    const store = fakeStore({ findStuckGenerations: async () => [s] });

    await runBillingReconciliation(store);

    expect(store.calls.refund).toEqual([
      [s.userId, s.generationId, 'stuck_unverifiable_after_5_days'],
    ]);
  });

  it('auto-refunds when there is no engine task id and no published slot', async () => {
    const s = stuck({ engineTaskId: null, generationId: 'batch:33333333-3333-3333-3333-333333333333' });
    const store = fakeStore({ findStuckGenerations: async () => [s] });

    const report = await runBillingReconciliation(store);

    expect(store.calls.refund).toEqual([[s.userId, s.generationId, STUCK_NO_TASK_REFUND_REASON]]);
    expect(store.calls.settled).toEqual([
      expect.objectContaining({
        generationId: s.generationId,
        status: 'failed',
        errorCode: 'no_task_id',
        refunded: true,
      }),
    ]);
    expect(captureAs).toHaveBeenCalledWith(
      s.userId,
      'refund_issued',
      expect.objectContaining({ reason: STUCK_NO_TASK_REFUND_REASON }),
    );
    expect(report.stuckAutoRefunded).toHaveLength(1);
  });

  it('marks completed without refund when there is no task id but a slot was published', async () => {
    const s = stuck({ engineTaskId: null, generationId: 'batch:33333333-3333-3333-3333-333333333333' });
    const store = fakeStore({
      findStuckGenerations: async () => [s],
      hasPublishedSlotForGeneration: async () => true,
    });

    const report = await runBillingReconciliation(store);

    expect(store.calls.refund).toHaveLength(0);
    expect(store.calls.settled).toEqual([
      expect.objectContaining({ generationId: s.generationId, status: 'completed', refunded: false }),
    ]);
    expect(captureAs).not.toHaveBeenCalled();
    expect(report.stuckSkippedValueDelivered).toHaveLength(1);
  });

  it('marks the generation failed without the refund flag when the refund RPC no-ops', async () => {
    engine404();
    const s = stuck();
    const store = fakeStore({
      findStuckGenerations: async () => [s],
      refund: async () => false,
    });

    await runBillingReconciliation(store);

    // Never mark refunded optimistically: the RPC said no.
    expect(store.calls.settled).toEqual([
      expect.objectContaining({ generationId: s.generationId, status: 'failed', refunded: false }),
    ]);
    expect(captureAs).not.toHaveBeenCalledWith(
      s.userId,
      'refund_issued',
      expect.anything(),
    );
  });

  it('keeps settling other generations when one settle throws', async () => {
    engine404();
    const s1 = stuck({ generationId: 'gen-1' });
    const s2 = stuck({ generationId: 'gen-2' });
    const store = fakeStore({
      findStuckGenerations: async () => [s1, s2],
      settleGeneration: async (input) => {
        if (input.generationId === 'gen-1') throw new Error('db down');
      },
    });

    const report = await runBillingReconciliation(store);

    expect(report.stuckAutoRefunded.map((r) => r.generationId)).toEqual(['gen-2']);
    expect(report.errors).toHaveLength(1);
  });
});

describe('hasPublishedSlotForGeneration — batch schedule mapping', () => {
  it('maps batch:<scheduleId> generations to their schedule slots', async () => {
    const { createReconcileStore } = await import('../reconcile');
    const scheduleId = '33333333-3333-3333-3333-333333333333';
    let seen: Record<string, unknown> | null = null;
    const fakeSupabase = {
      from: (table: string) => {
        seen = { table };
        const chain: Record<string, unknown> = {};
        chain.select = () => chain;
        chain.eq = (col: string, val: unknown) => {
          seen = { ...(seen as object), [col]: val };
          return chain;
        };
        chain.limit = async () => ({ data: [{ id: 'slot-1' }], error: null });
        return chain;
      },
    };
    const store = createReconcileStore(fakeSupabase as never);
    await expect(
      store.hasPublishedSlotForGeneration('user-1', `batch:${scheduleId}:slot:slot-9`),
    ).resolves.toBe(true);
    expect(seen).toMatchObject({
      table: 'scheduled_posts',
      user_id: 'user-1',
      schedule_id: scheduleId,
      status: 'published',
    });
  });

  it('returns false for non-batch generation ids (nothing provable to check)', async () => {
    const { createReconcileStore } = await import('../reconcile');
    const from = vi.fn();
    const store = createReconcileStore({ from } as never);
    await expect(store.hasPublishedSlotForGeneration('user-1', 'legacy-gen-9')).resolves.toBe(false);
    expect(from).not.toHaveBeenCalled();
  });
});

describe('supabase/migrations/004_billing_reconcile.sql literals', () => {
  async function readMigration(): Promise<string> {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    return readFileSync(
      join(
        findRepoRoot(import.meta.url),
        'supabase', 'migrations', '004_billing_reconcile.sql',
      ),
      'utf8',
    );
  }

  it('no longer ships the human review queue table (reconciliation is fully automatic)', async () => {
    const sql = await readMigration();
    expect(sql).not.toContain('refund_reviews');
  });

  it('ships the zombie/stuck detector functions the web adapter calls', async () => {
    const sql = await readMigration();
    expect(sql).toContain('find_zombie_schedule_candidates');
    expect(sql).toContain('find_stuck_generations');
    // The zombie query keys off the batch: generation id convention and
    // requires zero slots, zero generated videos, and a ledger spend.
    expect(sql).toContain("'batch:'");
    expect(sql).toContain('scheduled_posts');
    expect(sql).toContain('video_generations');
    expect(sql).toContain('token_transactions');
  });

  it('schedules the daily run via pg_cron/pg_net only when available', async () => {
    const sql = await readMigration();
    expect(sql).toContain('billing-reconcile-daily');
    expect(sql).toContain('/api/cron/billing-reconcile');
    expect(sql).toContain('pg_cron');
    expect(sql).toContain('pg_net');
    // Graceful degradation: never fail the migration when the extensions
    // or the cron settings are missing (vanilla PG in CI).
    expect(sql).toContain('pg_available_extensions');
  });
});
