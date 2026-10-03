//---------------
// i18n — unified dictionary exports and type utilities
//---------------

import { ptDictionary } from './pt';
import type { Dictionary } from './pt';
import { enDictionary } from './en';
import type { Locale } from './types';

export { ptDictionary, enDictionary };
export type { Dictionary } from './pt';
export type { Locale } from './types';

export const dictionaries: Record<Locale, Dictionary> = {
  pt: ptDictionary,
  en: enDictionary,
};

export const LOCALES: ReadonlyArray<{ value: Locale; label: string }> = [
  { value: 'pt', label: 'PT' },
  { value: 'en', label: 'EN' },
];

//---------------
// TranslationKey — union of all translation keys in dot-notation
// Ex.: "nav.posts" | "posts.statusPending" | "accounts.default" | ...
//---------------
export type TranslationKey = {
  [Section in keyof Dictionary]: {
    [Key in keyof Dictionary[Section]]: Key extends string
      ? Section extends string
        ? `${Section}.${Key}`
        : never
      : never;
  }[keyof Dictionary[Section]];
}[keyof Dictionary];
