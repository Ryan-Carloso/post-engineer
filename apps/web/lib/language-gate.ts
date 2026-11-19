export const ONLY_ENGLISH_VIDEOS_MESSAGE = 'Only English videos are supported for now.';

export const ONLY_ENGLISH_CLONE_MESSAGE = 'Voice cloning is only available in English for now.';

const ENGLISH_LANGUAGE_NAMES = new Set(['english', 'inglês', 'ingles']);

export function isEnglishLanguage(language: string): boolean {
  const base = language.trim().toLowerCase().replace('_', '-').split('-')[0];
  return base === 'en' || ENGLISH_LANGUAGE_NAMES.has(base);
}
