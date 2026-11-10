//---------------
// i18n — unified dictionary exports and type utilities
//---------------

import { ptDictionary as basePtDictionary, type Dictionary as BaseDictionary } from './pt';
import { enDictionary as baseEnDictionary } from './en';
import { publishingAccountsStrings } from './publishing-accounts';
import { metricsStrings } from './metrics-i18n';
import { metricsCoverageStrings } from './metrics-coverage-i18n';
import { experimentsStrings } from './experiments-i18n';
import { threadsStrings } from './threads-i18n';
import { facebookStrings } from './facebook-i18n';
import { pinterestStrings } from './pinterest-i18n';
import { rumbleStrings } from './rumble-i18n';
import { promptsStrings } from './nav-prompts-i18n';
import { voiceFallbackStrings } from './voice-fallback-i18n';
import { facelessMaterialStrings } from './faceless-material-i18n';
import { pricingContactStrings } from './pricing-contact-i18n';
import { fullLipsyncPriceStrings } from './full-lipsync-price-i18n';
import { themeStrings } from './theme-i18n';
import { postsCalendarStrings } from './posts-calendar-i18n';
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
  tokens: { ...basePtDictionary.tokens, ...fullLipsyncPriceStrings.pt.tokens },
  apiKeys: { ...basePtDictionary.apiKeys, ...publishingAccountsStrings.pt.apiKeys, ...pinterestStrings.pt.apiKeys },
  persona: { ...basePtDictionary.persona, ...publishingAccountsStrings.pt.persona, ...voiceFallbackStrings.pt.persona },
  newPost: { ...voiceFallbackStrings.pt.newPost, ...facelessMaterialStrings.pt.newPost },
  nav: { ...basePtDictionary.nav, ...metricsStrings.pt.nav, ...promptsStrings.pt.nav, ...experimentsStrings.pt.nav },
  metrics: { ...metricsStrings.pt.metrics, ...metricsCoverageStrings.pt.metrics },
  experiments: experimentsStrings.pt.experiments,
  accounts: { ...basePtDictionary.accounts, ...threadsStrings.pt.accounts, ...facebookStrings.pt.accounts, ...pinterestStrings.pt.accounts, ...rumbleStrings.pt.accounts },
  posts: { ...basePtDictionary.posts, ...facelessMaterialStrings.pt.posts, ...postsCalendarStrings.pt.posts },
  personas: { ...basePtDictionary.personas, ...facelessMaterialStrings.pt.personas },
  landing: { ...basePtDictionary.landing, ...pricingContactStrings.pt.landing },
  theme: themeStrings.pt.theme,
};

export const enDictionary = {
  ...baseEnDictionary,
  tokens: { ...baseEnDictionary.tokens, ...fullLipsyncPriceStrings.en.tokens },
  apiKeys: { ...baseEnDictionary.apiKeys, ...publishingAccountsStrings.en.apiKeys, ...pinterestStrings.en.apiKeys },
  persona: { ...baseEnDictionary.persona, ...publishingAccountsStrings.en.persona, ...voiceFallbackStrings.en.persona },
  newPost: { ...voiceFallbackStrings.en.newPost, ...facelessMaterialStrings.en.newPost },
  nav: { ...baseEnDictionary.nav, ...metricsStrings.en.nav, ...promptsStrings.en.nav, ...experimentsStrings.en.nav },
  metrics: { ...metricsStrings.en.metrics, ...metricsCoverageStrings.en.metrics },
  experiments: experimentsStrings.en.experiments,
  accounts: { ...baseEnDictionary.accounts, ...threadsStrings.en.accounts, ...facebookStrings.en.accounts, ...pinterestStrings.en.accounts, ...rumbleStrings.en.accounts },
  posts: { ...baseEnDictionary.posts, ...facelessMaterialStrings.en.posts, ...postsCalendarStrings.en.posts },
  personas: { ...baseEnDictionary.personas, ...facelessMaterialStrings.en.personas },
  landing: { ...baseEnDictionary.landing, ...pricingContactStrings.en.landing },
  theme: themeStrings.en.theme,
};

type PublishingAccountsKeys = typeof publishingAccountsStrings.en;
type MetricsKeys = typeof metricsStrings.en;
type ExperimentsKeys = typeof experimentsStrings.en;
type MetricsCoverageKeys = typeof metricsCoverageStrings.en;
type ThreadsKeys = typeof threadsStrings.en & typeof facebookStrings.en & typeof pinterestStrings.en & typeof rumbleStrings.en;
type PromptsKeys = typeof promptsStrings.en;
type VoiceFallbackKeys = typeof voiceFallbackStrings.en;
type FacelessMaterialKeys = typeof facelessMaterialStrings.en;
type PricingContactKeys = typeof pricingContactStrings.en;
type FullLipsyncPriceKeys = typeof fullLipsyncPriceStrings.en;
type ThemeKeys = typeof themeStrings.en;
type PostsCalendarKeys = typeof postsCalendarStrings.en;
export type Dictionary = BaseDictionary & {
  [Section in keyof ThreadsKeys]: {
    [Key in keyof ThreadsKeys[Section]]: string;
  };
} & {
  [Section in keyof PublishingAccountsKeys]: {
    [Key in keyof PublishingAccountsKeys[Section]]: string;
  };
} & {
  [Section in keyof MetricsKeys]: {
    [Key in keyof MetricsKeys[Section]]: string;
  };
} & {
  [Section in keyof ExperimentsKeys]: {
    [Key in keyof ExperimentsKeys[Section]]: string;
  };
} & {
  [Section in keyof MetricsCoverageKeys]: {
    [Key in keyof MetricsCoverageKeys[Section]]: string;
  };
} & {
  [Section in keyof PromptsKeys]: {
    [Key in keyof PromptsKeys[Section]]: string;
  };
} & {
  [Section in keyof VoiceFallbackKeys]: {
    [Key in keyof VoiceFallbackKeys[Section]]: string;
  };
} & {
  [Section in keyof FacelessMaterialKeys]: {
    [Key in keyof FacelessMaterialKeys[Section]]: string;
  };
} & {
  [Section in keyof PricingContactKeys]: {
    [Key in keyof PricingContactKeys[Section]]: string;
  };
} & {
  [Section in keyof FullLipsyncPriceKeys]: {
    [Key in keyof FullLipsyncPriceKeys[Section]]: string;
  };
} & {
  [Section in keyof PostsCalendarKeys]: {
    [Key in keyof PostsCalendarKeys[Section]]: string;
  };
} & {
  [Section in keyof ThemeKeys]: {
    [Key in keyof ThemeKeys[Section]]: string;
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
