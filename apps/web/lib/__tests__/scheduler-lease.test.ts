//---------------
// scheduler-lease tests — the DB lease RPCs: return shapes and the
// error path (an RPC failure must throw a tagged error so the scheduler
// tick treats the tick as failed and retries, never silently skipping).
//---------------

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));

vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: () => ({ rpc: rpcMock }),
}));

import {
  getSchedulerLastSuccess,
  recordSchedulerSuccess,
  tryAcquireSchedulerLease,
} from '../scheduler-lease';

describe('tryAcquireSchedulerLease', () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it('returns true when the RPC reports the lease acquired', async () => {
    rpcMock.mockResolvedValue({ data: true, error: null });
    await expect(tryAcquireSchedulerLease('post-metrics', 1800, 'h1')).resolves.toBe(true);
    expect(rpcMock).toHaveBeenCalledWith('try_acquire_scheduler_lease', {
      p_job: 'post-metrics',
      p_ttl_seconds: 1800,
      p_holder: 'h1',
    });
  });

  it('returns false when another replica holds the lease', async () => {
    rpcMock.mockResolvedValue({ data: false, error: null });
    await expect(tryAcquireSchedulerLease('post-metrics', 1800, 'h')).resolves.toBe(false);
  });

  it('throws a tagged error when the RPC fails', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'db down' } });
    await expect(tryAcquireSchedulerLease('post-metrics', 1800, 'h')).rejects.toThrow(
      'acquire rpc failed: db down',
    );
  });
});

describe('getSchedulerLastSuccess', () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it('returns the persisted timestamp as a Date', async () => {
    const iso = '2026-10-24T10:00:00.000Z';
    rpcMock.mockResolvedValue({ data: iso, error: null });
    await expect(getSchedulerLastSuccess('billing-reconcile')).resolves.toEqual(new Date(iso));
  });

  it('returns null when the job never ran', async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    await expect(getSchedulerLastSuccess('billing-reconcile')).resolves.toBeNull();
  });

  it('throws a tagged error when the RPC fails', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'db down' } });
    await expect(getSchedulerLastSuccess('billing-reconcile')).rejects.toThrow(
      'last-success rpc failed: db down',
    );
  });
});

describe('recordSchedulerSuccess', () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it('resolves when the RPC succeeds', async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    await expect(recordSchedulerSuccess('post-metrics')).resolves.toBeUndefined();
    expect(rpcMock).toHaveBeenCalledWith('record_scheduler_success', { p_job: 'post-metrics' });
  });

  it('throws a tagged error when the RPC fails', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'db down' } });
    await expect(recordSchedulerSuccess('post-metrics')).rejects.toThrow(
      'record-success rpc failed: db down',
    );
  });
});
