//---------------
// i18n — unified dictionary exports and type utilities
//---------------

import { ptDictionary as basePtDictionary, type Dictionary as BaseDictionary } from './pt';
import { enDictionary as baseEnDictionary } from './en';
import { publishingAccountsStrings } from './publishing-accounts';
import type { Locale } from './types';

//---------------
// Per-persona default publishing accounts (issue #212): en.ts/pt.ts are
// grandfathered over the 500-line file-size cap and may not grow a single
// line, so the feature's copy lives in ./publishing-accounts and is merged
// here. The exported dictionaries stay reference-identical per locale
// (dictionaries.pt === ptDictionary), and the Dictionary/TranslationKey
// contract below covers the merged keys.
//---------------

export const ptDictionary = {
  ...basePtDictionary,
  apiKeys: { ...basePtDictionary.apiKeys, ...publishingAccountsStrings.pt.apiKeys },
  persona: { ...basePtDictionary.persona, ...publishingAccountsStrings.pt.persona },
};

export const enDictionary = {
  ...baseEnDictionary,
  apiKeys: { ...baseEnDictionary.apiKeys, ...publishingAccountsStrings.en.apiKeys },
  persona: { ...baseEnDictionary.persona, ...publishingAccountsStrings.en.persona },
};

type PublishingAccountsKeys = typeof publishingAccountsStrings.en;
export type Dictionary = BaseDictionary & {
  [Section in keyof PublishingAccountsKeys]: {
    [Key in keyof PublishingAccountsKeys[Section]]: string;
  };
};

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
