//---------------
// Prompts hub data — one entry per prompt. Adding prompt N+1 is
// adding one entry here plus its i18n title, objective, steps,
// deliverables, and example keys in both locales. The list page
// and the detail page render from this array, never from a
// hand-built page per prompt. Prompt text is English by design:
// generation language is en. The copy-ready texts are the source
// content of the recipe docs in docs/recipes/, rendered here as
// structured components, not as a raw markdown dump. Cards link
// to the internal detail page; the list footer's "Add your
// prompt" link (add-prompt-link.tsx) and the detail page's doc
// link are the only GitHub links.
//---------------

import type { TranslationKey } from '@/lib/i18n';

export const DAILY_NEWS_PROMPT = [
  "Turn one top story from today's GNews headlines (lang=en, country=us) into",
  'one Post Engineer video. My GNews key is in your own environment as',
  'YOUR_GNEWS_KEY — never print it, never paste it anywhere else.',
  '',
  'Rules:',
  '1. Pick one clear single event with a named place. Skip round-ups, opinion',
  '   pieces, and stories sourced only from a social post.',
  '2. Write the script as segments: first hook (aim 20-30 words, end with',
  '   terminal punctuation), then body segments (at least 30 words total),',
  '   last CTA (5-20 words). Total 60–200 words, spoken English only, no',
  '   links, hashtags, markdown, emoji, or stage directions. Only facts the',
  '   source supports; attribute single-sourced claims.',
  '3. Call validate_script with those segments. Fix any named error and',
  '   re-validate until it passes. Do not generate before it passes.',
  '4. For media, prefer a photo of the actual place in the story. Check a',
  '   public URL with check_media first and attach it only on ok; or upload',
  '   a local file with upload_media shortly before generating and use the',
  '   mediaId. At most 6 medias. Skip a failed photo, never force it.',
  '5. Call generate_persona_video with personaId [PERSONA_ID], the validated',
  '   segments unchanged, title [STORY_TITLE], language "en", providers',
  '   [PROVIDERS] with account IDs from list_social_accounts, mode',
  '   [scheduled|asap] (scheduled needs startAt [ISO_DATETIME] + times',
  '   [HH:MM] in timezone [TIMEZONE]; asap needs no startAt/times).',
  '6. Poll get_video_task_progress on the taskId until done, then share the',
  '   final video URL from get_video_status.',
].join('\n');

export const GITHUB_PRS_PROMPT = [
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
  '- First, call validate_script with your script and only proceed when it is valid — validate before any token is debited.',
  '- Script: spoken text only, no links, hashtags, markdown, emojis, or stage directions.',
  '- Structure: first segment is the hook, last segment is the CTA, exactly one of each.',
  '- Length: 60–200 words total, hook 20–30 words (8–12 seconds), body at least 30 words, CTA 5–20 words, at most 12 segments.',
  '- Language: en only.',
  '- Media: at most 6, only if they match the PR (screenshots, diagrams, or repo visuals); otherwise generate without media.',
  '- Then generate one video for this PR and publish it where the user asked, scheduled or asap.',
  '- Never invent PR details: if the title, description, or change summary is missing, ask for it instead of guessing.',
].join('\n');

export type PromptIcon = 'globe' | 'compose';

export interface PromptEntry {
  slug: string;
  icon: PromptIcon;
  titleKey: TranslationKey;
  objectiveKey: TranslationKey;
  kindKey: TranslationKey;
  stepKeys: TranslationKey[];
  deliverKeys: TranslationKey[];
  exampleInputKey: TranslationKey;
  exampleOutputKey: TranslationKey;
  docHref: string;
  prompt: string;
}

export const PROMPTS: PromptEntry[] = [
  {
    slug: 'daily-news',
    icon: 'globe',
    titleKey: 'recipes.dailyNewsTitle',
    objectiveKey: 'recipes.dailyNewsObjective',
    kindKey: 'recipes.kindRecipe',
    stepKeys: [
      'recipes.dailyNewsStep1',
      'recipes.dailyNewsStep2',
      'recipes.dailyNewsStep3',
      'recipes.dailyNewsStep4',
      'recipes.dailyNewsStep5',
    ],
    deliverKeys: [
      'recipes.dailyNewsDeliver1',
      'recipes.dailyNewsDeliver2',
      'recipes.dailyNewsDeliver3',
    ],
    exampleInputKey: 'recipes.dailyNewsExampleInput',
    exampleOutputKey: 'recipes.dailyNewsExampleOutput',
    docHref:
      'https://github.com/Ryan-Carloso/post-engineer/blob/main/docs/recipes/daily-news.md',
    prompt: DAILY_NEWS_PROMPT,
  },
  {
    slug: 'github-prs',
    icon: 'compose',
    titleKey: 'recipes.githubPrsTitle',
    objectiveKey: 'recipes.githubPrsObjective',
    kindKey: 'recipes.kindPrompt',
    stepKeys: [
      'recipes.githubPrsStep1',
      'recipes.githubPrsStep2',
      'recipes.githubPrsStep3',
      'recipes.githubPrsStep4',
      'recipes.githubPrsStep5',
    ],
    deliverKeys: [
      'recipes.githubPrsDeliver1',
      'recipes.githubPrsDeliver2',
      'recipes.githubPrsDeliver3',
    ],
    exampleInputKey: 'recipes.githubPrsExampleInput',
    exampleOutputKey: 'recipes.githubPrsExampleOutput',
    docHref:
      'https://github.com/Ryan-Carloso/post-engineer/blob/main/docs/recipes/github-prs.md',
    prompt: GITHUB_PRS_PROMPT,
  },
];

export function getPrompt(slug: string): PromptEntry | undefined {
  return PROMPTS.find((prompt) => prompt.slug === slug);
}
