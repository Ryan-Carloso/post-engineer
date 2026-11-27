import type { DistributedSlot } from '@/lib/schedule/slot-distribution';

export interface SlotRowInput {
  slots: DistributedSlot[];
  title: string;
  description: string;
  scheduleId: string;
  userId: string;
  promptVersionId?: string;
  firstComment: string | null;
}

export function buildSlotRows(input: SlotRowInput) {
  return input.slots.map((slot) => ({
    schedule_id: input.scheduleId,
    user_id: input.userId,
    slot_at: slot.slotAtISO,
    status: 'pending',
    title: input.title,
    description: input.description,
    prompt_version_id: input.promptVersionId ?? null,
    first_comment: input.firstComment,
  }));
}
