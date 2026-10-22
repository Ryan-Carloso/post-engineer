//---------------
// English-only launch gate — the single place the web app decides
// whether a language is allowed. Voice cloning only ever worked well
// in English and the non-English preset catalogs are not ready, so
// every surface that accepts a video or clone language (video creation,
// persona create/update, cloned voices, the sample-language list)
// funnels through here until the launch lock lifts. Regional variants
// of English (en-US, en-GB, ...) count as English.
//---------------

export const ONLY_ENGLISH_VIDEOS_MESSAGE = 'Only English videos are supported for now.';

export const ONLY_ENGLISH_CLONE_MESSAGE = 'Voice cloning is only available in English for now.';

// Personas may store a language name instead of a code ("English"); the
// engine gate accepts that form, so the web gate must too, or legacy
// personas get rejected for being English.
const ENGLISH_LANGUAGE_NAMES = new Set(['english', 'inglês', 'ingles']);

export function isEnglishLanguage(language: string): boolean {
  const base = language.trim().toLowerCase().replace('_', '-').split('-')[0];
  return base === 'en' || ENGLISH_LANGUAGE_NAMES.has(base);
}
