'use client';

import { useState } from 'react';
import { useI18n } from '@/lib/i18n/provider';
import type { ScheduledSlot, SlotDetailPayload } from '@/lib/api';
import { RescheduleEditor } from '../reschedule-editor';

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
  const [editing, setEditing] = useState(false);

  const canReschedule =
    (slot.status === 'ready' || slot.status === 'awaiting_approval') && publishMode === 'scheduled';

  if (!canReschedule) return null;

  return (
    <section className="mt-6">
      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {t('posts.reschedule')}
      </p>
      {editing ? (
        <RescheduleEditor
          slotId={slot.id}
          slotAt={slot.slotAt}
          timezone={timezone}
          onDone={() => setEditing(false)}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="mt-2 rounded-xl border border-input px-4 py-2 text-sm font-semibold text-primary hover:bg-background"
        >
          {t('posts.reschedule')}
        </button>
      )}
    </section>
  );
};
