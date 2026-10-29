import { describe, it, expect } from 'vitest';
import type { TranslationKey } from '@/lib/i18n';
import { PROMPTS } from '../prompts';
import { filterPrompts, promptKinds } from '../prompts-filter';

const translations: Record<string, string> = {
  'recipes.dailyNewsTitle': 'Notícia diária vira vídeo',
  'recipes.dailyNewsObjective': 'Transforme uma notícia do dia em vídeo.',
  'recipes.githubPrsTitle': 'GitHub PRs become videos',
  'recipes.githubPrsObjective': 'Turn your pull requests into videos.',
};
const t = (key: TranslationKey): string => translations[key] ?? key;
const slugs = (list: typeof PROMPTS): string[] => list.map((prompt) => prompt.slug);

describe('filterPrompts', () => {
  it('returns every prompt with no kind and an empty query', () => {
    expect(slugs(filterPrompts(PROMPTS, 'all', '  ', t))).toEqual(['daily-news', 'github-prs', 'full-setup']);
  });

  it('keeps only the chosen kind', () => {
    expect(slugs(filterPrompts(PROMPTS, 'recipes.kindPrompt', '', t))).toEqual(['github-prs']);
  });

  it('matches the localized title ignoring case and accents', () => {
    expect(slugs(filterPrompts(PROMPTS, 'all', 'NOTICIA', t))).toEqual(['daily-news']);
  });

  it('matches the objective', () => {
    expect(slugs(filterPrompts(PROMPTS, 'all', 'pull requests', t))).toEqual(['github-prs']);
  });

  it('returns nothing when kind and query disagree', () => {
    expect(filterPrompts(PROMPTS, 'recipes.kindRecipe', 'pull', t)).toEqual([]);
  });
});

describe('promptKinds', () => {
  it('lists each kind once in first-seen order', () => {
    expect(promptKinds(PROMPTS)).toEqual(['recipes.kindRecipe', 'recipes.kindPrompt']);
  });
});
