import { describe, expect, it } from 'vitest';

import { isEnglishLanguage } from '@/lib/language-gate';

describe('isEnglishLanguage', () => {
  it('accepts English and its regional variants', () => {
    for (const language of ['en', 'en-US', 'en-GB', 'EN', 'En-Gb', 'en_us', ' en ']) {
      expect(isEnglishLanguage(language)).toBe(true);
    }
  });

  it('rejects other languages', () => {
    for (const language of ['pt', 'pt-BR', 'es', 'fr', 'de', 'enx']) {
      expect(isEnglishLanguage(language)).toBe(false);
    }
  });

  it('rejects an empty language', () => {
    expect(isEnglishLanguage('')).toBe(false);
    expect(isEnglishLanguage('   ')).toBe(false);
  });
});
