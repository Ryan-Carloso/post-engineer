'use client';

import { create } from 'zustand';
import type {
  CreatePersonaResult,
  PrivacyStatus,
  SocialProvider,
  UploadContentResult,
} from '@/lib/types';
import { isEnglishLanguage } from '@/lib/language-gate';
import { MAX_PERSONA_IMAGES } from '@/lib/persona-image-select';
import { SOCIAL_PROVIDERS } from '@/lib/types';
import type { FaceQuality } from '@/lib/tokens';
import {
  emptyPersonaDefaultAccounts,
  type PersonaDefaultAccounts,
} from '@/lib/persona-publishing-accounts';

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
// resolveScriptLanguage — derives the script language a NEW persona is
// created with from a locale (e.g. 'pt-BR', 'en-US'); a base language
// outside SCRIPT_LANGUAGES falls back to English. English-only launch:
// the derived language is then passed through the language gate, so
// every persona starts in English until the other languages launch.
// When the lock lifts, return `derived` directly again.
//---------------

export function resolveScriptLanguage(locale: string): ScriptLanguage {
  const base = locale.split('-')[0].toLowerCase();
  const derived: ScriptLanguage = (SCRIPT_LANGUAGES as readonly string[]).includes(base)
    ? (base as ScriptLanguage)
    : DEFAULT_SCRIPT_LANGUAGE;
  return isEnglishLanguage(derived) ? derived : DEFAULT_SCRIPT_LANGUAGE;
}

//---------------
// PersonaFormState — persona creation screen state
// (always faced: an uploaded photo OR a chosen character/AI avatar,
// name, house voice). A video without a face is a per-post choice
// (the faceless flag on the generate request), not a persona attribute.
//---------------

interface PersonaFormState {
  name: string;
  photo: File | null;
  /** Photos staged after the primary one; sent as the creation-time library
      (`images`). Capped with `photo` at MAX_PERSONA_IMAGES. */
  extraPhotos: File[];
  prompt: string;
  avatarUrl: string | null;
  /** Signed URL of the ALREADY uploaded photo (edit-mode display only).
      Never sent back to the server — photo_path is the stored identity and
      the link expires in 1h. */
  storedPhotoUrl: string | null;
  voiceId: string | null;
  /** Persona script language (edit hydrate). Voice fallback uses this. */
  language: string | null;
  videoAspect: string;
  /** How the persona is composed with the video material during the hook.
   *  'standard' = the avatar fills the frame; 'react' = the frame splits,
   *  avatar on top and the video material below. See VIDEO_LAYOUTS in persona-schema. */
  videoLayout: string;
  scriptPrompt: string;
  /** The persona's call to action ('' = the engine picks a generic one). */
  ctaText: string;
  niche: string;
  result: CreatePersonaResult | null;
  /** Avatar resolution: 'ok' (480p, 2 tokens/video) or 'very_good' (720p,
      3 tokens/video). The face is always present, so this is the only
      face-related choice on this screen. */
  faceQuality: FaceQuality;
  /** Bound publishing accounts (issue #572): at least one account, owned
      by the caller. The create picker writes here; the create submit sends
      it as the `publishingAccounts` JSON field. */
  publishingAccounts: PersonaDefaultAccounts;
  setPublishingAccounts: (accounts: PersonaDefaultAccounts) => void;
  setName: (value: string) => void;
  setPhoto: (file: File | null) => void;
  /** Appends picks after the staged ones; the first ever staged is the primary. */
  addPhotos: (files: File[]) => void;
  /** Removes by position in [photo, ...extraPhotos]. */
  removePhoto: (index: number) => void;
  setPrompt: (value: string) => void;
  setAvatarUrl: (url: string | null) => void;
  setStoredPhotoUrl: (url: string | null) => void;
  setVoiceId: (id: string | null) => void;
  setLanguage: (language: string | null) => void;
  setVideoAspect: (value: string) => void;
  setVideoLayout: (value: string) => void;
  setScriptPrompt: (value: string) => void;
  setCtaText: (value: string) => void;
  setNiche: (value: string) => void;
  setResult: (result: CreatePersonaResult | null) => void;
  setFaceQuality: (quality: FaceQuality) => void;
  resetForm: () => void;
  buildPersonaFormData: (language?: string) => FormData;
  buildPersonaEditFormData: () => FormData;
}

const initialPersonaState = {
  name: '',
  photo: null,
  extraPhotos: [] as File[],
  prompt: '',
  avatarUrl: null,
  storedPhotoUrl: null,
  voiceId: null,
  language: null,
  videoAspect: '9:16',
  videoLayout: 'standard',
  scriptPrompt: '',
  ctaText: '',
  niche: '',
  result: null,
  faceQuality: 'ok' as FaceQuality,
  publishingAccounts: emptyPersonaDefaultAccounts(),
};

export const usePersonaStore = create<PersonaFormState>()(
  (set, get) => ({
    ...initialPersonaState,
    setName: (name) => set({ name }),
    setPhoto: (photo) => set({ photo }),
    addPhotos: (files) =>
      set((s) => {
        const [photo = null, ...extraPhotos] = [...(s.photo ? [s.photo] : []), ...s.extraPhotos, ...files].slice(
          0,
          MAX_PERSONA_IMAGES,
        );
        return { photo, extraPhotos };
      }),
    removePhoto: (index) =>
      set((s) => {
        const [photo = null, ...extraPhotos] = [...(s.photo ? [s.photo] : []), ...s.extraPhotos].filter(
          (_, i) => i !== index,
        );
        return { photo, extraPhotos };
      }),
    setPrompt: (prompt) => set({ prompt }),
    setAvatarUrl: (avatarUrl) => set({ avatarUrl }),
    setStoredPhotoUrl: (storedPhotoUrl) => set({ storedPhotoUrl }),
    setVoiceId: (voiceId) => set({ voiceId }),
    setLanguage: (language) => set({ language }),
    setVideoAspect: (videoAspect) => set({ videoAspect }),
    setVideoLayout: (videoLayout) => set({ videoLayout }),
    setScriptPrompt: (scriptPrompt) => set({ scriptPrompt }),
    setCtaText: (ctaText) => set({ ctaText }),
    setNiche: (niche) => set({ niche }),
    setResult: (result) => set({ result }),
    setFaceQuality: (faceQuality) => set({ faceQuality }),
    setPublishingAccounts: (publishingAccounts) => set({ publishingAccounts }),
    // resetForm reuses the shared initial state, but the binding gets a
    // fresh empty map: sharing one object across resets would let a
    // mutated map leak into the next persona.
    resetForm: () => set({ ...initialPersonaState, publishingAccounts: emptyPersonaDefaultAccounts() }),
    buildPersonaFormData: (language?: string) => {
      const s = get();
      const formData = new FormData();
      formData.append('name', s.name.trim());
      formData.append('faceQuality', s.faceQuality);
      // Issue #572: the binding rides the create payload as JSON — the
      // server rejects a missing/empty binding with a 400 before writing
      // anything. Always sent, even empty: the server's error names the
      // rule instead of the client guessing at it.
      formData.append('publishingAccounts', JSON.stringify(s.publishingAccounts));
      // Exactly one visual identity per persona. The photo wins when both
      // are staged (the server enforces the same rule).
      if (s.photo) {
        formData.append('photo', s.photo);
        for (const extra of s.extraPhotos) formData.append('images', extra);
      } else if (s.avatarUrl) {
        formData.append('avatarUrl', s.avatarUrl);
      }
      if (s.voiceId) {
        formData.append('voiceId', s.voiceId);
      }
      if (language) formData.append('language', language);
      if (s.videoAspect) formData.append('videoAspect', s.videoAspect);
      if (s.videoLayout) formData.append('videoLayout', s.videoLayout);
      if (s.scriptPrompt.trim()) formData.append('scriptPrompt', s.scriptPrompt.trim());
      if (s.ctaText.trim()) formData.append('ctaText', s.ctaText.trim());
      if (s.niche.trim()) formData.append('niche', s.niche.trim());
      const videoSubject = s.niche.trim() || s.scriptPrompt.trim();
      if (videoSubject) formData.append('video_subject', videoSubject);
      return formData;
    },
    // Edit payload: the same fields the edit submit used to append inline,
    // plus the stored faceQuality — the PATCH accepts it now, so changing
    // the quality picker on the edit screen reaches the persona row instead
    // of being silently dropped. Photo changes do not ride this payload
    // (the avatar section uploads them separately).
    buildPersonaEditFormData: () => {
      const s = get();
      const formData = new FormData();
      formData.append('name', s.name.trim());
      if (s.avatarUrl) formData.append('avatarUrl', s.avatarUrl);
      if (s.voiceId) formData.append('voiceId', s.voiceId);
      if (s.videoAspect) formData.append('videoAspect', s.videoAspect);
      if (s.videoLayout) formData.append('videoLayout', s.videoLayout);
      if (s.scriptPrompt.trim()) formData.append('scriptPrompt', s.scriptPrompt.trim());
      // Always sent on edit: a blank value clears the persona's CTA
      // (the PATCH parser maps present-but-blank to ''), omitting the
      // field would leave the old CTA in place forever.
      formData.append('ctaText', s.ctaText.trim());
      if (s.niche.trim()) formData.append('niche', s.niche.trim());
      formData.append('faceQuality', s.faceQuality);
      return formData;
    },
  }),
);
