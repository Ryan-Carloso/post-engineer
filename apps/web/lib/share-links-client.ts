import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';

import {
  CreateShareLinkResponseSchema,
  ListShareLinksResponseSchema,
  RevokeShareLinkResponseSchema,
} from '@/lib/contracts/share-links';
import { HttpStatusError } from './errors';
import { notifyIfSessionExpired } from './session-expiry';

export type ShareLinkItem = z.infer<typeof ListShareLinksResponseSchema>['links'][number];
export type CreatedShareLink = z.infer<typeof CreateShareLinkResponseSchema>;

export type ShareLinkFailure = 'limit' | 'generic';
export type ShareLinkResult<T> = { success: true; value: T } | { success: false; error: ShareLinkFailure };

const SHARE_LINKS_KEY = ['share-links'] as const;
const LIMIT_STATUS = 409;

export async function fetchShareLinks(): Promise<ShareLinkItem[]> {
  const response = await fetch('/api/share-links');
  if (!response.ok) {
    notifyIfSessionExpired(response);
    throw new HttpStatusError('Failed to fetch share links', response.status);
  }
  const body: unknown = await response.json().catch(() => null);
  const parsed = ListShareLinksResponseSchema.safeParse(body);
  if (!parsed.success) throw new HttpStatusError('Unexpected share links response', response.status);
  return parsed.data.links;
}

async function send<T>(
  url: string,
  init: RequestInit,
  schema: z.ZodType<T>,
): Promise<ShareLinkResult<T>> {
  try {
    const response = await fetch(url, init);
    if (!response.ok) {
      notifyIfSessionExpired(response);
      return { success: false, error: response.status === LIMIT_STATUS ? 'limit' : 'generic' };
    }
    const body: unknown = await response.json().catch(() => null);
    const parsed = schema.safeParse(body);
    return parsed.success ? { success: true, value: parsed.data } : { success: false, error: 'generic' };
  } catch {
    return { success: false, error: 'generic' };
  }
}

export function createShareLink(personaIds: string[] | null): Promise<ShareLinkResult<CreatedShareLink>> {
  return send(
    '/api/share-links',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(personaIds === null ? {} : { personaIds }),
    },
    CreateShareLinkResponseSchema,
  );
}

export function revokeShareLink(id: string): Promise<ShareLinkResult<z.infer<typeof RevokeShareLinkResponseSchema>>> {
  return send(`/api/share-links/${encodeURIComponent(id)}`, { method: 'DELETE' }, RevokeShareLinkResponseSchema);
}

export function useShareLinksQuery() {
  return useQuery<ShareLinkItem[]>({ queryKey: SHARE_LINKS_KEY, queryFn: fetchShareLinks });
}

export function useCreateShareLinkMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (personaIds: string[] | null) => createShareLink(personaIds),
    onSuccess: (result) => {
      if (result.success) void queryClient.invalidateQueries({ queryKey: SHARE_LINKS_KEY });
    },
  });
}

export function useRevokeShareLinkMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => revokeShareLink(id),
    onSuccess: (result) => {
      if (result.success) void queryClient.invalidateQueries({ queryKey: SHARE_LINKS_KEY });
    },
  });
}
