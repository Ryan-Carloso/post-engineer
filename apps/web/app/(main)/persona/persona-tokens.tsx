'use client';

import { computeVideoTokens } from '@/lib/tokens';
import { usePersonaStore } from '@/lib/store';
import { useI18n } from '@/lib/i18n/provider';

//---------------
// PersonaTokensSection — face quality + estimated cost per video.
// Every persona has a face ("no face" is chosen per post, at creation), so
// there is no 0-100% mix here anymore: the cost is always the whole face,
// weighted by the chosen quality.
//---------------
export function PersonaTokensSection() {
  const faceQuality = usePersonaStore((s) => s.faceQuality);
  const setFaceQuality = usePersonaStore((s) => s.setFaceQuality);
  const { t } = useI18n();

  // The persona always has a face, so this is the with-face price (faceless is
  // a per-post choice, priced on the post screen). Full lip-sync is also a
  // per-post choice, priced here so the dashboard shows both modes.
  const cost = computeVideoTokens(false, faceQuality);
  const fullLipsyncCost = computeVideoTokens(false, faceQuality, true);

  return (
    <section>
      <div className="flex items-center gap-3">
        <span className="text-sm font-semibold text-ink">{t('tokens.qualityLabel')}</span>
        <span className="h-px flex-1 bg-sunken" />
      </div>

      <div className="mt-4 space-y-4">
        <fieldset>
          <legend className="text-sm font-medium text-ink">
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

        <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3">
          <span className="text-sm text-ink-soft">{t('tokens.costLabel')}</span>
          <span data-testid="token-cost-preview" className="shrink-0 text-sm font-semibold text-ink">
            {t('tokens.costValue', { cost })}
          </span>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3">
          <span className="text-sm text-ink-soft">{t('tokens.fullLipsyncCostLabel')}</span>
          <span data-testid="token-full-lipsync-cost-preview" className="shrink-0 text-sm font-semibold text-ink">
            {t('tokens.costValue', { cost: fullLipsyncCost })}
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
          ? 'border-accent bg-destructive-soft/50 text-ink'
          : 'border-line bg-card text-muted-text hover:border-muted-text'
      }`}
    >
      {label}
    </button>
  );
}