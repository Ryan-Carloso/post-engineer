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
import { DEFAULT_FACE_MIX_PERCENT } from '@/lib/persona-schema';

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
// (persona mode with AI avatar / photo OR 100% stock faceless,
// name, house voice)
//---------------

type PersonaMode = 'persona' | 'faceless';

interface PersonaFormState {
  personaMode: PersonaMode;
  name: string;
  photo: File | null;
  prompt: string;
  avatarUrl: string | null;
  voiceId: string | null;
  videoAspect: string;
  scriptPrompt: string;
  niche: string;
  result: CreatePersonaResult | null;
  // Faceless/face mix (hybrid) — % of face in the video and avatar quality.
  // 0% = faceless (cheap, 0.5 token); 100% ok (480p) = 1 token;
  // 100% very_good (720p) = 2 tokens. Cost is weighted by the mix.
  faceMixPercent: number;
  faceQuality: FaceQuality;
  // Autopilot (schedule) — state moved to the /schedule flow;
  // these fields only feed the scheduling page, not the persona.
  scheduleDays: number[];
  scheduleTimes: string[];
  timezone: string;
  youtubeSelectedIds: string[];
  instagramSelectedIds: string[];
  linkedinSelectedIds: string[];
  setPersonaMode: (mode: PersonaMode) => void;
  setName: (value: string) => void;
  setPhoto: (file: File | null) => void;
  setPrompt: (value: string) => void;
  setAvatarUrl: (url: string | null) => void;
  setVoiceId: (id: string | null) => void;
  setVideoAspect: (value: string) => void;
  setScriptPrompt: (value: string) => void;
  setNiche: (value: string) => void;
  setResult: (result: CreatePersonaResult | null) => void;
  // Mix/quality — setFaceMixPercent clamps on change and derives the mode
  // (0 → faceless, > 0 → persona). setFaceQuality only changes the quality.
  setFaceMixPercent: (value: number) => void;
  setFaceQuality: (quality: FaceQuality) => void;
  resetForm: () => void;
  buildPersonaFormData: (language?: string) => FormData;
  setScheduleDays: (days: number[]) => void;
  toggleScheduleDay: (day: number) => void;
  setScheduleTimes: (times: string[]) => void;
  addScheduleTime: (time?: string) => void;
  removeScheduleTime: (time: string) => void;
  setYoutubeSelectedIds: (ids: string[]) => void;
  setInstagramSelectedIds: (ids: string[]) => void;
  setLinkedInSelectedIds: (ids: string[]) => void;
  toggleYoutubeSelectedId: (id: string) => void;
  toggleInstagramSelectedId: (id: string) => void;
  toggleLinkedInSelectedId: (id: string) => void;
}

const initialPersonaState = {
  personaMode: 'persona' as PersonaMode,
  name: '',
  photo: null,
  prompt: '',
  avatarUrl: null,
  voiceId: null,
  videoAspect: '9:16',
  scriptPrompt: '',
  niche: '',
  result: null,
  // Legacy mode default: 100% face, ok quality (1 token). Shared with the
  // creation route's insert coercion so the two can't drift apart.
  faceMixPercent: DEFAULT_FACE_MIX_PERCENT,
  faceQuality: 'ok' as FaceQuality,
  scheduleDays: [0, 1, 2, 3, 4, 5, 6],
  scheduleTimes: ['09:00'],
  timezone: 'UTC',
  youtubeSelectedIds: [],
  instagramSelectedIds: [],
  linkedinSelectedIds: [],
};

export const usePersonaStore = create<PersonaFormState>()(
  (set, get) => ({
    ...initialPersonaState,
    setPersonaMode: (personaMode) => set({ personaMode }),
    setName: (name) => set({ name }),
    setPhoto: (photo) => set({ photo }),
    setPrompt: (prompt) => set({ prompt }),
    setAvatarUrl: (avatarUrl) => set({ avatarUrl }),
    setVoiceId: (voiceId) => set({ voiceId }),
    setVideoAspect: (videoAspect) => set({ videoAspect }),
    setScriptPrompt: (scriptPrompt) => set({ scriptPrompt }),
    setNiche: (niche) => set({ niche }),
    setResult: (result) => set({ result }),
    setFaceMixPercent: (value) =>
      set(() => {
        const faceMixPercent = Math.min(100, Math.max(0, Math.round(value)));
        return { faceMixPercent, personaMode: faceMixPercent === 0 ? 'faceless' : 'persona' };
      }),
    setFaceQuality: (faceQuality) => set({ faceQuality }),
    resetForm: () => set({ ...initialPersonaState }),
    setScheduleDays: (scheduleDays) => set({ scheduleDays }),
    toggleScheduleDay: (day) =>
      set((state) => {
        const current = state.scheduleDays;
        const next = current.includes(day)
          ? current.filter((d) => d !== day)
          : [...current, day];
        return { scheduleDays: next.sort((a, b) => a - b) };
      }),
    setScheduleTimes: (scheduleTimes) => set({ scheduleTimes: [...new Set(scheduleTimes)].sort() }),
    addScheduleTime: (time = '12:00') => set((state) => ({ scheduleTimes: [...new Set([...state.scheduleTimes, time])].sort() })),
    removeScheduleTime: (time) => set((state) => ({ scheduleTimes: state.scheduleTimes.filter((item) => item !== time) })),
    setYoutubeSelectedIds: (youtubeSelectedIds) => set({ youtubeSelectedIds }),
    setInstagramSelectedIds: (instagramSelectedIds) => set({ instagramSelectedIds }),
    setLinkedInSelectedIds: (linkedinSelectedIds) => set({ linkedinSelectedIds }),
    toggleYoutubeSelectedId: (id) =>
      set((state) => {
        const current = state.youtubeSelectedIds;
        const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
        return { youtubeSelectedIds: next };
      }),
    toggleInstagramSelectedId: (id) =>
      set((state) => {
        const current = state.instagramSelectedIds;
        const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
        return { instagramSelectedIds: next };
      }),
    toggleLinkedInSelectedId: (id) =>
      set((state) => {
        const current = state.linkedinSelectedIds;
        const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
        return { linkedinSelectedIds: next };
      }),
    buildPersonaFormData: (language?: string) => {
      const s = get();
      const formData = new FormData();
      formData.append('personaMode', s.personaMode);
      formData.append('name', s.name.trim());
      // Effective mix: faceless mode (or mix 0) → no face at all.
      const effectiveMix = s.personaMode === 'faceless' ? 0 : s.faceMixPercent;
      formData.append('faceMixPercent', String(effectiveMix));
      formData.append('faceQuality', s.faceQuality);
      if (effectiveMix > 0) {
        if (s.photo) {
          formData.append('photo', s.photo);
        } else if (s.avatarUrl) {
          formData.append('avatarUrl', s.avatarUrl);
        }
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
