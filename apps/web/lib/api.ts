'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createSupabaseClient } from '@/lib/supabase/client';
import { useUploadStore } from '@/lib/store';
import { mapSchedule, type ScheduleConfig, type ScheduleRow } from '@/lib/schedule-row';
import { fetchScheduleStatus, type ScheduledSlot } from '@/lib/schedule-status';
import type { CreatePersonaResult, SocialProvider } from '@/lib/types';
import { HttpStatusError } from '@/lib/errors';
import { notifyIfSessionExpired } from '@/lib/session-expiry';
import type { PublishLink } from '@/lib/publish-links';
import type { FirstCommentOutcomeWarning } from '@/lib/first-comment/outcome-warnings';
import type { PublishProviderFailure, PublishUserNotice } from '@/lib/publish-user-notice';
import { narrowPostPrompt, narrowSlotFields, type PostPromptFacts, type SlotMedia } from './slot-detail';
import { parseJsonBody, throwForBadResponse } from './api-response';
import type { PersonaRecord } from './persona-record';

export type { PersonaRecord };

export {
  useBlueskyAccountsQuery,
  useFacebookAccountsQuery,
  useInstagramAccountsQuery,
  useLinkedinAccountsQuery,
  useSocialAccountsQuery,
  useThreadsAccountsQuery,
  useThreespeakAccountsQuery,
  useYouTubeAccountsQuery,
} from './social-accounts-queries';
export type { ProviderAccountsResponse } from './social-accounts-queries';

async function createPersona(formData: FormData): Promise<CreatePersonaResult> {
  const response = await fetch('/api/persona', { method: 'POST', body: formData });
  notifyIfSessionExpired(response);
  return (await parseJsonBody<CreatePersonaResult>(response)) ?? { success: false };
}

async function fetchPersonaList(): Promise<PersonaRecord[]> {
  const response = await fetch('/api/persona/list');
  if (!response.ok) {
    throw new HttpStatusError(`Persona list request failed with status ${response.status}`, response.status);
  }
  const data: { authenticated: boolean; personas: PersonaRecord[] } =
    await response.json();
  return data.personas;
}

export function usePersonasQuery() {
  return useQuery<PersonaRecord[]>({
    queryKey: ['personas'],
    queryFn: fetchPersonaList,
    staleTime: 30_000,
  });
}

export interface DeletePersonaResult {
  success: boolean;
  error?: string;
  code?: string;
}

export interface DeletePreview {
  success: boolean;
  persona?: { id: string; name: string };
  counts?: {
    schedules: number;
    upcomingSlots: number;
    publishedSlots: number;
    failedSlots: number;
  };
  error?: string;
  code?: string;
}

async function parseErrorResponse(
  response: Response,
  fallback: string,
): Promise<{ error: string; code?: string }> {
  const body = await response.json().catch(() => null);
  if (body !== null && typeof body === 'object') {
    const error =
      'error' in body && typeof body.error === 'string' ? body.error : null;
    const code = 'code' in body && typeof body.code === 'string' ? body.code : undefined;
    if (error !== null) return { error, code };
  }
  return { error: fallback };
}

export async function fetchDeletePreview(personaId: string): Promise<DeletePreview> {
  const response = await fetch(
    `/api/persona/delete-preview?personaId=${encodeURIComponent(personaId)}`,
  );
  if (!response.ok) {
    notifyIfSessionExpired(response);
    const parsed = await parseErrorResponse(response, `Preview request failed (${response.status}).`);
    return { success: false, error: parsed.error, code: parsed.code };
  }
  try {
    return (await response.json()) as DeletePreview;
  } catch {
    return { success: false, error: 'Preview returned an unreadable response.' };
  }
}

export async function deletePersona(personaId: string): Promise<DeletePersonaResult> {
  const response = await fetch(
    `/api/persona?personaId=${encodeURIComponent(personaId)}`,
    { method: 'DELETE' },
  );
  if (!response.ok) {
    notifyIfSessionExpired(response);
    const parsed = await parseErrorResponse(response, `Delete request failed (${response.status}).`);
    return { success: false, error: parsed.error, code: parsed.code };
  }
  try {
    return (await response.json()) as DeletePersonaResult;
  } catch {
    return { success: false, error: 'Delete returned an unreadable response.' };
  }
}

export interface UpdatePersonaResult {
  success: boolean;
  error?: string;
}

export interface UpdatePersonaInput {
  personaId: string;
  formData: FormData;
}

export async function updatePersona(
  personaId: string,
  formData: FormData,
): Promise<UpdatePersonaResult> {
  const response = await fetch(
    `/api/persona?personaId=${encodeURIComponent(personaId)}`,
    { method: 'PATCH', body: formData },
  );
  if (!response.ok) {
    notifyIfSessionExpired(response);
    const parsed = await parseErrorResponse(response, `Update request failed (${response.status}).`);
    return { success: false, error: parsed.error };
  }
  try {
    return (await response.json()) as UpdatePersonaResult;
  } catch {
    return { success: false, error: 'Update returned an unreadable response.' };
  }
}

export function useUpdatePersonaMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdatePersonaInput) =>
      updatePersona(input.personaId, input.formData),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['persona-list'] });
    },
  });
}

export function usePersonaListQuery() {
  return useQuery<PersonaRecord[]>({
    queryKey: ['persona-list'],
    queryFn: fetchPersonaList,
    staleTime: 30_000,
  });
}

interface SupabaseSessionUser {
  id: string;
  email?: string;
  user_metadata: {
    avatar_url?: string;
    name?: string;
    user_name?: string;
    provider_id?: string;
  };
}

async function fetchSession(): Promise<SupabaseSessionUser | null> {
  const supabase = createSupabaseClient();
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) {
    return null;
  }
  return data.session.user as SupabaseSessionUser;
}

export interface DisconnectAccountResult {
  success: boolean;
  error?: string;
}

export type DisconnectableProvider = SocialProvider;

export interface DisconnectAccountInput {
  providerAccountId: string;
}

export async function disconnectAccount(
  provider: DisconnectableProvider,
  providerAccountId: string,
): Promise<DisconnectAccountResult> {
  const response = await fetch(
    `/api/account?provider=${encodeURIComponent(provider)}&providerAccountId=${encodeURIComponent(providerAccountId)}`,
    { method: 'DELETE' },
  );
  notifyIfSessionExpired(response);
  return response.json();
}

export function useDisconnectAccountMutation(provider: DisconnectableProvider) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: DisconnectAccountInput) => disconnectAccount(provider, input.providerAccountId),
    onSuccess: (_data, input) => {
      void queryClient.invalidateQueries({ queryKey: ['social-accounts'] });
      useUploadStore.getState().deselectAccount(provider, input.providerAccountId);
    },
  });
}

export function useSessionQuery() {
  return useQuery<SupabaseSessionUser | null>({
    queryKey: ['session'],
    queryFn: fetchSession,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}

export type { ScheduleConfig };

async function fetchSchedules(): Promise<ScheduleConfig[]> {
  const response = await fetch('/api/schedule');
  const data: { success: boolean; schedules?: ScheduleRow[] } | null = await response.json().catch(() => null);
  if (!response.ok || !data?.success) throw new HttpStatusError('Failed to fetch schedules', response.status);
  return (data.schedules ?? []).map(mapSchedule);
}

export function useSchedulesQuery() {
  return useQuery<ScheduleConfig[]>({
    queryKey: ['schedules'],
    queryFn: fetchSchedules,
    staleTime: 30_000,
  });
}

export {
  fetchApiKeys,
  useApiKeysQuery,
  useCreateApiKeyMutation,
  useRevokeApiKeyMutation,
  useUpdateApiKeyMutation,
} from './api-keys-client';

export { fetchScheduleStatus, mapSlot } from './schedule-status';
export type { ScheduledSlot, SlotRow } from './schedule-status';

export function useScheduleStatusQuery(limit?: number) {
  return useQuery<{ upcoming: ScheduledSlot[]; recent: ScheduledSlot[]; hasAnyPost: boolean; awaitingCount?: number }>({
    queryKey: ['schedule-status', limit ?? 'default'],
    queryFn: () => fetchScheduleStatus(limit),
    refetchInterval: 60_000,
  });
}

export async function updateSlotTitle(slotId: string, title: string): Promise<string> {
  const response = await fetch(`/api/schedule/slots/${encodeURIComponent(slotId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  if (!response.ok) await throwForBadResponse(response, 'Failed to update slot');
  const data = await parseJsonBody<{ success: boolean; title?: string; error?: string }>(response);
  if (!data?.success) throw new Error(data?.error ?? 'Failed to update slot');
  return data.title ?? title;
}

export async function deleteSlot(slotId: string): Promise<void> {
  const response = await fetch(`/api/schedule/slots/${encodeURIComponent(slotId)}`, {
    method: 'DELETE',
  });
  if (!response.ok) await throwForBadResponse(response, 'Failed to delete slot');
  const data = await parseJsonBody<{ success: boolean; error?: string }>(response);
  if (!data?.success) throw new Error(data?.error ?? 'Failed to delete slot');
}

export function useUpdateSlotMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ slotId, title }: { slotId: string; title: string }) =>
      updateSlotTitle(slotId, title),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['schedule-status'] });
      void queryClient.invalidateQueries({ queryKey: ['post-detail', variables.slotId] });
    },
  });
}

export function useDeleteSlotMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteSlot,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['schedule-status'] });
    },
  });
}

export interface SlotDetailPayload {
  slot: {
    id: string;
    scheduleId: string;
    slotAt: string;
    status: ScheduledSlot['status'];
    title: string | null;
    description: string | null;
    error: string | null;
    publishedAt: string | null;
    publishLinks: PublishLink[];
    userNotices?: PublishUserNotice[];
    providerFailures?: PublishProviderFailure[];
    firstComment: string | null;
    commentWarnings: FirstCommentOutcomeWarning[];
    media: SlotMedia | null;
  };
  schedule: {
    id: string;
    personaId: string;
    providers: string[];
    youtubeAccountIds: string[];
    instagramAccountIds: string[];
    linkedinAccountIds: string[];
    blueskyAccountIds: string[];
    threadsAccountIds: string[];
    facebookAccountIds: string[];
    pinterestAccountIds: string[];
    pinterestBoardId: string | null;
    threespeakAccountIds: string[];
    rumbleAccountIds: string[];
    fanvueAccountIds: string[];
    telegramAccountIds: string[];
    timezone: string;
    publishMode: 'scheduled' | 'asap';
  };
  persona: { id: string; name: string } | null;
  prompt: PostPromptFacts | null;
}

export type PostDetail = SlotDetailPayload;

export async function fetchPostDetail(id: string): Promise<PostDetail | null> {
  const response = await fetch(`/api/posts/${encodeURIComponent(id)}`, {
    method: 'GET',
  });
  if (response.status === 404) return null;
  if (!response.ok) await throwForBadResponse(response, 'Failed to load post.');
  const data = await parseJsonBody<{ success: boolean; error?: string } & Record<string, unknown>>(response);
  if (!data?.success) throw new Error(data?.error ?? 'Failed to load post.');
  const payload = data as unknown as SlotDetailPayload;
  if (!payload.slot || !payload.schedule) throw new Error('Failed to load post.');
  const rawSchedule = payload.schedule as SlotDetailPayload['schedule'] & { publishMode?: unknown };
  return {
    slot: { ...payload.slot, ...narrowSlotFields(payload.slot) },
    schedule: { ...payload.schedule, publishMode: rawSchedule.publishMode === 'asap' ? 'asap' : 'scheduled' },
    persona: payload.persona ?? null,
    prompt: narrowPostPrompt((data as Record<string, unknown>).prompt),
  };
}

export function usePostDetailQuery(id: string) {
  return useQuery<PostDetail | null>({
    queryKey: ['post-detail', id],
    queryFn: () => fetchPostDetail(id),
    enabled: id !== '',
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export { fetchSession, createPersona, fetchPersonaList };
export { fetchYouTubeAccounts, fetchInstagramAccounts } from './social-accounts-queries';

export type { SupabaseSessionUser };
