'use client';

import { useMemo, useState } from 'react';
import { useRescheduleSlotMutation } from '@/lib/api-slot-reschedule';
import { useI18n } from '@/lib/i18n/provider';
import { parseZonedDateTime, utcToZonedInputValue } from '@/lib/timezone';

export function RescheduleEditor({
  slotId,
  slotAt,
  timezone,
  onDone,
  onCancel,
}: {
  slotId: string;
  slotAt: string;
  timezone: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const reschedule = useRescheduleSlotMutation();
  const [draft, setDraft] = useState(() => utcToZonedInputValue(slotAt, timezone) ?? '');
  const [invalid, setInvalid] = useState(false);
  const [createdAt] = useState(() => Date.now());
  const min = useMemo(
    () => utcToZonedInputValue(new Date(createdAt + 3 * 60 * 60 * 1000).toISOString(), timezone),
    [createdAt, timezone],
  );
  const max = useMemo(
    () => utcToZonedInputValue(new Date(createdAt + 30 * 24 * 60 * 60 * 1000).toISOString(), timezone),
    [createdAt, timezone],
  );

  const handleSave = (): void => {
    const parsed = parseZonedDateTime(draft, timezone);
    if (parsed === null) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    reschedule.mutate({ slotId, slotAt: parsed.toISOString() }, { onSuccess: () => onDone() });
  };

  return (
    <div className="mt-2">
      <p className="text-sm text-muted-foreground">{t('posts.rescheduleHint')}</p>
      <label className="sr-only" htmlFor={`slot-reschedule-${slotId}`}>
        {t('posts.reschedule')}
      </label>
      <input
        id={`slot-reschedule-${slotId}`}
        type="datetime-local"
        value={draft}
        min={min ?? undefined}
        max={max ?? undefined}
        onChange={(event) => setDraft(event.target.value)}
        className="w-full rounded-xl border border-input px-3 py-2 text-sm text-primary focus:border-primary focus:outline-none"
      />
      {invalid && (
        <p className="mt-2 text-sm text-destructive" role="alert">
          {t('posts.rescheduleInvalid')}
        </p>
      )}
      {reschedule.isError && (
        <p className="mt-2 text-sm text-destructive" role="alert">
          {t('posts.rescheduleError')}
        </p>
      )}
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={reschedule.isPending || draft === ''}
          className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-ink hover:bg-accent-hover disabled:opacity-50"
        >
          {t('posts.save')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={reschedule.isPending}
          className="rounded-xl border border-input px-4 py-2 text-sm font-semibold text-primary hover:bg-background"
        >
          {t('posts.cancel')}
        </button>
      </div>
    </div>
  );
}
