//---------------
// i18n — unified dictionary exports and type utilities
//---------------

import { ptDictionary as basePtDictionary, type Dictionary as BaseDictionary } from './pt';
import { enDictionary as baseEnDictionary } from './en';
import { publishingAccountsStrings } from './publishing-accounts';
import { metricsStrings } from './metrics-i18n';
import { voiceFallbackStrings } from './voice-fallback-i18n';
import { facelessMaterialStrings } from './faceless-material-i18n';
import type { Locale } from './types';

//---------------
// Per-persona default publishing accounts (issue #212): en.ts/pt.ts are
// grandfathered over the 500-line file-size cap and may not grow a single
// line, so the feature's copy lives in ./publishing-accounts and is merged
// here. The faceless material copy follows the same pattern
// (./faceless-material-i18n, merged into newPost/posts/personas below). The exported
// dictionaries stay reference-identical per locale
// (dictionaries.pt === ptDictionary), and the Dictionary/TranslationKey
// contract below covers the merged keys.
//---------------

export const ptDictionary = {
  ...basePtDictionary,
  apiKeys: { ...basePtDictionary.apiKeys, ...publishingAccountsStrings.pt.apiKeys },
  persona: { ...basePtDictionary.persona, ...publishingAccountsStrings.pt.persona, ...voiceFallbackStrings.pt.persona },
  newPost: { ...basePtDictionary.newPost, ...voiceFallbackStrings.pt.newPost, ...facelessMaterialStrings.pt.newPost },
  nav: { ...basePtDictionary.nav, ...metricsStrings.pt.nav },
  metrics: metricsStrings.pt.metrics,
  posts: { ...basePtDictionary.posts, ...facelessMaterialStrings.pt.posts },
  personas: { ...basePtDictionary.personas, ...facelessMaterialStrings.pt.personas },
};

export const enDictionary = {
  ...baseEnDictionary,
  apiKeys: { ...baseEnDictionary.apiKeys, ...publishingAccountsStrings.en.apiKeys },
  persona: { ...baseEnDictionary.persona, ...publishingAccountsStrings.en.persona, ...voiceFallbackStrings.en.persona },
  newPost: { ...baseEnDictionary.newPost, ...voiceFallbackStrings.en.newPost, ...facelessMaterialStrings.en.newPost },
  nav: { ...baseEnDictionary.nav, ...metricsStrings.en.nav },
  metrics: metricsStrings.en.metrics,
  posts: { ...baseEnDictionary.posts, ...facelessMaterialStrings.en.posts },
  personas: { ...baseEnDictionary.personas, ...facelessMaterialStrings.en.personas },
};

type PublishingAccountsKeys = typeof publishingAccountsStrings.en;
type MetricsKeys = typeof metricsStrings.en;
type VoiceFallbackKeys = typeof voiceFallbackStrings.en;
type FacelessMaterialKeys = typeof facelessMaterialStrings.en;
export type Dictionary = BaseDictionary & {
  [Section in keyof PublishingAccountsKeys]: {
    [Key in keyof PublishingAccountsKeys[Section]]: string;
  };
} & {
  [Section in keyof MetricsKeys]: {
    [Key in keyof MetricsKeys[Section]]: string;
  };
} & {
  [Section in keyof VoiceFallbackKeys]: {
    [Key in keyof VoiceFallbackKeys[Section]]: string;
  };
} & {
  [Section in keyof FacelessMaterialKeys]: {
    [Key in keyof FacelessMaterialKeys[Section]]: string;
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
