'use client';

import { create } from 'zustand';

//---------------
// First-visit onboarding wizard state (issue #573). The wizard shows on
// the first visit to the posts calendar and is dismissable: closing it or
// finishing it marks the visit seen, so it never pops again on its own.
// The current step is saved as the user advances, so a detour (e.g. to
// /recipes for the setup prompt) resumes where it stopped. Step 2
// connects inline and never navigates; the resume stays as a safety net.
// The reopen button clears nothing — it always starts at step 1.
//---------------

export const ONBOARDING_WIZARD_SEEN_KEY = 'post-engineer-onboarding-wizard-seen';
export const ONBOARDING_WIZARD_STEP_KEY = 'post-engineer-onboarding-wizard-step';
export const ONBOARDING_WIZARD_STEPS = 4;

export function readOnboardingWizardSeen(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(ONBOARDING_WIZARD_SEEN_KEY) === '1';
}

export function markOnboardingWizardSeen(): void {
  window.localStorage.setItem(ONBOARDING_WIZARD_SEEN_KEY, '1');
  window.localStorage.removeItem(ONBOARDING_WIZARD_STEP_KEY);
}

export function readOnboardingWizardStep(): number {
  if (typeof window === 'undefined') return 1;
  const step = Number.parseInt(window.localStorage.getItem(ONBOARDING_WIZARD_STEP_KEY) ?? '', 10);
  return Number.isInteger(step) && step >= 1 && step <= ONBOARDING_WIZARD_STEPS ? step : 1;
}

export function saveOnboardingWizardStep(step: number): void {
  window.localStorage.setItem(ONBOARDING_WIZARD_STEP_KEY, String(step));
}

interface OnboardingWizardState {
  isOpen: boolean;
  step: number;
  open: () => void;
  openAtStep: (step: number) => void;
  dismiss: () => void;
  goToStep: (step: number) => void;
  next: () => void;
}

export const useOnboardingWizardStore = create<OnboardingWizardState>((set, get) => ({
  isOpen: false,
  step: 1,
  open: () => set({ isOpen: true, step: 1 }),
  openAtStep: (step) => set({ isOpen: true, step }),
  dismiss: () => {
    markOnboardingWizardSeen();
    set({ isOpen: false, step: 1 });
  },
  goToStep: (step) => {
    saveOnboardingWizardStep(step);
    set({ step });
  },
  next: () => {
    const nextStep = Math.min(get().step + 1, ONBOARDING_WIZARD_STEPS);
    saveOnboardingWizardStep(nextStep);
    set({ step: nextStep });
  },
}));
