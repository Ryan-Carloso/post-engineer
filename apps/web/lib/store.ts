'use client';

import { create } from 'zustand';
import type {
  CreatePersonaResult,
  PrivacyStatus,
  SocialProvider,
  UploadContentResult,
} from '@/lib/types';
import { SOCIAL_PROVIDERS } from '@/lib/types';
import type { FaceQuality } from '@/lib/tokens';
import type { TranslationKey } from '@/lib/i18n';

//---------------
// UploadStore — global state shared between screens
// (accounts selects, create/publish consumes)
//---------------

function emptySelection(): Record<SocialProvider, string[]> {
  const selection = {} as Record<SocialProvider, string[]>;
  for (const provider of SOCIAL_PROVIDERS) {
    selection[provider] = [];
  }
  return selection;
}

//---------------
// ResolvedContent — effective values after resolving overrides
//---------------
interface ResolvedContent {
  title: string;
  description: string;
  igCaption: string;
}

interface UploadFormState {
  // Active mode of the creation screen
  mode: SocialProvider;
  // Accounts selected for publishing (multiple accounts per network,
  // multiple networks simultaneously). accounts selects, create consumes.
  selectedAccountIds: Record<SocialProvider, string[]>;
  // YouTube
  file: File | null;
  title: string;
  description: string;
  tags: string;
  privacyStatus: PrivacyStatus;
  result: UploadContentResult | null;
  oauthUrl: string | null;
  // Instagram
  igFile: File | null;
  igCaption: string;
  igCaptionEdited: boolean;
  igResult: UploadContentResult | null;
  // Per-platform overrides (empty = use shared)
  ytTitleOverride: string;
  ytDescriptionOverride: string;
  igCaptionOverride: string;
  ytThumbnail: File | null;
  // Setters (modo)
  setMode: (mode: SocialProvider) => void;
  // Setters (contas)
  toggleSelectedAccount: (provider: SocialProvider, accountId: string) => void;
  deselectAccount: (provider: SocialProvider, accountId: string) => void;
  clearSelectedAccounts: (provider?: SocialProvider) => void;
  // Setters (YouTube)
  setFile: (file: File | null) => void;
  setTitle: (value: string) => void;
  setDescription: (value: string) => void;
  setTags: (value: string) => void;
  setPrivacyStatus: (value: PrivacyStatus) => void;
  setResult: (result: UploadContentResult | null) => void;
  setOauthUrl: (url: string | null) => void;
  resetForm: () => void;
  // Setters (Instagram)
  setIgFile: (file: File | null) => void;
  setIgCaption: (value: string) => void;
  setIgResult: (result: UploadContentResult | null) => void;
  resetIgForm: () => void;
  // Setters (overrides)
  setYtTitleOverride: (value: string) => void;
  setYtDescriptionOverride: (value: string) => void;
  setIgCaptionOverride: (value: string) => void;
  setYtThumbnail: (file: File | null) => void;
  // Content resolution (override > shared)
  resolveContent: () => ResolvedContent;
}

export const useUploadStore = create<UploadFormState>()(
  (set, get) => ({
    mode: 'youtube',
    file: null,
    title: '',
    description: '',
    tags: '',
    privacyStatus: 'public',
    result: null,
    oauthUrl: null,
    selectedAccountIds: emptySelection(),
    igFile: null,
    igCaption: '',
    igCaptionEdited: false,
    igResult: null,
    ytTitleOverride: '',
    ytDescriptionOverride: '',
    igCaptionOverride: '',
    ytThumbnail: null,
    setMode: (mode) => set({ mode }),
    toggleSelectedAccount: (provider, accountId) =>
      set((state) => {
        const current = state.selectedAccountIds[provider];
        const next = current.includes(accountId)
          ? current.filter((id) => id !== accountId)
          : [...current, accountId];
        return { selectedAccountIds: { ...state.selectedAccountIds, [provider]: next } };
      }),
    deselectAccount: (provider, accountId) =>
      set((state) => {
        const current = state.selectedAccountIds[provider];
        if (!current.includes(accountId)) return state;
        return {
          selectedAccountIds: {
            ...state.selectedAccountIds,
            [provider]: current.filter((id) => id !== accountId),
          },
        };
      }),
    clearSelectedAccounts: (provider) =>
      set((state) =>
        provider
          ? { selectedAccountIds: { ...state.selectedAccountIds, [provider]: [] } }
          : { selectedAccountIds: emptySelection() },
      ),
    setFile: (file) => set({ file }),
    setTitle: (title) => set({ title }),
    setDescription: (description) => set({ description }),
    setTags: (tags) => set({ tags }),
    setPrivacyStatus: (privacyStatus) => set({ privacyStatus }),
    setResult: (result) => set({ result }),
    setOauthUrl: (oauthUrl) => set({ oauthUrl }),
    resetForm: () =>
      set({
        file: null, title: '', description: '', tags: '', privacyStatus: 'public',
        ytTitleOverride: '', ytDescriptionOverride: '', igCaptionOverride: '', ytThumbnail: null,
      }),
    setIgFile: (igFile) => set({ igFile }),
    setIgCaption: (igCaption) => set({ igCaption, igCaptionEdited: true }),
    setIgResult: (igResult) => set({ igResult }),
    resetIgForm: () =>
      set({ igFile: null, igCaption: '', igCaptionEdited: false, igResult: null }),
    // Setters (overrides)
    setYtTitleOverride: (ytTitleOverride) => set({ ytTitleOverride }),
    setYtDescriptionOverride: (ytDescriptionOverride) => set({ ytDescriptionOverride }),
    setIgCaptionOverride: (igCaptionOverride) => set({ igCaptionOverride }),
    setYtThumbnail: (ytThumbnail) => set({ ytThumbnail }),
    // Content resolution — override > shared
    resolveContent: () => {
      const s = get();
      return {
        title: s.ytTitleOverride || s.title,
        description: s.ytDescriptionOverride || s.description,
        igCaption: s.igCaptionOverride || s.description,
      };
    },
  }),
);

//---------------
// Script languages — languages supported by the engine for script
// generation. English (en) is always the safe default fallback.
// Add new codes here once the engine supports them.
//---------------

const SCRIPT_LANGUAGES = ['pt', 'es', 'fr', 'en'] as const;

export type ScriptLanguage = (typeof SCRIPT_LANGUAGES)[number];

const DEFAULT_SCRIPT_LANGUAGE: ScriptLanguage = 'en';

//---------------
// resolveScriptLanguage — derives the script language from a
// locale (e.g. 'pt-BR', 'en-US'). If the base language is not among
// supported ones, falls back to English (safe default).
//---------------

export function resolveScriptLanguage(locale: string): ScriptLanguage {
  const base = locale.split('-')[0].toLowerCase();
  return (SCRIPT_LANGUAGES as readonly string[]).includes(base)
    ? (base as ScriptLanguage)
    : DEFAULT_SCRIPT_LANGUAGE;
}

//---------------
// PersonaFormState — persona creation screen state
// (always faced: an uploaded photo OR a chosen character/AI avatar,
// name, house voice). A video without a face is a per-post choice
// (NewPostState.faceless), not a persona attribute.
//---------------

interface PersonaFormState {
  name: string;
  photo: File | null;
  prompt: string;
  avatarUrl: string | null;
  /** Signed URL of the ALREADY uploaded photo (edit-mode display only).
      Never sent back to the server — photo_path is the stored identity and
      the link expires in 1h. */
  storedPhotoUrl: string | null;
  voiceId: string | null;
  videoAspect: string;
  scriptPrompt: string;
  niche: string;
  result: CreatePersonaResult | null;
  /** Avatar resolution: 'ok' (480p, 1 token/video) or 'very_good' (720p,
      2 tokens/video). The face is always present, so this is the only
      face-related choice on this screen. */
  faceQuality: FaceQuality;
  setName: (value: string) => void;
  setPhoto: (file: File | null) => void;
  setPrompt: (value: string) => void;
  setAvatarUrl: (url: string | null) => void;
  setStoredPhotoUrl: (url: string | null) => void;
  setVoiceId: (id: string | null) => void;
  setVideoAspect: (value: string) => void;
  setScriptPrompt: (value: string) => void;
  setNiche: (value: string) => void;
  setResult: (result: CreatePersonaResult | null) => void;
  setFaceQuality: (quality: FaceQuality) => void;
  resetForm: () => void;
  buildPersonaFormData: (language?: string) => FormData;
}

const initialPersonaState = {
  name: '',
  photo: null,
  prompt: '',
  avatarUrl: null,
  storedPhotoUrl: null,
  voiceId: null,
  videoAspect: '9:16',
  scriptPrompt: '',
  niche: '',
  result: null,
  faceQuality: 'ok' as FaceQuality,
};

export const usePersonaStore = create<PersonaFormState>()(
  (set, get) => ({
    ...initialPersonaState,
    setName: (name) => set({ name }),
    setPhoto: (photo) => set({ photo }),
    setPrompt: (prompt) => set({ prompt }),
    setAvatarUrl: (avatarUrl) => set({ avatarUrl }),
    setStoredPhotoUrl: (storedPhotoUrl) => set({ storedPhotoUrl }),
    setVoiceId: (voiceId) => set({ voiceId }),
    setVideoAspect: (videoAspect) => set({ videoAspect }),
    setScriptPrompt: (scriptPrompt) => set({ scriptPrompt }),
    setNiche: (niche) => set({ niche }),
    setResult: (result) => set({ result }),
    setFaceQuality: (faceQuality) => set({ faceQuality }),
    resetForm: () => set({ ...initialPersonaState }),
    buildPersonaFormData: (language?: string) => {
      const s = get();
      const formData = new FormData();
      formData.append('name', s.name.trim());
      formData.append('faceQuality', s.faceQuality);
      // Exactly one visual identity per persona. The photo wins when both
      // are staged (the server enforces the same rule).
      if (s.photo) {
        formData.append('photo', s.photo);
      } else if (s.avatarUrl) {
        formData.append('avatarUrl', s.avatarUrl);
      }
      if (s.voiceId) {
        formData.append('voiceId', s.voiceId);
      }
      if (language) formData.append('language', language);
      if (s.videoAspect) formData.append('videoAspect', s.videoAspect);
      if (s.scriptPrompt.trim()) formData.append('scriptPrompt', s.scriptPrompt.trim());
      if (s.niche.trim()) formData.append('niche', s.niche.trim());
      const videoSubject = s.niche.trim() || s.scriptPrompt.trim();
      if (videoSubject) formData.append('video_subject', videoSubject);
      return formData;
    },
  }),
);

//---------------
// NewPostState — /posts/new draft (persona, topics, publish plan).
//
// Account selection is NOT duplicated here: it lives in useUploadStore
// (selectedAccountIds), which the accounts screen already writes and the
// creation screen reads — one selection for the whole app.
//---------------

export interface NewPostState {
  /** The selected persona; '' means "none chosen yet", NOT "no persona". */
  personaId: string;
  /**
   * The user explicitly chose "no persona" (migration 012): a faceless post
   * carrying its own voice. Kept apart from an empty personaId so the form
   * does not open in persona-less mode before anyone chose anything, and so
   * "not chosen yet" can still be reported as a missing field.
   */
  withoutPersona: boolean;
  /**
   * Voice for a post created WITHOUT a persona: with no persona there is no
   * voice to inherit, and the engine rejects a job that speaks with none.
   * Unused when a persona is selected — that one supplies its own voice.
   */
  voiceId: string;
  /**
   * The single video topic. One post mints one video and one publish slot,
   * so the draft is a string, not a list: a second topic would mean a second
   * video at another time, which is a second post. The API still takes an
   * array (`topics: [topic]`) because the MCP tool schedules up to 10 per
   * call — the form simply does not offer the range.
   */
  topic: string;
  /** Naive "YYYY-MM-DDTHH:mm" wall clock, resolved against `timezone`. */
  startAt: string;
  /** Daily publish times as "HH:MM". */
  times: string[];
  timezone: string;
  /**
   * How the post publishes: 'scheduled' (default) publishes at the slot
   * times above; 'asap' publishes the video the moment generation finishes,
   * with no scheduled time (the 3h lead-time window does not apply).
   */
  publishMode: 'scheduled' | 'asap';
  /**
   * Generate this batch WITHOUT a face: 100% stock footage, no lipsync, and
   * no persona image in the library (the persona still supplies the voice,
   * niche and script prompt — and is still required). Personas are always
   * faced; this is the only place "no face" lives now.
   */
  faceless: boolean;
  /** Last create outcome, so every local component can render it without
      props. A projection of api.ts' CreatePostResult (only the fields the UI
      reads) — declared here so lib/store.ts never imports lib/api.ts, which
      imports this store (accounts selection) back. */
  result: NewPostOutcome | null;
  /** Localized failure key for a client-side rejection (never sent). */
  validationKey: TranslationKey | null;
  /** True while the create request is in flight. */
  pending: boolean;
  setPersonaId: (personaId: string) => void;
  /** The persona choice and the persona-less choice are exclusive. */
  setWithoutPersona: (withoutPersona: boolean) => void;
  setVoiceId: (voiceId: string) => void;
  setTopic: (value: string) => void;
  setStartAt: (value: string) => void;
  setTime: (index: number, value: string) => void;
  addTime: () => void;
  removeTime: (index: number) => void;
  setTimezone: (value: string) => void;
  setPublishMode: (mode: 'scheduled' | 'asap') => void;
  setFaceless: (faceless: boolean) => void;
  setResult: (result: NewPostOutcome | null) => void;
  setValidationKey: (key: TranslationKey | null) => void;
  setPending: (pending: boolean) => void;
  reset: () => void;
}

/** The slice of the create response the screen renders. */
export interface NewPostOutcome {
  success: boolean;
  /** Null when the request failed before a schedule existed. */
  scheduleId: string | null;
  /** The schedule's publish mode, so the banner can speak the right copy. */
  scheduleMode: 'scheduled' | 'asap' | null;
  /**
   * The created slot the screen navigates to (`/posts/[slotId]`). Null only
   * on a failure that produced no slot; the form never mints an empty
   * successful batch, so a successful outcome always carries one.
   */
  slotId: string | null;
  /** Number of slots the server created (drives the success copy). */
  slotCount: number;
  code: string | null;
  need: number | null;
  have: number | null;
}

const initialNewPostState = {
  personaId: '',
  withoutPersona: false,
  voiceId: '',
  topic: '',
  startAt: '',
  times: ['18:00'],
  timezone: 'UTC',
  publishMode: 'scheduled' as 'scheduled' | 'asap',
  // Default is WITH the persona's face; "no face" is the opt-in.
  faceless: false,
  result: null as NewPostOutcome | null,
  validationKey: null as TranslationKey | null,
  pending: false,
};

function replaceAt(list: string[], index: number, value: string): string[] {
  if (index < 0 || index >= list.length) return list;
  const next = [...list];
  next[index] = value;
  return next;
}

export const useNewPostStore = create<NewPostState>()(
  (set) => ({
    ...initialNewPostState,
    setPersonaId: (personaId) => set({ personaId, withoutPersona: false }),
    setWithoutPersona: (withoutPersona) => set({ withoutPersona, personaId: '' }),
    setVoiceId: (voiceId) => set({ voiceId }),
    setTopic: (topic) => set({ topic }),
    setStartAt: (startAt) => set({ startAt }),
    setTime: (index, value) => set((state) => ({ times: replaceAt(state.times, index, value) })),
    addTime: () => set((state) => ({ times: [...state.times, ''] })),
    removeTime: (index) =>
      set((state) => {
        if (state.times.length <= 1) return state;
        return { times: state.times.filter((_, i) => i !== index) };
      }),
    setTimezone: (timezone) => set({ timezone }),
    setPublishMode: (publishMode) => set({ publishMode }),
    setFaceless: (faceless) => set({ faceless }),
    setResult: (result) => set({ result }),
    setValidationKey: (validationKey) => set({ validationKey }),
    setPending: (pending) => set({ pending }),
    reset: () => set({ ...initialNewPostState, times: ['18:00'] }),
  }),
);
