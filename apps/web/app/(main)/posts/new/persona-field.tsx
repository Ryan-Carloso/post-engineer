'use client';

import Link from 'next/link';

import { useI18n } from '@/lib/i18n/provider';
import { INPUT_CLASS } from '@/lib/ui';
import type { PersonaRecord } from '@/lib/persona-record';

export function PersonaField({
  personas,
  loading,
  value,
  boundCount,
  disabled,
  onChange,
}: {
  personas: PersonaRecord[];
  loading: boolean;
  value: string | null;
  boundCount: number | null;
  disabled: boolean;
  onChange: (personaId: string | null) => void;
}) {
  const { t } = useI18n();
  const empty = boundCount === 0;

  return (
    <section className="rounded-2xl border border-line bg-card p-5 shadow-sm" data-testid="composer-persona">
      <label htmlFor="composer-persona" className="block text-xs font-medium text-ink-soft">
        {t('composer.personaLabel')}
      </label>
      <select
        id="composer-persona"
        value={value ?? ''}
        disabled={disabled || loading}
        onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
        className={INPUT_CLASS}
      >
        <option value="">{t('composer.personaNone')}</option>
        {personas.map((persona) => (
          <option key={persona.id} value={persona.id}>
            {persona.name}
          </option>
        ))}
      </select>
      <p className="mt-1 text-[11px] text-muted-text">{t('composer.personaHint')}</p>
      {empty ? (
        <div className="mt-2 rounded-xl border border-dashed border-line bg-surface px-3 py-2.5">
          <p className="text-xs font-medium text-destructive">{t('composer.personaNoBound')}</p>
          <Link
            href={`/persona?edit=${encodeURIComponent(value ?? '')}`}
            className="mt-1 inline-block text-xs font-semibold text-accent underline"
          >
            {t('composer.personaNoBoundAction')}
          </Link>
        </div>
      ) : null}
    </section>
  );
}
