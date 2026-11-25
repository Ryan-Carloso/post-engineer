import { describe, expect, it } from 'vitest';

import { EXPERIMENT_MAX_FULL_LIPSYNC_VIDEOS } from '@/lib/contracts/experiments';
import {
  EXPERIMENT_PREFLIGHT_BUDGET_MS,
  FULL_LIPSYNC_NARRATION_CHECK_MS,
  LIPSYNC_PHOTO_CHECK_ROUNDS,
  PREFLIGHT_CONCURRENCY,
  fullLipsyncVideoCap,
} from '../preflight-budget';

describe('fullLipsyncVideoCap', () => {
  it('pins the contract cap to the time budget, the batch size and the narration check time', () => {
    expect(fullLipsyncVideoCap()).toBe(EXPERIMENT_MAX_FULL_LIPSYNC_VIDEOS);
  });

  it('fits every narration check, one batch at a time, plus the photo check inside the budget', () => {
    const batches = EXPERIMENT_MAX_FULL_LIPSYNC_VIDEOS / PREFLIGHT_CONCURRENCY;

    expect(Number.isInteger(batches)).toBe(true);
    expect((batches + LIPSYNC_PHOTO_CHECK_ROUNDS) * FULL_LIPSYNC_NARRATION_CHECK_MS).toBeLessThanOrEqual(EXPERIMENT_PREFLIGHT_BUDGET_MS);
  });

  it('shrinks when the budget shrinks and never goes below zero', () => {
    expect(fullLipsyncVideoCap(30_000, 4, 10_000)).toBe(8);
    expect(fullLipsyncVideoCap(5_000, 4, 10_000)).toBe(0);
  });
});
