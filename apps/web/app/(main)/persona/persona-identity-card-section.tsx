'use client';

import { useEffect } from 'react';
import { INPUT_CLASS } from '@/lib/ui';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n/provider';
import { usePersonaStore } from '@/lib/store';
import { usePersonaIdentityCardQuery } from '@/lib/persona-identity-card-api';
import { cardToText } from '@/lib/persona-identity-card-form';
import { IDENTITY_CARD_MAX_BYTES } from '@/lib/contracts/persona-identity-card';
import { InlineFieldError, SectionDivider } from './persona-section-parts';

export function PersonaIdentityCardSection({ personaId }: { personaId: string | null }) {
  const { t } = useI18n();
  const query = usePersonaIdentityCardQuery(personaId);
  const text = usePersonaStore((s) => s.identityCardDraft);
  const isSubmitting = usePersonaStore((s) => s.isSubmitting);
  const storedText = query.isSuccess ? cardToText(query.data) : null;

  useEffect(() => {
    usePersonaStore.getState().resetIdentityCard();
  }, [personaId]);

  useEffect(() => {
    if (!query.isSuccess) return;
    usePersonaStore.getState().applyServerIdentityCard(cardToText(query.data));
  }, [personaId, query.isSuccess, query.dataUpdatedAt, query.data]);

  const disabled = isSubmitting || (personaId !== null && storedText === null && !query.isError) || query.isError;
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
        {personaId !== null && storedText === null && !query.isError ? (
          <p className="text-sm text-muted-text">{t('identityCard.loading')}</p>
        ) : null}
        <label className="block text-sm font-medium text-ink-soft">
          {t('identityCard.descriptionLabel')}
          <textarea
            className={cn(INPUT_CLASS, 'min-h-44 resize-y font-mono text-xs leading-5')}
            maxLength={IDENTITY_CARD_MAX_BYTES}
            value={text}
            disabled={disabled}
            placeholder={t('identityCard.descriptionPlaceholder')}
            data-testid="identity-card-text"
            onChange={(event) => usePersonaStore.getState().setIdentityCardText(event.target.value)}
          />
        </label>
        <p className="text-xs leading-5 text-muted-text">{t('identityCard.descriptionHint')}</p>
      </div>
    </section>
  );
}
