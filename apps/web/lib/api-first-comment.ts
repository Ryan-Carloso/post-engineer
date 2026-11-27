'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { parseJsonBody, throwForBadResponse } from './api-response';

export async function updateSlotFirstComment(slotId: string, firstComment: string | null): Promise<string | null> {
  const response = await fetch(`/api/schedule/slots/${encodeURIComponent(slotId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstComment }),
  });
  if (!response.ok) await throwForBadResponse(response, 'Failed to update the first comment');
  const data = await parseJsonBody<{ success: boolean; firstComment?: string | null; error?: string }>(response);
  if (!data?.success) throw new Error(data?.error ?? 'Failed to update the first comment');
  return data.firstComment ?? null;
}

export function useUpdateFirstCommentMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ slotId, firstComment }: { slotId: string; firstComment: string | null }) =>
      updateSlotFirstComment(slotId, firstComment),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['post-detail', variables.slotId] });
    },
  });
}
