import { ptDictionary as basePtDictionary, type Dictionary as BaseDictionary } from './pt';
import { enDictionary as baseEnDictionary } from './en';
import { publishingAccountsStrings } from './publishing-accounts';
import { metricsStrings } from './metrics-i18n';
import { metricsCoverageStrings } from './metrics-coverage-i18n';
import { metricsFiltersStrings } from './metrics-filters-i18n';
import { metricsChartsStrings } from './metrics-charts-i18n';
import { experimentsStrings } from './experiments-i18n';
import { threadsStrings } from './threads-i18n';
import { facebookStrings } from './facebook-i18n';
import { pinterestStrings } from './pinterest-i18n';
import { fanvueStrings } from './fanvue-i18n';
import { rumbleStrings } from './rumble-i18n';
import { telegramStrings } from './telegram-i18n';
import { promptsStrings } from './nav-prompts-i18n';
import { personaBoundAccountsStrings } from './persona-bound-accounts-i18n';
import { personaLayoutHintStrings } from './persona-layout-hint-i18n';
import { pricingContactStrings } from './pricing-contact-i18n';
import { themeStrings } from './theme-i18n';
import { postsCalendarStrings } from './posts-calendar-i18n';
import { postComposerStrings } from './post-composer-i18n';
import { onboardingStrings } from './onboarding-i18n';
import { userPromptsStrings } from './user-prompts-i18n';
import { shareLinksStrings } from './share-links-i18n';
import { personaIdentityCardStrings } from './persona-identity-card-i18n';
import { notFoundStrings } from './not-found-i18n';
import { accessStrings } from './access-i18n';
import type { Locale } from './types';

export const ptDictionary = {
  ...basePtDictionary,
  apiKeys: basePtDictionary.apiKeys,
  persona: { ...basePtDictionary.persona, ...publishingAccountsStrings.pt.persona },
  nav: { ...basePtDictionary.nav, ...metricsStrings.pt.nav, ...promptsStrings.pt.nav },
  metrics: { ...metricsStrings.pt.metrics, ...metricsCoverageStrings.pt.metrics, ...metricsFiltersStrings.pt.metrics, ...metricsChartsStrings.pt.metrics },
  experiments: experimentsStrings.pt.experiments,
  postPrompt: experimentsStrings.pt.postPrompt,
  accounts: { ...basePtDictionary.accounts, ...threadsStrings.pt.accounts, ...facebookStrings.pt.accounts, ...pinterestStrings.pt.accounts, ...fanvueStrings.pt.accounts, ...rumbleStrings.pt.accounts, ...telegramStrings.pt.accounts },
  posts: { ...basePtDictionary.posts, ...postsCalendarStrings.pt.posts },
  composer: postComposerStrings.pt.composer,
  personas: { ...basePtDictionary.personas, ...personaLayoutHintStrings.pt.personas, ...personaBoundAccountsStrings.pt.personas },
  landing: { ...basePtDictionary.landing, ...pricingContactStrings.pt.landing },
  theme: themeStrings.pt.theme,
  onboarding: onboardingStrings.pt.onboarding,
  userPrompts: userPromptsStrings.pt.userPrompts,
  shareLinks: shareLinksStrings.pt.shareLinks,
  sharedView: shareLinksStrings.pt.sharedView,
  identityCard: personaIdentityCardStrings.pt.identityCard,
  notFound: notFoundStrings.pt.notFound,
  access: accessStrings.pt.access,
};

export const enDictionary = {
  ...baseEnDictionary,
  apiKeys: baseEnDictionary.apiKeys,
  persona: { ...baseEnDictionary.persona, ...publishingAccountsStrings.en.persona },
  nav: { ...baseEnDictionary.nav, ...metricsStrings.en.nav, ...promptsStrings.en.nav },
  metrics: { ...metricsStrings.en.metrics, ...metricsCoverageStrings.en.metrics, ...metricsFiltersStrings.en.metrics, ...metricsChartsStrings.en.metrics },
  experiments: experimentsStrings.en.experiments,
  postPrompt: experimentsStrings.en.postPrompt,
  accounts: { ...baseEnDictionary.accounts, ...threadsStrings.en.accounts, ...facebookStrings.en.accounts, ...pinterestStrings.en.accounts, ...fanvueStrings.en.accounts, ...rumbleStrings.en.accounts, ...telegramStrings.en.accounts },
  posts: { ...baseEnDictionary.posts, ...postsCalendarStrings.en.posts },
  composer: postComposerStrings.en.composer,
  personas: { ...baseEnDictionary.personas, ...personaLayoutHintStrings.en.personas, ...personaBoundAccountsStrings.en.personas },
  landing: { ...baseEnDictionary.landing, ...pricingContactStrings.en.landing },
  theme: themeStrings.en.theme,
  onboarding: onboardingStrings.en.onboarding,
  userPrompts: userPromptsStrings.en.userPrompts,
  shareLinks: shareLinksStrings.en.shareLinks,
  sharedView: shareLinksStrings.en.sharedView,
  identityCard: personaIdentityCardStrings.en.identityCard,
  notFound: notFoundStrings.en.notFound,
  access: accessStrings.en.access,
};

type PublishingAccountsKeys = typeof publishingAccountsStrings.en;
type MetricsKeys = typeof metricsStrings.en;
type ExperimentsKeys = typeof experimentsStrings.en;
type MetricsCoverageKeys = typeof metricsCoverageStrings.en;
type MetricsFiltersKeys = typeof metricsFiltersStrings.en;
type MetricsChartsKeys = typeof metricsChartsStrings.en;
type ThreadsKeys = typeof threadsStrings.en & typeof facebookStrings.en & typeof pinterestStrings.en & typeof fanvueStrings.en & typeof rumbleStrings.en & typeof telegramStrings.en;
type PromptsKeys = typeof promptsStrings.en;
type PersonaLayoutHintKeys = typeof personaLayoutHintStrings.en;
type PersonaBoundAccountsKeys = typeof personaBoundAccountsStrings.en;
type PricingContactKeys = typeof pricingContactStrings.en;
type ThemeKeys = typeof themeStrings.en;
type PostsCalendarKeys = typeof postsCalendarStrings.en;
type PostComposerKeys = typeof postComposerStrings.en;
type OnboardingKeys = typeof onboardingStrings.en;
type UserPromptsKeys = typeof userPromptsStrings.en;
type ShareLinksKeys = typeof shareLinksStrings.en;
type IdentityCardKeys = typeof personaIdentityCardStrings.en;
type NotFoundKeys = typeof notFoundStrings.en;
type AccessKeys = typeof accessStrings.en;
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
  [Section in keyof MetricsFiltersKeys]: {
    [Key in keyof MetricsFiltersKeys[Section]]: string;
  };
} & {
  [Section in keyof MetricsChartsKeys]: {
    [Key in keyof MetricsChartsKeys[Section]]: string;
  };
} & {
  [Section in keyof PromptsKeys]: {
    [Key in keyof PromptsKeys[Section]]: string;
  };
} & {
  [Section in keyof PersonaLayoutHintKeys]: {
    [Key in keyof PersonaLayoutHintKeys[Section]]: string;
  };
} & {
  [Section in keyof PersonaBoundAccountsKeys]: {
    [Key in keyof PersonaBoundAccountsKeys[Section]]: string;
  };
} & {
  [Section in keyof PricingContactKeys]: {
    [Key in keyof PricingContactKeys[Section]]: string;
  };
} & {
  [Section in keyof PostsCalendarKeys]: {
    [Key in keyof PostsCalendarKeys[Section]]: string;
  };
} & {
  [Section in keyof PostComposerKeys]: {
    [Key in keyof PostComposerKeys[Section]]: string;
  };
} & {
  [Section in keyof OnboardingKeys]: {
    [Key in keyof OnboardingKeys[Section]]: string;
  };
} & {
  [Section in keyof UserPromptsKeys]: {
    [Key in keyof UserPromptsKeys[Section]]: string;
  };
} & {
  [Section in keyof ShareLinksKeys]: {
    [Key in keyof ShareLinksKeys[Section]]: string;
  };
} & {
  [Section in keyof IdentityCardKeys]: {
    [Key in keyof IdentityCardKeys[Section]]: string;
  };
} & {
  [Section in keyof NotFoundKeys]: {
    [Key in keyof NotFoundKeys[Section]]: string;
  };
} & {
  [Section in keyof AccessKeys]: {
    [Key in keyof AccessKeys[Section]]: string;
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

export type TranslationKey = {
  [Section in keyof Dictionary]: {
    [Key in keyof Dictionary[Section]]: Key extends string
      ? Section extends string
        ? `${Section}.${Key}`
        : never
      : never;
  }[keyof Dictionary[Section]];
}[keyof Dictionary];
