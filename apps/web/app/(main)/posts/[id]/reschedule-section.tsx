'use client';

import { useMemo, useState } from 'react';
import { useRescheduleSlotMutation } from '@/lib/api-slot-reschedule';
import { useI18n } from '@/lib/i18n/provider';
import { parseZonedDateTime, utcToZonedInputValue } from '@/lib/timezone';
import type { ScheduledSlot, SlotDetailPayload } from '@/lib/api';

export const RescheduleSection = ({
  slot,
  timezone,
  publishMode,
}: {
  slot: ScheduledSlot;
  timezone: string;
  publishMode: SlotDetailPayload['schedule']['publishMode'];
}) => {
  const { t } = useI18n();
  const reschedule = useRescheduleSlotMutation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => utcToZonedInputValue(slot.slotAt, timezone) ?? '');
  const [invalid, setInvalid] = useState(false);

  const canReschedule =
    slot.status === 'ready' && publishMode === 'scheduled';
  const min = useMemo(
    () => utcToZonedInputValue(new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(), timezone),
    [timezone],
  );
  const max = useMemo(
    () => utcToZonedInputValue(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), timezone),
    [timezone],
  );

  if (!canReschedule) return null;

  const openEditor = (): void => {
    setDraft(utcToZonedInputValue(slot.slotAt, timezone) ?? '');
    setInvalid(false);
    setEditing(true);
  };

  const handleSave = (): void => {
    const parsed = parseZonedDateTime(draft, timezone);
    if (parsed === null) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    reschedule.mutate(
      { slotId: slot.id, slotAt: parsed.toISOString() },
      { onSuccess: () => setEditing(false) },
    );
  };

  return (
    <section className="mt-6">
      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {t('posts.reschedule')}
      </p>
      {editing ? (
        <div className="mt-2">
          <p className="text-sm text-muted-foreground">{t('posts.rescheduleHint')}</p>
          <label className="sr-only" htmlFor="slot-reschedule">
            {t('posts.reschedule')}
          </label>
          <input
            id="slot-reschedule"
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
              onClick={() => {
                setEditing(false);
                setDraft(utcToZonedInputValue(slot.slotAt, timezone) ?? '');
              }}
              disabled={reschedule.isPending}
              className="rounded-xl border border-input px-4 py-2 text-sm font-semibold text-primary hover:bg-background"
            >
              {t('posts.cancel')}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={openEditor}
          className="mt-2 rounded-xl border border-input px-4 py-2 text-sm font-semibold text-primary hover:bg-background"
        >
          {t('posts.reschedule')}
        </button>
      )}
    </section>
  );
};
