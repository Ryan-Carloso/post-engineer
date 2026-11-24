'use client';

import { useEffect } from 'react';
import { INPUT_CLASS } from '@/lib/ui';
import { useI18n } from '@/lib/i18n/provider';
import type { TranslationKey } from '@/lib/i18n';
import { usePersonaStore } from '@/lib/store';
import { usePersonaIdentityCardQuery } from '@/lib/persona-identity-card-api';
import {
  IDENTITY_CARD_GROUPS,
  cardToDraft,
  type IdentityCardDraft,
  type IdentityCardFieldKey,
} from '@/lib/persona-identity-card-form';
import { IDENTITY_TEXT_MAX_LENGTH } from '@/lib/contracts/persona-identity-card';
import { InlineFieldError, SectionDivider } from './persona-section-parts';

const FIELD_LABELS: Record<IdentityCardFieldKey, TranslationKey> = {
  'face.shape': 'identityCard.face_shape',
  'face.eyes': 'identityCard.face_eyes',
  'face.eyebrows': 'identityCard.face_eyebrows',
  'face.nose': 'identityCard.face_nose',
  'face.lips': 'identityCard.face_lips',
  'face.skin': 'identityCard.face_skin',
  'face.facial_hair': 'identityCard.face_facial_hair',
  'face.marks': 'identityCard.face_marks',
  'face.hair.color': 'identityCard.face_hair_color',
  'face.hair.style': 'identityCard.face_hair_style',
  'face.hair.length': 'identityCard.face_hair_length',
  'body.build': 'identityCard.body_build',
  'body.height': 'identityCard.body_height',
  'body.shoulders': 'identityCard.body_shoulders',
  'body.hands': 'identityCard.body_hands',
  'outfit.top': 'identityCard.outfit_top',
  'outfit.bottom': 'identityCard.outfit_bottom',
  'outfit.one_piece': 'identityCard.outfit_one_piece',
  'outfit.outerwear': 'identityCard.outfit_outerwear',
  'outfit.footwear': 'identityCard.outfit_footwear',
  'outfit.accessories': 'identityCard.outfit_accessories',
};

const GROUP_LABELS: Record<'face' | 'hair' | 'body' | 'outfit', TranslationKey> = {
  face: 'identityCard.groupFace',
  hair: 'identityCard.groupHair',
  body: 'identityCard.groupBody',
  outfit: 'identityCard.groupOutfit',
};

interface IdentityCardFieldsProps {
  draft: IdentityCardDraft;
  disabled: boolean;
  onChange: (key: IdentityCardFieldKey, value: string) => void;
}

function IdentityCardFields({ draft, disabled, onChange }: IdentityCardFieldsProps) {
  const { t } = useI18n();
  return (
    <div className="space-y-5">
      {IDENTITY_CARD_GROUPS.map((group) => (
        <fieldset key={group.id} disabled={disabled}>
          <legend className="text-sm font-semibold text-ink">{t(GROUP_LABELS[group.id])}</legend>
          {group.id === 'outfit' ? (
            <p className="mt-1 text-xs leading-5 text-muted-text">{t('identityCard.outfitHint')}</p>
          ) : null}
          <div className="mt-2 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
            {group.fields.map((key) => (
              <label key={key} className="block text-sm font-medium text-ink-soft">
                {t(FIELD_LABELS[key])}
                <input
                  type="text"
                  className={INPUT_CLASS}
                  maxLength={IDENTITY_TEXT_MAX_LENGTH}
                  value={draft[key]}
                  disabled={disabled}
                  data-testid={`identity-card-${key}`}
                  onChange={(event) => onChange(key, event.target.value)}
                />
              </label>
            ))}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

export function PersonaIdentityCardSection({ personaId }: { personaId: string | null }) {
  const { t } = useI18n();
  const query = usePersonaIdentityCardQuery(personaId);
  const draft = usePersonaStore((s) => s.identityCardDraft);
  const isSubmitting = usePersonaStore((s) => s.isSubmitting);
  const storedDraft = query.isSuccess ? cardToDraft(query.data) : null;

  useEffect(() => {
    usePersonaStore.getState().resetIdentityCard();
  }, [personaId]);

  useEffect(() => {
    if (!query.isSuccess) return;
    usePersonaStore.getState().applyServerIdentityCard(cardToDraft(query.data));
  }, [personaId, query.isSuccess, query.dataUpdatedAt]);

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
          draft={draft}
          disabled={isSubmitting || isLoading || query.isError}
          onChange={(key, value) => usePersonaStore.getState().setIdentityCardField(key, value)}
        />
      </div>
    </section>
  );
}
