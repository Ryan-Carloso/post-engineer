import { describe, it, expect, beforeEach } from 'vitest';

import {
  ONBOARDING_WIZARD_STEP_KEY,
  markOnboardingWizardSeen,
  readOnboardingWizardSeen,
  readOnboardingWizardStep,
  saveOnboardingWizardStep,
  useOnboardingWizardStore,
} from '@/lib/onboarding-wizard';

describe('onboarding wizard first-visit state', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useOnboardingWizardStore.setState({ isOpen: false, step: 1 });
  });

  it('is unseen on the first visit', () => {
    expect(readOnboardingWizardSeen()).toBe(false);
  });

  it('marks the visit seen and clears the saved step', () => {
    saveOnboardingWizardStep(3);
    markOnboardingWizardSeen();
    expect(readOnboardingWizardSeen()).toBe(true);
    expect(window.localStorage.getItem(ONBOARDING_WIZARD_STEP_KEY)).toBeNull();
    expect(readOnboardingWizardStep()).toBe(1);
  });

  it('starts at step 1 with no saved step', () => {
    expect(readOnboardingWizardStep()).toBe(1);
  });

  it('resumes at the saved step', () => {
    saveOnboardingWizardStep(2);
    expect(readOnboardingWizardStep()).toBe(2);
  });

  it('falls back to step 1 for a step outside the wizard', () => {
    for (const raw of ['0', '5', 'abc', '']) {
      window.localStorage.setItem(ONBOARDING_WIZARD_STEP_KEY, raw);
      expect(readOnboardingWizardStep()).toBe(1);
    }
  });
});

describe('useOnboardingWizardStore', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useOnboardingWizardStore.setState({ isOpen: false, step: 1 });
  });

  it('opens at step 1 and advances, saving each step', () => {
    const store = useOnboardingWizardStore.getState();
    store.open();
    expect(useOnboardingWizardStore.getState()).toMatchObject({ isOpen: true, step: 1 });
    useOnboardingWizardStore.getState().next();
    expect(useOnboardingWizardStore.getState()).toMatchObject({ isOpen: true, step: 2 });
    expect(window.localStorage.getItem(ONBOARDING_WIZARD_STEP_KEY)).toBe('2');
  });

  it('never advances past the last step', () => {
    const store = useOnboardingWizardStore.getState();
    store.openAtStep(4);
    useOnboardingWizardStore.getState().next();
    expect(useOnboardingWizardStore.getState().step).toBe(4);
  });

  it('dismiss marks the visit seen, closes, and resets to step 1', () => {
    const store = useOnboardingWizardStore.getState();
    store.openAtStep(3);
    useOnboardingWizardStore.getState().dismiss();
    expect(useOnboardingWizardStore.getState()).toMatchObject({ isOpen: false, step: 1 });
    expect(readOnboardingWizardSeen()).toBe(true);
  });

  it('opens at a given step', () => {
    useOnboardingWizardStore.getState().openAtStep(3);
    expect(useOnboardingWizardStore.getState()).toMatchObject({ isOpen: true, step: 3 });
  });
});
