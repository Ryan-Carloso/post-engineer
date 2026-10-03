//---------------
// Tests for lib/billing/reconcile — daily billing reconciliation.
//
// The store (Supabase) and the engine HTTP check are the mocked
// boundaries; the orchestration decisions are real:
//   - zombie schedule (0 slots, old, spent, no videos) -> auto-refund
//   - stuck generation + engine task gone + no published slot -> auto-refund
//   - stuck generation + anything ambiguous -> review queue, NEVER refund
//---------------

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/posthog-server', () => ({ getPostHogServer: vi.fn() }));

vi.mock('@/lib/request-auth', () => ({ engineAuthHeaders: vi.fn() }));

import { getPostHogServer } from '@/lib/posthog-server';
import { engineAuthHeaders } from '@/lib/request-auth';
import {
  ZOMBIE_SCHEDULE_AGE_HOURS,
  ZOMBIE_REFUND_REASON,
  STUCK_REFUND_REASON,
  stuckGenerationAgeHours,
  checkEngineTask,
  runBillingReconciliation,
  type ReconcileStore,
  type ZombieCandidate,
  type StuckGeneration,
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

function fakeStore(over: Partial<ReconcileStore> = {}): ReconcileStore & {
  calls: { refund: Array<[string, string, string]>; queued: unknown[] };
} {
  const calls = { refund: [] as Array<[string, string, string]>, queued: [] as unknown[] };
  const store: ReconcileStore = {
    findZombieCandidates: async () => [],
    findStuckGenerations: async () => [],
    refund: async (userId, generationId, reason) => {
      calls.refund.push([userId, generationId, reason]);
      return true;
    },
    hasPublishedSlotForTask: async () => false,
    queueReview: async (input) => {
      calls.queued.push(input);
      return 'queued';
    },
    markGenerationSettled: async () => {},
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

describe('checkEngineTask', () => {
  const TASK = 'task-abc-123';
  const USER = 'user-uuid-1';

  function mockFetch(status: number) {
    const fetchMock = vi.fn().mockResolvedValue({ status, ok: status >= 200 && status < 300 });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('returns gone on engine 404', async () => {
    process.env.MONEYPRINT_API_URL = 'https://engine.example';
    mockFetch(404);
    await expect(checkEngineTask(TASK, USER)).resolves.toBe('gone');
  });

  it('returns alive on engine 200', async () => {
    process.env.MONEYPRINT_API_URL = 'https://engine.example';
    mockFetch(200);
    await expect(checkEngineTask(TASK, USER)).resolves.toBe('alive');
  });

  it('returns unknown on engine 500 (never treat as gone)', async () => {
    process.env.MONEYPRINT_API_URL = 'https://engine.example';
    mockFetch(500);
    await expect(checkEngineTask(TASK, USER)).resolves.toBe('unknown');
  });

  it('returns unknown when the fetch throws (engine unreachable)', async () => {
    process.env.MONEYPRINT_API_URL = 'https://engine.example';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')));
    await expect(checkEngineTask(TASK, USER)).resolves.toBe('unknown');
  });

  it('returns unknown when the engine URL is not configured', async () => {
    await expect(checkEngineTask(TASK, USER)).resolves.toBe('unknown');
  });

  it('returns unknown for an unsafe task id without calling the engine', async () => {
    process.env.MONEYPRINT_API_URL = 'https://engine.example';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(checkEngineTask('../../etc/passwd', USER)).resolves.toBe('unknown');
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
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 404, ok: false }));
  }

  it('auto-refunds a stuck generation whose engine task is gone and has no published slot', async () => {
    engine404();
    const s = stuck();
    const markSettled = vi.fn();
    const store = fakeStore({
      findStuckGenerations: async () => [s],
      markGenerationSettled: markSettled,
    });

    const report = await runBillingReconciliation(store);

    expect(store.calls.refund).toEqual([[s.userId, s.generationId, STUCK_REFUND_REASON]]);
    expect(markSettled).toHaveBeenCalledWith(s.generationId, true);
    expect(captureAs).toHaveBeenCalledWith(
      s.userId,
      'refund_issued',
      expect.objectContaining({ kind: 'stuck_generation', reason: STUCK_REFUND_REASON }),
    );
    expect(report.stuckAutoRefunded).toHaveLength(1);
    expect(store.calls.queued).toHaveLength(0);
  });

  it('never refunds when a published slot exists for the task (value was delivered)', async () => {
    engine404();
    const s = stuck();
    const store = fakeStore({
      findStuckGenerations: async () => [s],
      hasPublishedSlotForTask: async () => true,
    });

    const report = await runBillingReconciliation(store);

    expect(store.calls.refund).toHaveLength(0);
    expect(store.calls.queued).toHaveLength(0);
    expect(captureAs).not.toHaveBeenCalled();
    expect(report.stuckSkippedValueDelivered).toHaveLength(1);
  });

  it('queues (never refunds) when the engine task is still alive', async () => {
    process.env.MONEYPRINT_API_URL = 'https://engine.example';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200, ok: true }));
    const s = stuck();
    const store = fakeStore({ findStuckGenerations: async () => [s] });

    const report = await runBillingReconciliation(store);

    expect(store.calls.refund).toHaveLength(0);
    expect(store.calls.queued).toHaveLength(1);
    expect(captureAs).toHaveBeenCalledWith(
      s.userId,
      'refund_review_queued',
      expect.objectContaining({ generation_id: s.generationId }),
    );
    expect(report.queuedForReview).toHaveLength(1);
  });

  it('queues (never refunds) when the engine is unreachable', async () => {
    process.env.MONEYPRINT_API_URL = 'https://engine.example';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));
    const s = stuck();
    const store = fakeStore({ findStuckGenerations: async () => [s] });

    const report = await runBillingReconciliation(store);

    expect(store.calls.refund).toHaveLength(0);
    expect(store.calls.queued).toHaveLength(1);
    expect(report.queuedForReview).toHaveLength(1);
  });

  it('queues (never refunds) when the generation has no engine task id to verify', async () => {
    const s = stuck({ engineTaskId: null });
    const store = fakeStore({ findStuckGenerations: async () => [s] });

    const report = await runBillingReconciliation(store);

    expect(store.calls.refund).toHaveLength(0);
    expect(store.calls.queued).toHaveLength(1);
    expect(report.queuedForReview).toHaveLength(1);
  });

  it('does not emit a second queue event for an already-queued generation', async () => {
    process.env.MONEYPRINT_API_URL = 'https://engine.example';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200, ok: true }));
    const s = stuck();
    const store = fakeStore({
      findStuckGenerations: async () => [s],
      queueReview: async () => 'already_queued',
    });

    const report = await runBillingReconciliation(store);

    expect(report.queuedForReview).toHaveLength(0);
    expect(report.queuedAlready).toHaveLength(1);
    expect(captureAs).not.toHaveBeenCalledWith(
      s.userId,
      'refund_review_queued',
      expect.anything(),
    );
  });

  it('marks the generation failed without the refund flag when the refund RPC no-ops', async () => {
    engine404();
    const s = stuck();
    const markSettled = vi.fn();
    const store = fakeStore({
      findStuckGenerations: async () => [s],
      refund: async () => false,
      markGenerationSettled: markSettled,
    });

    await runBillingReconciliation(store);

    // Never mark refunded optimistically: the RPC said no.
    expect(markSettled).toHaveBeenCalledWith(s.generationId, false);
    expect(captureAs).not.toHaveBeenCalledWith(
      s.userId,
      'refund_issued',
      expect.anything(),
    );
  });
});

describe('supabase/migrations/004_billing_reconcile.sql literals', () => {
  async function readMigration(): Promise<string> {
    const { readFileSync } = await import('node:fs');
    const { join, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    return readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        '..', '..', '..', '..', '..',
        'supabase', 'migrations', '004_billing_reconcile.sql',
      ),
      'utf8',
    );
  }

  it('creates the refund_reviews queue table with a pending-uniqueness guard', async () => {
    const sql = await readMigration();
    expect(sql).toContain('create table if not exists public.refund_reviews');
    expect(sql).toMatch(/status text not null default 'pending'/);
    expect(sql).toContain("where status = 'pending'");
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
