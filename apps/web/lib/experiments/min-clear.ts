import { CLEAR_P_VALUE, signTestPValue, type AccountResult } from './prompt-comparison';

export function minimumVideosForClear(groups: number): number {
  if (!Number.isInteger(groups) || groups < 1) {
    throw new RangeError('groups must be a positive integer.');
  }
  const threshold = CLEAR_P_VALUE / groups;
  let videos = 1;
  while (signTestPValue(videos, 0) >= threshold) videos += 1;
  return videos;
}

const NO_PROMPT_KEY = '';

export function projectedGroups(account: AccountResult | undefined, newVersionIds: string[]): number {
  const keys = new Set<string>(newVersionIds);
  for (const prompt of account?.prompts ?? []) {
    if (prompt.label !== 'insufficient') keys.add(prompt.versionId ?? NO_PROMPT_KEY);
  }
  return keys.size;
}
