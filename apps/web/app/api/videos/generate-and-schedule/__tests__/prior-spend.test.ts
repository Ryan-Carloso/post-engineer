import { describe, expect, it } from 'vitest';

import { hasSlotRefund, isRollbackRefund, SPEND_LEDGER_TYPES } from '../prior-spend';

const GEN = 'batch:sched-1';

describe('isRollbackRefund', () => {
  it('accepts a refund keyed by this generation rollback prefix', () => {
    expect(isRollbackRefund({ type: 'generation_refund', amount: 2, reference_id: `${GEN}:rollback:abc` }, GEN)).toBe(true);
  });

  it('rejects a slot refund of the same generation', () => {
    expect(isRollbackRefund({ type: 'generation_refund', amount: 2, reference_id: `${GEN}:slot:s1` }, GEN)).toBe(false);
  });

  it('rejects a rollback key of another generation', () => {
    expect(isRollbackRefund({ type: 'generation_refund', amount: 2, reference_id: 'batch:other:rollback:abc' }, GEN)).toBe(false);
  });

  it('rejects a refund without a reference id', () => {
    expect(isRollbackRefund({ type: 'generation_refund', amount: 2, reference_id: null }, GEN)).toBe(false);
  });

  it('rejects a charge row even with a rollback-shaped reference', () => {
    expect(isRollbackRefund({ type: 'video_generation', amount: -2, reference_id: `${GEN}:rollback:abc` }, GEN)).toBe(false);
  });
});

describe('hasSlotRefund', () => {
  it('is false for a charge alone', () => {
    expect(hasSlotRefund([{ type: 'video_generation', amount: -2, reference_id: null }], GEN)).toBe(false);
  });

  it('is false when every refund is a rollback refund', () => {
    expect(
      hasSlotRefund(
        [
          { type: 'video_generation', amount: -2, reference_id: null },
          { type: 'generation_refund', amount: 2, reference_id: `${GEN}:rollback:abc` },
        ],
        GEN,
      ),
    ).toBe(false);
  });

  it('is true when a slot or discount refund exists', () => {
    expect(
      hasSlotRefund(
        [
          { type: 'video_generation', amount: -2, reference_id: null },
          { type: 'generation_refund', amount: 2, reference_id: `${GEN}:slot:s1:discount` },
        ],
        GEN,
      ),
    ).toBe(true);
  });
});

describe('SPEND_LEDGER_TYPES', () => {
  it('names exactly the charge and refund ledger types', () => {
    expect(SPEND_LEDGER_TYPES).toEqual(['video_generation', 'generation_refund']);
  });
});
