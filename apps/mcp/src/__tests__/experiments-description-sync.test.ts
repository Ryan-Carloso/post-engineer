import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const comparison = readFileSync(join(here, '..', '..', '..', 'web', 'lib', 'experiments', 'prompt-comparison.ts'), 'utf8');
const description = readFileSync(join(here, '..', 'intent-content.ts'), 'utf8');
const readme = readFileSync(join(here, '..', '..', 'README.md'), 'utf8');

function recommendedVideos(): number {
  const match = /export const RECOMMENDED_VIDEOS_PER_PROMPT = (\d+);/.exec(comparison);
  if (match === null) throw new Error('RECOMMENDED_VIDEOS_PER_PROMPT not found in prompt-comparison.ts');
  return Number(match[1]);
}

function minComparedVideos(): number {
  const match = /export const MIN_COMPARED_VIDEOS = (\d+);/.exec(comparison);
  if (match === null) throw new Error('MIN_COMPARED_VIDEOS not found in prompt-comparison.ts');
  return Number(match[1]);
}

describe('experiments description sync with the prompt comparison', () => {
  it('names the same minimum video count the comparison labels with', () => {
    const min = minComparedVideos();
    expect(description).toContain(`insufficient (fewer than ${min} videos)`);
    expect(description).toContain(`groups of the account with at least ${min} videos`);
    expect(readme).toContain(`${min} only lift a prompt out of insufficient`);
  });

  it('recommends the same videos per prompt the comparison recommends', () => {
    const recommended = recommendedVideos();
    expect(description).toContain(`make at least ${recommended} videos per prompt`);
    expect(readme).toContain(`at least ${recommended} videos each`);
  });

  it('tells the agent the thresholds are corrected for the number of prompts while the comparison divides them', () => {
    expect(comparison).toContain('pValue < CLEAR_P_VALUE / comparisons');
    expect(comparison).toContain('pValue < INDICATIVE_P_VALUE / comparisons');
    expect(description).toContain('corrected for the number of prompts compared');
    expect(description).toContain('rotate them round-robin on the same account, swap their posting times');
    expect(description).not.toContain('To test two prompts fairly');
    expect(readme).toContain('corrected for the number of prompts compared');
  });
});
