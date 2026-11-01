import { describe, it, expect } from 'vitest';
import { PROMPTS, getPrompt } from '../prompts';
import { SHARED_PROMPT_BASE } from '../../../../../shared/prompt-base/prompt-base';

describe('prompts hub data', () => {
  it('has one data entry per prompt, and adding a prompt is adding one entry', () => {
    expect(PROMPTS.map((prompt) => prompt.slug)).toEqual([
      'daily-news',
      'github-prs',
      'full-setup',
    ]);
    for (const prompt of PROMPTS) {
      expect(prompt.titleKey).toMatch(/^recipes\./);
      expect(prompt.objectiveKey).toMatch(/^recipes\./);
      expect(prompt.kindKey).toMatch(/^recipes\./);
      expect(prompt.stepKeys).toHaveLength(5);
      expect(prompt.deliverKeys).toHaveLength(3);
      expect(prompt.exampleInputKey).toMatch(/^recipes\./);
      expect(prompt.exampleOutputKey).toMatch(/^recipes\./);
      expect(prompt.docHref).toContain('docs/recipes/');
      expect(prompt.prompt.length).toBeGreaterThan(200);
    }
  });

  it('resolves a prompt by slug and returns undefined for an unknown slug', () => {
    expect(getPrompt('daily-news')?.slug).toBe('daily-news');
    expect(getPrompt('github-prs')?.slug).toBe('github-prs');
    expect(getPrompt('full-setup')?.slug).toBe('full-setup');
    expect(getPrompt('no-such-prompt')).toBeUndefined();
  });

  it('adds full-setup as the third recipe entry with the compose icon', () => {
    expect(PROMPTS.map((prompt) => prompt.slug)).toEqual([
      'daily-news',
      'github-prs',
      'full-setup',
    ]);
    const fullSetup = getPrompt('full-setup');
    if (fullSetup === undefined) {
      throw new Error('full-setup prompt entry is missing');
    }
    expect(fullSetup.kindKey).toBe('recipes.kindRecipe');
    expect(fullSetup.objectiveKey).toBe('recipes.fullSetupObjective');
    expect(fullSetup.stepKeys).toEqual([
      'recipes.fullSetupStep1',
      'recipes.fullSetupStep2',
      'recipes.fullSetupStep3',
      'recipes.fullSetupStep4',
      'recipes.fullSetupStep5',
    ]);
    expect(fullSetup.deliverKeys).toEqual([
      'recipes.fullSetupDeliver1',
      'recipes.fullSetupDeliver2',
      'recipes.fullSetupDeliver3',
    ]);
    expect(fullSetup.exampleInputKey).toBe('recipes.fullSetupExampleInput');
    expect(fullSetup.exampleOutputKey).toBe('recipes.fullSetupExampleOutput');
    expect(fullSetup.docHref).toEqual(
      'https://github.com/Ryan-Carloso/post-engineer/blob/main/docs/recipes/full-setup.md',
    );
  });

  it('orders the full-setup flow: accounts, app password, persona, balance/validate, confirm publish, generate', () => {
    // The composed prompt starts with the shared base, which already
    // mentions validate_script and the 3h-30d window; the flow order
    // below is checked on the specific part only, after stripping that
    // base prefix. The 3h-30d window itself lives in the base.
    const fullText = getPrompt('full-setup')?.prompt ?? '';
    const baseText = SHARED_PROMPT_BASE.join('\n');
    expect(fullText.startsWith(baseText)).toBe(true);
    const text = fullText.slice(baseText.length + 2);
    const positions = [
      'list_social_accounts',
      'connect_account',
      'never repeat, print, or log it',
      'list_faces',
      'list_voices',
      'create_persona',
      'avatarUrl',
      'voiceId',
      'language "en-US"',
      'personaId',
      'get_token_balance',
      'validate_script',
      'confirm the providers/accounts and the mode (scheduled|asap)',
      'generate_persona_video',
      'confirmed title',
      'account IDs',
      'get_video_task_progress',
      'get_video_status',
    ].map((needle) => text.indexOf(needle));
    expect(positions.every((i) => i >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(text).toContain('never the main password');
    expect(text).toContain('issue #327');
  });

  it('bakes the segments contract into every prompt text', () => {
    for (const prompt of PROMPTS) {
      expect(prompt.prompt).toContain('validate_script');
      expect(prompt.prompt).toContain('generate_persona_video');
      expect(prompt.prompt).toContain('60–200 words');
      expect(prompt.prompt).toContain('hook');
      expect(prompt.prompt).toContain('CTA');
    }
  });

  it('starts every prompt with the shared base and carries humanizer + anti-slop in all of them', () => {
    const baseText = SHARED_PROMPT_BASE.join('\n');
    expect(baseText).toContain('No em dashes');
    expect(baseText).toContain('never invent it');
    expect(baseText).toContain('make me want the next sentence');
    expect(baseText).toContain('another creator');
    expect(baseText).toContain('one specific action');
    expect(baseText).toContain('score_draft with kind "script"');
    expect(baseText).toContain('no recurring schedule');
    expect(baseText).not.toContain('[');
    expect(baseText).toContain('3h-30d ahead');
    expect(baseText).toContain('mode "asap"');
    for (const prompt of PROMPTS) {
      expect(prompt.prompt.startsWith(baseText)).toBe(true);
      expect(prompt.prompt).toContain('Write like a human');
      expect(prompt.prompt).toContain('No em dashes');
      expect(prompt.prompt).not.toMatch(/\[[A-Z_]+\]/);
    }
  });

  it('pins the exact entry fields for daily-news and github-prs', () => {
    const dailyNews = getPrompt('daily-news');
    const githubPrs = getPrompt('github-prs');
    if (dailyNews === undefined || githubPrs === undefined) {
      throw new Error('daily-news or github-prs prompt entry is missing');
    }
    expect(dailyNews.icon).toBe('globe');
    expect(dailyNews.stepKeys).toEqual([
      'recipes.dailyNewsStep1',
      'recipes.dailyNewsStep2',
      'recipes.dailyNewsStep3',
      'recipes.dailyNewsStep4',
      'recipes.dailyNewsStep5',
    ]);
    expect(dailyNews.deliverKeys).toEqual([
      'recipes.dailyNewsDeliver1',
      'recipes.dailyNewsDeliver2',
      'recipes.dailyNewsDeliver3',
    ]);
    expect(dailyNews.docHref).toBe(
      'https://github.com/Ryan-Carloso/post-engineer/blob/main/docs/recipes/daily-news.md',
    );
    expect(githubPrs.icon).toBe('compose');
    expect(githubPrs.stepKeys).toEqual([
      'recipes.githubPrsStep1',
      'recipes.githubPrsStep2',
      'recipes.githubPrsStep3',
      'recipes.githubPrsStep4',
      'recipes.githubPrsStep5',
    ]);
    expect(githubPrs.deliverKeys).toEqual([
      'recipes.githubPrsDeliver1',
      'recipes.githubPrsDeliver2',
      'recipes.githubPrsDeliver3',
    ]);
    expect(githubPrs.docHref).toBe(
      'https://github.com/Ryan-Carloso/post-engineer/blob/main/docs/recipes/github-prs.md',
    );
  });
});
