//---------------
// Prompts hub data — one entry per prompt. Adding prompt N+1 is
// adding one entry here plus its i18n title, objective, steps,
// deliverables, and example keys in both locales. The list page
// and the detail page render from this array, never from a
// hand-built page per prompt. Prompt text is English by design:
// generation language is en. The recipe docs in docs/recipes/ link
// to this hub instead of repeating the text, which renders here as
// structured components, not as a raw markdown dump. Cards link
// to the internal detail page; the list footer's "Add your
// prompt" link (add-prompt-link.tsx) and the detail page's doc
// link are the only GitHub links.
//
// Prompt texts live once in shared/prompt-base/prompt-base.ts and are
// imported here through a symlink at @/lib/generation/prompt-base —
// there is no web copy. A direct import fails tsc with TS6059 (web
// rootDir is apps/web) and, worse, breaks Stryker's sandbox, which
// copies only the app root and would leave the shared file behind.
// The symlink is dereferenced by tsc, webpack, vitest, and Stryker,
// so every tool sees the shared content as a local file.
//---------------

import type { TranslationKey } from '@/lib/i18n';
import {
  DAILY_NEWS_PROMPT,
  FULL_SETUP_PROMPT,
  GITHUB_PRS_PROMPT,
  PLACE_SPOTLIGHT_PROMPT,
} from '@/lib/generation/prompt-base';

export { DAILY_NEWS_PROMPT, FULL_SETUP_PROMPT, GITHUB_PRS_PROMPT, PLACE_SPOTLIGHT_PROMPT };

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
    slug: 'place-spotlight',
    icon: 'globe',
    titleKey: 'recipes.placeSpotlightTitle',
    objectiveKey: 'recipes.placeSpotlightObjective',
    kindKey: 'recipes.kindRecipe',
    stepKeys: [
      'recipes.placeSpotlightStep1',
      'recipes.placeSpotlightStep2',
      'recipes.placeSpotlightStep3',
      'recipes.placeSpotlightStep4',
      'recipes.placeSpotlightStep5',
    ],
    deliverKeys: [
      'recipes.placeSpotlightDeliver1',
      'recipes.placeSpotlightDeliver2',
      'recipes.placeSpotlightDeliver3',
    ],
    exampleInputKey: 'recipes.placeSpotlightExampleInput',
    exampleOutputKey: 'recipes.placeSpotlightExampleOutput',
    docHref:
      'https://github.com/Ryan-Carloso/post-engineer/blob/main/docs/recipes/place-spotlight.md',
    prompt: PLACE_SPOTLIGHT_PROMPT,
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
  {
    slug: 'full-setup',
    icon: 'compose',
    titleKey: 'recipes.fullSetupTitle',
    objectiveKey: 'recipes.fullSetupObjective',
    kindKey: 'recipes.kindRecipe',
    stepKeys: [
      'recipes.fullSetupStep1',
      'recipes.fullSetupStep2',
      'recipes.fullSetupStep3',
      'recipes.fullSetupStep4',
      'recipes.fullSetupStep5',
    ],
    deliverKeys: [
      'recipes.fullSetupDeliver1',
      'recipes.fullSetupDeliver2',
      'recipes.fullSetupDeliver3',
    ],
    exampleInputKey: 'recipes.fullSetupExampleInput',
    exampleOutputKey: 'recipes.fullSetupExampleOutput',
    docHref:
      'https://github.com/Ryan-Carloso/post-engineer/blob/main/docs/recipes/full-setup.md',
    prompt: FULL_SETUP_PROMPT,
  },
];

export function getPrompt(slug: string): PromptEntry | undefined {
  return PROMPTS.find((prompt) => prompt.slug === slug);
}
