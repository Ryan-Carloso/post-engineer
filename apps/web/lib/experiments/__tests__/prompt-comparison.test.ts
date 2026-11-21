import { describe, expect, it } from 'vitest';
import {
  CLEAR_P_VALUE,
  INDICATIVE_P_VALUE,
  MIN_COMPARED_VIDEOS,
  comparePrompts,
  median,
  signTestPValue,
  type ComparedVideo,
  type PromptVersionFacts,
} from '../prompt-comparison';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

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

  it('labels a unanimous lead over six videos clear, five indicative, and a split no_signal', () => {
    const control = videos(null, [10, 10, 10, 10, 10, 10]);
    const six = comparePrompts([...videos(A, [100, 100, 100, 100, 100, 100]), ...control], VERSIONS)[0]?.prompts[0];
    const five = comparePrompts([...videos(A, [100, 100, 100, 100, 100]), ...control], VERSIONS)[0]?.prompts[0];
    const split = comparePrompts([...videos(A, [1, 1, 1, 100, 100, 100]), ...control], VERSIONS)[0]?.prompts[0];
    expect(six?.pValue).toBeLessThan(CLEAR_P_VALUE);
    expect(six?.label).toBe('clear');
    expect(five?.pValue).toBeLessThan(INDICATIVE_P_VALUE);
    expect(five?.label).toBe('indicative');
    expect(split?.label).toBe('no_signal');
  });

  it('marks a clear trailing prompt as below the account', () => {
    const [account] = comparePrompts([...videos(A, [1, 1, 1, 1, 1, 1]), ...videos(null, [100, 100, 100, 100, 100, 100])], VERSIONS);
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

  it('gives no direction when the median lift is exactly 1', () => {
    const [account] = comparePrompts([...videos(A, [10]), ...videos(B, [10])], VERSIONS);
    expect(account?.prompts.every((entry) => entry.lift === 1 && entry.direction === null)).toBe(true);
  });
});
