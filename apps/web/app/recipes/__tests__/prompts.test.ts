import { describe, it, expect } from 'vitest';
import { PROMPTS, getPrompt } from '../prompts';
import { SHARED_PROMPT_BASE } from '@/lib/generation/prompt-base';

describe('prompts hub data', () => {
  it('has one data entry per prompt, and adding a prompt is adding one entry', () => {
    expect(PROMPTS.map((prompt) => prompt.slug)).toEqual([
      'daily-news',
      'place-spotlight',
      'subject-spotlight',
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

  it('adds place-spotlight, ordered after daily-news with the globe icon and recipe kind', () => {
    const placeSpotlight = getPrompt('place-spotlight');
    if (placeSpotlight === undefined) {
      throw new Error('place-spotlight prompt entry is missing');
    }
    expect(placeSpotlight.icon).toBe('globe');
    expect(placeSpotlight.kindKey).toBe('recipes.kindRecipe');
    expect(placeSpotlight.objectiveKey).toBe('recipes.placeSpotlightObjective');
    expect(placeSpotlight.stepKeys).toEqual([
      'recipes.placeSpotlightStep1',
      'recipes.placeSpotlightStep2',
      'recipes.placeSpotlightStep3',
      'recipes.placeSpotlightStep4',
      'recipes.placeSpotlightStep5',
    ]);
    expect(placeSpotlight.deliverKeys).toEqual([
      'recipes.placeSpotlightDeliver1',
      'recipes.placeSpotlightDeliver2',
      'recipes.placeSpotlightDeliver3',
    ]);
    expect(placeSpotlight.exampleInputKey).toBe('recipes.placeSpotlightExampleInput');
    expect(placeSpotlight.exampleOutputKey).toBe('recipes.placeSpotlightExampleOutput');
    expect(placeSpotlight.docHref).toEqual(
      'https://github.com/Ryan-Carloso/post-engineer/blob/main/docs/recipes/place-spotlight.md',
    );
  });

  it('orders the place-spotlight flow: place, facts search, photos with checks and cards, validate, generate', () => {
    // The composed prompt starts with the shared base, which already
    // mentions validate_script and the 3h-30d window; the flow order
    // below is checked on the specific part only, after stripping that
    // base prefix.
    const fullText = getPrompt('place-spotlight')?.prompt ?? '';
    const baseText = SHARED_PROMPT_BASE.join('\n');
    expect(fullText.startsWith(baseText)).toBe(true);
    const text = fullText.slice(baseText.length + 2);
    const positions = [
      'Ask me which place',
      'Search the place once',
      'image search',
      'check_media',
      'upload_media',
      'media overlay',
      'validate_script',
      'score_draft',
      'get_video_task_progress',
      'get_video_status',
    ].map((needle) => text.indexOf(needle));
    expect(positions.every((i) => i >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(text).toContain('one generate_persona_video call');
    expect(text).toContain('only on ok');
    expect(text).toContain('at most 6 photos');
    expect(text).toContain('60 characters');
    expect(text).toContain('80');
    expect(text).toContain('30');
    expect(text).toContain('Never send a fake User-Agent or');
    expect(text).toContain('never attach a photo of a different');
    expect(text).toContain('lives one hour');
  });

  it('adds subject-spotlight, ordered after place-spotlight with the globe icon and recipe kind', () => {
    const subjectSpotlight = getPrompt('subject-spotlight');
    if (subjectSpotlight === undefined) {
      throw new Error('subject-spotlight prompt entry is missing');
    }
    expect(subjectSpotlight.icon).toBe('globe');
    expect(subjectSpotlight.kindKey).toBe('recipes.kindRecipe');
    expect(subjectSpotlight.objectiveKey).toBe('recipes.subjectSpotlightObjective');
    expect(subjectSpotlight.stepKeys).toEqual([
      'recipes.subjectSpotlightStep1',
      'recipes.subjectSpotlightStep2',
      'recipes.subjectSpotlightStep3',
      'recipes.subjectSpotlightStep4',
      'recipes.subjectSpotlightStep5',
    ]);
    expect(subjectSpotlight.deliverKeys).toEqual([
      'recipes.subjectSpotlightDeliver1',
      'recipes.subjectSpotlightDeliver2',
      'recipes.subjectSpotlightDeliver3',
    ]);
    expect(subjectSpotlight.exampleInputKey).toBe('recipes.subjectSpotlightExampleInput');
    expect(subjectSpotlight.exampleOutputKey).toBe('recipes.subjectSpotlightExampleOutput');
    expect(subjectSpotlight.docHref).toEqual(
      'https://github.com/Ryan-Carloso/post-engineer/blob/main/docs/recipes/subject-spotlight.md',
    );
  });

  it('orders the subject-spotlight flow: subject, identity and price, exact photos, validate, generate', () => {
    const fullText = getPrompt('subject-spotlight')?.prompt ?? '';
    const baseText = SHARED_PROMPT_BASE.join('\n');
    expect(fullText.startsWith(baseText)).toBe(true);
    const text = fullText.slice(baseText.length + 2);
    const positions = [
      'Ask me what the subject is',
      'Pin the identity first',
      'image search',
      'check_media',
      'upload_media',
      'media overlay',
      'validate_script',
      'score_draft',
      'get_video_task_progress',
      'get_video_status',
    ].map((needle) => text.indexOf(needle));
    expect(positions.every((i) => i >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(text).toContain('generate_persona_video call');
    expect(text).toContain('model, trim, and year');
    expect(text).toContain('currency, market, and date');
    expect(text).toContain('a price without a source is a');
    expect(text).toContain('never a different generation, a render, or a rebadged');
    expect(text).toContain('only on ok');
    expect(text).toContain('at most 6 photos');
    expect(text).toContain('60 characters');
    expect(text).toContain('drop the badge: a');
    expect(text).toContain('Never send a fake User-Agent or');
    expect(text).toContain('never attach a photo of a different');
    expect(text).toContain('lives one hour');
  });

  it('adds full-setup as the last recipe entry with the compose icon', () => {
    expect(PROMPTS.map((prompt) => prompt.slug)).toEqual([
      'daily-news',
      'place-spotlight',
      'subject-spotlight',
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
    expect(text).toContain('Bluesky is optional');
    expect(text).not.toContain('issue #');
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
