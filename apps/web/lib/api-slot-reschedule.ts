'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { parseJsonBody, throwForBadResponse } from './api-response';

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
      void queryClient.invalidateQueries({ queryKey: ['schedule-status'] });
      void queryClient.invalidateQueries({ queryKey: ['post-detail', variables.slotId] });
    },
  });
}
