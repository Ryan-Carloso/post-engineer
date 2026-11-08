'use client';

import { useSyncExternalStore } from 'react';
import { useTheme } from 'next-themes';
import { ThemeToggle, type ThemeChoice } from '@/components/ui/theme-toggle';
import { useI18n } from '@/lib/i18n/provider';

const subscribe = (): (() => void) => () => undefined;

function isThemeChoice(value: string | undefined): value is ThemeChoice {
  return value === 'light' || value === 'dark' || value === 'system';
}

// next-themes' provider is mounted in app/providers.tsx. The stored choice is
// only known on the client (next-themes reads localStorage in its state
// initializer), so the server and the hydration render could disagree on the
// pressed option. Until mounted (useSyncExternalStore uses the server snapshot,
// false, on the server and during hydration) the control renders the server
// value, "system", and stays disabled; the stored choice appears right after.
export default function ThemeSwitcher({ className }: { className?: string }) {
  const { t } = useI18n();
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  const value: ThemeChoice = mounted && isThemeChoice(theme) ? theme : 'system';
  return (
    <ThemeToggle
      className={className}
      value={value}
      onChange={setTheme}
      disabled={!mounted}
      labels={{ group: t('theme.label'), light: t('theme.light'), dark: t('theme.dark'), system: t('theme.system') }}
    />
  );
}
