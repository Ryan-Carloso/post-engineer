import { PROMPTS } from '@/app/recipes/prompts';
import { recipesI18nEn } from '@/lib/i18n/recipes-i18n-en';

export interface HubPromptSummary {
  slug: string;
  title: string;
  description: string;
}

export interface HubPrompt extends HubPromptSummary {
  prompt: string;
}

const englishRecipes = new Map<string, string>(Object.entries(recipesI18nEn));

function englishRecipeCopy(key: string): string {
  const value = englishRecipes.get(key.replace(/^recipes\./, ''));
  if (value === undefined) {
    throw new Error(`Missing English recipes copy for ${key}`);
  }
  return value;
}

export function listHubPrompts(): HubPromptSummary[] {
  return PROMPTS.map((entry) => ({
    slug: entry.slug,
    title: englishRecipeCopy(entry.titleKey),
    description: englishRecipeCopy(entry.objectiveKey),
  }));
}

export function findHubPrompt(slug: string): HubPrompt | null {
  const entry = PROMPTS.find((candidate) => candidate.slug === slug);
  if (entry === undefined) return null;
  return {
    slug: entry.slug,
    title: englishRecipeCopy(entry.titleKey),
    description: englishRecipeCopy(entry.objectiveKey),
    prompt: entry.prompt,
  };
}

export function isOfficialPromptSlug(slug: string): boolean {
  return PROMPTS.some((candidate) => candidate.slug === slug);
}
