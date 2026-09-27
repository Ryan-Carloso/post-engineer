'use client';

import { computeVideoTokens } from '@/lib/tokens';
import { usePersonaStore } from '@/lib/store';
import { useI18n } from '@/lib/i18n/provider';

//---------------
// PersonaTokensSection — mix faceless/face + qualidade da face + custo
// estimado por vídeo (mock de preço, sem backend de cobrança ainda).
// No modo persona o mix é livre (0–100%) e o custo é ponderado pelo mix;
// no faceless os controles ficam travados em 0% → 0.5 token sempre.
//---------------
export function PersonaTokensSection() {
  const personaMode = usePersonaStore((s) => s.personaMode);
  const faceMixPercent = usePersonaStore((s) => s.faceMixPercent);
  const faceQuality = usePersonaStore((s) => s.faceQuality);
  const setFaceMixPercent = usePersonaStore((s) => s.setFaceMixPercent);
  const setFaceQuality = usePersonaStore((s) => s.setFaceQuality);
  const { t } = useI18n();

  const disabled = personaMode === 'faceless';
  const effectiveMix = disabled ? 0 : faceMixPercent;
  const cost = computeVideoTokens(effectiveMix, faceQuality);

  return (
    <section>
      <div className="flex items-center gap-3">
        <span className="text-sm font-semibold text-neutral-900">{t('tokens.mixLabel')}</span>
        <span className="h-px flex-1 bg-neutral-200" />
      </div>

      <div className="mt-4 space-y-4">
        <div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-neutral-700">{t('tokens.mixHint')}</span>
            <span className="shrink-0 text-sm font-medium text-neutral-900">{effectiveMix}%</span>
          </div>
          <input
            type="range"
            data-testid="face-mix-slider"
            aria-label={t('tokens.mixLabel')}
            min={0}
            max={100}
            step={1}
            value={effectiveMix}
            disabled={disabled}
            onChange={(event) => setFaceMixPercent(Number(event.target.value))}
            className="mt-2 block w-full accent-[#ff5a4e]"
          />
        </div>

        {!disabled ? (
          <fieldset>
            <legend className="text-sm font-medium text-neutral-900">
              {t('tokens.qualityLabel')}
            </legend>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <QualityOption
                quality="ok"
                active={faceQuality === 'ok'}
                onSelect={setFaceQuality}
                label={t('tokens.qualityOk')}
              />
              <QualityOption
                quality="very_good"
                active={faceQuality === 'very_good'}
                onSelect={setFaceQuality}
                label={t('tokens.qualityVeryGood')}
              />
            </div>
          </fieldset>
        ) : null}

        <div className="flex items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3">
          <span className="text-sm text-neutral-700">{t('tokens.costLabel')}</span>
          <span data-testid="token-cost-preview" className="shrink-0 text-sm font-semibold text-neutral-900">
            {t('tokens.costValue', { cost })}
          </span>
        </div>
      </div>
    </section>
  );
}

function QualityOption({
  quality,
  active,
  onSelect,
  label,
}: {
  quality: 'ok' | 'very_good';
  active: boolean;
  onSelect: (quality: 'ok' | 'very_good') => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      data-testid={`face-quality-${quality}`}
      aria-checked={active}
      aria-label={label}
      onClick={() => onSelect(quality)}
      className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
        active
          ? 'border-accent bg-red-50/50 text-neutral-900'
          : 'border-neutral-200 bg-white text-neutral-600 hover:border-neutral-400'
      }`}
    >
      {label}
    </button>
  );
}
