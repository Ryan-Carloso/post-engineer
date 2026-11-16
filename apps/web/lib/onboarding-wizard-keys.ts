//---------------
// Storage keys of the onboarding wizard's seen flag. They live apart from
// lib/onboarding-wizard.ts so the test setup can seed the flag without
// loading the wizard module (and its logger) before a suite's mocks apply.
//---------------

export const ONBOARDING_WIZARD_SEEN_KEY = 'post-engineer-onboarding-wizard-seen';
export const ONBOARDING_WIZARD_SEEN_METADATA_KEY = 'onboarding_wizard_seen';
