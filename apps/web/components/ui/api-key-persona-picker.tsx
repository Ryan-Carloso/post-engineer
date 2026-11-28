'use client';

import type { ReactNode } from 'react';
import { useI18n } from '@/lib/i18n/provider';

export interface PickerPersona {
  id: string;
  name: string;
}

export function isScopeValid(value: string[] | null): boolean {
  return value === null || value.length > 0;
}

export default function ApiKeyPersonaPicker({
  idPrefix,
  personas,
  loadFailed,
  value,
  onChange,
  disabled,
}: {
  idPrefix: string;
  personas: PickerPersona[];
  loadFailed: boolean;
  value: string[] | null;
  onChange: (next: string[] | null) => void;
  disabled: boolean;
}): ReactNode {
  const { t } = useI18n();

  if (personas.length === 0) {
    return (
      <p data-testid={`${idPrefix}-personas-none`} className="text-xs text-muted-text">
        {loadFailed ? t('apiKeys.personasLoadError') : t('apiKeys.personasNone')}
      </p>
    );
  }

  const restricted = value !== null;
  const toggle = (id: string): void => {
    const current = value ?? [];
    onChange(current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  return (
    <fieldset disabled={disabled} className="flex flex-col gap-2">
      <legend className="block text-xs font-medium text-ink-soft">{t('apiKeys.personasLabel')}</legend>
      <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-line bg-card px-3 py-2">
        <input
          type="radio"
          name={`${idPrefix}-scope`}
          data-testid={`${idPrefix}-scope-all`}
          checked={!restricted}
          onChange={() => onChange(null)}
          className="mt-0.5"
        />
        <span>
          <span className="block text-sm font-semibold text-ink">{t('apiKeys.personasAll')}</span>
          <span className="block text-xs text-muted-text">{t('apiKeys.personasAllHint')}</span>
        </span>
      </label>
      <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-line bg-card px-3 py-2">
        <input
          type="radio"
          name={`${idPrefix}-scope`}
          data-testid={`${idPrefix}-scope-selected`}
          checked={restricted}
          onChange={() => onChange([])}
          className="mt-0.5"
        />
        <span className="block text-sm font-semibold text-ink">{t('apiKeys.personasSelected')}</span>
      </label>
      {restricted ? (
        <div className="ml-6 flex flex-col gap-1.5" data-testid={`${idPrefix}-persona-list`}>
          {personas.map((persona) => (
            <label key={persona.id} className="flex cursor-pointer items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                data-testid={`${idPrefix}-persona-${persona.id}`}
                checked={value.includes(persona.id)}
                onChange={() => toggle(persona.id)}
              />
              {persona.name}
            </label>
          ))}
          {value.length === 0 ? (
            <p className="text-xs text-muted-text">{t('apiKeys.personasSelectedHint')}</p>
          ) : null}
        </div>
      ) : null}
    </fieldset>
  );
}
