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
  type IdentityCardTextFieldKey,
} from '@/lib/persona-identity-card-form';
import { CARD_STYLES, IDENTITY_TEXT_MAX_LENGTH, type CardStyle } from '@/lib/contracts/persona-identity-card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { InlineFieldError, SectionDivider } from './persona-section-parts';

const FIELD_LABELS: Record<IdentityCardTextFieldKey, TranslationKey> = {
  'face.shape': 'identityCard.face_shape',
  'face.eyes': 'identityCard.face_eyes',
  'face.eye_color': 'identityCard.face_eye_color',
  'face.eyebrows': 'identityCard.face_eyebrows',
  'face.nose': 'identityCard.face_nose',
  'face.lips': 'identityCard.face_lips',
  'face.teeth': 'identityCard.face_teeth',
  'face.smile': 'identityCard.face_smile',
  'face.skin': 'identityCard.face_skin',
  'face.jawline': 'identityCard.face_jawline',
  'face.cheekbones': 'identityCard.face_cheekbones',
  'face.chin': 'identityCard.face_chin',
  'face.forehead': 'identityCard.face_forehead',
  'face.ears': 'identityCard.face_ears',
  'face.facial_hair': 'identityCard.face_facial_hair',
  'face.marks': 'identityCard.face_marks',
  'face.tattoos': 'identityCard.face_tattoos',
  'face.hair.color': 'identityCard.face_hair_color',
  'face.hair.style': 'identityCard.face_hair_style',
  'face.hair.length': 'identityCard.face_hair_length',
  'face.hair.texture': 'identityCard.face_hair_texture',
  'face.hair.parting': 'identityCard.face_hair_parting',
  'body.build': 'identityCard.body_build',
  'body.height': 'identityCard.body_height',
  'body.shoulders': 'identityCard.body_shoulders',
  'body.arms': 'identityCard.body_arms',
  'body.hands': 'identityCard.body_hands',
  'body.waist': 'identityCard.body_waist',
  'body.hips': 'identityCard.body_hips',
  'body.legs': 'identityCard.body_legs',
  'body.posture': 'identityCard.body_posture',
  'body.proportions': 'identityCard.body_proportions',
  'outfit.top': 'identityCard.outfit_top',
  'outfit.bottom': 'identityCard.outfit_bottom',
  'outfit.one_piece': 'identityCard.outfit_one_piece',
  'outfit.outerwear': 'identityCard.outfit_outerwear',
  'outfit.footwear': 'identityCard.outfit_footwear',
  'outfit.accessories': 'identityCard.outfit_accessories',
};

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

const GROUP_LABELS: Record<'face' | 'hair' | 'body' | 'style' | 'outfit', TranslationKey> = {
  face: 'identityCard.groupFace',
  hair: 'identityCard.groupHair',
  body: 'identityCard.groupBody',
  style: 'identityCard.groupStyle',
  outfit: 'identityCard.groupOutfit',
};

interface IdentityCardFieldsProps {
  draft: IdentityCardDraft;
  disabled: boolean;
  onChange: (key: IdentityCardFieldKey, value: string) => void;
}

function TextField({
  fieldKey,
  draft,
  disabled,
  onChange,
}: IdentityCardFieldsProps & { fieldKey: IdentityCardFieldKey }) {
  const { t } = useI18n();
  if (!isTextField(fieldKey)) return null;
  return (
    <label className="block text-sm font-medium text-ink-soft">
      {t(FIELD_LABELS[fieldKey])}
      <input
        type="text"
        className={INPUT_CLASS}
        maxLength={IDENTITY_TEXT_MAX_LENGTH}
        value={draft[fieldKey]}
        disabled={disabled}
        data-testid={`identity-card-${fieldKey}`}
        onChange={(event) => onChange(fieldKey, event.target.value)}
      />
    </label>
  );
}

function isTextField(key: IdentityCardFieldKey): key is IdentityCardTextFieldKey {
  return key !== 'style';
}

function StyleSelect({ draft, disabled, onChange }: IdentityCardFieldsProps) {
  const { t } = useI18n();
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <p className="text-xs leading-5 text-muted-text">{t('identityCard.styleHint')}</p>
      <Select
        value={draft.style === '' ? NO_STYLE : draft.style}
        disabled={disabled}
        onValueChange={(value) => onChange('style', value === NO_STYLE ? '' : value)}
      >
        <SelectTrigger aria-label={t('identityCard.styleLabel')} className="w-full sm:max-w-xs" data-testid="identity-card-style">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_STYLE}>{t('identityCard.styleNone')}</SelectItem>
          {CARD_STYLES.map((style) => (
            <SelectItem key={style} value={style}>
              {t(STYLE_LABELS[style])}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function IdentityCardFields(props: IdentityCardFieldsProps) {
  const { draft, disabled, onChange } = props;
  const { t } = useI18n();
  return (
    <div className="space-y-5">
      {IDENTITY_CARD_GROUPS.map((group) => (
        <fieldset key={group.id} disabled={disabled}>
          <legend className="text-sm font-semibold text-ink">{t(GROUP_LABELS[group.id])}</legend>
          {group.id === 'outfit' ? (
            <p className="mt-1 text-xs leading-5 text-muted-text">{t('identityCard.outfitHint')}</p>
          ) : null}
          {group.id === 'style' ? (
            <StyleSelect {...props} />
          ) : (
            <div className="mt-2 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
              {group.fields.map((key) => (
                <TextField key={key} fieldKey={key} draft={draft} disabled={disabled} onChange={onChange} />
              ))}
            </div>
          )}
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
