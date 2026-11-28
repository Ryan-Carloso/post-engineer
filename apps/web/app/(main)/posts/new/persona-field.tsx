'use client';

import Link from 'next/link';

import { useI18n } from '@/lib/i18n/provider';
import { SelectField } from '@/components/ui/select';
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
      <SelectField
        id="composer-persona"
        value={value ?? ''}
        disabled={disabled || loading}
        onValueChange={(next) => onChange(next === '' ? null : next)}
        options={[
          { value: '', label: t('composer.personaNone') },
          ...personas.map((persona) => ({ value: persona.id, label: persona.name })),
        ]}
        className="mt-1.5"
      />
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
