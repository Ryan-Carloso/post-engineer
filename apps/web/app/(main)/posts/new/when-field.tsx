'use client';

import { useI18n } from '@/lib/i18n/provider';
import { InlineFieldError } from '@/components/ui/form-field';
import { INPUT_CLASS } from '@/lib/ui';
import { SelectField } from '@/components/ui/select';
import {
  SCHEDULE_MAX_AHEAD_DAYS,
  SCHEDULE_MIN_ADVANCE_HOURS,
} from '@/lib/schedule-window';
import { type ComposerMode } from '@/lib/post-composer/compose';
import { cn } from '@/lib/utils';
export function WhenField({
  mode,
  publishAt,
  timezone,
  min,
  max,
  issues,
  timezones,
  disabled,
  onModeChange,
  onPublishAtChange,
  onTimezoneChange,
}: {
  mode: ComposerMode;
  publishAt: string;
  timezone: string;
  min: string;
  max: string;
  issues: string[];
  timezones: readonly string[];
  disabled: boolean;
  onModeChange: (mode: ComposerMode) => void;
  onPublishAtChange: (value: string) => void;
  onTimezoneChange: (timezone: string) => void;
}) {
  const { t } = useI18n();
  const zones = timezones.includes(timezone) ? timezones : [timezone, ...timezones];

  return (
    <section className="rounded-2xl border border-line bg-card p-5 shadow-sm" data-testid="composer-when">
      <h2 className="text-xs font-medium text-ink-soft">{t('composer.whenLabel')}</h2>
      <div className="mt-2 grid grid-cols-2 gap-2" role="radiogroup" aria-label={t('composer.whenLabel')}>
        {(['asap', 'scheduled'] as const).map((option) => {
          const active = mode === option;
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              onClick={() => onModeChange(option)}
              className={cn(
                'h-10 rounded-xl border px-2 text-xs font-semibold whitespace-nowrap transition-colors sm:px-3 sm:text-sm',
                active
                  ? 'border-ink bg-ink text-on-ink'
                  : 'border-line bg-card text-ink hover:border-muted-text hover:bg-surface',
              )}
            >
              {option === 'asap' ? t('composer.modeAsap') : t('composer.modeScheduled')}
            </button>
          );
        })}
      </div>

      {mode === 'scheduled' ? (
        <div className="mt-4 space-y-3">
          <div>
            <label htmlFor="composer-publish-at" className="block text-xs font-medium text-ink-soft">
              {t('composer.scheduleAtLabel')}
            </label>
            <input
              id="composer-publish-at"
              type="datetime-local"
              value={publishAt}
              min={min === '' ? undefined : min}
              max={max === '' ? undefined : max}
              disabled={disabled}
              onChange={(event) => onPublishAtChange(event.target.value)}
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label htmlFor="composer-timezone" className="block text-xs font-medium text-ink-soft">
              {t('composer.scheduleTimezoneLabel')}
            </label>
            <SelectField
              id="composer-timezone"
              value={timezone}
              disabled={disabled}
              onValueChange={onTimezoneChange}
              options={zones.map((zone) => ({ value: zone, label: zone }))}
              className="mt-1.5"
            />
          </div>
          <p className="text-[11px] text-muted-text">
            {t('composer.scheduleWindowHint', {
              min: SCHEDULE_MIN_ADVANCE_HOURS,
              max: SCHEDULE_MAX_AHEAD_DAYS,
            })}
          </p>
          {issues.map((message) => (
            <InlineFieldError key={message} message={message} />
          ))}
        </div>
      ) : null}
    </section>
  );
}
