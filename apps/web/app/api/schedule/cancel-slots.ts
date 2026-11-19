export const CANCELLABLE_SLOT_STATUSES = ['pending', 'generating', 'ready'] as const;

export interface ScheduleCancelSlot {
  id: string;
  status: string;
  chargedTokens: number;
  batchId: string | null;
  taskId: string | null;
  mediaKind: string | null;
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

export function neverGenerated(slot: ScheduleCancelSlot): boolean {
  return slot.status === 'pending' && slot.taskId === null;
}
