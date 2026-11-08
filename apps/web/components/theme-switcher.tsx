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
// only known on the client, so the control stays disabled during SSR/hydration
// (useSyncExternalStore returns false on the server) to avoid a mismatch.
export default function ThemeSwitcher({ className }: { className?: string }) {
  const { t } = useI18n();
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  return (
    <ThemeToggle
      className={className}
      value={isThemeChoice(theme) ? theme : 'system'}
      onChange={setTheme}
      disabled={!mounted}
      labels={{ group: t('theme.label'), light: t('theme.light'), dark: t('theme.dark'), system: t('theme.system') }}
    />
  );
}
