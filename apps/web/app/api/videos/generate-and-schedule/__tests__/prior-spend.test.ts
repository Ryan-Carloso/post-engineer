import { describe, expect, it } from 'vitest';

import { SPEND_LEDGER_TYPES } from '../prior-spend';

describe('SPEND_LEDGER_TYPES', () => {
  it('names exactly the charge and refund ledger types', () => {
    expect(SPEND_LEDGER_TYPES).toEqual(['video_generation', 'generation_refund']);
  });
});
