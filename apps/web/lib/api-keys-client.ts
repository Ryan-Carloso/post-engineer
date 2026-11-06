import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { HttpStatusError } from './errors';

//---------------
// API keys — typed fetch clients + React Query hooks for /api/api-keys.
// Extracted from lib/api.ts (issue #385 work); consumers keep importing
// through the '@/lib/api' re-export.
//---------------

export interface ApiKeyItem {
  id: string;
  name: string;
  keyPrefix: string;
  personaIds: string[] | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export async function fetchApiKeys(): Promise<ApiKeyItem[]> {
  const response = await fetch('/api/api-keys');
  if (!response.ok) throw new HttpStatusError('Failed to fetch API keys', response.status);
  const data = await response.json();
  return data.keys ?? [];
}

export interface CreateApiKeyInput {
  name: string;
  personaIds?: string[] | null;
}

export async function createApiKey(input: CreateApiKeyInput): Promise<{
  id: string;
  name: string;
  key: string;
  keyPrefix: string;
  personaIds: string[] | null;
  createdAt: string;
}> {
  const response = await fetch('/api/api-keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: input.name, personaIds: input.personaIds ?? null }),
  });
  if (!response.ok) throw new HttpStatusError('Failed to create API key', response.status);
  return response.json();
}

export async function revokeApiKey(id: string): Promise<void> {
  const response = await fetch(`/api/api-keys/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new HttpStatusError('Failed to revoke API key', response.status);
}

export function useApiKeysQuery() {
  return useQuery<ApiKeyItem[]>({
    queryKey: ['user-api-keys'],
    queryFn: fetchApiKeys,
  });
}

export function useCreateApiKeyMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateApiKeyInput) => createApiKey(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['user-api-keys'] });
    },
  });
}

export function useRevokeApiKeyMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => revokeApiKey(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['user-api-keys'] });
    },
  });
}
