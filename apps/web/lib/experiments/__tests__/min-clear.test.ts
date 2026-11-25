import { describe, expect, it } from 'vitest';
import { minimumVideosForClear, projectedGroups } from '../min-clear';
import { CLEAR_P_VALUE, signTestPValue, type AccountResult, type PromptResult } from '../prompt-comparison';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

function prompt(versionId: string | null, label: PromptResult['label']): PromptResult {
  return { versionId, slug: null, title: null, version: null, source: null, videos: 8, medianViews: 1, lift: 1, pValue: 0.5, label, direction: null };
}

function account(prompts: PromptResult[]): AccountResult {
  return { provider: 'youtube', accountId: 'yt-1', videos: 20, baselineViews: 100, prompts };
}

describe('minimumVideosForClear', () => {
  it('pins the sample table: 1 group needs 6, 3 need 7, 5 need 8', () => {
    expect(minimumVideosForClear(1)).toBe(6);
    expect(minimumVideosForClear(2)).toBe(7);
    expect(minimumVideosForClear(3)).toBe(7);
    expect(minimumVideosForClear(4)).toBe(8);
    expect(minimumVideosForClear(5)).toBe(8);
  });

  it('is the smallest unanimous sample whose p-value clears the Bonferroni threshold', () => {
    for (let groups = 1; groups <= 5; groups += 1) {
      const videos = minimumVideosForClear(groups);
      expect(signTestPValue(videos, 0)).toBeLessThan(CLEAR_P_VALUE / groups);
      expect(signTestPValue(videos - 1, 0)).toBeGreaterThanOrEqual(CLEAR_P_VALUE / groups);
    }
  });

  it('rejects a group count that is not a positive integer', () => {
    expect(() => minimumVideosForClear(0)).toThrow(RangeError);
    expect(() => minimumVideosForClear(1.5)).toThrow(RangeError);
  });
});

describe('projectedGroups', () => {
  it('counts only the new variants when the account has no history', () => {
    expect(projectedGroups(undefined, [A, B], 0)).toBe(2);
  });

  it('adds the no-prompt group of an account with no prompt video once it has 5 compared videos', () => {
    expect(projectedGroups(undefined, [A, B], 5)).toBe(3);
    expect(projectedGroups(undefined, [A], 30)).toBe(2);
  });

  it('leaves out the no-prompt group of an account with no prompt video below 5 compared videos', () => {
    expect(projectedGroups(undefined, [A, B], 4)).toBe(2);
  });

  it('raises the minimum by one when the no-prompt group joins the comparison', () => {
    const without = minimumVideosForClear(projectedGroups(undefined, [A, B, C], 0));
    const withHistory = minimumVideosForClear(projectedGroups(undefined, [A, B, C], 12));

    expect([without, withHistory]).toEqual([7, 8]);
  });

  it('adds the account groups that already have 5 compared videos, the no-prompt group included', () => {
    const existing = account([prompt(C, 'no_signal'), prompt(null, 'indicative'), prompt(B, 'insufficient')]);
    expect(projectedGroups(existing, [A], 0)).toBe(3);
  });

  it('takes the no-prompt group from the account result, never twice', () => {
    const existing = account([prompt(C, 'no_signal'), prompt(null, 'no_signal')]);
    expect(projectedGroups(existing, [A], 40)).toBe(3);
  });

  it('counts a version that is both new and already tested once', () => {
    const existing = account([prompt(A, 'clear'), prompt(null, 'no_signal')]);
    expect(projectedGroups(existing, [A, B], 0)).toBe(3);
  });
});
