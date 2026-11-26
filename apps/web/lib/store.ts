'use client';

import { create } from 'zustand';
import type {
  CreatePersonaResult,
  PrivacyStatus,
  SocialProvider,
  UploadContentResult,
} from '@/lib/types';
import { SOCIAL_PROVIDERS } from '@/lib/types';
import {
  emptyPersonaDefaultAccounts,
  type PersonaDefaultAccounts,
} from '@/lib/persona-publishing-accounts';
import {
  emptyIdentityCardDraft,
  identityCardFormValue,
  sameIdentityCardDraft,
  type IdentityCardDraft,
  type IdentityCardFieldKey,
} from '@/lib/persona-identity-card-form';

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

interface PersonaFormState {
  name: string;
  photo: File | null;
  storedPhotoUrl: string | null;
  result: CreatePersonaResult | null;
  publishingAccounts: PersonaDefaultAccounts;
  publishingAccountsLoaded: boolean;
  loadedPublishingAccounts: PersonaDefaultAccounts | null;
  identityCardDraft: IdentityCardDraft;
  identityCardLoaded: IdentityCardDraft;
  isSubmitting: boolean;
  setIdentityCardField: (key: IdentityCardFieldKey, value: string) => void;
  applyServerIdentityCard: (draft: IdentityCardDraft) => void;
  resetIdentityCard: () => void;
  setSubmitting: (value: boolean) => void;
  setPublishingAccounts: (accounts: PersonaDefaultAccounts) => void;
  setPublishingAccountsLoaded: (loaded: boolean) => void;
  setLoadedPublishingAccounts: (accounts: PersonaDefaultAccounts) => void;
  setName: (value: string) => void;
  setPhoto: (file: File | null) => void;
  setStoredPhotoUrl: (url: string | null) => void;
  setResult: (result: CreatePersonaResult | null) => void;
  resetForm: () => void;
  buildPersonaFormData: () => FormData;
  buildPersonaEditFormData: () => FormData;
}

const initialPersonaState = {
  name: '',
  photo: null,
  storedPhotoUrl: null,
  result: null,
  publishingAccounts: emptyPersonaDefaultAccounts(),
  publishingAccountsLoaded: true,
  loadedPublishingAccounts: null,
  identityCardDraft: emptyIdentityCardDraft(),
  identityCardLoaded: emptyIdentityCardDraft(),
  isSubmitting: false,
};

export const usePersonaStore = create<PersonaFormState>()(
  (set, get) => ({
    ...initialPersonaState,
    setName: (name) => set({ name }),
    setPhoto: (photo) => set({ photo }),
    setStoredPhotoUrl: (storedPhotoUrl) => set({ storedPhotoUrl }),
    setResult: (result) => set({ result }),
    setPublishingAccounts: (publishingAccounts) => set({ publishingAccounts }),
    setPublishingAccountsLoaded: (publishingAccountsLoaded) => set({ publishingAccountsLoaded }),
    setLoadedPublishingAccounts: (loadedPublishingAccounts) => set({ loadedPublishingAccounts }),
    setIdentityCardField: (key, value) => set((s) => ({ identityCardDraft: { ...s.identityCardDraft, [key]: value } })),
    applyServerIdentityCard: (draft) =>
      set((s) => ({
        identityCardLoaded: draft,
        identityCardDraft: sameIdentityCardDraft(s.identityCardDraft, s.identityCardLoaded) ? draft : s.identityCardDraft,
      })),
    resetIdentityCard: () => set({ identityCardDraft: emptyIdentityCardDraft(), identityCardLoaded: emptyIdentityCardDraft() }),
    setSubmitting: (isSubmitting) => set({ isSubmitting }),
    resetForm: () => set({ ...initialPersonaState, publishingAccounts: emptyPersonaDefaultAccounts() }),
    buildPersonaFormData: () => {
      const s = get();
      const formData = new FormData();
      formData.append('name', s.name.trim());
      formData.append('publishingAccounts', JSON.stringify(s.publishingAccounts));
      if (s.photo) formData.append('photo', s.photo);
      const identityCard = identityCardFormValue(s.identityCardDraft, s.identityCardLoaded);
      if (identityCard !== null) formData.append('identityCard', identityCard);
      return formData;
    },
    buildPersonaEditFormData: () => {
      const s = get();
      const formData = new FormData();
      formData.append('name', s.name.trim());
      if (s.photo) formData.append('photo', s.photo);
      const identityCard = identityCardFormValue(s.identityCardDraft, s.identityCardLoaded);
      if (identityCard !== null) formData.append('identityCard', identityCard);
      return formData;
    },
  }),
);
