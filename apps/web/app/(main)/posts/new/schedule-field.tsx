'use client';

//---------------
// Schedule field for the new-post form: the publish-mode picker (scheduled
// vs asap) plus the date/time/timezone inputs. Extracted from page.tsx so
// the page stays under the file-size ratchet. Same shadcn RadioGroup + Label
// card pattern as the page's other pickers.
//---------------

import { useMemo } from 'react';
import { useNewPostStore } from '@/lib/store';
import { useI18n } from '@/lib/i18n/provider';
import {
  CalendarIcon,
  CheckIcon,
  GlobeIcon,
  PlayIcon,
  PlusIcon,
  TrashIcon,
  INPUT_CLASS,
  SECTION_LABEL_CLASS,
} from '@/lib/ui';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

// Form card: the same shell as the persona/personas screens (page.tsx).
const CARD_CLASS = 'rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm sm:p-6';
const SECONDARY_BUTTON_CLASS =
  'inline-flex items-center justify-center gap-2 rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-sm font-semibold text-neutral-700 transition-colors hover:border-neutral-400 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40 [&_svg]:size-4';
const ICON_BUTTON_CLASS =
  'flex size-10 shrink-0 items-center justify-center rounded-xl border border-neutral-200 bg-white text-neutral-400 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-30 [&_svg]:size-4';

//---------------
// SectionTitle — the same icon + uppercase label + short hint pattern as the
// page's local one; kept local so this module stays self-contained.
//---------------
const SectionTitle = ({ icon, label, hint }: { icon: React.ReactNode; label: string; hint?: string }) => (
  <div className="flex items-start gap-2.5">
    <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-500 [&_svg]:size-4">
      {icon}
    </span>
    <div>
      <p className={SECTION_LABEL_CLASS}>{label}</p>
      {hint ? <p className="mt-1 text-xs leading-5 text-neutral-500">{hint}</p> : null}
    </div>
  </div>
);

// Short timezone list; the browser timezone goes first, so the common case
// needs no scrolling. The server validates the zone (isValidTimezone) and
// rejects anything unknown.
const COMMON_TIMEZONES = [
  'UTC',
  'America/Sao_Paulo',
  'America/New_York',
  'America/Los_Angeles',
  'Europe/Lisbon',
  'Europe/London',
  'Europe/Berlin',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Australia/Sydney',
];


//---------------
// Publish-mode resolution. 'scheduled' (default) keeps the existing
// contract: a schedule plan with distributed, window-checked slots.
// 'asap' publishes each video the moment generation finishes: no schedule
// plan is accepted (a stray one would be silently ignored, so it is a 400),
// and every slot lands at the request time.
//---------------
const PUBLISH_MODE_OPTIONS = [
  {
    value: 'scheduled',
    labelKey: 'newPost.publishModeScheduled',
    hintKey: 'newPost.publishModeScheduledHint',
    icon: 'scheduled',
  },
  {
    value: 'asap',
    labelKey: 'newPost.publishModeAsap',
    hintKey: 'newPost.publishModeAsapHint',
    icon: 'asap',
  },
] as const;

const NewPostPublishModePicker = () => {
  const { t } = useI18n();
  const publishMode = useNewPostStore((s) => s.publishMode);
  const setPublishMode = useNewPostStore((s) => s.setPublishMode);
  return (
    <RadioGroup
      value={publishMode}
      onValueChange={(value) => setPublishMode(value === 'asap' ? 'asap' : 'scheduled')}
      aria-label={t('newPost.publishModeLabel')}
      className="grid gap-3 sm:grid-cols-2"
    >
      {PUBLISH_MODE_OPTIONS.map((option) => {
        const selected = publishMode === option.value;
        const itemId = `new-post-publish-mode-${option.value}`;
        return (
          <Label
            key={option.value}
            htmlFor={itemId}
            data-selected={selected ? 'true' : 'false'}
            className={cn(
              'flex cursor-pointer items-start gap-3 rounded-2xl border bg-white p-3 transition-colors',
              'has-focus-visible:ring-2 has-focus-visible:ring-accent/40 has-focus-visible:ring-offset-2',
              selected
                ? 'border-accent bg-accent/5 ring-1 ring-accent'
                : 'border-neutral-200 hover:border-neutral-300 hover:bg-neutral-50',
            )}
          >
            <RadioGroupItem
              value={option.value}
              id={itemId}
              aria-label={t(option.labelKey)}
              className="sr-only"
            />
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-500">
              {option.icon === 'asap' ? <PlayIcon /> : <CalendarIcon />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-neutral-900">
                {t(option.labelKey)}
              </span>
              <span className="mt-0.5 block text-xs leading-5 text-neutral-500">
                {t(option.hintKey)}
              </span>
            </span>
            {selected ? (
              <span className="shrink-0 text-accent">
                <CheckIcon />
              </span>
            ) : null}
          </Label>
        );
      })}
    </RadioGroup>
  );
};

//---------------
// The date/time/timezone inputs for scheduled mode. Unmounted (not hidden)
// in ASAP mode so stale values can never leak into the request.
//---------------
const NewPostScheduledInputs = () => {
  const { t } = useI18n();
  const startAt = useNewPostStore((s) => s.startAt);
  const times = useNewPostStore((s) => s.times);
  const timezone = useNewPostStore((s) => s.timezone);
  const setStartAt = useNewPostStore((s) => s.setStartAt);
  const setTime = useNewPostStore((s) => s.setTime);
  const addTime = useNewPostStore((s) => s.addTime);
  const removeTime = useNewPostStore((s) => s.removeTime);
  const setTimezone = useNewPostStore((s) => s.setTimezone);

  const timezoneOptions = useMemo(() => {
    const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return [...new Set([browserZone, timezone, ...COMMON_TIMEZONES])];
  }, [timezone]);

  return (
    <>
      <SectionTitle
        icon={<CalendarIcon />}
        label={t('newPost.startAtLabel')}
        hint={t('newPost.startAtHint')}
      />
      <input
        type="datetime-local"
        value={startAt}
        aria-label={t('newPost.startAtLabel')}
        onChange={(event) => setStartAt(event.target.value)}
        className={cn(INPUT_CLASS, 'mt-0')}
      />

      <div>
        <label className="flex items-center gap-2 text-sm font-medium text-neutral-700">
          <GlobeIcon />
          {t('newPost.timezoneLabel')}
        </label>
        <p className="mt-1 text-xs text-neutral-500">{t('newPost.timezoneHint')}</p>
        <select
          value={timezone}
          onChange={(event) => setTimezone(event.target.value)}
          aria-label={t('newPost.timezoneLabel')}
          className={cn(INPUT_CLASS, 'cursor-pointer')}
        >
          {timezoneOptions.map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </select>
      </div>

      <div>
        <p className="text-sm font-medium text-neutral-700">{t('newPost.timesLabel')}</p>
        <p className="mt-1 text-xs text-neutral-500">{t('newPost.timesHint')}</p>
        <div className="mt-3 space-y-2">
          {times.map((time, index) => (
            <div key={index} className="flex items-center gap-2">
              <input
                type="time"
                value={time}
                aria-label={`${t('newPost.timesLabel')} ${index + 1}`}
                onChange={(event) => setTime(index, event.target.value)}
                className={cn(INPUT_CLASS, 'mt-0')}
              />
              <button
                type="button"
                onClick={() => removeTime(index)}
                disabled={times.length <= 1}
                aria-label={`${t('newPost.removeTime')} ${index + 1}`}
                className={ICON_BUTTON_CLASS}
              >
                <TrashIcon />
              </button>
            </div>
          ))}
        </div>
        <button type="button" onClick={addTime} className={cn(SECONDARY_BUTTON_CLASS, 'mt-3')}>
          <PlusIcon />
          {t('newPost.addTime')}
        </button>
      </div>
    </>
  );
};

const NewPostScheduleField = () => {
  const { t } = useI18n();
  const publishMode = useNewPostStore((s) => s.publishMode);

  return (
    <section className={cn(CARD_CLASS, 'space-y-5')}>
      <SectionTitle icon={<CalendarIcon />} label={t('newPost.publishModeLabel')} />
      <NewPostPublishModePicker />
      {publishMode === 'asap' ? null : <NewPostScheduledInputs />}
    </section>
  );
};

export { NewPostScheduleField };

