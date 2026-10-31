import { describe, it, expect } from 'vitest';
import { DAILY_NEWS_PROMPT, FULL_SETUP_PROMPT, GITHUB_PRS_PROMPT, PROMPTS, getPrompt } from '../prompts';
import { SHARED_PROMPT_BASE } from '@/lib/generation/prompt-base';

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
    // base prefix. The specific generate step keeps the bare startAt
    // placeholder; the 3h-30d window itself lives in the base.
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
      'title [VIDEO_TITLE]',
      'account IDs',
      'startAt [ISO_DATETIME]',
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
    expect(baseText).toContain('3h-30d ahead');
    expect(baseText).toContain('mode "asap"');
    for (const prompt of PROMPTS) {
      expect(prompt.prompt.startsWith(baseText)).toBe(true);
      expect(prompt.prompt).toContain('Write like a human');
      expect(prompt.prompt).toContain('No em dashes');
    }
  });

  it('pins the exact composed text of every prompt', () => {
    // Exact-text pins: any mutated line, separator, or blank line in the
    // composed prompts changes the output and fails here. The specific
    // lines are pinned deliberately; the shared base comes along via
    // SHARED_PROMPT_BASE, so a base change fails loudly too.
    const FULL_SETUP_SPECIFIC = [
      'Set up Post Engineer end to end and publish your first video. Follow the',
      'steps in order; do not skip ahead of validation or the publish confirmation.',
      '',
      '1. Call list_social_accounts. Ask which of youtube, instagram, linkedin',
      '   the user wants; for each one that is missing, call connect_account with',
      '   that provider and hand the returned https OAuth link to the user to',
      '   finish in the browser, then re-check with list_social_accounts.',
      '2. Bluesky is optional. If the user wants it, ask for the handle and the',
      '   app password (never the main password); use the app password only in',
      '   connect_account and never repeat, print, or log it.',
      '3. Call list_faces and list_voices, let the user pick a face and a voice,',
      '   then call create_persona with name, avatarUrl, voiceId,',
      '   language "en-US" (English only for now) and niche. Remember the personaId.',
      '4. Call get_token_balance first, then write the script as segments',
      '   following the contract above and call validate_script until it passes.',
      '5. Before generating, tell the user the video IS published as a',
      '   real post, and confirm the providers/accounts and the mode (scheduled|asap)',
      '   with the user. Warning: Bluesky video publishing is',
      '   currently being fixed (issue #327); Bluesky is optional and can be',
      '   skipped.',
      "6. Call generate_persona_video once with that personaId, the validated",
      '   segments unchanged, title [VIDEO_TITLE], language "en", the confirmed',
      '   providers with their account IDs from list_social_accounts, and the',
      '   confirmed mode (scheduled needs startAt [ISO_DATETIME] + times',
      '   [HH:MM] in timezone [TIMEZONE]; asap needs no startAt/times).',
      '   Then call get_video_task_progress until done and share the',
      '   get_video_status URL.',
    ];
    expect(FULL_SETUP_PROMPT).toBe([...SHARED_PROMPT_BASE, '', ...FULL_SETUP_SPECIFIC].join('\n'));
    const DAILY_NEWS_SPECIFIC = [
      "Turn one top story from today's GNews headlines (lang=en, country=us) into",
      'one Post Engineer video. My GNews key is in your own environment as',
      'YOUR_GNEWS_KEY — never print it, never paste it anywhere else.',
      '',
      '1. Pick one clear single event with a named place. Skip round-ups, opinion',
      '   pieces, and stories sourced only from a social post. Only facts the',
      '   source supports; attribute single-sourced claims.',
      '2. For media, prefer a photo of the actual place in the story. Check a',
      '   public URL with check_media first and attach it only on ok; or upload',
      '   a local file with upload_media shortly before generating and use the',
      '   mediaId. At most 6 medias. Skip a failed photo, never force it.',
      '3. Call generate_persona_video with personaId [PERSONA_ID], the validated',
      '   segments unchanged, title [STORY_TITLE], language "en", providers',
      '   [PROVIDERS] with account IDs from list_social_accounts, mode',
      '   [scheduled|asap] (scheduled needs startAt [ISO_DATETIME] + times',
      '   [HH:MM] in timezone [TIMEZONE]; asap needs no startAt/times).',
      '4. Poll get_video_task_progress on the taskId until done, then share the',
      '   final video URL from get_video_status.',
    ];
    expect(DAILY_NEWS_PROMPT).toBe([...SHARED_PROMPT_BASE, '', ...DAILY_NEWS_SPECIFIC].join('\n'));
    const GITHUB_PRS_SPECIFIC = [
      'Turn this GitHub pull request into one persona video.',
      '',
      'PR to use (paste the PR title, description, and a short change summary, plus any linked issues):',
      '- Title: ...',
      '- Description: ...',
      '- What changed: ...',
      '- Linked issues: ...',
      '',
      'Rules:',
      '- Use the Post Engineer MCP server and the singular video tool, generate_persona_video.',
      '- Media: at most 6, only if they match the PR (screenshots, diagrams, or repo visuals); otherwise generate without media.',
      '- Then generate one video for this PR and publish it where the user asked, scheduled or asap.',
      '- Never invent PR details: if the title, description, or change summary is missing, ask for it instead of guessing.',
    ];
    expect(GITHUB_PRS_PROMPT).toBe([...SHARED_PROMPT_BASE, '', ...GITHUB_PRS_SPECIFIC].join('\n'));
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
