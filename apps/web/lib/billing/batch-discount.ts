export { MAX_BATCH_VIDEOS } from '@/lib/contracts/videos';

export const BATCH_FREE_EVERY = 6;

export const BATCH_WINDOW_MS = 10 * 60 * 1000;

export interface BatchSlot {
  id: string;
  scheduleId: string;
  voiceover: boolean;
  status: string;
  chargedTokens: number;
  discountTokens: number;
  createdAt: string;
  taskId: string | null;
}

function faceSlots(slots: readonly BatchSlot[]): BatchSlot[] {
  return slots.filter((slot) => !slot.voiceover);
}

export function batchFreeCount(slots: readonly BatchSlot[]): number {
  return Math.floor(faceSlots(slots).length / BATCH_FREE_EVERY);
}

export function planBatchDiscount(slots: readonly BatchSlot[]): BatchSlot[] {
  const faces = faceSlots(slots);
  const alreadyFree = faces.filter((slot) => slot.discountTokens > 0).length;
  const missing = batchFreeCount(slots) - alreadyFree;
  if (missing <= 0) return [];
  return faces
    .filter((slot) => slot.discountTokens === 0 && slot.chargedTokens > 0 && slot.status !== 'failed')
    .sort(
      (a, b) =>
        a.chargedTokens - b.chargedTokens ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, missing);
}

export function batchChargeId(scheduleId: string): string {
  return `batch:${scheduleId}`;
}

export function batchSlotRefundKey(scheduleId: string, slotId: string): string {
  return `${batchChargeId(scheduleId)}:slot:${slotId}`;
}

export function batchDiscountRefundKey(scheduleId: string, slotId: string): string {
  return `${batchSlotRefundKey(scheduleId, slotId)}:discount`;
}

export function planBatchClawback(remaining: readonly BatchSlot[]): BatchSlot[] {
  const free = faceSlots(remaining)
    .filter((slot) => slot.discountTokens > 0)
    .sort((a, b) => a.discountTokens - b.discountTokens || a.id.localeCompare(b.id));
  const earned = batchFreeCount(remaining);
  const failedFree = free.filter((slot) => slot.status === 'failed').length;
  const liveAllowed = Math.max(0, earned - Math.min(failedFree, earned));
  const live = free.filter((slot) => slot.status !== 'failed');
  const excess = live.length - liveAllowed;
  return excess > 0 ? live.slice(0, excess) : [];
}

export function withinBatchWindow(slots: readonly BatchSlot[]): boolean {
  const times = slots.map((slot) => Date.parse(slot.createdAt));
  if (times.some((time) => Number.isNaN(time))) return false;
  if (times.length === 0) return true;
  return Math.max(...times) - Math.min(...times) <= BATCH_WINDOW_MS;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

export const BATCH_SLOT_COLUMNS =
  'id, schedule_id, voiceover, status, charged_tokens, discount_tokens, created_at, task_id, batch_id';

export function narrowBatchSlot(value: unknown): BatchSlot | null {
  if (typeof value !== 'object' || value === null) return null;
  const row = value as Record<string, unknown>;
  const { id, schedule_id: scheduleId, status, created_at: createdAt, task_id: taskId } = row;
  if (typeof id !== 'string' || id.length === 0) return null;
  if (typeof scheduleId !== 'string' || scheduleId.length === 0) return null;
  if (typeof status !== 'string' || typeof createdAt !== 'string') return null;
  if (!isNonNegativeInteger(row.charged_tokens) || !isNonNegativeInteger(row.discount_tokens)) return null;
  if (taskId !== null && taskId !== undefined && typeof taskId !== 'string') return null;
  return {
    id,
    scheduleId,
    voiceover: row.voiceover === true,
    status,
    chargedTokens: row.charged_tokens,
    discountTokens: row.discount_tokens,
    createdAt,
    taskId: typeof taskId === 'string' && taskId.length > 0 ? taskId : null,
  };
}
