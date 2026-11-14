//---------------
// Tests for lib/billing/refund-tokens — the shared web refund helper.
//
// Every request-path refund (dispatch failure, schedule cancel) funnels
// through here so the tokens move and the audit event fires in one place:
//   - the refund_batch_tokens RPC moves the tokens (idempotent key),
//   - refund_issued fires ONLY on a landed refund (refunded === true),
//     never on already_refunded — re-firing would double-count it,
//   - the event mirrors the engine's track_refund_issued property shape
//     (kind, amount, reason, batch_generation_id, slot_id,
//     engine_task_id) so dashboards unify across both sides.
//---------------

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/posthog-server', () => ({ getPostHogServer: vi.fn() }));

import { getPostHogServer } from '@/lib/posthog-server';
import { emitRefundIssued, refundSlotTokens } from '../refund-tokens';

const captureAs = vi.fn();

function mockPostHog() {
  vi.mocked(getPostHogServer).mockReturnValue({
    capture: vi.fn(),
    captureAs,
    captureException: vi.fn(),
    captureExceptionAs: vi.fn(),
  });
}

function mockSupabase(rpc: ReturnType<typeof vi.fn>) {
  return { rpc } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPostHog();
});

describe('emitRefundIssued', () => {
  it('emits refund_issued with the engine-mirrored property shape', () => {
    emitRefundIssued('user-1', {
      kind: 'schedule_cancelled',
      amount: 2,
      reason: 'Schedule cancelled before publish; video refunded',
      batchGenerationId: 'batch:s-1',
      scheduleId: 's-1',
      slotId: 'slot-1',
      engineTaskId: 'task-1',
    });

    expect(captureAs).toHaveBeenCalledTimes(1);
    expect(captureAs).toHaveBeenCalledWith('user-1', 'refund_issued', {
      kind: 'schedule_cancelled',
      user_id: 'user-1',
      amount: 2,
      reason: 'Schedule cancelled before publish; video refunded',
      batch_generation_id: 'batch:s-1',
      schedule_id: 's-1',
      slot_id: 'slot-1',
      engine_task_id: 'task-1',
    });
  });

  it('scrubs credential-shaped fragments out of the ids before emitting', () => {
    // The cancel route's scheduleId comes straight off the query string,
    // so the funnel must scrub it — including inside batch_generation_id,
    // which carries the same id after `batch:`.
    emitRefundIssued('user-1', {
      kind: 'schedule_cancelled',
      amount: 2,
      reason: 'Schedule cancelled before publish; video refunded',
      batchGenerationId: 'batch:Bearer not-a-real-token',
      scheduleId: 'Bearer not-a-real-token',
      slotId: 'slot-1',
      engineTaskId: 'task-1',
    });

    expect(captureAs).toHaveBeenCalledWith('user-1', 'refund_issued', {
      kind: 'schedule_cancelled',
      user_id: 'user-1',
      amount: 2,
      reason: 'Schedule cancelled before publish; video refunded',
      batch_generation_id: 'batch:Bearer [redacted]',
      schedule_id: 'Bearer [redacted]',
      slot_id: 'slot-1',
      engine_task_id: 'task-1',
    });
    expect(JSON.stringify(captureAs.mock.calls)).not.toContain('not-a-real-token');
  });

  it('sends a null engine_task_id when the slot never reached the engine', () => {
    emitRefundIssued('user-1', {
      kind: 'dispatch_failed',
      amount: 1,
      reason: 'Unified generate+schedule: slot dispatch failed; video refunded',
      batchGenerationId: 'batch:s-1',
      scheduleId: 's-1',
      slotId: 'slot-1',
      engineTaskId: null,
    });

    expect(captureAs).toHaveBeenCalledWith(
      'user-1',
      'refund_issued',
      expect.objectContaining({ engine_task_id: null }),
    );
  });

  it('does nothing when PostHog is not configured', () => {
    vi.mocked(getPostHogServer).mockReturnValue(undefined as never);

    expect(() =>
      emitRefundIssued('user-1', {
        kind: 'dispatch_failed',
        amount: 1,
        reason: 'r',
        batchGenerationId: 'batch:s-1',
        scheduleId: 's-1',
        slotId: 'slot-1',
        engineTaskId: null,
      }),
    ).not.toThrow();
    expect(captureAs).not.toHaveBeenCalled();
  });

  it('never throws when the capture itself throws', () => {
    captureAs.mockImplementationOnce(() => {
      throw new Error('posthog down');
    });

    expect(() =>
      emitRefundIssued('user-1', {
        kind: 'dispatch_failed',
        amount: 1,
        reason: 'r',
        batchGenerationId: 'batch:s-1',
        scheduleId: 's-1',
        slotId: 'slot-1',
        engineTaskId: null,
      }),
    ).not.toThrow();
  });
});

describe('refundSlotTokens', () => {
  const base = {
    userId: 'user-1',
    scheduleId: 's-1',
    slotId: 'slot-1',
    amount: 2,
    reason: 'Schedule cancelled before publish; video refunded',
    kind: 'schedule_cancelled' as const,
  };

  it('refunds via the RPC and emits refund_issued on a landed refund', async () => {
    const rpc = vi.fn(async () => ({ data: { refunded: true }, error: null }));

    const result = await refundSlotTokens({
      ...base,
      supabase: mockSupabase(rpc),
      engineTaskId: 'task-1',
    });

    expect(result).toEqual({ refunded: true, alreadyRefunded: false });
    expect(rpc).toHaveBeenCalledWith('refund_batch_tokens', {
      p_user_id: 'user-1',
      p_batch_generation_id: 'batch:s-1',
      p_refund_key: 'batch:s-1:slot:slot-1',
      p_amount: 2,
      p_reason: 'Schedule cancelled before publish; video refunded',
      p_engine_task_id: 'task-1',
    });
    expect(captureAs).toHaveBeenCalledTimes(1);
    expect(captureAs).toHaveBeenCalledWith(
      'user-1',
      'refund_issued',
      expect.objectContaining({ kind: 'schedule_cancelled', amount: 2, slot_id: 'slot-1' }),
    );
  });

  it('does not emit refund_issued when the slot was already refunded', async () => {
    const rpc = vi.fn(async () => ({
      data: { refunded: false, already_refunded: true },
      error: null,
    }));

    const result = await refundSlotTokens({ ...base, supabase: mockSupabase(rpc) });

    expect(result).toEqual({ refunded: false, alreadyRefunded: true });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(captureAs).not.toHaveBeenCalled();
  });

  it('reports both false and emits nothing when the RPC answers refunded false', async () => {
    const rpc = vi.fn(async () => ({
      data: { refunded: false, already_refunded: false },
      error: null,
    }));

    const result = await refundSlotTokens({ ...base, supabase: mockSupabase(rpc) });

    expect(result).toEqual({ refunded: false, alreadyRefunded: false });
    expect(captureAs).not.toHaveBeenCalled();
  });

  it('reports the RPC error and emits nothing when the RPC errors', async () => {
    const rpcError = { message: 'rpc down' };
    const rpc = vi.fn(async () => ({ data: null, error: rpcError }));

    const result = await refundSlotTokens({ ...base, supabase: mockSupabase(rpc) });

    expect(result).toEqual({ refunded: false, alreadyRefunded: false, error: rpcError });
    expect(captureAs).not.toHaveBeenCalled();
  });

  it('never throws when the RPC itself throws', async () => {
    const rpc = vi.fn(async () => {
      throw new Error('network down');
    });

    const result = await refundSlotTokens({ ...base, supabase: mockSupabase(rpc) });

    expect(result.refunded).toBe(false);
    expect(result.alreadyRefunded).toBe(false);
    expect(result.error).toBeInstanceOf(Error);
    expect(captureAs).not.toHaveBeenCalled();
  });

  it('treats a null RPC payload as no refund', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }));

    const result = await refundSlotTokens({ ...base, supabase: mockSupabase(rpc) });

    expect(result).toEqual({ refunded: false, alreadyRefunded: false });
    expect(captureAs).not.toHaveBeenCalled();
  });
});
