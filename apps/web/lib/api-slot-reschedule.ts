'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { parseJsonBody, throwForBadResponse } from './api';

//---------------
// rescheduleSlot — move a pending or ready slot's publish time (issue
// #555). The server re-validates the scheduling window (3h lead, 30-day
// max) and rejects ASAP schedules; the client only sends an ISO instant.
//---------------
export async function rescheduleSlot(slotId: string, slotAt: string): Promise<string> {
  const response = await fetch(`/api/schedule/slots/${encodeURIComponent(slotId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slotAt }),
  });
  if (!response.ok) await throwForBadResponse(response, 'Failed to reschedule slot');
  const data = await parseJsonBody<{ success: boolean; slotAt?: string; error?: string }>(response);
  if (!data?.success) throw new Error(data?.error ?? 'Failed to reschedule slot');
  return data.slotAt ?? slotAt;
}

export function useRescheduleSlotMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ slotId, slotAt }: { slotId: string; slotAt: string }) =>
      rescheduleSlot(slotId, slotAt),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['fill-schedule-status'] });
      // The detail page reads ['post-detail', slotId] with a 30s staleTime;
      // invalidate it too so the new time shows immediately.
      void queryClient.invalidateQueries({ queryKey: ['post-detail', variables.slotId] });
    },
  });
}
