'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createSupabaseClient } from '@/lib/supabase/client';
import { useUploadStore } from '@/lib/store';
import { mapSchedule, type ScheduleConfig, type ScheduleRow } from '@/lib/schedule-row';
import { fetchScheduleStatus, type ScheduledSlot } from '@/lib/schedule-status';
import type {
  CreatePersonaResult,
  GeneratePersonaAvatarResult,
  SocialProvider,
  VoiceOption,
} from '@/lib/types';
import { isVoiceOption } from './voice-catalog';
import { HttpStatusError } from '@/lib/errors';
import { notifyIfSessionExpired } from '@/lib/session-expiry';
import type { PublishLink } from '@/lib/publish-links';
import type { VideoGenerationRow as VideoGeneration } from '@/lib/contracts/video-tasks';
import type { PublishProviderFailure, PublishUserNotice } from '@/lib/publish-user-notice';
import { narrowGeneration, narrowSlotFields, type GenerationFacts, type ProgressHistoryEntry, type SlotMedia } from './slot-detail';
import { narrowScriptAngle } from './script-angle';
import type { HookPhoto } from './hook-photo';
import { parseJsonBody, throwForBadResponse } from './api-response';
import type { PersonaRecord } from './persona-record';

export type { ProgressHistoryEntry };
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
export type { BlueskyAccountResponse, ProviderAccountsResponse } from './social-accounts-queries';

async function createPersona(formData: FormData): Promise<CreatePersonaResult> {
  const response = await fetch('/api/persona', { method: 'POST', body: formData });
  notifyIfSessionExpired(response);
  const data = (await parseJsonBody<CreatePersonaResult>(response)) ?? { success: false };
  return {
    ...data,
    imageIds: toStringArray(data.imageIds),
    warnings: toStringArray(data.warnings),
  };
}

function toStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const entries = value.filter((entry): entry is string => typeof entry === 'string');
  return entries.length > 0 ? entries : undefined;
}

async function generatePersonaAvatar(prompt: string): Promise<GeneratePersonaAvatarResult> {
  const response = await fetch('/api/persona/avatar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });
  notifyIfSessionExpired(response);
  const data: GeneratePersonaAvatarResult = await response.json();
  return data;
}

async function fetchVoices(): Promise<VoiceOption[]> {
  const response = await fetch('/api/persona/voices');
  const data: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      typeof data === 'object' &&
      data !== null &&
      'error' in data &&
      typeof data.error === 'string'
        ? data.error
        : 'Failed to fetch voices.';
    throw new HttpStatusError(message, response.status);
  }

  if (
    typeof data !== 'object' ||
    data === null ||
    !('voices' in data) ||
    !Array.isArray(data.voices) ||
    !data.voices.every(isVoiceOption)
  ) {
    throw new Error('Invalid voices response.');
  }

  return data.voices;
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

export interface DeletePreviewVideo {
  taskId: string | null;
  title: string | null;
  status: string;
  downloadUrl: string | null;
}

export interface DeletePreview {
  success: boolean;
  persona?: { id: string; name: string };
  counts?: {
    schedules: number;
    upcomingSlots: number;
    publishedSlots: number;
    failedSlots: number;
    generatedVideos: number;
    personaImages: number;
  };
  videos?: DeletePreviewVideo[];
  videosTruncated?: boolean;
  linksIncomplete?: boolean;
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

export interface PersonaImageRecord {
  id: string;
  tag: string | null;
  description: string | null;
  is_primary: boolean;
  created_at: string;
  image_url: string | null;
  image_url_error?: true;
}

async function fetchPersonaImages(personaId: string): Promise<PersonaImageRecord[]> {
  const response = await fetch(
    `/api/persona/images?personaId=${encodeURIComponent(personaId)}`,
  );
  const data: { success: boolean; images: PersonaImageRecord[]; error?: string } | null =
    await response.json().catch(() => null);
  const serverError = data && typeof data.error === 'string' ? data.error : null;
  if (!response.ok) {
    throw new HttpStatusError(serverError ?? `Persona images request failed with status ${response.status}`, response.status);
  }
  if (!data || data.success !== true || !Array.isArray(data.images)) {
    throw new Error(serverError ?? 'Persona images request returned an unexpected payload.');
  }
  return data.images.filter(
    (image): image is PersonaImageRecord =>
      typeof image?.id === 'string' &&
      (image.image_url === null || typeof image.image_url === 'string') &&
      typeof image?.is_primary === 'boolean' &&
      (image.tag === null ||
        image.tag === undefined ||
        typeof image.tag === 'string') &&
      (image.description === null ||
        image.description === undefined ||
        typeof image.description === 'string'),
  );
}

export function usePersonaImagesQuery(personaId: string | null) {
  return useQuery<PersonaImageRecord[]>({
    queryKey: ['persona-images', personaId],
    queryFn: () => {
      if (personaId === null) throw new Error('personaId is required.');
      return fetchPersonaImages(personaId);
    },
    enabled: personaId !== null,
    staleTime: 30_000,
  });
}

export interface UploadPersonaImageInput {
  file: File;
  tag?: string;
  description?: string;
  isPrimary?: true;
}

export interface ImageMutationResult {
  success: boolean;
  error?: string;
  warnings?: string[];
}

async function parseImageMutationResult(
  response: Response,
): Promise<ImageMutationResult> {
  const data: { success?: unknown; error?: unknown; warnings?: unknown } | null =
    await response.json().catch(() => null);
  if (!response.ok || !data || data.success !== true) {
    if (!response.ok) notifyIfSessionExpired(response);
    return {
      success: false,
      error:
        (data && typeof data.error === 'string' && data.error) ||
        `Request failed with status ${response.status}.`,
    };
  }
  const warnings = Array.isArray(data.warnings)
    ? data.warnings.filter((warning): warning is string => typeof warning === 'string')
    : [];
  return { success: true, ...(warnings.length > 0 ? { warnings } : {}) };
}

export async function uploadPersonaImage(
  personaId: string,
  input: UploadPersonaImageInput,
): Promise<ImageMutationResult> {
  const formData = new FormData();
  formData.append('personaId', personaId);
  formData.append('image', input.file);
  if (input.tag) formData.append('tag', input.tag);
  if (input.description) formData.append('description', input.description);
  if (input.isPrimary !== undefined) formData.append('isPrimary', String(input.isPrimary));
  const response = await fetch('/api/persona/images', { method: 'POST', body: formData });
  return parseImageMutationResult(response);
}

export interface UpdatePersonaImageInput {
  id: string;
  tag?: string;
  description?: string;
  isPrimary?: true;
}

export async function updatePersonaImage(
  input: UpdatePersonaImageInput,
): Promise<ImageMutationResult> {
  if ((input.isPrimary as boolean | undefined) === false) {
    throw new Error('isPrimary cannot be false: mark another image as primary instead.');
  }
  const response = await fetch('/api/persona/images', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return parseImageMutationResult(response);
}

export async function deletePersonaImage(id: string): Promise<ImageMutationResult> {
  const response = await fetch(
    `/api/persona/images?id=${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  );
  return parseImageMutationResult(response);
}

function useInvalidatePersonaImages(personaId: string | null) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['persona-images', personaId] });
  };
}

function usePersonaImageMutation<TInput>(
  personaId: string | null,
  mutationFn: (personaId: string, input: TInput) => Promise<ImageMutationResult>,
) {
  const invalidate = useInvalidatePersonaImages(personaId);
  return useMutation({
    mutationFn: (input: TInput) => {
      if (personaId === null) throw new Error('personaId is required.');
      return mutationFn(personaId, input);
    },
    onSuccess: (result) => {
      if (result.success) invalidate();
    },
  });
}

export function useUploadPersonaImageMutation(personaId: string | null) {
  return usePersonaImageMutation<UploadPersonaImageInput>(personaId, uploadPersonaImage);
}

export function useUpdatePersonaImageMutation(personaId: string | null) {
  return usePersonaImageMutation<UpdatePersonaImageInput>(
    personaId,
    (_personaId, input) => updatePersonaImage(input),
  );
}

export function useDeletePersonaImageMutation(personaId: string | null) {
  return usePersonaImageMutation<string>(
    personaId,
    (_personaId, id) => deletePersonaImage(id),
  );
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

export function useVoicesQuery() {
  return useQuery<VoiceOption[]>({
    queryKey: ['persona-voices'],
    queryFn: fetchVoices,
    retry: false,
    staleTime: 5 * 60_000,
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
    queryKey: ['fill-schedules'],
    queryFn: fetchSchedules,
    staleTime: 30_000,
  });
}

export {
  createApiKey,
  fetchApiKeys,
  revokeApiKey,
  useApiKeysQuery,
  useCreateApiKeyMutation,
  useRevokeApiKeyMutation,
} from './api-keys-client';
export type { ApiKeyItem, CreateApiKeyInput } from './api-keys-client';

export { fetchScheduleStatus, mapSlot } from './schedule-status';
export type { ScheduledSlot, SlotRow } from './schedule-status';

export function useScheduleStatusQuery(limit?: number) {
  return useQuery<{ upcoming: ScheduledSlot[]; recent: ScheduledSlot[]; hasAnyPost: boolean }>({
    queryKey: ['fill-schedule-status', limit ?? 'default'],
    queryFn: () => fetchScheduleStatus(limit),
    refetchInterval: 60_000,
  });
}

export type { VideoGeneration };

async function fetchVideoGenerations(limit?: number): Promise<VideoGeneration[]> {
  const url =
    typeof limit === 'number'
      ? `/api/persona/video-generations?limit=${limit}`
      : '/api/persona/video-generations';
  const response = await fetch(url);
  const data: { success?: boolean; generations?: VideoGeneration[] } | null = await response.json().catch(() => null);
  if (!response.ok || !data?.success) throw new HttpStatusError('Failed to fetch video generations', response.status);
  return data.generations ?? [];
}

export function useVideoGenerationsQuery(limit?: number) {
  return useQuery<VideoGeneration[]>({
    queryKey: ['video-generations', limit ?? 'default'],
    queryFn: () => fetchVideoGenerations(limit),
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
      void queryClient.invalidateQueries({ queryKey: ['fill-schedule-status'] });
      void queryClient.invalidateQueries({ queryKey: ['post-detail', variables.slotId] });
    },
  });
}

export function useDeleteSlotMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteSlot,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['fill-schedule-status'] });
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
    error: string | null;
    publishedAt: string | null;
    taskId: string | null;
    media: SlotMedia | null;
    progress: number;
    stage: string | null;
    retryable: boolean | null;
    queuePosition: number | null;
    queueTotal: number | null;
    scriptAngle: string | null;
    publishLinks: PublishLink[];
    hookPhoto: HookPhoto;
    progressHistory: ProgressHistoryEntry[];
    userNotices?: PublishUserNotice[];
    providerFailures?: PublishProviderFailure[];
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
  generation: GenerationFacts;
}

export type PostDetail =
  | (SlotDetailPayload & { kind: 'slot' })
  | { kind: 'generation'; generation: VideoGeneration & { progress: number; stage: string | null; scriptAngle: string | null } };

export async function fetchPostDetail(id: string): Promise<PostDetail | null> {
  const response = await fetch(`/api/posts/${encodeURIComponent(id)}`, {
    method: 'GET',
  });
  if (response.status === 404) return null;
  if (!response.ok) await throwForBadResponse(response, 'Failed to load post.');
  const data = await parseJsonBody<{ success: boolean; kind?: string; error?: string } & Record<string, unknown>>(response);
  if (!data?.success) throw new Error(data?.error ?? 'Failed to load post.');
  if (data.kind === 'generation') {
    const record = (typeof data.generation === 'object' && data.generation !== null ? data.generation : {}) as Record<string, unknown>;
    const progress = typeof record.progress === 'number' ? record.progress : 0;
    const stage = typeof record.stage === 'string' ? record.stage : null;
    const scriptAngle = narrowScriptAngle(record.scriptAngle);
    return { kind: 'generation', generation: { ...(record as unknown as VideoGeneration), progress, stage, scriptAngle } };
  }
  if (data.kind === 'slot') {
    const payload = data as unknown as SlotDetailPayload;
    if (!payload.slot || !payload.schedule) throw new Error('Failed to load post.');
    const rawSchedule = payload.schedule as SlotDetailPayload['schedule'] & { publishMode?: unknown };
    return {
      kind: 'slot',
      slot: { ...payload.slot, ...narrowSlotFields(payload.slot) },
      schedule: { ...payload.schedule, publishMode: rawSchedule.publishMode === 'asap' ? 'asap' : 'scheduled' },
      persona: payload.persona ?? null,
      generation: narrowGeneration(payload.generation),
    };
  }
  throw new Error('Failed to load post.');
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


export {
  fetchSession,
  createPersona,
  generatePersonaAvatar,
  fetchVoices,
  fetchPersonaList,
};
export { fetchYouTubeAccounts, fetchInstagramAccounts } from './social-accounts-queries';

export type { SupabaseSessionUser };
