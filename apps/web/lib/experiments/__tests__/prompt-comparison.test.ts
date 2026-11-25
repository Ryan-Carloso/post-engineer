import { describe, expect, it } from 'vitest';
import {
  CLEAR_P_VALUE,
  INDICATIVE_P_VALUE,
  MIN_COMPARED_VIDEOS,
  RECOMMENDED_VIDEOS_PER_PROMPT,
  comparePrompts,
  comparisonLabel,
  median,
  signTestPValue,
  unversionedAccounts,
  type ComparedVideo,
  type PromptVersionFacts,
} from '../prompt-comparison';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const D = '44444444-4444-4444-8444-444444444444';
const E = '55555555-5555-4555-8555-555555555555';

const VERSIONS: PromptVersionFacts[] = [
  { versionId: A, slug: 'calm-hook', title: 'Calm hook', version: 2, source: 'user' },
  { versionId: B, slug: 'story-first-reels', title: 'Story first', version: 1, source: 'official' },
];

function videos(promptVersionId: string | null, views: number[], accountId = 'yt-1', provider = 'youtube'): ComparedVideo[] {
  return views.map((count) => ({ provider, accountId, views: count, promptVersionId }));
}

describe('median', () => {
  it('takes the middle value, the mean of the two middle values, or null for no values', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe('signTestPValue', () => {
  it('is 1 with no decisive videos and halves with each unanimous video', () => {
    expect(signTestPValue(0, 0)).toBe(1);
    expect(signTestPValue(5, 0)).toBe(0.0625);
    expect(signTestPValue(6, 0)).toBe(0.03125);
    expect(signTestPValue(3, 3)).toBe(1);
  });
});

describe('comparePrompts', () => {
  it('groups by account and never mixes two accounts', () => {
    const accounts = comparePrompts(
      [...videos(A, [100, 200], 'yt-1'), ...videos(A, [5000], 'yt-2'), ...videos(B, [10], 'ig-1', 'instagram')],
      VERSIONS,
    );
    expect(accounts.map((account) => `${account.provider}:${account.accountId}:${account.videos}`)).toEqual([
      'youtube:yt-1:2',
      'instagram:ig-1:1',
      'youtube:yt-2:1',
    ]);
  });

  it('measures each video against the median of the other videos of its account', () => {
    const [account] = comparePrompts([...videos(A, [300]), ...videos(B, [100, 100])], VERSIONS);
    const prompt = account?.prompts.find((entry) => entry.versionId === A);
    expect(account?.baselineViews).toBe(100);
    expect(prompt?.lift).toBe(3);
    expect(prompt?.direction).toBe('above');
    expect(prompt?.medianViews).toBe(300);
  });

  it('names each version with its slug, title, number and source', () => {
    const [account] = comparePrompts([...videos(A, [1, 2]), ...videos(B, [3])], VERSIONS);
    expect(account?.prompts.map((entry) => [entry.slug, entry.title, entry.version, entry.source])).toEqual([
      ['calm-hook', 'Calm hook', 2, 'user'],
      ['story-first-reels', 'Story first', 1, 'official'],
    ]);
  });

  it('labels fewer than the minimum compared videos as insufficient, whatever the lift', () => {
    const few = MIN_COMPARED_VIDEOS - 1;
    const [account] = comparePrompts([...videos(A, Array(few).fill(1000)), ...videos(null, [10, 10, 10, 10, 10])], VERSIONS);
    const prompt = account?.prompts.find((entry) => entry.versionId === A);
    expect(prompt?.videos).toBe(few);
    expect(prompt?.label).toBe('insufficient');
  });

  it('labels a unanimous lead over six videos clear, five indicative, and a split no_signal when it is the only tested group', () => {
    const control = [...videos(B, [10, 10, 10, 10]), ...videos(null, [10, 10, 10, 10])];
    const six = comparePrompts([...videos(A, [100, 100, 100, 100, 100, 100]), ...control], VERSIONS)[0]?.prompts[0];
    const five = comparePrompts([...videos(A, [100, 100, 100, 100, 100]), ...control], VERSIONS)[0]?.prompts[0];
    const split = comparePrompts([...videos(A, [1, 1, 1, 100, 100, 100]), ...control], VERSIONS)[0]?.prompts[0];
    expect(six?.pValue).toBe(0.03125);
    expect(six?.label).toBe('clear');
    expect(five?.pValue).toBe(0.0625);
    expect(five?.label).toBe('indicative');
    expect(split?.label).toBe('no_signal');
  });

  it('marks a clear trailing prompt as below the account', () => {
    const [account] = comparePrompts([...videos(A, [1, 1, 1, 1, 1, 1, 1]), ...videos(null, [100, 100, 100, 100, 100, 100, 100])], VERSIONS);
    const prompt = account?.prompts.find((entry) => entry.versionId === A);
    expect(prompt?.label).toBe('clear');
    expect(prompt?.direction).toBe('below');
  });

  it('keeps the no-prompt group last and skips accounts with no prompt video at all', () => {
    const accounts = comparePrompts([...videos(null, [5, 6, 7]), ...videos(A, [8]), ...videos(null, [1, 2], 'yt-2')], VERSIONS);
    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.prompts.map((entry) => entry.versionId)).toEqual([A, null]);
    expect(accounts[0]?.prompts[1]).toMatchObject({ slug: null, title: null, version: null, source: null, videos: 3 });
  });

  it('gives no lift when the other videos of the account have no views or there is no other video', () => {
    const zero = comparePrompts([...videos(A, [50]), ...videos(B, [0])], VERSIONS)[0]?.prompts.find((entry) => entry.versionId === A);
    const alone = comparePrompts(videos(A, [50]), VERSIONS)[0]?.prompts[0];
    expect(zero).toMatchObject({ lift: null, pValue: null, label: 'insufficient', direction: null });
    expect(alone).toMatchObject({ lift: null, label: 'insufficient', medianViews: 50 });
  });

  it('leaves the facts null for a version the read did not return', () => {
    const [account] = comparePrompts(videos('33333333-3333-4333-8333-333333333333', [1, 2]), VERSIONS);
    expect(account?.prompts[0]).toMatchObject({ slug: null, title: null, version: null, source: null });
  });

  it('downgrades a lead that is clear for one prompt once five prompts are compared on the account', () => {
    const lead = videos(A, [100, 100, 100, 100, 100, 100, 100]);
    const alone = comparePrompts([...lead, ...videos(B, [10, 10, 10, 10]), ...videos(C, [10, 10, 10, 10])], VERSIONS)[0];
    const five = comparePrompts(
      [...lead, ...videos(B, [10, 10, 10, 10, 10]), ...videos(C, [10, 10, 10, 10, 10]), ...videos(D, [10, 10, 10, 10, 10]), ...videos(E, [10, 10, 10, 10, 10])],
      VERSIONS,
    )[0];
    const aloneLead = alone?.prompts.find((entry) => entry.versionId === A);
    const fiveLead = five?.prompts.find((entry) => entry.versionId === A);
    expect(aloneLead?.pValue).toBe(0.015625);
    expect(aloneLead?.label).toBe('clear');
    expect(fiveLead?.pValue).toBe(0.015625);
    expect(fiveLead?.pValue).toBeLessThan(CLEAR_P_VALUE);
    expect(fiveLead?.pValue).toBeGreaterThan(CLEAR_P_VALUE / 5);
    expect(fiveLead?.label).toBe('indicative');
    expect(five?.prompts.filter((entry) => entry.versionId !== A).every((entry) => entry.label === 'no_signal')).toBe(true);
  });

  it('counts the no-prompt group as a comparison once it has enough videos to be labeled', () => {
    const lead = videos(A, [100, 100, 100, 100, 100, 100]);
    const tested = comparePrompts([...lead, ...videos(null, [10, 10, 10, 10, 10, 10])], VERSIONS)[0];
    const untested = comparePrompts([...lead, ...videos(B, [10, 10, 10, 10]), ...videos(null, [10, 10, 10, 10])], VERSIONS)[0];
    expect(tested?.prompts.map((entry) => [entry.versionId, entry.pValue, entry.label])).toEqual([
      [A, 0.03125, 'indicative'],
      [null, 0.03125, 'indicative'],
    ]);
    expect(untested?.prompts.find((entry) => entry.versionId === null)?.label).toBe('insufficient');
    expect(untested?.prompts.find((entry) => entry.versionId === A)?.label).toBe('clear');
  });

  it('leaves a prompt with fewer than the minimum videos out of the comparison count', () => {
    const lead = videos(A, [100, 100, 100, 100, 100, 100]);
    const withSmallGroup = comparePrompts([...lead, ...videos(B, [10, 10, 10, 10]), ...videos(C, [10, 10, 10, 10])], VERSIONS)[0];
    const withTestedGroup = comparePrompts([...lead, ...videos(B, [10, 10, 10, 10, 10]), ...videos(C, [10, 10, 10])], VERSIONS)[0];
    expect(withSmallGroup?.prompts.find((entry) => entry.versionId === A)?.label).toBe('clear');
    expect(withTestedGroup?.prompts.find((entry) => entry.versionId === B)?.label).not.toBe('insufficient');
    expect(withTestedGroup?.prompts.find((entry) => entry.versionId === A)?.label).toBe('indicative');
  });

  it('gives no direction when the median lift is exactly 1', () => {
    const [account] = comparePrompts([...videos(A, [10]), ...videos(B, [10])], VERSIONS);
    expect(account?.prompts.every((entry) => entry.lift === 1 && entry.direction === null)).toBe(true);
  });
});

describe('unversionedAccounts', () => {
  it('lists the accounts with no prompt-versioned video, which comparePrompts leaves out', () => {
    const all = [...videos(null, [100, 200, 300, 400, 500, 600], 'yt-1'), ...videos(A, [10, 20], 'yt-2'), ...videos(null, [5], 'yt-2')];

    expect(comparePrompts(all, VERSIONS).map((account) => account.accountId)).toEqual(['yt-2']);
    expect(unversionedAccounts(all)).toEqual([{ provider: 'youtube', accountId: 'yt-1', comparedVideos: 6 }]);
  });

  it('counts only the videos that have a lift, the way the no-prompt group is counted', () => {
    expect(unversionedAccounts(videos(null, [0, 0, 0, 0, 0, 0]))).toEqual([{ provider: 'youtube', accountId: 'yt-1', comparedVideos: 0 }]);
    expect(unversionedAccounts(videos(null, [7]))).toEqual([{ provider: 'youtube', accountId: 'yt-1', comparedVideos: 0 }]);
  });

  it('keeps two accounts of different providers apart', () => {
    const all = [...videos(null, [1, 2, 3], 'same-id', 'youtube'), ...videos(null, [1, 2], 'same-id', 'instagram')];

    expect(unversionedAccounts(all).map((account) => [account.provider, account.comparedVideos])).toEqual([
      ['youtube', 3],
      ['instagram', 2],
    ]);
  });
});

describe('comparisonLabel', () => {
  it('divides both thresholds by the number of tested groups and compares strictly', () => {
    expect(comparisonLabel(MIN_COMPARED_VIDEOS, CLEAR_P_VALUE / 2 - 0.0001, 2)).toBe('clear');
    expect(comparisonLabel(MIN_COMPARED_VIDEOS, CLEAR_P_VALUE / 2, 2)).toBe('indicative');
    expect(comparisonLabel(MIN_COMPARED_VIDEOS, INDICATIVE_P_VALUE / 2 - 0.0001, 2)).toBe('indicative');
    expect(comparisonLabel(MIN_COMPARED_VIDEOS, INDICATIVE_P_VALUE / 2, 2)).toBe('no_signal');
    expect(comparisonLabel(MIN_COMPARED_VIDEOS, CLEAR_P_VALUE / 5, 5)).toBe('indicative');
    expect(comparisonLabel(MIN_COMPARED_VIDEOS, INDICATIVE_P_VALUE / 5, 5)).toBe('no_signal');
  });

  it('keeps the raw thresholds for one tested group and treats zero tested groups as one', () => {
    for (const tested of [0, 1]) {
      expect(comparisonLabel(MIN_COMPARED_VIDEOS, CLEAR_P_VALUE - 0.0001, tested)).toBe('clear');
      expect(comparisonLabel(MIN_COMPARED_VIDEOS, CLEAR_P_VALUE, tested)).toBe('indicative');
      expect(comparisonLabel(MIN_COMPARED_VIDEOS, INDICATIVE_P_VALUE, tested)).toBe('no_signal');
    }
  });

  it('labels fewer than the minimum compared videos insufficient before looking at the p-value', () => {
    expect(comparisonLabel(MIN_COMPARED_VIDEOS - 1, 0, 1)).toBe('insufficient');
  });
});

describe('RECOMMENDED_VIDEOS_PER_PROMPT', () => {
  const FIVE_PROMPTS = 5;

  it('lets a unanimous lead read clear when five prompts are compared', () => {
    const pValue = signTestPValue(RECOMMENDED_VIDEOS_PER_PROMPT, 0);
    expect(comparisonLabel(RECOMMENDED_VIDEOS_PER_PROMPT, pValue, FIVE_PROMPTS)).toBe('clear');
  });

  it('is needed because the minimum count can never read clear, even unanimous and alone', () => {
    const pValue = signTestPValue(MIN_COMPARED_VIDEOS, 0);
    expect(comparisonLabel(MIN_COMPARED_VIDEOS, pValue, 1)).not.toBe('clear');
    expect(RECOMMENDED_VIDEOS_PER_PROMPT).toBeGreaterThan(MIN_COMPARED_VIDEOS);
  });
});
