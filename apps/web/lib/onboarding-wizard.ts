'use client';

import { create } from 'zustand';

import { logClientError } from '@/lib/client-logger';
import { ONBOARDING_WIZARD_SEEN_KEY, ONBOARDING_WIZARD_SEEN_METADATA_KEY } from '@/lib/onboarding-wizard-keys';

//---------------
// First-visit onboarding wizard state (issue #573). The wizard opens on
// its own once per account: the first time it auto-opens, it is marked
// seen right away, both in this browser (localStorage, a fast cache) and
// on the account (Supabase user_metadata), so another browser, another
// device, or cleared site data never shows it again. Leaving the page
// without closing the dialog still counts as seen. The reopen button
// always starts at step 1.
//---------------

export const ONBOARDING_WIZARD_STEPS = 4;

// The slice of the Supabase browser client the account flag needs, so
// tests inject a stub instead of a real client.
export interface OnboardingAuthClient {
  auth: {
    getUser: () => Promise<{
      data: { user: { user_metadata?: Record<string, unknown> } | null };
      error: unknown;
    }>;
    updateUser: (attributes: { data: Record<string, unknown> }) => Promise<{ error: unknown }>;
  };
}

export function readOnboardingWizardSeen(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(ONBOARDING_WIZARD_SEEN_KEY) === '1';
}

export function markOnboardingWizardSeenLocally(): void {
  window.localStorage.setItem(ONBOARDING_WIZARD_SEEN_KEY, '1');
}

// Decides whether the wizard auto-opens. A failed account read keeps it
// closed: the reopen button is always there, and showing the wizard again
// to a returning user is the bug this flag exists to prevent.
export async function shouldAutoOpenOnboardingWizard(client: OnboardingAuthClient): Promise<boolean> {
  if (readOnboardingWizardSeen()) return false;
  const { data, error } = await client.auth.getUser();
  if (error !== null && error !== undefined) {
    logClientError('[onboarding] account read failed; wizard stays closed', error);
    return false;
  }
  if (data.user === null) return false;
  if (data.user.user_metadata?.[ONBOARDING_WIZARD_SEEN_METADATA_KEY] === true) {
    markOnboardingWizardSeenLocally();
    return false;
  }
  return true;
}

// Records the first auto-open on this browser and on the account. A failed
// account write is logged; the local flag still keeps this browser quiet.
export async function markOnboardingWizardSeen(client: OnboardingAuthClient): Promise<void> {
  markOnboardingWizardSeenLocally();
  const { error } = await client.auth.updateUser({ data: { [ONBOARDING_WIZARD_SEEN_METADATA_KEY]: true } });
  if (error !== null && error !== undefined) {
    logClientError('[onboarding] account seen-flag write failed', error);
  }
}

interface OnboardingWizardState {
  isOpen: boolean;
  step: number;
  open: () => void;
  close: () => void;
  next: () => void;
}

export const useOnboardingWizardStore = create<OnboardingWizardState>((set, get) => ({
  isOpen: false,
  step: 1,
  open: () => set({ isOpen: true, step: 1 }),
  close: () => set({ isOpen: false, step: 1 }),
  next: () => set({ step: Math.min(get().step + 1, ONBOARDING_WIZARD_STEPS) }),
}));
