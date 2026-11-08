'use client';

import { useI18n } from '@/lib/i18n/provider';
import { LOCALES } from '@/lib/i18n';

//---------------
// HeaderLocaleSwitcher — seletor PT/EN do header
//---------------
export default function HeaderLocaleSwitcher() {
  const { locale, setLocale } = useI18n();
  return (
    <div className="flex items-center gap-0.5 rounded-lg bg-sunken p-0.5">
      {LOCALES.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => setLocale(option.value)}
          aria-pressed={option.value === locale}
          className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
            option.value === locale
              ? 'bg-card text-ink shadow-sm'
              : 'text-muted-text hover:text-ink'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
