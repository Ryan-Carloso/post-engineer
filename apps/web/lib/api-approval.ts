'use client';

import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { parseJsonBody, throwForBadResponse } from './api-response';

interface SlotDecisionResponse {
  success: boolean;
  status?: string;
  error?: string;
}

async function decideSlot(slotId: string, decision: 'approve' | 'reject'): Promise<string> {
  const response = await fetch(`/api/schedule/slots/${encodeURIComponent(slotId)}/${decision}`, {
    method: 'POST',
  });
  if (!response.ok) await throwForBadResponse(response, `Failed to ${decision} slot`);
  const data = await parseJsonBody<SlotDecisionResponse>(response);
  if (!data?.success || typeof data.status !== 'string') {
    throw new Error(data?.error ?? `Failed to ${decision} slot`);
  }
  return data.status;
}

export async function approveSlot(slotId: string): Promise<string> {
  return decideSlot(slotId, 'approve');
}

export async function rejectSlot(slotId: string): Promise<string> {
  return decideSlot(slotId, 'reject');
}

function invalidateSlotQueries(queryClient: QueryClient, slotId: string): void {
  void queryClient.invalidateQueries({ queryKey: ['fill-schedule-status'] });
  void queryClient.invalidateQueries({ queryKey: ['fill-schedule-range'] });
  void queryClient.invalidateQueries({ queryKey: ['post-detail', slotId] });
}

export function useApproveSlotMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: approveSlot,
    onSuccess: (_data, slotId) => invalidateSlotQueries(queryClient, slotId),
  });
}

export function useRejectSlotMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: rejectSlot,
    onSuccess: (_data, slotId) => invalidateSlotQueries(queryClient, slotId),
  });
}
