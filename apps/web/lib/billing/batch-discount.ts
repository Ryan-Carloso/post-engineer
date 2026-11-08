//---------------
// batch-discount — the "6 for 5" rule of issue #487, as pure functions.
//
// Videos created together through the MCP batch tool render back to back in
// one warm Modal container, so the batch shares that saving with the user:
// for every BATCH_FREE_EVERY face videos in a batch, the cheapest one is
// free. Faceless videos never touch Modal, so they pay full price, do not
// count toward the threshold and are never the free one.
//
// The discount is a credit: each video is charged its list price at
// creation (generate-and-schedule), then POST /api/videos/batch-discount
// credits the free video's charge back and records it on the slot
// (charged_tokens -> 0, discount_tokens -> the credited amount). A cancel
// that drops the batch below the threshold takes the discount back from the
// cancelled video's refund (planBatchClawback), so cancelling the paid
// videos never leaves a free one behind.
//---------------

/** One free video per this many face videos in a batch. */
export const BATCH_FREE_EVERY = 6;

/** Most videos one batch may hold (MCP `generate_persona_video_batch` mirrors it). */
export const MAX_BATCH_VIDEOS = 12;

/** Every video of a batch must be created within this window of the first. */
export const BATCH_WINDOW_MS = 10 * 60 * 1000;

/** The slot fields the batch rules read. */
export interface BatchSlot {
  id: string;
  scheduleId: string;
  faceless: boolean;
  status: string;
  chargedTokens: number;
  discountTokens: number;
  createdAt: string;
  taskId: string | null;
}

// A face video counts toward the threshold whatever its status: a video
// that failed on our side keeps the batch's discount (issue #487 rule 7).
// Cancelled videos are deleted rows, so they are simply absent.
function faceSlots(slots: readonly BatchSlot[]): BatchSlot[] {
  return slots.filter((slot) => !slot.faceless);
}

/** How many free videos the batch earns. */
export function batchFreeCount(slots: readonly BatchSlot[]): number {
  return Math.floor(faceSlots(slots).length / BATCH_FREE_EVERY);
}

/**
 * The slots to make free now. Monotonic: a slot that is already free stays
 * free and counts toward the target, so calling this again (a retry that
 * adds the rest of the batch) only ever adds free videos. Candidates are the
 * cheapest paid face videos (oldest first on a tie, then id, so the choice
 * is deterministic). A failed slot is never a candidate: its charge may
 * already be refunded, and crediting it again would pay it back twice.
 */
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

/**
 * The free slots whose discount no longer holds, given the slots that
 * remain in the batch after a cancel. Smallest discount first: the user
 * loses as little of the remaining discount as possible.
 */
export function planBatchClawback(remaining: readonly BatchSlot[]): BatchSlot[] {
  const free = faceSlots(remaining)
    .filter((slot) => slot.discountTokens > 0)
    .sort((a, b) => a.discountTokens - b.discountTokens || a.id.localeCompare(b.id));
  const excess = free.length - batchFreeCount(remaining);
  return excess > 0 ? free.slice(0, excess) : [];
}

/** True when every slot was created within BATCH_WINDOW_MS of the first. */
export function withinBatchWindow(slots: readonly BatchSlot[]): boolean {
  const times = slots.map((slot) => Date.parse(slot.createdAt));
  if (times.some((time) => Number.isNaN(time))) return false;
  if (times.length === 0) return true;
  return Math.max(...times) - Math.min(...times) <= BATCH_WINDOW_MS;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/** The columns every batch read selects, in the order narrowBatchSlot expects. */
export const BATCH_SLOT_COLUMNS =
  'id, schedule_id, faceless, status, charged_tokens, discount_tokens, created_at, task_id, batch_id';

/**
 * Narrow a scheduled_posts row to a BatchSlot, or null when a column the
 * rules depend on is unreadable. Only literal true is faceless (billing
 * rule): anything else is the face case.
 */
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
    faceless: row.faceless === true,
    status,
    chargedTokens: row.charged_tokens,
    discountTokens: row.discount_tokens,
    createdAt,
    taskId: typeof taskId === 'string' && taskId.length > 0 ? taskId : null,
  };
}
