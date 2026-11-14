import { describe, it, expect } from 'vitest';

import {
  BATCH_FREE_EVERY,
  BATCH_WINDOW_MS,
  MAX_BATCH_VIDEOS,
  batchChargeId,
  batchDiscountRefundKey,
  batchFreeCount,
  batchSlotRefundKey,
  narrowBatchSlot,
  planBatchClawback,
  planBatchDiscount,
  withinBatchWindow,
  type BatchSlot,
} from '../batch-discount';
import { RATE_LIMITS } from '@/lib/rate-limit';

//---------------
// The "6 for 5" rule of issue #487: every 6 face videos of a batch, the
// cheapest is free; faceless never counts and is never free.
//---------------

const T0 = '2026-11-08T10:00:00.000Z';

function slot(id: string, chargedTokens: number, extra: Partial<BatchSlot> = {}): BatchSlot {
  return {
    id,
    scheduleId: `sched-${id}`,
    faceless: false,
    status: 'generating',
    chargedTokens,
    discountTokens: 0,
    createdAt: T0,
    taskId: `task-${id}`,
    ...extra,
  };
}

function faces(count: number, chargedTokens = 2): BatchSlot[] {
  return Array.from({ length: count }, (_, index) => slot(`f${index + 1}`, chargedTokens));
}

describe('batch discount constants', () => {
  it('builds the ledger ids the discount credit and the slot refund share', () => {
    expect(batchChargeId('sched-1')).toBe('batch:sched-1');
    expect(batchSlotRefundKey('sched-1', 'slot-1')).toBe('batch:sched-1:slot:slot-1');
    expect(batchDiscountRefundKey('sched-1', 'slot-1')).toBe('batch:sched-1:slot:slot-1:discount');
  });

  it('is one free video per 6, at most 12 videos, within 10 minutes', () => {
    expect(BATCH_FREE_EVERY).toBe(6);
    expect(MAX_BATCH_VIDEOS).toBe(12);
    expect(BATCH_WINDOW_MS).toBe(10 * 60 * 1000);
  });

  it('lets a full batch through the generate-and-schedule rate limit in one window', () => {
    expect(RATE_LIMITS.generateAndSchedule.limit).toBeGreaterThanOrEqual(MAX_BATCH_VIDEOS);
  });
});

describe('batchFreeCount', () => {
  it('earns one free video per 6 face videos, rounding down', () => {
    expect(batchFreeCount(faces(5))).toBe(0);
    expect(batchFreeCount(faces(6))).toBe(1);
    expect(batchFreeCount(faces(11))).toBe(1);
    expect(batchFreeCount(faces(12))).toBe(2);
  });

  it('does not count faceless videos toward the threshold', () => {
    const batch = [...faces(5), slot('fl', 1, { faceless: true })];
    expect(batchFreeCount(batch)).toBe(0);
  });

  it('keeps counting a face video that failed on our side', () => {
    const batch = [...faces(5), slot('failed', 2, { status: 'failed' })];
    expect(batchFreeCount(batch)).toBe(1);
  });
});

describe('planBatchDiscount', () => {
  it('makes nothing free below 6 face videos', () => {
    expect(planBatchDiscount(faces(5))).toEqual([]);
  });

  it('makes the cheapest face video free', () => {
    const batch = [slot('a', 15), slot('b', 3), slot('c', 8), slot('d', 2), slot('e', 3), slot('f', 15)];
    expect(planBatchDiscount(batch).map((s) => s.id)).toEqual(['d']);
  });

  it('makes two free in a batch of 12', () => {
    const batch = [...faces(10, 3), slot('cheap1', 2), slot('cheap2', 2)];
    expect(planBatchDiscount(batch).map((s) => s.id)).toEqual(['cheap1', 'cheap2']);
  });

  it('never makes a faceless video free, even when it is the cheapest', () => {
    const batch = [...faces(6, 3), slot('fl', 1, { faceless: true })];
    const plan = planBatchDiscount(batch);
    expect(plan).toHaveLength(1);
    expect(plan[0]?.faceless).toBe(false);
  });

  it('never picks a failed video (its charge may already be refunded)', () => {
    const batch = [...faces(5, 3), slot('failed', 2, { status: 'failed' })];
    expect(planBatchDiscount(batch).map((s) => s.id)).toEqual(['f1']);
  });

  it('breaks price ties by creation time, then id', () => {
    const batch = [
      slot('z', 2, { createdAt: '2026-11-08T10:01:00.000Z' }),
      slot('y', 2, { createdAt: '2026-11-08T10:00:00.000Z' }),
      slot('x', 2, { createdAt: '2026-11-08T10:00:00.000Z' }),
      ...faces(3, 3),
    ];
    expect(planBatchDiscount(batch).map((s) => s.id)).toEqual(['x']);
  });

  it('is monotonic: an already free video counts, nothing more is added', () => {
    const batch = [...faces(5), slot('free', 0, { discountTokens: 2 })];
    expect(planBatchDiscount(batch)).toEqual([]);
  });

  it('adds only the missing free video when a retry grows the batch to 12', () => {
    const batch = [slot('free', 0, { discountTokens: 3 }), ...faces(11, 3), slot('cheap', 2)];
    expect(planBatchDiscount(batch.slice(0, 12)).map((s) => s.id)).toEqual(['f1']);
    expect(planBatchDiscount([batch[0] as BatchSlot, ...faces(10, 3), slot('cheap', 2)]).map((s) => s.id)).toEqual([
      'cheap',
    ]);
  });
});

describe('planBatchClawback', () => {
  it('claws back the free video when the batch drops below 6 face videos', () => {
    const remaining = [...faces(4), slot('free', 0, { discountTokens: 2 })];
    expect(planBatchClawback(remaining).map((s) => s.id)).toEqual(['free']);
  });

  it('keeps the discount while the batch still earns it', () => {
    const remaining = [...faces(5), slot('free', 0, { discountTokens: 2 })];
    expect(planBatchClawback(remaining)).toEqual([]);
  });

  it('claws back only the excess, smallest discount first', () => {
    const remaining = [
      ...faces(8, 3),
      slot('free-big', 0, { discountTokens: 3 }),
      slot('free-small', 0, { discountTokens: 2 }),
    ];
    expect(planBatchClawback(remaining).map((s) => s.id)).toEqual(['free-small']);
  });

  it('does not claw back a failed free video', () => {
    const remaining = [...faces(4), slot('free', 0, { discountTokens: 2, status: 'failed' })];
    expect(planBatchClawback(remaining)).toEqual([]);
  });

  it('claws the live free video when a failed discount already occupies the earned slot', () => {
    const remaining = [
      ...faces(4),
      slot('failed-free', 0, { discountTokens: 2, status: 'failed' }),
      slot('live-free', 0, { discountTokens: 3, status: 'ready' }),
    ];
    expect(planBatchClawback(remaining).map((s) => s.id)).toEqual(['live-free']);
  });

  it('ignores faceless videos when counting what remains', () => {
    const remaining = [
      ...faces(4),
      slot('fl', 1, { faceless: true }),
      slot('free', 0, { discountTokens: 2 }),
    ];
    expect(planBatchClawback(remaining).map((s) => s.id)).toEqual(['free']);
  });
});

describe('withinBatchWindow', () => {
  it('accepts videos created within 10 minutes of the first', () => {
    expect(withinBatchWindow([slot('a', 2), slot('b', 2, { createdAt: '2026-11-08T10:10:00.000Z' })])).toBe(true);
  });

  it('rejects a video created more than 10 minutes after the first', () => {
    expect(withinBatchWindow([slot('a', 2), slot('b', 2, { createdAt: '2026-11-08T10:10:00.001Z' })])).toBe(false);
  });

  it('rejects an unreadable timestamp', () => {
    expect(withinBatchWindow([slot('a', 2, { createdAt: 'not a date' })])).toBe(false);
  });
});

describe('narrowBatchSlot', () => {
  const row = {
    id: 'slot-1',
    schedule_id: 'sched-1',
    faceless: false,
    status: 'ready',
    charged_tokens: 2,
    discount_tokens: 0,
    created_at: T0,
    task_id: 'task-1',
    batch_id: null,
  };

  it('reads a well-formed row', () => {
    expect(narrowBatchSlot(row)).toEqual({
      id: 'slot-1',
      scheduleId: 'sched-1',
      faceless: false,
      status: 'ready',
      chargedTokens: 2,
      discountTokens: 0,
      createdAt: T0,
      taskId: 'task-1',
    });
  });

  it('treats only literal true as faceless', () => {
    expect(narrowBatchSlot({ ...row, faceless: 'true' })?.faceless).toBe(false);
    expect(narrowBatchSlot({ ...row, faceless: true })?.faceless).toBe(true);
  });

  it('rejects rows with unreadable money columns', () => {
    for (const bad of [{ charged_tokens: -1 }, { charged_tokens: 1.5 }, { discount_tokens: '0' }, { charged_tokens: null }]) {
      expect(narrowBatchSlot({ ...row, ...bad })).toBeNull();
    }
    expect(narrowBatchSlot(null)).toBeNull();
    expect(narrowBatchSlot({ ...row, id: '' })).toBeNull();
    expect(narrowBatchSlot({ ...row, task_id: 7 })).toBeNull();
  });
});

describe('batch discount copy', () => {
  it('states the BATCH_FREE_EVERY threshold in both locales of the MCP docs card', async () => {
    const { mcpToolDescEn } = await import('@/lib/i18n/mcp-tools-i18n-en');
    const { mcpToolDescPt } = await import('@/lib/i18n/mcp-tools-i18n-pt');
    expect(mcpToolDescEn.toolDescGenerateVideo).toContain(`every ${BATCH_FREE_EVERY}th face video`);
    expect(mcpToolDescPt.toolDescGenerateVideo).toContain(`a cada ${BATCH_FREE_EVERY} vídeos com rosto`);
  });
});
