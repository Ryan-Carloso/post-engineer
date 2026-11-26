'use client';

import { useMemo } from 'react';
import { useScheduleStatusQuery, type ScheduledSlot } from '@/lib/api';

export const APPROVAL_QUEUE_LIMIT = 200;

export const APPROVAL_SLOT_GRACE_MS = 5 * 60 * 1000;

export function isSlotExpired(slot: Pick<ScheduledSlot, 'slotAt'>, now = Date.now()): boolean {
  return Date.parse(slot.slotAt) < now - APPROVAL_SLOT_GRACE_MS;
}

export function awaitingSlots(slots: ScheduledSlot[]): ScheduledSlot[] {
  return slots
    .filter((slot) => slot.status === 'awaiting_approval')
    .sort((a, b) => a.slotAt.localeCompare(b.slotAt));
}

export interface ApprovalQueueState {
  slots: ScheduledSlot[];
  count: number;
  isLoading: boolean;
  isError: boolean;
}

export function useApprovalQueue(): ApprovalQueueState {
  const statusQuery = useScheduleStatusQuery(APPROVAL_QUEUE_LIMIT);
  const slots = useMemo(() => awaitingSlots(statusQuery.data?.upcoming ?? []), [statusQuery.data]);
  return {
    slots,
    count: slots.length,
    isLoading: statusQuery.isLoading,
    isError: statusQuery.isError,
  };
}
