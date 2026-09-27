'use client';

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { dictionaries } from './index';
import type { TranslationKey } from './index';
import type { Locale } from './types';
import { DEFAULT_LOCALE, STORAGE_KEY } from './types';

//---------------
// I18nContext — valor exposto pelo provider
//---------------
interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

//---------------
// resolveKey — accesses a dot-notation value inside the dictionary
//---------------
function resolveKey(dictionary: (typeof dictionaries)[Locale], key: TranslationKey): string {
  const parts = key.split('.') as [string, string];
  const section = dictionary[parts[0] as keyof typeof dictionary];
  if (!section) return key;
  const value = section[parts[1] as keyof typeof section];
  return typeof value === 'string' ? value : key;
}

//---------------
// interpolate — substitui {var} pelos valores passados
//---------------
function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name];
    return value === undefined ? match : String(value);
  });
}

//---------------
// readStoredLocale — carrega o idioma salvo no localStorage
//---------------
function readStoredLocale(): Locale {
  if (typeof window === 'undefined') return DEFAULT_LOCALE;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === 'pt' || stored === 'en' ? stored : DEFAULT_LOCALE;
}

//---------------
// I18nProvider — provides translations and language control to the tree
//---------------
export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  React.useEffect(() => {
    setLocaleState(readStoredLocale());
  }, []);

  const setLocale = useCallback((nextLocale: Locale) => {
    setLocaleState(nextLocale);
    window.localStorage.setItem(STORAGE_KEY, nextLocale);
  }, []);

  const t = useCallback(
    (key: TranslationKey, vars?: Record<string, string | number>): string => {
      const template = resolveKey(dictionaries[locale], key);
      return interpolate(template, vars);
    },
    [locale]
  );

  const value = useMemo<I18nContextValue>(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

//---------------
// useI18n — hook for accessing translations
//---------------
export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n deve ser usado dentro de <I18nProvider>');
  }
  return context;
}
