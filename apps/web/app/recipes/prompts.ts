import type { TranslationKey } from '@/lib/i18n';
import {
  DAILY_NEWS_PROMPT,
  FULL_SETUP_PROMPT,
  GITHUB_PRS_PROMPT,
  LAST_30_DAYS_PROMPT,
  MULTI_REDE_PROMPT,
  PLACE_SPOTLIGHT_PROMPT,
  SUBJECT_SPOTLIGHT_PROMPT,
  VIRAL_SHORTS_PROMPT,
  COMPARE_PROMPTS_PROMPT,
  STORY_FIRST_REELS_PROMPT,
} from '@/lib/generation/prompt-base';

export {
  DAILY_NEWS_PROMPT,
  FULL_SETUP_PROMPT,
  GITHUB_PRS_PROMPT,
  LAST_30_DAYS_PROMPT,
  MULTI_REDE_PROMPT,
  PLACE_SPOTLIGHT_PROMPT,
  SUBJECT_SPOTLIGHT_PROMPT,
  VIRAL_SHORTS_PROMPT,
  COMPARE_PROMPTS_PROMPT,
  STORY_FIRST_REELS_PROMPT,
};

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
    slug: 'subject-spotlight',
    icon: 'globe',
    titleKey: 'recipes.subjectSpotlightTitle',
    objectiveKey: 'recipes.subjectSpotlightObjective',
    kindKey: 'recipes.kindRecipe',
    stepKeys: [
      'recipes.subjectSpotlightStep1',
      'recipes.subjectSpotlightStep2',
      'recipes.subjectSpotlightStep3',
      'recipes.subjectSpotlightStep4',
      'recipes.subjectSpotlightStep5',
    ],
    deliverKeys: [
      'recipes.subjectSpotlightDeliver1',
      'recipes.subjectSpotlightDeliver2',
      'recipes.subjectSpotlightDeliver3',
    ],
    exampleInputKey: 'recipes.subjectSpotlightExampleInput',
    exampleOutputKey: 'recipes.subjectSpotlightExampleOutput',
    docHref:
      'https://github.com/Ryan-Carloso/post-engineer/blob/main/docs/recipes/subject-spotlight.md',
    prompt: SUBJECT_SPOTLIGHT_PROMPT,
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
    slug: 'last-30-days',
    icon: 'globe',
    titleKey: 'recipes.last30DaysTitle',
    objectiveKey: 'recipes.last30DaysObjective',
    kindKey: 'recipes.kindRecipe',
    stepKeys: [
      'recipes.last30DaysStep1',
      'recipes.last30DaysStep2',
      'recipes.last30DaysStep3',
      'recipes.last30DaysStep4',
      'recipes.last30DaysStep5',
    ],
    deliverKeys: [
      'recipes.last30DaysDeliver1',
      'recipes.last30DaysDeliver2',
      'recipes.last30DaysDeliver3',
    ],
    exampleInputKey: 'recipes.last30DaysExampleInput',
    exampleOutputKey: 'recipes.last30DaysExampleOutput',
    docHref:
      'https://github.com/Ryan-Carloso/post-engineer/blob/main/docs/recipes/last-30-days.md',
    prompt: LAST_30_DAYS_PROMPT,
  },
  {
    slug: 'multi-rede',
    icon: 'globe',
    titleKey: 'recipes.multiRedeTitle',
    objectiveKey: 'recipes.multiRedeObjective',
    kindKey: 'recipes.kindRecipe',
    stepKeys: [
      'recipes.multiRedeStep1',
      'recipes.multiRedeStep2',
      'recipes.multiRedeStep3',
      'recipes.multiRedeStep4',
      'recipes.multiRedeStep5',
    ],
    deliverKeys: [
      'recipes.multiRedeDeliver1',
      'recipes.multiRedeDeliver2',
      'recipes.multiRedeDeliver3',
    ],
    exampleInputKey: 'recipes.multiRedeExampleInput',
    exampleOutputKey: 'recipes.multiRedeExampleOutput',
    docHref:
      'https://github.com/Ryan-Carloso/post-engineer/blob/main/docs/recipes/multi-rede.md',
    prompt: MULTI_REDE_PROMPT,
  },
  {
    slug: 'viral-shorts',
    icon: 'compose',
    titleKey: 'recipes.viralShortsTitle',
    objectiveKey: 'recipes.viralShortsObjective',
    kindKey: 'recipes.kindPrompt',
    stepKeys: [
      'recipes.viralShortsStep1',
      'recipes.viralShortsStep2',
      'recipes.viralShortsStep3',
      'recipes.viralShortsStep4',
      'recipes.viralShortsStep5',
    ],
    deliverKeys: [
      'recipes.viralShortsDeliver1',
      'recipes.viralShortsDeliver2',
      'recipes.viralShortsDeliver3',
    ],
    exampleInputKey: 'recipes.viralShortsExampleInput',
    exampleOutputKey: 'recipes.viralShortsExampleOutput',
    docHref:
      'https://github.com/Ryan-Carloso/post-engineer/blob/main/docs/recipes/viral-shorts.md',
    prompt: VIRAL_SHORTS_PROMPT,
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
  {
    slug: 'compare-prompts',
    icon: 'compose',
    titleKey: 'recipes.comparePromptsTitle',
    objectiveKey: 'recipes.comparePromptsObjective',
    kindKey: 'recipes.kindRecipe',
    stepKeys: [
      'recipes.comparePromptsStep1',
      'recipes.comparePromptsStep2',
      'recipes.comparePromptsStep3',
      'recipes.comparePromptsStep4',
      'recipes.comparePromptsStep5',
    ],
    deliverKeys: [
      'recipes.comparePromptsDeliver1',
      'recipes.comparePromptsDeliver2',
      'recipes.comparePromptsDeliver3',
    ],
    exampleInputKey: 'recipes.comparePromptsExampleInput',
    exampleOutputKey: 'recipes.comparePromptsExampleOutput',
    docHref:
      'https://github.com/Ryan-Carloso/post-engineer/blob/main/docs/recipes/compare-prompts.md',
    prompt: COMPARE_PROMPTS_PROMPT,
  },
  {
    slug: 'story-first-reels',
    icon: 'compose',
    titleKey: 'recipes.storyFirstReelsTitle',
    objectiveKey: 'recipes.storyFirstReelsObjective',
    kindKey: 'recipes.kindPrompt',
    stepKeys: [
      'recipes.storyFirstReelsStep1',
      'recipes.storyFirstReelsStep2',
      'recipes.storyFirstReelsStep3',
      'recipes.storyFirstReelsStep4',
      'recipes.storyFirstReelsStep5',
      'recipes.storyFirstReelsStep6',
      'recipes.storyFirstReelsStep7',
    ],
    deliverKeys: [
      'recipes.storyFirstReelsDeliver1',
      'recipes.storyFirstReelsDeliver2',
      'recipes.storyFirstReelsDeliver3',
    ],
    exampleInputKey: 'recipes.storyFirstReelsExampleInput',
    exampleOutputKey: 'recipes.storyFirstReelsExampleOutput',
    docHref:
      'https://github.com/Ryan-Carloso/post-engineer/blob/main/docs/recipes/story-first-reels.md',
    prompt: STORY_FIRST_REELS_PROMPT,
  },
];

export function getPrompt(slug: string): PromptEntry | undefined {
  return PROMPTS.find((prompt) => prompt.slug === slug);
}
