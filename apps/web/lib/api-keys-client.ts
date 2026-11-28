import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { HttpStatusError } from './errors';
import type { ApprovalMode } from './api-keys';

export interface ApiKeyItem {
  id: string;
  name: string;
  keyPrefix: string;
  personaIds: string[] | null;
  approvalMode: ApprovalMode;
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
  approvalMode?: ApprovalMode;
}

export async function createApiKey(input: CreateApiKeyInput): Promise<{
  id: string;
  name: string;
  key: string;
  keyPrefix: string;
  personaIds: string[] | null;
  approvalMode: ApprovalMode;
  createdAt: string;
}> {
  const response = await fetch('/api/api-keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: input.name, personaIds: input.personaIds ?? null, approvalMode: input.approvalMode ?? 'approval' }),
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

export interface UpdateApiKeyInput {
  id: string;
  approvalMode: ApprovalMode;
  personaIds: string[] | null;
}

export async function updateApiKey(input: UpdateApiKeyInput): Promise<ApiKeyItem> {
  const response = await fetch(`/api/api-keys/${encodeURIComponent(input.id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ approvalMode: input.approvalMode, personaIds: input.personaIds }),
  });
  if (!response.ok) throw new HttpStatusError('Failed to update API key', response.status);
  const data: unknown = await response.json().catch(() => null);
  if (typeof data !== 'object' || data === null || !('key' in data)) {
    throw new HttpStatusError('Failed to update API key', response.status);
  }
  return (data as { key: ApiKeyItem }).key;
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

export function useUpdateApiKeyMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateApiKeyInput) => updateApiKey(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['user-api-keys'] });
    },
  });
}
