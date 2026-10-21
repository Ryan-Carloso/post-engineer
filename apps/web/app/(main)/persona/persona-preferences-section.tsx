'use client';

import { useFormContext } from 'react-hook-form';
import { INPUT_CLASS } from '@/lib/ui';
import { PERSONA_CTA_MAX_LENGTH, VIDEO_LAYOUTS } from '@/lib/persona-schema';
import { usePersonaStore } from '@/lib/store';
import { useI18n } from '@/lib/i18n/provider';
import { InlineFieldError, SectionDivider } from './persona-section-parts';

//---------------
// PersonaPreferencesSection — optional persona content defaults: video format,
// opening layout, niche and script style.
//---------------

//---------------
// PersonaLayoutFieldset — how the persona meets the b-roll in the opening.
// 'standard' fills the frame with the avatar; 'react' splits it, avatar on
// top and b-roll below. The list comes from VIDEO_LAYOUTS, the same constant
// the API validates against, so a new layout can never appear in the UI
// without the server accepting it.
//---------------
const PersonaLayoutFieldset = () => {
  const videoLayout = usePersonaStore((s) => s.videoLayout);
  const { t } = useI18n();
  return (
    <fieldset>
      <legend className="text-sm font-semibold text-neutral-800">{t('personas.layoutLabel')}</legend>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {VIDEO_LAYOUTS.map((layout) => {
          const isSelected = videoLayout === layout;
          return (
            <button
              key={layout}
              type="button"
              aria-pressed={isSelected}
              onClick={() => usePersonaStore.getState().setVideoLayout(layout)}
              className={`flex min-h-14 items-center justify-center rounded-xl border px-4 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                isSelected
                  ? 'border-accent bg-red-50 text-accent ring-2 ring-accent/10'
                  : 'border-neutral-200 bg-neutral-50 text-neutral-700 hover:border-neutral-400 hover:bg-white'
              }`}
            >
              {t(`personas.layout${layout === 'standard' ? 'Standard' : 'React'}`)}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
};

export function PersonaPreferencesSection() {
  const videoAspect = usePersonaStore((s) => s.videoAspect);
  const result = usePersonaStore((s) => s.result);
  const { t } = useI18n();
  const { register, formState: { errors } } = useFormContext();
  return (
    <section>
      <SectionDivider label={t('personas.preferencesLabel')} />
      <div className="mt-4 space-y-5 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm sm:p-6">
        <fieldset>
          <legend className="text-sm font-semibold text-neutral-800">{t('personas.aspectLabel')}</legend>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {['9:16', '16:9', '1:1'].map((aspect) => {
              const isSelected = videoAspect === aspect;
              return (
                <button
                  key={aspect}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => usePersonaStore.getState().setVideoAspect(aspect)}
                  className={`flex min-h-14 items-center justify-center rounded-xl border px-4 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                    isSelected
                      ? 'border-accent bg-red-50 text-accent ring-2 ring-accent/10'
                      : 'border-neutral-200 bg-neutral-50 text-neutral-700 hover:border-neutral-400 hover:bg-white'
                  }`}
                >
                  {aspect}
                </button>
              );
            })}
          </div>
        </fieldset>
        <PersonaLayoutFieldset />
        <label className="block text-sm font-semibold text-neutral-800">
          {t('personas.nicheLabel')}
          <input
            type="text"
            className={INPUT_CLASS}
            placeholder={t('personas.nichePlaceholder')}
            data-testid="persona-niche"
            {...register('niche')}
          />
          {errors.niche ? (
            <span role="alert" className="mt-1 block text-sm font-normal text-red-600">{t('personas.nicheMaxError')}</span>
          ) : null}
        </label>
        <label className="block text-sm font-semibold text-neutral-800" data-error-field="script">
          {t('personas.scriptLabel')}
          <textarea className={`${INPUT_CLASS} min-h-28 resize-y`} placeholder={t('personas.scriptPlaceholder')} {...register('scriptPrompt')} />
          {errors.scriptPrompt ? (
            <span role="alert" className="mt-1 block text-sm font-normal text-red-600">{t('personas.scriptMaxError')}</span>
          ) : null}
        </label>
        <label className="block text-sm font-semibold text-neutral-800">
          {t('personas.ctaLabel')}
          <input
            type="text"
            className={INPUT_CLASS}
            placeholder={t('personas.ctaPlaceholder')}
            data-testid="persona-cta"
            {...register('ctaText')}
          />
          <span className="mt-1 block text-xs font-normal text-muted-foreground">{t('personas.ctaHint')}</span>
          {errors.ctaText ? (
            <span role="alert" className="mt-1 block text-sm font-normal text-red-600">{t('personas.ctaMaxError', { max: PERSONA_CTA_MAX_LENGTH })}</span>
          ) : null}
        </label>
        {result && !result.success && result.error === 'prompt_rejected' ? (
          <InlineFieldError message={t('persona.errPromptRejected')} />
        ) : null}
      </div>
    </section>
  );
}