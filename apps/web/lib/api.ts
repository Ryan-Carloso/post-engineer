'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';
import { createSupabaseClient } from '@/lib/supabase/client';
import { useUploadStore } from '@/lib/store';
import type { PublicAccountItem, BlueskyAccountData, LinkedinAccountData } from '@/lib/providers/registry';
import type {
  AccountResponse,
  AccountData,
  CreatePersonaResult,
  GeneratePersonaAvatarResult,
  InstagramAccountResponse,
  InstagramAccountData,
  SocialProvider,
  VoiceOption,
} from '@/lib/types';

//---------------
// API — typed fetch clients
//---------------

interface ServerAccountPayload {
  authenticated: boolean;
  accounts: PublicAccountItem[];
  message?: string;
}

//---------------
// fetchProviderAccounts — single fetch from /api/account filtered by provider.
// The shape and the provider list come from the registry (lib/providers/registry.ts):
// the server already returns each account with provider and correct fields.
//---------------
async function fetchProviderAccounts<T extends PublicAccountItem>(
  provider: T['provider'],
): Promise<{ authenticated: boolean; accounts: T[] }> {
  const payload = await fetchServerAccounts();
  return {
    authenticated: payload.authenticated,
    accounts: payload.accounts.filter((item): item is T => item.provider === provider),
  };
}

async function fetchServerAccounts(): Promise<ServerAccountPayload> {
  try {
    const response = await fetch('/api/account');
    if (!response.ok) {
      throw new Error(`Account request failed with status ${response.status}`);
    }
    const data: ServerAccountPayload = await response.json();
    return data;
  } catch (error) {
    console.error('[api/account] network request failed', { error });
    throw error;
  }
}

//---------------
// fetchYouTubeAccounts — YouTube accounts (no tokens) from /api/account
//---------------
async function fetchYouTubeAccounts(): Promise<AccountResponse> {
  return fetchProviderAccounts<AccountData>('youtube');
}

//---------------
// fetchInstagramAccounts — Instagram accounts (no tokens) via /api/account
//---------------
async function fetchInstagramAccounts(): Promise<InstagramAccountResponse> {
  return fetchProviderAccounts<InstagramAccountData>('instagram');
}

//---------------
// fetchBlueskyAccounts — Bluesky accounts (handle/did) via /api/account
//---------------

export interface BlueskyAccountResponse {
  authenticated: boolean;
  accounts: BlueskyAccountData[];
}

async function fetchBlueskyAccounts(): Promise<BlueskyAccountResponse> {
  return fetchProviderAccounts<BlueskyAccountData>('bluesky');
}

async function createPersona(formData: FormData): Promise<CreatePersonaResult> {
  const response = await fetch('/api/persona', { method: 'POST', body: formData });
  const data: CreatePersonaResult = await response.json();
  return data;
}

export interface CreateScheduleInput {
  personaId: string;
  providers?: string[];
  youtubeAccountIds?: string[];
  instagramAccountIds?: string[];
  linkedinAccountIds?: string[];
  blueskyAccountIds?: string[];
  daysOfWeek?: number[];
  startHour?: number;
  endHour?: number;
  postsPerDay?: number;
  times?: string[];
  timezone?: string;
  scheduledAt?: string;
}

export class ScheduleError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ScheduleError';
  }
}

export async function createSchedule(input: CreateScheduleInput): Promise<void> {
  const response = await fetch('/api/schedule', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data: { success: boolean; error?: string } = await response.json().catch(() => ({ success: false }));
  if (!response.ok || !data.success) {
    throw new ScheduleError(response.status, data.error ?? 'Failed to create schedule');
  }
}

async function generatePersonaAvatar(prompt: string): Promise<GeneratePersonaAvatarResult> {
  const response = await fetch('/api/persona/avatar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });
  const data: GeneratePersonaAvatarResult = await response.json();
  return data;
}

async function fetchVoices(): Promise<VoiceOption[]> {
  const response = await fetch('/api/persona/voices');
  const data: unknown = await response.json();

  if (!response.ok) {
    const message =
      typeof data === 'object' &&
      data !== null &&
      'error' in data &&
      typeof data.error === 'string'
        ? data.error
        : 'Failed to fetch voices.';
    throw new Error(message);
  }

  if (
    typeof data !== 'object' ||
    data === null ||
    !('voices' in data) ||
    !Array.isArray(data.voices) ||
    !data.voices.every(
      (voice): voice is VoiceOption =>
        typeof voice === 'object' &&
        voice !== null &&
        'id' in voice &&
        typeof voice.id === 'string',
    )
  ) {
    throw new Error('Invalid voices response.');
  }

  return data.voices;
}

export interface PersonaRecord {
  id: string;
  name: string;
  createdAt: string;
  avatarUrl?: string;
  photoUrl?: string;
  voiceId?: string;
  voiceAudioUrl?: string;
  language?: string;
  videoAspect?: string;
  scriptPrompt?: string;
  paragraphNumber?: number;
  niche?: string;
  // Billing inputs for per-video token cost estimates.
  faceMixPercent?: number;
  faceQuality?: string;
}

async function fetchPersonaList(): Promise<PersonaRecord[]> {
  const response = await fetch('/api/persona/list');
  if (!response.ok) {
    throw new Error(`Persona list request failed with status ${response.status}`);
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
}

export async function deletePersona(personaId: string): Promise<DeletePersonaResult> {
  const response = await fetch(
    `/api/persona?personaId=${encodeURIComponent(personaId)}`,
    { method: 'DELETE' },
  );
  return response.json();
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
  return response.json();
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

export function useDeletePersonaMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deletePersona,
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

//---------------
// Persona image library — up to 10 tagged images per persona used for
// deterministic per-video image selection.
//---------------

export interface PersonaImageRecord {
  id: string;
  image_path: string;
  tag: string | null;
  description: string | null;
  is_primary: boolean;
  created_at: string;
  /** Signed URL. Only GET /api/persona/images populates this; mutations
      return ImageMutationResult (no image row), so this type is GET-only. */
  image_url: string | null;
  /** True when signing failed transiently; the UI can show a retryable
      error state instead of a silently broken thumbnail. */
  image_url_error?: true;
}

async function fetchPersonaImages(personaId: string): Promise<PersonaImageRecord[]> {
  const response = await fetch(
    `/api/persona/images?personaId=${encodeURIComponent(personaId)}`,
  );
  const data: { success: boolean; images: PersonaImageRecord[]; error?: string } | null =
    await response.json().catch(() => null);
  // Surface the server's error string when present, like the mutation
  // paths do — a generic status message is less actionable.
  const serverError = data && typeof data.error === 'string' ? data.error : null;
  if (!response.ok) {
    throw new Error(serverError ?? `Persona images request failed with status ${response.status}`);
  }
  if (!data || data.success !== true || !Array.isArray(data.images)) {
    throw new Error(serverError ?? 'Persona images request returned an unexpected payload.');
  }
  return data.images;
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
  /** Swap-only, like UpdatePersonaImageInput: false is meaningless on upload
      (new images default to is_primary:false; the server only promotes on
      'true'). */
  isPrimary?: true;
}

export interface ImageMutationResult {
  success: boolean;
  error?: string;
  /**
   * Partial-success notes from the server (e.g. the image uploaded but the
   * primary swap failed). Present only when non-empty, mirroring the
   * PATCH contract — callers surface these so the user knows the true
   * state instead of assuming the full request applied.
   */
  warnings?: string[];
}

/**
 * Reads a mutation-style JSON payload defensively: a non-2xx status, a
 * non-JSON body, or a success:false payload all surface as
 * { success: false } instead of throwing on .json() or resolving as success.
 * The server row is intentionally NOT carried: mutations return the raw DB
 * row (no signed image_url) and no consumer reads it — every mutation hook
 * invalidates the library query and refetches the signed GET shape.
 */
async function parseImageMutationResult(
  response: Response,
): Promise<ImageMutationResult> {
  const data: { success?: unknown; error?: unknown; warnings?: unknown } | null =
    await response.json().catch(() => null);
  if (!response.ok || !data || data.success !== true) {
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
  /** Swap-only, like the MCP client: the server 400s isPrimary:false. */
  isPrimary?: true;
}

export async function updatePersonaImage(
  input: UpdatePersonaImageInput,
): Promise<ImageMutationResult> {
  // Fail fast like the MCP client instead of a server 400 after the
  // round-trip. The type above already prevents this at compile time;
  // the runtime check guards JS callers (hence the cast).
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

/**
 * Shared factory for the persona-image mutations. Every mutation needs the
 * same null-personaId guard and the same invalidate-on-success behavior;
 * keeping them in one place means future changes (surfacing warnings,
 * error toasts) land once instead of three times.
 */
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
    // NOTE: server rejections resolve as { success: false } rather than
    // throwing — consumers MUST check result.success / result.error;
    // mutation.isError will never be true for these hooks.
    // Only refresh the library when the server actually accepted the change;
    // a success:false payload must not look like a completed mutation.
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

//---------------
// Supabase session — authenticated user's session
//----------------

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

//---------------
// React Query hooks — data shared across screens
//---------------

export function useYouTubeAccountsQuery(): UseQueryResult<AccountResponse, Error> {
  return useQuery<AccountResponse>({
    queryKey: ['youtube-accounts'],
    queryFn: fetchYouTubeAccounts,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}

export function useInstagramAccountsQuery(): UseQueryResult<InstagramAccountResponse, Error> {
  return useQuery<InstagramAccountResponse>({
    queryKey: ['instagram-accounts'],
    queryFn: fetchInstagramAccounts,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}

export function useBlueskyAccountsQuery(): UseQueryResult<BlueskyAccountResponse, Error> {
  return useQuery<BlueskyAccountResponse>({
    queryKey: ['bluesky-accounts'],
    queryFn: fetchBlueskyAccounts,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}

//---------------
// fetchLinkedinAccounts — LinkedIn accounts (member/orgs) via /api/account
//---------------

export interface LinkedinAccountResponse {
  authenticated: boolean;
  accounts: LinkedinAccountData[];
}

async function fetchLinkedinAccounts(): Promise<LinkedinAccountResponse> {
  return fetchProviderAccounts<LinkedinAccountData>('linkedin');
}

export function useLinkedinAccountsQuery(): UseQueryResult<LinkedinAccountResponse, Error> {
  return useQuery<LinkedinAccountResponse>({
    queryKey: ['linkedin-accounts'],
    queryFn: fetchLinkedinAccounts,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}

//---------------
// disconnectAccount — removes a connected social account (DELETE /api/account).
//---------------

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
  return response.json();
}

export function useDisconnectAccountMutation(provider: DisconnectableProvider) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: DisconnectAccountInput) => disconnectAccount(provider, input.providerAccountId),
    onSuccess: (_data, input) => {
      void queryClient.invalidateQueries({ queryKey: [`${provider}-accounts`] });
      // Deselects the disconnected account from upload on any network
      // (no-op if it was not selected).
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

export interface VoiceSampleLanguage {
  code: string;
  label: string;
}

async function fetchVoiceSampleLanguages(): Promise<VoiceSampleLanguage[]> {
  const response = await fetch('/api/persona/voice-sample-languages');
  if (!response.ok) {
    throw new Error('Failed to fetch voice sample languages');
  }
  const data: { languages: VoiceSampleLanguage[] } = await response.json();
  return data.languages;
}

export function useVoiceSampleLanguagesQuery() {
  return useQuery<VoiceSampleLanguage[]>({
    queryKey: ['persona-voice-sample-languages'],
    queryFn: fetchVoiceSampleLanguages,
    staleTime: 24 * 60 * 60_000,
  });
}


//---------------
// Fill Schedule — automatic schedule (days + time window + posts/day).
// The engine reads the config and does the rest: LLM topic, video in the 06h
// UTC batch and publishing at each slot's time.
//---------------

export interface ScheduleConfig {
  id: string;
  personaId: string;
  providers: string[];
  youtubeAccountIds: string[];
  instagramAccountIds: string[];
  linkedinAccountIds: string[];
  blueskyAccountIds: string[];
  daysOfWeek: number[];
  startHour: number | null;
  endHour: number | null;
  postsPerDay: number;
  timezone: string;
  active: boolean;
  scheduledAt: string | null;
}

export interface ScheduledSlot {
  id: string;
  scheduleId: string;
  slotAt: string;
  status: 'pending' | 'generating' | 'ready' | 'published' | 'failed';
  topic: string | null;
  error?: string | null;
  publishedAt?: string | null;
}

interface ScheduleRow {
  id: string;
  persona_id: string;
  providers: string[];
  youtube_account_ids: string[];
  instagram_account_ids: string[];
  linkedin_account_ids: string[];
  bluesky_account_ids: string[];
  days_of_week: number[] | null;
  start_hour: number | null;
  end_hour: number | null;
  posts_per_day: number;
  timezone: string;
  active: boolean;
  scheduled_at: string | null;
}

interface SlotRow {
  id: string;
  schedule_id: string;
  slot_at: string;
  status: ScheduledSlot['status'];
  topic: string | null;
  error?: string | null;
  published_at?: string | null;
}

function mapSchedule(row: ScheduleRow): ScheduleConfig {
  return {
    id: row.id,
    personaId: row.persona_id,
    providers: row.providers,
    youtubeAccountIds: row.youtube_account_ids ?? [],
    instagramAccountIds: row.instagram_account_ids ?? [],
    linkedinAccountIds: row.linkedin_account_ids ?? [],
    blueskyAccountIds: row.bluesky_account_ids ?? [],
    // One-off schedules: days/window are null in the database (scheduled_at instead).
    daysOfWeek: row.days_of_week ?? [],
    startHour: row.start_hour ?? null,
    endHour: row.end_hour ?? null,
    postsPerDay: row.posts_per_day,
    timezone: row.timezone,
    active: row.active,
    scheduledAt: row.scheduled_at ?? null,
  };
}

interface ScheduleSlotInput {
  personaId: string;
  providers: string[];
  youtubeAccountIds: string[];
  instagramAccountIds: string[];
  linkedinAccountIds: string[];
  blueskyAccountIds: string[];
  daysOfWeek: number[];
  startHour: number;
  endHour: number;
  postsPerDay: number;
  timezone: string;
}

async function fetchSchedules(): Promise<ScheduleConfig[]> {
  const response = await fetch('/api/schedule');
  const data: { success: boolean; schedules?: ScheduleRow[] } = await response.json();
  if (!response.ok || !data.success) throw new Error('Failed to fetch schedules');
  return (data.schedules ?? []).map(mapSchedule);
}

export async function updateSchedule(
  id: string,
  updates: Partial<
    Pick<ScheduleSlotInput, 'daysOfWeek' | 'startHour' | 'endHour' | 'postsPerDay' | 'providers' | 'youtubeAccountIds' | 'instagramAccountIds' | 'linkedinAccountIds' | 'blueskyAccountIds' | 'timezone'>
  > & { active?: boolean },
): Promise<void> {
  const response = await fetch('/api/schedule', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, ...updates }),
  });
  const data: { success: boolean; error?: string } = await response.json();
  if (!response.ok || !data.success) throw new Error(data.error ?? 'Failed to update schedule');
}

async function deleteSchedule(id: string): Promise<void> {
  const response = await fetch(`/api/schedule?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  const data: { success: boolean; error?: string } = await response.json();
  if (!response.ok || !data.success) throw new Error(data.error ?? 'Failed to delete schedule');
}

interface ScheduleStatusPayload {
  success: boolean;
  upcoming?: SlotRow[];
  recent?: SlotRow[];
}

function mapSlot(row: SlotRow): ScheduledSlot {
  return {
    id: row.id,
    scheduleId: row.schedule_id,
    slotAt: row.slot_at,
    status: row.status,
    topic: row.topic,
    error: row.error,
    publishedAt: row.published_at,
  };
}

async function fetchScheduleStatus(limit?: number): Promise<{ upcoming: ScheduledSlot[]; recent: ScheduledSlot[] }> {
  const url = typeof limit === 'number' ? `/api/schedule/status?limit=${limit}` : '/api/schedule/status';
  const response = await fetch(url);
  const data: ScheduleStatusPayload = await response.json();
  if (!response.ok || !data.success) throw new Error('Failed to fetch schedule status');
  return {
    upcoming: (data.upcoming ?? []).map(mapSlot),
    recent: (data.recent ?? []).map(mapSlot),
  };
}

export function useSchedulesQuery() {
  return useQuery<ScheduleConfig[]>({
    queryKey: ['fill-schedules'],
    queryFn: fetchSchedules,
    staleTime: 30_000,
  });
}

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
  if (!response.ok) throw new Error('Failed to fetch API keys');
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
  if (!response.ok) throw new Error('Failed to create API key');
  return response.json();
}

export async function revokeApiKey(id: string): Promise<void> {
  const response = await fetch(`/api/api-keys/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error('Failed to revoke API key');
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

export function useScheduleStatusQuery(limit?: number) {
  return useQuery<{ upcoming: ScheduledSlot[]; recent: ScheduledSlot[] }>({
    queryKey: ['fill-schedule-status', limit ?? 'default'],
    queryFn: () => fetchScheduleStatus(limit),
    refetchInterval: 60_000,
  });
}

//---------------
// Video generation history (Posts > History). Mirrors the
// VideoGenerationRow shape returned by GET /api/persona/video-generations.
//---------------
export interface VideoGeneration {
  id: string;
  generationId: string;
  engineTaskId: string | null;
  personaName: string | null;
  videoSubject: string | null;
  status: string;
  errorCode: string | null;
  tokensRefunded: boolean;
  createdAt: string;
  completedAt: string | null;
}

async function fetchVideoGenerations(limit?: number): Promise<VideoGeneration[]> {
  const url =
    typeof limit === 'number'
      ? `/api/persona/video-generations?limit=${limit}`
      : '/api/persona/video-generations';
  const response = await fetch(url);
  const data: { success?: boolean; generations?: VideoGeneration[] } = await response.json();
  if (!response.ok || !data.success) throw new Error('Failed to fetch video generations');
  return data.generations ?? [];
}

export function useVideoGenerationsQuery(limit?: number) {
  return useQuery<VideoGeneration[]>({
    queryKey: ['video-generations', limit ?? 'default'],
    queryFn: () => fetchVideoGenerations(limit),
    refetchInterval: 60_000,
  });
}

export function useUpdateScheduleMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...updates }: { id: string } & Parameters<typeof updateSchedule>[1]) =>
      updateSchedule(id, updates),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['fill-schedules'] });
      void queryClient.invalidateQueries({ queryKey: ['fill-schedule-status'] });
    },
  });
}

export function useDeleteScheduleMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteSchedule,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['fill-schedules'] });
      void queryClient.invalidateQueries({ queryKey: ['fill-schedule-status'] });
    },
  });
}

export {
  fetchYouTubeAccounts,
  fetchInstagramAccounts,
  fetchSession,
  createPersona,
  generatePersonaAvatar,
  fetchVoices,
  fetchPersonaList,
};

export type { SupabaseSessionUser };
