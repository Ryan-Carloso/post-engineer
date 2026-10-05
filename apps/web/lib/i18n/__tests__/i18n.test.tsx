import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

import { ptDictionary, enDictionary, dictionaries, LOCALES } from '@/lib/i18n';
import { STORAGE_KEY, DEFAULT_LOCALE } from '@/lib/i18n/types';
import { I18nProvider, useI18n } from '@/lib/i18n/provider';

describe('i18n dictionaries', () => {
  it('exposes pt dictionary', () => {
    expect(ptDictionary.nav.brand).toBe('Post Engineer');
    expect(ptDictionary.posts.title).toBeTruthy();
  });

  it('exposes en dictionary', () => {
    expect(enDictionary.nav.brand).toBe('Post Engineer');
    expect(enDictionary.posts.title).toBeTruthy();
  });

  it('dictionaries maps locales to data', () => {
    expect(dictionaries.pt).toBe(ptDictionary);
    expect(dictionaries.en).toBe(enDictionary);
  });

  it('LOCALES lists pt and en, default is pt', () => {
    expect(LOCALES.map((l) => l.value)).toEqual(['pt', 'en']);
    expect(DEFAULT_LOCALE).toBe('pt');
  });

  it('pt and en have identical key shapes', () => {
    const keys = (obj: Record<string, unknown>): string[] =>
      Object.keys(obj).sort();
    expect(keys(ptDictionary as Record<string, unknown>)).toEqual(
      keys(enDictionary as Record<string, unknown>),
    );
    for (const section of Object.keys(ptDictionary)) {
      const ptSection = ptDictionary[section as keyof typeof ptDictionary];
      const enSection = enDictionary[section as keyof typeof enDictionary];
      expect(keys(ptSection as Record<string, unknown>)).toEqual(
        keys(enSection as Record<string, unknown>),
      );
    }
  });

  //---------------
  // The scheduling screen is gone: its copy must go with it. The home tab
  // was deliberately restored (user decision — the removal made no sense),
  // so nav.home/nav.homeHint are live keys again.
  //---------------
  it('carries no scheduling copy', () => {
    for (const key of ['schedule', 'scheduleHint'] as const) {
      expect(ptDictionary.nav).not.toHaveProperty(key);
      expect(enDictionary.nav).not.toHaveProperty(key);
    }
    expect(ptDictionary).not.toHaveProperty('fillSchedule');
    expect(enDictionary).not.toHaveProperty('fillSchedule');
  });

  it('restores the home tab copy', () => {
    expect(ptDictionary.nav.home).toBe('Início');
    expect(ptDictionary.nav.homeHint).toBe('Visão geral');
    expect(enDictionary.nav.home).toBe('Home');
    expect(enDictionary.nav.homeHint).toBe('Overview');
  });
});

describe('I18nProvider', () => {
  const TestConsumer = () => {
    const { locale, setLocale, t } = useI18n();
    return (
      <div>
        <span data-testid="locale">{locale}</span>
        <span data-testid="brand">{t('nav.brand')}</span>
        <span data-testid="connected">
          {t('accounts.accountsConnected', { count: 3 })}
        </span>
        <button type="button" onClick={() => setLocale('en')}>
          switch
        </button>
      </div>
    );
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders children with default locale', () => {
    render(
      <I18nProvider>
        <TestConsumer />
      </I18nProvider>,
    );
    expect(screen.getByTestId('locale').textContent).toBe('pt');
    expect(screen.getByTestId('brand').textContent).toBe('Post Engineer');
    expect(screen.getByTestId('connected').textContent).toBe(
      ptDictionary.accounts.accountsConnected.replace('{count}', '3'),
    );
  });

  it('loads stored locale on mount', () => {
    window.localStorage.setItem(STORAGE_KEY, 'en');
    render(
      <I18nProvider>
        <TestConsumer />
      </I18nProvider>,
    );
    expect(screen.getByTestId('locale').textContent).toBe('en');
    expect(screen.getByTestId('brand').textContent).toBe('Post Engineer');
  });

  it('setLocale switches translations and persists to localStorage', () => {
    render(
      <I18nProvider>
        <TestConsumer />
      </I18nProvider>,
    );
    act(() => {
      screen.getByRole('button', { name: 'switch' }).click();
    });
    expect(screen.getByTestId('locale').textContent).toBe('en');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('en');
    expect(screen.getByTestId('connected').textContent).toBe(
      enDictionary.accounts.accountsConnected.replace('{count}', '3'),
    );
  });

  it('defaults to pt when stored value is invalid', () => {
    window.localStorage.setItem(STORAGE_KEY, 'fr');
    render(
      <I18nProvider>
        <TestConsumer />
      </I18nProvider>,
    );
    expect(screen.getByTestId('locale').textContent).toBe('pt');
  });

  it('t translates oauth error keys', () => {
    const Oauth = () => (
      <span data-testid="oauth">{useI18n().t('oauth.popupBlocked')}</span>
    );
    render(
      <I18nProvider>
        <Oauth />
      </I18nProvider>,
    );
    expect(screen.getByTestId('oauth').textContent).toBe(
      ptDictionary.oauth.popupBlocked,
    );
  });
});

describe('useI18n outside provider', () => {
  it('throws when used outside an I18nProvider', () => {
    const Boom = () => {
      useI18n();
      return null;
    };
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Boom />)).toThrow(
      'useI18n deve ser usado dentro de <I18nProvider>',
    );
    error.mockRestore();
  });
});
