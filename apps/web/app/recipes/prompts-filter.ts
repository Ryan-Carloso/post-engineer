//---------------
// Prompts hub filtering — pure: given the entries, a kind filter,
// a search query, and the translate function, returns the entries
// to show. Search matches the localized title and objective,
// case- and accent-insensitive, so it works in both locales.
//---------------

import type { TranslationKey } from '@/lib/i18n';
import type { PromptEntry } from './prompts';

export type KindFilter = 'all' | TranslationKey;

function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function filterPrompts(
  prompts: PromptEntry[],
  kind: KindFilter,
  query: string,
  t: (key: TranslationKey) => string,
): PromptEntry[] {
  const needle = normalize(query.trim());
  return prompts.filter((prompt) => {
    if (kind !== 'all' && prompt.kindKey !== kind) return false;
    if (needle === '') return true;
    const haystack = normalize(`${t(prompt.titleKey)} ${t(prompt.objectiveKey)}`);
    return haystack.includes(needle);
  });
}

export function promptKinds(prompts: PromptEntry[]): TranslationKey[] {
  return [...new Set(prompts.map((prompt) => prompt.kindKey))];
}
