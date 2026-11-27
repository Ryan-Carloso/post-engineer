export const CANCELLABLE_SLOT_STATUSES = ['pending', 'ready', 'awaiting_approval'] as const;

export interface ScheduleCancelSlot {
  id: string;
  status: string;
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
  const mediaKind = row.media_kind;
  if (mediaKind !== null && mediaKind !== undefined && typeof mediaKind !== 'string') return null;
  const mediaRef = row.media_ref;
  if (mediaRef !== null && mediaRef !== undefined && typeof mediaRef !== 'string') return null;
  return {
    id: row.id,
    status: row.status,
    mediaKind: nullableString(mediaKind),
    mediaRef: nullableString(mediaRef),
  };
}

export function isCancellableStatus(status: string): boolean {
  return (CANCELLABLE_SLOT_STATUSES as readonly string[]).includes(status);
}
