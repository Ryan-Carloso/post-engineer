'use client';

import { useEffect } from 'react';
import { INPUT_CLASS } from '@/lib/ui';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n/provider';
import type { TranslationKey } from '@/lib/i18n';
import { usePersonaStore } from '@/lib/store';
import { usePersonaIdentityCardQuery } from '@/lib/persona-identity-card-api';
import { cardToDraft } from '@/lib/persona-identity-card-form';
import { CARD_STYLES, IDENTITY_CARD_MAX_BYTES, type CardStyle } from '@/lib/contracts/persona-identity-card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { InlineFieldError, SectionDivider } from './persona-section-parts';

const STYLE_LABELS: Record<CardStyle, TranslationKey> = {
  casual: 'identityCard.style_casual',
  business: 'identityCard.style_business',
  business_casual: 'identityCard.style_business_casual',
  formal: 'identityCard.style_formal',
  elegant: 'identityCard.style_elegant',
  romantic: 'identityCard.style_romantic',
  sensual: 'identityCard.style_sensual',
  sporty: 'identityCard.style_sporty',
  athleisure: 'identityCard.style_athleisure',
  streetwear: 'identityCard.style_streetwear',
  boho: 'identityCard.style_boho',
  minimalist: 'identityCard.style_minimalist',
  vintage: 'identityCard.style_vintage',
  glamorous: 'identityCard.style_glamorous',
  edgy: 'identityCard.style_edgy',
  cozy: 'identityCard.style_cozy',
  beach: 'identityCard.style_beach',
  party: 'identityCard.style_party',
  outdoor: 'identityCard.style_outdoor',
};

const NO_STYLE = '__none';
const TEXTAREA_MAX_LENGTH = IDENTITY_CARD_MAX_BYTES;

interface IdentityCardFieldsProps {
  disabled: boolean;
  onChange: (key: 'text' | 'style', value: string) => void;
}

function StyleSelect({ disabled, onChange }: IdentityCardFieldsProps) {
  const { t } = useI18n();
  const style = usePersonaStore((s) => s.identityCardDraft.style);
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs leading-5 text-muted-text">{t('identityCard.styleHint')}</p>
      <Select
        value={style === '' ? NO_STYLE : style}
        disabled={disabled}
        onValueChange={(value) => onChange('style', value === NO_STYLE ? '' : value)}
      >
        <SelectTrigger aria-label={t('identityCard.styleLabel')} className="w-full sm:max-w-xs" data-testid="identity-card-style">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_STYLE}>{t('identityCard.styleNone')}</SelectItem>
          {CARD_STYLES.map((cardStyle) => (
            <SelectItem key={cardStyle} value={cardStyle}>
              {t(STYLE_LABELS[cardStyle])}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function IdentityDescriptionField({ disabled, onChange }: IdentityCardFieldsProps) {
  const { t } = useI18n();
  const text = usePersonaStore((s) => s.identityCardDraft.text);
  return (
    <label className="block text-sm font-medium text-ink-soft">
      {t('identityCard.descriptionLabel')}
      <textarea
        className={cn(INPUT_CLASS, 'min-h-40 resize-y leading-6')}
        maxLength={TEXTAREA_MAX_LENGTH}
        value={text}
        disabled={disabled}
        placeholder={t('identityCard.descriptionPlaceholder')}
        data-testid="identity-card-text"
        onChange={(event) => onChange('text', event.target.value)}
      />
    </label>
  );
}

function IdentityCardFields(props: IdentityCardFieldsProps) {
  const { disabled, onChange } = props;
  const { t } = useI18n();
  return (
    <fieldset disabled={disabled} className="space-y-4">
      <legend className="sr-only">{t('identityCard.descriptionLabel')}</legend>
      <IdentityDescriptionField disabled={disabled} onChange={onChange} />
      <p className="text-xs leading-5 text-muted-text">{t('identityCard.descriptionHint')}</p>
      <StyleSelect disabled={disabled} onChange={onChange} />
    </fieldset>
  );
}

export function PersonaIdentityCardSection({ personaId }: { personaId: string | null }) {
  const { t } = useI18n();
  const query = usePersonaIdentityCardQuery(personaId);
  const isSubmitting = usePersonaStore((s) => s.isSubmitting);
  const storedDraft = query.isSuccess ? cardToDraft(query.data) : null;

  useEffect(() => {
    usePersonaStore.getState().resetIdentityCard();
  }, [personaId]);

  useEffect(() => {
    if (!query.isSuccess) return;
    usePersonaStore.getState().applyServerIdentityCard(cardToDraft(query.data));
  }, [personaId, query.isSuccess, query.dataUpdatedAt, query.data]);

  const isLoading = personaId !== null && storedDraft === null && !query.isError;
  return (
    <section
      data-error-field="identity-card"
      data-testid="persona-identity-card"
      className="rounded-2xl border border-line bg-card p-5 shadow-sm sm:p-6"
    >
      <SectionDivider label={t('identityCard.sectionLabel')} />
      <div className="mt-4 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-ink">{t('identityCard.title')}</h2>
          <p className="mt-1 text-xs leading-5 text-muted-text">{t('identityCard.note')}</p>
          <p className="mt-2 text-xs leading-5 text-muted-text" data-testid="identity-card-consent">
            {t('identityCard.consent')}
          </p>
          <p className="mt-2 text-xs leading-5 text-muted-text">{t('identityCard.limitHint')}</p>
        </div>
        {query.isError ? (
          <div>
            <InlineFieldError message={t('identityCard.loadError')} />
            <button
              type="button"
              onClick={() => void query.refetch()}
              disabled={query.isFetching}
              className="mt-2 text-sm font-semibold text-accent underline-offset-2 hover:underline disabled:opacity-60"
            >
              {t('persona.tryAgain')}
            </button>
          </div>
        ) : null}
        {isLoading ? <p className="text-sm text-muted-text">{t('identityCard.loading')}</p> : null}
        <IdentityCardFields
          disabled={isSubmitting || isLoading || query.isError}
          onChange={(key, value) => usePersonaStore.getState().setIdentityCardField(key, value)}
        />
      </div>
    </section>
  );
}
