//---------------
// Cancel-slot shape (DELETE /api/schedule): the rows the cancel reads,
// narrowed from unknown PostgREST rows. Extracted from route.ts so the
// route stays under the file-size ratchet.
//---------------

// Statuses the publisher can still turn into a post. `pending` has not
// been dispatched; `generating` and `ready` already have (generate-and-schedule
// dispatches every slot immediately, and the reconciler promotes generating
// → ready when the engine task finishes). `publishing` is left alone: the
// claim already happened and the upload may be in flight. `published` and
// `failed` are terminal.
export const CANCELLABLE_SLOT_STATUSES = ['pending', 'generating', 'ready'] as const;

export interface ScheduleCancelSlot {
  id: string;
  status: string;
  chargedTokens: number;
  batchId: string | null;
  taskId: string | null;
  /** Existing-media kind (issue #384): 'upload' | 'image' | null. */
  mediaKind: string | null;
  /** Existing-media reference: upload id, or the `uploads` bucket path for
   *  a scheduled image. */
  mediaRef: string | null;
}

function nullableString(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  return value;
}

export function narrowCancelSlot(value: unknown): ScheduleCancelSlot | null {
  if (typeof value !== 'object' || value === null) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || row.id.length === 0) return null;
  if (typeof row.status !== 'string') return null;
  const taskId = row.task_id;
  if (taskId !== null && taskId !== undefined && typeof taskId !== 'string') return null;
  // NOT NULL integer >= 0 in the schema: anything else is an unreadable row.
  const chargedTokens = row.charged_tokens;
  if (typeof chargedTokens !== 'number' || !Number.isInteger(chargedTokens) || chargedTokens < 0) return null;
  const batchId = row.batch_id;
  if (batchId !== null && batchId !== undefined && typeof batchId !== 'string') return null;
  const mediaKind = row.media_kind;
  if (mediaKind !== null && mediaKind !== undefined && typeof mediaKind !== 'string') return null;
  const mediaRef = row.media_ref;
  if (mediaRef !== null && mediaRef !== undefined && typeof mediaRef !== 'string') return null;
  return {
    id: row.id,
    status: row.status,
    chargedTokens,
    batchId: typeof batchId === 'string' ? batchId : null,
    taskId: typeof taskId === 'string' && taskId.length > 0 ? taskId : null,
    mediaKind: nullableString(mediaKind),
    mediaRef: nullableString(mediaRef),
  };
}

export function isCancellableStatus(status: string): boolean {
  return (CANCELLABLE_SLOT_STATUSES as readonly string[]).includes(status);
}

/**
 * True when a slot's generation never ran: still `pending` with no engine
 * task. Anything else means the engine accepted the job (or finished it),
 * so the GPU cost is already sunk and the charge stands. A `pending` slot
 * that somehow carries a task id fails closed the same way — the engine
 * may have accepted the job before the status write landed.
 */
export function neverGenerated(slot: ScheduleCancelSlot): boolean {
  return slot.status === 'pending' && slot.taskId === null;
}
