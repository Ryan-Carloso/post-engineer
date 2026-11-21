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
import type { PersonaCtaType } from '@/lib/contracts/personas';
import {
  emptyPersonaDefaultAccounts,
  type PersonaDefaultAccounts,
} from '@/lib/persona-publishing-accounts';

function emptySelection(): Record<SocialProvider, string[]> {
  const selection = {} as Record<SocialProvider, string[]>;
  for (const provider of SOCIAL_PROVIDERS) {
    selection[provider] = [];
  }
  return selection;
}

interface ResolvedContent {
  title: string;
  description: string;
  igCaption: string;
}

interface UploadFormState {
  mode: SocialProvider;
  selectedAccountIds: Record<SocialProvider, string[]>;
  file: File | null;
  title: string;
  description: string;
  tags: string;
  privacyStatus: PrivacyStatus;
  result: UploadContentResult | null;
  oauthUrl: string | null;
  igFile: File | null;
  igCaption: string;
  igCaptionEdited: boolean;
  igResult: UploadContentResult | null;
  ytTitleOverride: string;
  ytDescriptionOverride: string;
  igCaptionOverride: string;
  ytThumbnail: File | null;
  setMode: (mode: SocialProvider) => void;
  toggleSelectedAccount: (provider: SocialProvider, accountId: string) => void;
  deselectAccount: (provider: SocialProvider, accountId: string) => void;
  clearSelectedAccounts: (provider?: SocialProvider) => void;
  setFile: (file: File | null) => void;
  setTitle: (value: string) => void;
  setDescription: (value: string) => void;
  setTags: (value: string) => void;
  setPrivacyStatus: (value: PrivacyStatus) => void;
  setResult: (result: UploadContentResult | null) => void;
  setOauthUrl: (url: string | null) => void;
  resetForm: () => void;
  setIgFile: (file: File | null) => void;
  setIgCaption: (value: string) => void;
  setIgResult: (result: UploadContentResult | null) => void;
  resetIgForm: () => void;
  setYtTitleOverride: (value: string) => void;
  setYtDescriptionOverride: (value: string) => void;
  setIgCaptionOverride: (value: string) => void;
  setYtThumbnail: (file: File | null) => void;
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
    setYtTitleOverride: (ytTitleOverride) => set({ ytTitleOverride }),
    setYtDescriptionOverride: (ytDescriptionOverride) => set({ ytDescriptionOverride }),
    setIgCaptionOverride: (igCaptionOverride) => set({ igCaptionOverride }),
    setYtThumbnail: (ytThumbnail) => set({ ytThumbnail }),
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

const SCRIPT_LANGUAGES = ['pt', 'es', 'fr', 'en'] as const;

export type ScriptLanguage = (typeof SCRIPT_LANGUAGES)[number];

const DEFAULT_SCRIPT_LANGUAGE: ScriptLanguage = 'en';

export function resolveScriptLanguage(locale: string): ScriptLanguage {
  const base = locale.split('-')[0].toLowerCase();
  const derived: ScriptLanguage = (SCRIPT_LANGUAGES as readonly string[]).includes(base)
    ? (base as ScriptLanguage)
    : DEFAULT_SCRIPT_LANGUAGE;
  return isEnglishLanguage(derived) ? derived : DEFAULT_SCRIPT_LANGUAGE;
}

interface PersonaFormState {
  name: string;
  photo: File | null;
  extraPhotos: File[];
  prompt: string;
  avatarUrl: string | null;
  storedPhotoUrl: string | null;
  voiceId: string | null;
  language: string | null;
  videoAspect: string;
  videoLayout: string;
  scriptPrompt: string;
  ctaType: PersonaCtaType;
  ctaUrl: string;
  ctaInstruction: string;
  niche: string;
  result: CreatePersonaResult | null;
  faceQuality: FaceQuality;
  publishingAccounts: PersonaDefaultAccounts;
  publishingAccountsLoaded: boolean;
  loadedPublishingAccounts: PersonaDefaultAccounts | null;
  setPublishingAccounts: (accounts: PersonaDefaultAccounts) => void;
  setPublishingAccountsLoaded: (loaded: boolean) => void;
  setLoadedPublishingAccounts: (accounts: PersonaDefaultAccounts) => void;
  setName: (value: string) => void;
  setPhoto: (file: File | null) => void;
  addPhotos: (files: File[]) => void;
  removePhoto: (index: number) => void;
  setPrompt: (value: string) => void;
  setAvatarUrl: (url: string | null) => void;
  setStoredPhotoUrl: (url: string | null) => void;
  setVoiceId: (id: string | null) => void;
  setLanguage: (language: string | null) => void;
  setVideoAspect: (value: string) => void;
  setVideoLayout: (value: string) => void;
  setScriptPrompt: (value: string) => void;
  setCta: (cta: { type: PersonaCtaType; url: string; instruction: string }) => void;
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
  ctaType: 'follow' as PersonaCtaType,
  ctaUrl: '',
  ctaInstruction: '',
  niche: '',
  result: null,
  faceQuality: 'ok' as FaceQuality,
  publishingAccounts: emptyPersonaDefaultAccounts(),
  publishingAccountsLoaded: true,
  loadedPublishingAccounts: null,
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
    setCta: (cta) => set({ ctaType: cta.type, ctaUrl: cta.url, ctaInstruction: cta.instruction }),
    setNiche: (niche) => set({ niche }),
    setResult: (result) => set({ result }),
    setFaceQuality: (faceQuality) => set({ faceQuality }),
    setPublishingAccounts: (publishingAccounts) => set({ publishingAccounts }),
    setPublishingAccountsLoaded: (publishingAccountsLoaded) => set({ publishingAccountsLoaded }),
    setLoadedPublishingAccounts: (loadedPublishingAccounts) => set({ loadedPublishingAccounts }),
    resetForm: () => set({ ...initialPersonaState, publishingAccounts: emptyPersonaDefaultAccounts() }),
    buildPersonaFormData: (language?: string) => {
      const s = get();
      const formData = new FormData();
      formData.append('name', s.name.trim());
      formData.append('faceQuality', s.faceQuality);
      formData.append('publishingAccounts', JSON.stringify(s.publishingAccounts));
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
      formData.append('ctaType', s.ctaType);
      if (s.ctaUrl.trim()) formData.append('ctaUrl', s.ctaUrl.trim());
      if (s.ctaInstruction.trim()) formData.append('ctaInstruction', s.ctaInstruction.trim());
      if (s.niche.trim()) formData.append('niche', s.niche.trim());
      const videoSubject = s.niche.trim() || s.scriptPrompt.trim();
      if (videoSubject) formData.append('video_subject', videoSubject);
      return formData;
    },
    buildPersonaEditFormData: () => {
      const s = get();
      const formData = new FormData();
      formData.append('name', s.name.trim());
      if (s.avatarUrl) formData.append('avatarUrl', s.avatarUrl);
      if (s.voiceId) formData.append('voiceId', s.voiceId);
      if (s.videoAspect) formData.append('videoAspect', s.videoAspect);
      if (s.videoLayout) formData.append('videoLayout', s.videoLayout);
      if (s.scriptPrompt.trim()) formData.append('scriptPrompt', s.scriptPrompt.trim());
      formData.append('ctaType', s.ctaType);
      formData.append('ctaUrl', s.ctaUrl.trim());
      formData.append('ctaInstruction', s.ctaInstruction.trim());
      if (s.niche.trim()) formData.append('niche', s.niche.trim());
      formData.append('faceQuality', s.faceQuality);
      return formData;
    },
  }),
);
