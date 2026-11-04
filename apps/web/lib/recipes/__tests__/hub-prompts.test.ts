import { describe, expect, it } from 'vitest';
import { PROMPTS } from '@/app/recipes/prompts';
import { recipesI18nEn } from '@/lib/i18n/recipes-i18n-en';
import { findHubPrompt, listHubPrompts } from '../hub-prompts';

//---------------
// The MCP-facing recipe catalog is derived from the web hub: every PROMPTS
// entry is served, in order, with its English title (titleKey) and
// description (objectiveKey) and the exact prompt text.
//---------------

const english = new Map<string, string>(Object.entries(recipesI18nEn));

function englishCopy(key: string): string | undefined {
  return english.get(key.replace(/^recipes\./, ''));
}

describe('hub prompts', () => {
  it('lists every PROMPTS entry in order', () => {
    expect(listHubPrompts().map((entry) => entry.slug)).toEqual(PROMPTS.map((entry) => entry.slug));
  });

  it.each(PROMPTS.map((entry) => [entry.slug, entry] as const))(
    '%s resolves to its English copy and exact prompt text',
    (slug, entry) => {
      const title = englishCopy(entry.titleKey);
      const description = englishCopy(entry.objectiveKey);
      expect(title).toBeTruthy();
      expect(description).toBeTruthy();
      expect(findHubPrompt(slug)).toEqual({ slug, title, description, prompt: entry.prompt });
      expect(listHubPrompts()).toContainEqual({ slug, title, description });
    },
  );

  it('returns null for an unknown slug', () => {
    expect(findHubPrompt('unknown-recipe')).toBeNull();
  });
});
