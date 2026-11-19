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
      'last-30-days',
      'multi-rede',
      'viral-shorts',
      'full-setup',
      'ab-hook-test',
      'story-first-reels',
    ]);
    for (const prompt of PROMPTS) {
      expect(prompt.titleKey).toMatch(/^recipes\./);
      expect(prompt.objectiveKey).toMatch(/^recipes\./);
      expect(prompt.kindKey).toMatch(/^recipes\./);
      // Story-first carries two extra steps: one archetype carries
      // the value (step 3) and mixed media with one consistent
      // persona (step 6); every other prompt has the uniform 5 steps.
      const expectedStepCount = prompt.slug === 'story-first-reels' ? 7 : 5;
      expect(prompt.stepKeys).toHaveLength(expectedStepCount);
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
    // mentions check_script (action: validate) and the 3h-30d window; the flow order
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
      'media (action: check)',
      'media (action: upload)',
      'media overlay',
      'check_script (action: validate)',
      'check_script (action: score)',
      'video_tasks (action: status)',
      'video_tasks (action: status)',
    ].map((needle) => text.indexOf(needle));
    expect(positions.every((i) => i >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(text).toContain('one generate_video call');
    expect(text).toContain('only on ok');
    expect(text).toContain('Follow the density rule above; fewer, chosen well, beats every');
    expect(text).toContain('photo you found.');
    expect(text).toContain('60 characters');
    expect(text).toContain('80');
    expect(text).toContain('30');
    expect(text).toContain('Never send a fake User-Agent or');
    expect(text).toContain('never attach a photo of a different');
    // The sentence spans two source lines: assert it whole (whitespace
    // flattened), so dropping the "Referer to bypass a block," line fails.
    const flatText = text
      .split('\n')
      .map((line) => line.trim())
      .join(' ');
    expect(flatText).toContain(
      'Never send a fake User-Agent or Referer to bypass a block, and never attach a photo of a different place.',
    );
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
      'media (action: check)',
      'media (action: upload)',
      'media overlay',
      'check_script (action: validate)',
      'check_script (action: score)',
      'video_tasks (action: status)',
      'video_tasks (action: status)',
    ].map((needle) => text.indexOf(needle));
    expect(positions.every((i) => i >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(text).toContain('generate_video call');
    expect(text).toContain('model, trim, and year');
    expect(text).toContain('currency, market, and date');
    expect(text).toContain('a price without a source is a');
    expect(text).toContain('never a different generation, a render, or a rebadged');
    expect(text).toContain('only on ok');
    expect(text).toContain('Follow the density rule above;');
    expect(text).toContain('fewer, chosen well, beats every photo you found.');
    expect(text).toContain('60 characters');
    expect(text).toContain('drop the badge: a');
    expect(text).toContain('Never send a fake User-Agent or');
    expect(text).toContain('never attach a photo of a different');
    // The sentence spans two source lines: assert it whole (whitespace
    // flattened), so dropping the "Referer to bypass a block," line fails.
    const flatText = text
      .split('\n')
      .map((line) => line.trim())
      .join(' ');
    expect(flatText).toContain(
      'Never send a fake User-Agent or Referer to bypass a block, and never attach a photo of a different subject.',
    );
    expect(text).toContain('lives one hour');
  });

  it('keeps full-setup with the compose icon and recipe kind', () => {
    expect(PROMPTS.map((prompt) => prompt.slug)).toEqual([
      'daily-news',
      'place-spotlight',
      'subject-spotlight',
      'github-prs',
      'last-30-days',
      'multi-rede',
      'viral-shorts',
      'full-setup',
      'ab-hook-test',
      'story-first-reels',
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

  it('orders the full-setup flow: accounts, app password, persona, tools config, balance/validate, confirm publish, generate', () => {
    // The composed prompt starts with the shared base, which already
    // mentions check_script (action: validate) and the 3h-30d window; the flow order
    // below is checked on the specific part only, after stripping that
    // base prefix. The 3h-30d window itself lives in the base.
    const fullText = getPrompt('full-setup')?.prompt ?? '';
    const baseText = SHARED_PROMPT_BASE.join('\n');
    expect(fullText.startsWith(baseText)).toBe(true);
    const text = fullText.slice(baseText.length + 2);
    const positions = [
      'accounts (action: list)',
      'accounts (action: connect)',
      'never repeat, print, or log it',
      'persona_media (action: list_faces)',
      'voices (action: list)',
      'personas (action: create)',
      'avatarUrl',
      'voiceId',
      'language "en-US"',
      'Remember the persona name',
      'Check the saved tool configuration first with tool_config',
      'Ask which licensed stock video sources I have keys for, in order',
      'Coverr, or none)',
      'if only one is',
      'configured, use it without asking which',
      'tool_config (action: save)',
      'Reuse those answers for later videos in this',
      'conversation',
      'uses images only',
      'YOUR_TAVILY_API_KEY',
      'YOUR_EXA_API_KEY',
      'YOUR_PEXELS_API_KEY',
      'YOUR_PIXABAY_API_KEY',
      'YOUR_COVERR_API_KEY',
      'never ask me to paste one in chat',
      'never use a source with no key',
      'If a source fails - timeout, no results, or',
      'error - use the next configured source',
      'try the best-matching',
      'source first and never stop at the first failure',
      'billing (action: balance)',
      'check_script (action: validate)',
      'confirm the providers/accounts and the mode (scheduled|asap)',
      'generate_video',
      'confirmed title',
      'each a name or id',
      'video_tasks (action: status)',
      'post URL',
    ].map((needle) => text.indexOf(needle));
    expect(positions.every((i) => i >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(text).toContain('never the main password');
    expect(text).toContain('Bluesky is optional');
    expect(text).toContain('Pexels');
    expect(text).toContain('Pixabay');
    expect(text).toContain('Coverr');
    expect(text).toContain('Reuse those answers for later videos in this');
    expect(text).toContain('a later session reuses them instead of asking again');
    // The search-tool ask lives in the base; step 4 must not repeat it,
    // so the composed prompt asks it exactly once.
    expect(fullText.split('Ask me once which search tool you already have').length - 1).toBe(1);
    expect(text).not.toContain('issue #');
  });

  it('saves the setup answers and reuses them in later conversations', () => {
    const fullText = getPrompt('full-setup')?.prompt ?? '';
    const baseText = SHARED_PROMPT_BASE.join('\n');
    expect(fullText.startsWith(baseText)).toBe(true);
    const text = fullText.slice(baseText.length + 2);
    expect(text).toContain('later videos in this conversation');
    expect(text).toContain('the first video in this setup follows the base and');
    expect(text).toContain('uses images only');
    expect(text).toContain('tool_config (action: save)');
    expect(text).toContain('are stored encrypted and are never shown back in full');
    expect(text).toContain('If a key is missing, tell');
    expect(text).toContain('me to set it and keep going with the sources that are configured');
    // This phrase really spans a line break.
    expect(text).toMatch(/never print them,\s+never paste them anywhere else, never log them/);
    expect(text).not.toContain('standing configuration for this account');
    expect(text).not.toContain('save the answers as the');
  });

  it('falls back to the next configured stock source when one fails', () => {
    const fullText = getPrompt('full-setup')?.prompt ?? '';
    const baseText = SHARED_PROMPT_BASE.join('\n');
    expect(fullText.startsWith(baseText)).toBe(true);
    const text = fullText.slice(baseText.length + 2);
    expect(text).toContain('Ask which licensed stock video sources I have keys for, in order');
    // The fallback phrase spans a line break, so pin it with a regex.
    expect(text).toMatch(/If a source fails - timeout, no results, or\s+error - use the next configured source/);
    expect(text).toContain('try the best-matching');
    expect(text).toContain('source first and never stop at the first failure');
    // Terminal case: if every configured source fails, nothing is left
    // to try — photos only.
    expect(text).toMatch(/If every configured\s+source fails, use photos only/);
    // Step 4 asks stock sources only; the search tool lives in the base.
    expect(text).not.toContain('which search tool');
  });

  it('says images is the only material and names the video types with the full-lip-sync media cap', () => {
    const baseText = SHARED_PROMPT_BASE.join('\n');
    expect(baseText).toContain('images is the only material');
    expect(baseText).toContain('no stock footage and no drawn material');
    expect(baseText).toContain('options.videoType on generate_video: full_lipsync');
    expect(baseText).toContain('media optional, at most 6 photos in total');
    expect(baseText).toContain('hook_lipsync (lip sync only on the hook');
    expect(baseText).toContain('faceless (only the agent\'s photos, no face');
    expect(baseText).toContain('one photo per idea in its segment');
    expect(baseText).toContain('while it is spoken');
    expect(baseText).toContain('each segment idea, not once for the whole topic');
    expect(baseText).toContain('Never repeat a photo; vary the angle and the detail');
    expect(baseText).toContain('strongest photo in the hook segment');
    const daily = (getPrompt('daily-news')?.prompt ?? '').slice(baseText.length);
    const github = (getPrompt('github-prs')?.prompt ?? '').slice(baseText.length);
    expect(daily).toContain('Follow the density rule above. Skip a failed photo,');
    expect(github).toContain('follow the density rule above for images, only if they');
    expect(github).toContain('match the PR (screenshots, diagrams, or repo visuals)');
    expect(github).toContain('generate with full lip sync and no media');
  });

  it('bakes the segments contract into every prompt text', () => {
    for (const prompt of PROMPTS) {
      expect(prompt.prompt).toContain('check_script (action: validate)');
      expect(prompt.prompt).toContain('generate_video');
      expect(prompt.prompt).toContain('60–200 words');
      expect(prompt.prompt).toContain('hook');
      expect(prompt.prompt).toContain('CTA');
    }
  });

  it('starts every prompt with the shared base and carries humanizer + anti-slop in all of them', () => {
    const baseText = SHARED_PROMPT_BASE.join('\n');
    expect(baseText).toContain('No em dashes');
    expect(baseText).toContain('Subtitles: never use "-"');
    expect(baseText).toContain('never invent it');
    expect(baseText).toContain('make me want the next sentence');
    expect(baseText).toContain('another creator');
    expect(baseText).toContain('one specific action');
    expect(baseText).toContain('check_script (action: score) with kind "script"');
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

  it('adds last-30-days, ordered after github-prs with the globe icon and recipe kind', () => {
    const last30Days = getPrompt('last-30-days');
    if (last30Days === undefined) {
      throw new Error('last-30-days prompt entry is missing');
    }
    expect(last30Days.icon).toBe('globe');
    expect(last30Days.kindKey).toBe('recipes.kindRecipe');
    expect(last30Days.objectiveKey).toBe('recipes.last30DaysObjective');
    expect(last30Days.stepKeys).toEqual([
      'recipes.last30DaysStep1',
      'recipes.last30DaysStep2',
      'recipes.last30DaysStep3',
      'recipes.last30DaysStep4',
      'recipes.last30DaysStep5',
    ]);
    expect(last30Days.deliverKeys).toEqual([
      'recipes.last30DaysDeliver1',
      'recipes.last30DaysDeliver2',
      'recipes.last30DaysDeliver3',
    ]);
    expect(last30Days.exampleInputKey).toBe('recipes.last30DaysExampleInput');
    expect(last30Days.exampleOutputKey).toBe('recipes.last30DaysExampleOutput');
    expect(last30Days.docHref).toEqual(
      'https://github.com/Ryan-Carloso/post-engineer/blob/main/docs/recipes/last-30-days.md',
    );
  });

  it('orders the last-30-days flow: niche, 30-day search, facts only, validate, score, generate', () => {
    const fullText = getPrompt('last-30-days')?.prompt ?? '';
    const baseText = SHARED_PROMPT_BASE.join('\n');
    expect(fullText.startsWith(baseText)).toBe(true);
    const text = fullText.slice(baseText.length + 2);
    const positions = [
      'last 30 days',
      'Ask me my niche',
      'Search the web with your own search tool',
      'at most 5 results',
      'single event',
      'ONLY facts from those results',
      'check_script (action: validate)',
      'check_script (action: score)',
      'generate_video',
      'video_tasks (action: status)',
      'video_tasks (action: status)',
    ].map((needle) => text.indexOf(needle));
    expect(positions.every((i) => i >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(text).toContain('never invent a replacement fact');
    expect(text).toContain('Skip round-ups, opinion pieces');
  });

  it('adds multi-rede, ordered after last-30-days with the globe icon and recipe kind', () => {
    const multiRede = getPrompt('multi-rede');
    if (multiRede === undefined) {
      throw new Error('multi-rede prompt entry is missing');
    }
    expect(multiRede.icon).toBe('globe');
    expect(multiRede.kindKey).toBe('recipes.kindRecipe');
    expect(multiRede.objectiveKey).toBe('recipes.multiRedeObjective');
    expect(multiRede.stepKeys).toEqual([
      'recipes.multiRedeStep1',
      'recipes.multiRedeStep2',
      'recipes.multiRedeStep3',
      'recipes.multiRedeStep4',
      'recipes.multiRedeStep5',
    ]);
    expect(multiRede.deliverKeys).toEqual([
      'recipes.multiRedeDeliver1',
      'recipes.multiRedeDeliver2',
      'recipes.multiRedeDeliver3',
    ]);
    expect(multiRede.exampleInputKey).toBe('recipes.multiRedeExampleInput');
    expect(multiRede.exampleOutputKey).toBe('recipes.multiRedeExampleOutput');
    expect(multiRede.docHref).toEqual(
      'https://github.com/Ryan-Carloso/post-engineer/blob/main/docs/recipes/multi-rede.md',
    );
  });

  it('orders the multi-rede flow: one video per network, per-network score, confirm the week, generate each', () => {
    const fullText = getPrompt('multi-rede')?.prompt ?? '';
    const baseText = SHARED_PROMPT_BASE.join('\n');
    expect(fullText.startsWith(baseText)).toBe(true);
    const text = fullText.slice(baseText.length + 2);
    const positions = [
      'one video per network',
      'Ask me the niche',
      'accounts (action: list)',
      'one topic for the week',
      '60–200 words',
      'check_script (action: validate)',
      'check_script (action: score)',
      'wait for my yes',
      'generate_video',
      'video_tasks (action: status)',
      'video_tasks (action: status)',
    ].map((needle) => text.indexOf(needle));
    expect(positions.every((i) => i >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(text).toContain('LinkedIn');
    expect(text).toContain('YouTube');
    expect(text).toContain('Instagram');
    expect(text).toContain('Bluesky');
    expect(text).toContain('four networks');
    expect(text).toContain('never bends the facts to gain points');
  });

  it('adds viral-shorts, ordered after multi-rede with the compose icon and prompt kind', () => {
    const viralShorts = getPrompt('viral-shorts');
    if (viralShorts === undefined) {
      throw new Error('viral-shorts prompt entry is missing');
    }
    expect(viralShorts.icon).toBe('compose');
    expect(viralShorts.kindKey).toBe('recipes.kindPrompt');
    expect(viralShorts.objectiveKey).toBe('recipes.viralShortsObjective');
    expect(viralShorts.stepKeys).toEqual([
      'recipes.viralShortsStep1',
      'recipes.viralShortsStep2',
      'recipes.viralShortsStep3',
      'recipes.viralShortsStep4',
      'recipes.viralShortsStep5',
    ]);
    expect(viralShorts.deliverKeys).toEqual([
      'recipes.viralShortsDeliver1',
      'recipes.viralShortsDeliver2',
      'recipes.viralShortsDeliver3',
    ]);
    expect(viralShorts.exampleInputKey).toBe('recipes.viralShortsExampleInput');
    expect(viralShorts.exampleOutputKey).toBe('recipes.viralShortsExampleOutput');
    expect(viralShorts.docHref).toEqual(
      'https://github.com/Ryan-Carloso/post-engineer/blob/main/docs/recipes/viral-shorts.md',
    );
  });

  it('orders the viral-shorts flow: niche, top 5 by views, study without downloading, fresh script, generate', () => {
    const fullText = getPrompt('viral-shorts')?.prompt ?? '';
    const baseText = SHARED_PROMPT_BASE.join('\n');
    expect(fullText.startsWith(baseText)).toBe(true);
    const text = fullText.slice(baseText.length + 2);
    const positions = [
      'Find a proven video',
      'Do not download its video file',
      'Ask me my niche',
      'most-viewed YouTube',
      'top 5',
      'Never invent a view count',
      'yt-dlp',
      '--skip-download',
      'Break down its structure',
      'Write MY script from MY content',
      'check_script (action: validate)',
      'check_script (action: score)',
      'generate_video',
      'video_tasks (action: status)',
    ].map((needle) => text.indexOf(needle));
    expect(positions.every((i) => i >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(text).toContain('never reuse its exact lines');
    expect(text).toContain('pip install');
    expect(text).not.toContain('issue #');
  });

  it('guards the viral-shorts breakdown: views are popularity, retention conclusions are hypotheses', () => {
    const fullText = getPrompt('viral-shorts')?.prompt ?? '';
    const text = fullText.slice(SHARED_PROMPT_BASE.join('\n').length + 2);
    // (a) view count is popularity, not retention, since views count at play start.
    expect(text).toContain('measures popularity, not retention');
    expect(text).toContain('since 2026-08-24');
    // (b) hook conclusions from public data are hypotheses, never measured causes.
    expect(text).toContain('HYPOTHESES, never measured causes');
    // (c) never compare Short and long-form view counts.
    expect(text).toContain("Never compare a Short's view count with a long-form video's view count");
    // (d) Stayed to watch is not a per-second curve.
    expect(text).toContain('never treat "Stayed to watch" as a per-second retention curve');
    // (e) every breakdown carries the missing-evidence fields.
    expect(text).toContain("retention_evidence: 'unavailable'");
    expect(text).toContain('source video URL');
    expect(text).toContain('fetch date (YYYY-MM-DD)');
    // Metadata + subtitles only, and an explicit refusal to fetch video bytes.
    expect(text).toContain('--write-subs --write-auto-subs --skip-download');
    expect(text).toContain('Never download the video bytes');
    expect(text).toContain('refuse');
    // The guard sits between the study step and the script, and the
    // missing-evidence block comes before validation.
    const order = [
      '--skip-download',
      'HYPOTHESES, never measured causes',
      "retention_evidence: 'unavailable'",
      'Write MY script from MY content',
      'check_script (action: validate)',
    ].map((needle) => text.indexOf(needle));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('adds ab-hook-test before story-first-reels and describes only the experiment actions that exist', () => {
    expect(PROMPTS.map((prompt) => prompt.slug).at(-2)).toBe('ab-hook-test');
    const entry = getPrompt('ab-hook-test');
    if (entry === undefined) {
      throw new Error('ab-hook-test prompt entry is missing');
    }
    expect(entry.icon).toBe('compose');
    expect(entry.kindKey).toBe('recipes.kindRecipe');
    expect(entry.titleKey).toBe('recipes.abHookTestTitle');
    expect(entry.objectiveKey).toBe('recipes.abHookTestObjective');
    expect(entry.stepKeys).toEqual([
      'recipes.abHookTestStep1',
      'recipes.abHookTestStep2',
      'recipes.abHookTestStep3',
      'recipes.abHookTestStep4',
      'recipes.abHookTestStep5',
    ]);
    expect(entry.deliverKeys).toEqual([
      'recipes.abHookTestDeliver1',
      'recipes.abHookTestDeliver2',
      'recipes.abHookTestDeliver3',
    ]);
    expect(entry.exampleInputKey).toBe('recipes.abHookTestExampleInput');
    expect(entry.exampleOutputKey).toBe('recipes.abHookTestExampleOutput');
    expect(entry.docHref).toEqual(
      'https://github.com/Ryan-Carloso/post-engineer/blob/main/docs/recipes/ab-hook-test.md',
    );
    const baseText = SHARED_PROMPT_BASE.join('\n');
    expect(entry.prompt.startsWith(baseText)).toBe(true);
    const text = entry.prompt.slice(baseText.length + 2);
    const positions = [
      'experiments (action: create)',
      'targetPairs 6',
      'experiments (action: add_pair)',
      'next free pair number',
      'experiments (action: list)',
      'experiments (action: results)',
    ].map((needle) => text.indexOf(needle));
    expect(positions.every((index) => index >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(text).toContain('no persona');
    expect(text).toContain('1 token per video');
    expect(text).toContain("options.videoType 'faceless'");
    expect(text).toContain('same voiceId');
    expect(text).toContain('smallest target that can ever be clear');
    expect(text).toContain('10-12');
    expect(text).toContain("each variant's style");
    expect(text).toContain('Only the hook differs inside a pair');
    expect(text).toContain('Wait for publication and metrics');
    expect(text).toContain('unless the label is clear');
    expect(text).toContain('never generate the variants by hand');
    expect(text).not.toContain('add_pairs');
    expect(text).not.toContain('attach');
    expect(text).not.toContain('nextStep');
    expect(text).not.toContain('CTA variable');
  });

  it('adds story-first-reels last with the compose icon and prompt kind', () => {
    expect(PROMPTS.map((prompt) => prompt.slug).at(-1)).toBe('story-first-reels');
    const entry = getPrompt('story-first-reels');
    if (entry === undefined) {
      throw new Error('story-first-reels prompt entry is missing');
    }
    expect(entry.icon).toBe('compose');
    expect(entry.kindKey).toBe('recipes.kindPrompt');
    expect(entry.titleKey).toBe('recipes.storyFirstReelsTitle');
    expect(entry.objectiveKey).toBe('recipes.storyFirstReelsObjective');
    expect(entry.stepKeys).toEqual([
      'recipes.storyFirstReelsStep1',
      'recipes.storyFirstReelsStep2',
      'recipes.storyFirstReelsStep3',
      'recipes.storyFirstReelsStep4',
      'recipes.storyFirstReelsStep5',
      'recipes.storyFirstReelsStep6',
      'recipes.storyFirstReelsStep7',
    ]);
    expect(entry.deliverKeys).toEqual([
      'recipes.storyFirstReelsDeliver1',
      'recipes.storyFirstReelsDeliver2',
      'recipes.storyFirstReelsDeliver3',
    ]);
    expect(entry.exampleInputKey).toBe('recipes.storyFirstReelsExampleInput');
    expect(entry.exampleOutputKey).toBe('recipes.storyFirstReelsExampleOutput');
    expect(entry.docHref).toEqual(
      'https://github.com/Ryan-Carloso/post-engineer/blob/main/docs/recipes/story-first-reels.md',
    );
    const baseText = SHARED_PROMPT_BASE.join('\n');
    expect(entry.prompt.startsWith(baseText)).toBe(true);
  });

  it('orders the story-first flow: inputs, story, archetype, hook mechanisms, watch-through, voice, images, validate, generate', () => {
    // The composed prompt starts with the shared base; the flow order below
    // is checked on the specific part only, after stripping that base prefix.
    const fullText = getPrompt('story-first-reels')?.prompt ?? '';
    const baseText = SHARED_PROMPT_BASE.join('\n');
    expect(fullText.startsWith(baseText)).toBe(true);
    const text = fullText.slice(baseText.length + 2);
    const positions = [
      'Ask me the persona, the topic, and the video type',
      'Find the real story first',
      'setup, turning point, payoff',
      'Every emotional beat must be VISIBLE in the image',
      'the turning point MUST have a visual moment',
      'An invisible beat is a failure',
      'Pick one archetype',
      'One archetype only',
      'never basic content',
      'Build the hook from one mechanism',
      'Draft three hooks',
      'Write for watch-through',
      'Open a loop early',
      'echo one word from the hook',
      'Vary the rhythm deliberately',
      'a short, direct hook',
      'a longer discovery',
      'a short close',
      'pace changes from take to take',
      'Voice: direct, plain spoken sentences',
      'If a line sounds written rather than spoken',
      'Mix the photos',
      'never AI photos only',
      'identical static panels is monotonous',
      'licensed',
      'stock photos from an image library',
      'without a licence',
      'Licensed stock VIDEO (b-roll) is allowed on faceless videos and',
      'on the non-hook takes of hook_lipsync videos',
      'from the stock sources configured for this video (Pexels, Pixabay,',
      'Coverr)',
      'On full_lipsync the face fills the frame, so photos',
      'only - never a clip',
      'Never put a clip in the hook window',
      'a skipped clip fails the render',
      'If no stock source is configured,',
      'photos only. A clip is full-frame',
      'If a source fails - timeout, no results, or',
      'error - use the next configured source',
      'try the best-matching',
      'source first and never stop at the first failure',
      'extract frames',
      'same subject,',
      'same action, same mood',
      'discarded,',
      'never forced in',
      'the base lines about material do not apply here',
      'One segment is one beat',
      'never the next sentence',
      'Image quality, no exceptions',
      'No neutral filler photo',
      'One consistent persona',
      'the same person, the same look',
      'one fixed group',
      'from that same original photo',
      'never chain',
      'check_script (action: validate)',
      'check_script (action: score)',
      'generate_video',
      'video_tasks (action: status)',
    ].map((needle) => text.indexOf(needle));
    expect(positions.every((i) => i >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(text).toContain('one emotion only');
    expect(text).toContain('The viewer is the hero');
    // A real story, not an explanation: one concrete day, one event, first
    // person, plausible in real life — never a generic explainer.
    expect(text).toContain('one concrete day');
    expect(text).toContain('first person');
    expect(text).toContain('could really have happened');
    expect(text).toContain('Never a generic explainer');
    expect(text).toContain('Never present it as a real person');
    expect(text).toContain('verified testimonial');
    // Step 3 picks one archetype for the value the video delivers:
    // informative, funny, inspirational, relatable, or provocative —
    // never basic content with no value.
    expect(text).toContain('Pick one archetype');
    expect(text).toContain('informative');
    expect(text).toContain('funny');
    expect(text).toContain('inspirational');
    expect(text).toContain('relatable');
    expect(text).toContain('provocative');
    expect(text).toContain('One archetype only');
    expect(text).toContain('adds nothing to the viewer');
    // The story is real, concrete, and lived, first person, plausible in
    // real life. "The day it happened to me" is one valid form, not the
    // only one: a first time, a week, a realization, a repeating ritual,
    // or a before/after arc all count — as long as one concrete moment
    // is lived, not described. A documentary, study, or fact is
    // transformed into a lived story; the fact goes inside the story,
    // never as exposition.
    expect(text).toContain('the day it happened to me');
    expect(text).toContain('one valid form, not the only one');
    expect(text).toContain('the first time I');
    expect(text).toContain('the day I realized');
    expect(text).toContain('every Tuesday');
    expect(text).toContain('before/after arc');
    expect(text).toContain('lived, not described');
    expect(text).toContain('never random');
    expect(text).toContain('documentary');
    expect(text).toContain('transform it into a concrete story');
    expect(text).toContain('never as exposition');
    // Research, never invent: every fact is verified before it is
    // asserted — mechanisms, hormones, numbers, deadlines. A fact that
    // cannot be confirmed is cut from the script, never asserted anyway.
    expect(text).toContain('Research every fact before you assert it');
    expect(text).toContain('Never invent a fact');
    expect(text).toContain('Tavily');
    expect(text).toContain('Exa');
    // The fallback phrase spans a line break, so pin it with a regex.
    expect(text).toMatch(/If\s+that tool fails - timeout, out of tokens, or error - try the next/);
    expect(text).toContain('configured search tool');
    expect(text).toContain('cut it from the script');
    expect(text).toContain('unconfirmed fact never enters');
    // Step 7 overrides the base's material lines for this prompt only:
    // licensed stock photos and licensed stock video are allowed here,
    // and real photos are welcome — the base's "images only, your own
    // real photos, no stock footage" rule does not apply to this prompt.
    // Clips come only from the stock sources configured for this video,
    // and only after a frame check proves they fit the segment sentence.
    // Clips are scoped to where the engine can play them: faceless and
    // the non-hook takes of hook_lipsync — never full_lipsync, never
    // in the hook window, where a skipped clip fails the render.
    // (The story-rule PR's step-6 assertions — "do not search for images",
    // "the base lines about searching images", "about your own real photos"
    // — pinned the AI-only step 6 this PR replaces, so they do not carry
    // over: this prompt searches licensed libraries for real photos.)
    expect(text).toContain('the base lines about material do not apply here');
    expect(text).toContain('licensed stock photos and licensed stock video are allowed');
    expect(text).toContain('real photos are welcome');
    expect(text).toContain('without a licence');
    expect(text).toContain('Licensed stock VIDEO (b-roll) is allowed on faceless videos and');
    expect(text).toContain('on the non-hook takes of hook_lipsync videos');
    expect(text).toContain('from the stock sources configured for this video');
    expect(text).toContain('On full_lipsync the face fills the frame, so photos');
    expect(text).toContain('only - never a clip');
    expect(text).toContain('Never put a clip in the hook window');
    expect(text).toContain('a skipped clip fails the render');
    expect(text).toContain('If no stock source is configured,');
    // "never AI photos only" appears earlier in step 7, so pin the
    // fallback occurrence with its following words, not the bare phrase.
    expect(text).toContain('photos only. A clip is full-frame');
    // "clip audio is discarded" spans a line break, so pin it with a regex.
    expect(text).toMatch(/clip\s+audio is discarded/);
    // If a stock source fails, the agent tries the next configured one —
    // best match first, never stopping at the first failure.
    expect(text).toContain('If a source fails - timeout, no results, or');
    expect(text).toContain('error - use the next configured source');
    expect(text).toContain('try the best-matching');
    expect(text).toContain('source first and never stop at the first failure');
    // Terminal case: if every configured source fails, nothing is left
    // to try — photos only.
    expect(text).toMatch(/If every configured\s+source fails, use photos only/);
    expect(text).toContain('extract frames');
    expect(text).toContain('same subject,');
    expect(text).toContain('same action, same mood');
    expect(text).toContain('never forced in');
    expect(text).not.toContain('it cannot use');
    expect(text).not.toContain('never attach a video URL');
    // v3/v4 lessons, for a 10/10 video: every emotional beat is visible
    // in the image, the rhythm varies take by take, every segment is one
    // beat and gets its own image, and every image is sharp, well-lit, and on-topic.
    expect(text).toContain('Every emotional beat must be VISIBLE in the image');
    expect(text).toContain('visibly triumphant');
    expect(text).toContain('An invisible beat is a failure');
    expect(text).toContain('Vary the rhythm deliberately');
    expect(text).toContain('pace changes from take to take');
    expect(text).toContain('One segment is one beat');
    expect(text).toContain('never the next sentence');
    expect(text).toContain('Image quality, no exceptions');
    expect(text).toContain('No neutral filler photo');
    expect(text).toContain('no repeated compositions');
    // The old rule is gone: no more AI-only photos, no "never stock".
    expect(text).not.toContain('Generate every photo with AI');
    expect(text).not.toContain('never stock');
    // The prompt never names a test persona: it talks about "the persona".
    expect(text).not.toContain('Mara');
    expect(text).toContain('who would DM this to whom, and why');
    expect(text).toContain('never a rote "like and subscribe"');
    expect(text).toContain('wait for my yes');
    // Generalized: the winning test brief (HabitLoom, the diet topic) must
    // not leak into the prompt — it takes persona, topic, and video type
    // as inputs instead. Same for Mara, the local test-video persona:
    // product copy always says "the persona", never a test persona name.
    expect(text).not.toContain('HabitLoom');
    expect(text).not.toContain('why you regain weight after a diet');
    expect(text).not.toContain('Mara');
    expect(text).not.toContain('issue #');
  });

  it('carries the 10/10-loop lessons (v7-v15): one beat per segment, two body states, duration contrast, matching clips, covered takes, literal study, 12-word CTA', () => {
    // The loop lessons were verified on real rendered videos (v7-v15):
    // each segment is one beat, the body change is visible in the body,
    // photos pace with SegmentMedia.duration, clips must match the persona
    // even from behind, every take is covered, the study is literal, and
    // the CTA is 12 words over 2 photos. Pins are single-line fragments:
    // the composed prompt joins source lines with '\n', so a needle
    // spanning a source-line break never matches.
    const fullText = getPrompt('story-first-reels')?.prompt ?? '';
    const baseText = SHARED_PROMPT_BASE.join('\n');
    expect(fullText.startsWith(baseText)).toBe(true);
    const text = fullText.slice(baseText.length + 2);
    expect(text).toContain('One segment is one beat');
    expect(text).toContain('never the next sentence');
    expect(text).toContain('TWO body states');
    expect(text).toContain('visible IN THE BODY');
    expect(text).toContain('checking its body matches the phase');
    expect(text).toContain('SegmentMedia.duration (0.5-6s)');
    expect(text).toContain('never more than 2');
    expect(text).toContain('hold the low point 3.5-5s');
    expect(text).toContain('fast at 1-1.5s');
    expect(text).toContain('the payoff 4-6s');
    expect(text).toContain('One photo is one beat, never two');
    expect(text).toContain('same persona even');
    expect(text).toContain('same hair, same clothes, same setting');
    expect(text).toContain('"No visible face"');
    expect(text).toContain('is NOT enough');
    expect(text).toContain('Re-encode every clip to 30 fps');
    expect(text).toContain('verify the PLAYED');
    expect(text).toContain('rendered cut list');
    expect(text).toContain('Every take must have image for ALL its audio');
    expect(text).toContain('the last frame is the payoff');
    expect(text).toContain('A study gets a literal image');
    expect(text).toContain('labeled chart');
    expect(text).toContain('The notebook enters only on its sentence');
    expect(text).toContain('a chart holds 2s or more');
    expect(text).toContain('12 words over 2 photos');
    expect(text).toContain('The turning-point object appears only at the turn, never before');
  });
});
