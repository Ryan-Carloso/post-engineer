import { useQuery } from '@tanstack/react-query';
import { HttpStatusError } from '@/lib/errors';
import { mapSlot, type ScheduledSlot, type SlotRow } from '@/lib/api';

//---------------
// Range read of GET /api/schedule/status (?from=&to=): every slot of any
// status in [from, to). Used by the posts calendar so a busy month is never
// cut by the list view's POSTS_LIMIT. Lives outside lib/api.ts (over the
// file-size cap).
//---------------

// Mirrors RANGE_MAX_SLOTS in app/api/schedule/status/range.ts (pinned by a
// file-parsing sync test).
export const RANGE_MAX_SLOTS = 1000;

export interface ScheduleRange {
  slots: ScheduledSlot[];
  truncated: boolean;
}

interface RangePayload {
  success: boolean;
  slots?: SlotRow[];
  truncated?: boolean;
}

export async function fetchScheduleRange(from: string, to: string): Promise<ScheduleRange> {
  const params = new URLSearchParams({ from, to });
  const response = await fetch(`/api/schedule/status?${params.toString()}`);
  const data: RangePayload | null = await response.json().catch(() => null);
  if (!response.ok || !data?.success || !Array.isArray(data.slots)) {
    throw new HttpStatusError('Failed to fetch schedule range', response.status);
  }
  return { slots: data.slots.map(mapSlot), truncated: data.truncated === true };
}

// `monthKey` + the grid bounds identify the cache entry; refetching every
// minute mirrors the list view so progress and statuses stay current.
export function useScheduleRangeQuery(monthKey: string, from: string, to: string, enabled: boolean) {
  return useQuery<ScheduleRange>({
    queryKey: ['fill-schedule-range', monthKey, from, to],
    queryFn: () => fetchScheduleRange(from, to),
    enabled,
    refetchInterval: 60_000,
  });
}
