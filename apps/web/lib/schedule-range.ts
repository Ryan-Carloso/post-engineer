import { useQuery } from '@tanstack/react-query';
import { HttpStatusError } from '@/lib/errors';
import { fetchScheduleStatus, mapSlot, type ScheduledSlot, type SlotRow } from '@/lib/api';

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

export function useScheduleRangeQuery(monthKey: string, from: string, to: string, enabled: boolean) {
  return useQuery<ScheduleRange>({
    queryKey: ['fill-schedule-range', monthKey, from, to],
    queryFn: () => fetchScheduleRange(from, to),
    enabled,
    refetchInterval: 60_000,
  });
}

export function useHasAnyPostQuery(enabled: boolean) {
  return useQuery<boolean>({
    queryKey: ['fill-schedule-has-any-post'],
    queryFn: async () => {
      const { hasAnyPost } = await fetchScheduleStatus(1);
      return hasAnyPost;
    },
    enabled,
    staleTime: 60_000,
  });
}
