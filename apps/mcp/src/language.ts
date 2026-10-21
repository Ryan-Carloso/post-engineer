/**
 * English-only launch gate — the single place the MCP server decides
 * whether a language argument is allowed. Voice cloning only ever
 * worked well in English and the non-English preset catalogs are not
 * ready, so the tool schemas reject any other language until the
 * launch lock lifts. Regional variants of English (en-US, en-GB, ...)
 * count as English.
 */
export const ONLY_ENGLISH_VIDEOS_MESSAGE = 'Only English videos are supported for now';

export const ONLY_ENGLISH_CLONE_MESSAGE = 'Voice cloning is only available in English for now';

export function isEnglishLanguage(language: string): boolean {
  const base = language.trim().toLowerCase().replace('_', '-').split('-')[0];
  return base === 'en';
}
