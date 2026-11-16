import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  markOnboardingWizardSeen,
  readOnboardingWizardSeen,
  shouldAutoOpenOnboardingWizard,
  useOnboardingWizardStore,
  type OnboardingAuthClient,
} from '@/lib/onboarding-wizard';
import { ONBOARDING_WIZARD_SEEN_KEY, ONBOARDING_WIZARD_SEEN_METADATA_KEY } from '@/lib/onboarding-wizard-keys';
import { logClientError } from '@/lib/client-logger';

vi.mock('@/lib/client-logger', () => ({ logClientError: vi.fn() }));

function authClient(
  metadata: Record<string, unknown> | null,
  options: { readError?: unknown; writeError?: unknown } = {},
) {
  const getUser = vi.fn(async () => ({
    data: { user: metadata === null ? null : { user_metadata: metadata } },
    error: options.readError ?? null,
  }));
  const updateUser = vi.fn(async () => ({ error: options.writeError ?? null }));
  const client: OnboardingAuthClient = { auth: { getUser, updateUser } };
  return { client, getUser, updateUser };
}

describe('shouldAutoOpenOnboardingWizard', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.mocked(logClientError).mockClear();
  });

  it('opens for an account that never saw the wizard', async () => {
    const { client } = authClient({ name: 'A' });
    await expect(shouldAutoOpenOnboardingWizard(client)).resolves.toBe(true);
  });

  it('stays closed without an account read when this browser already saw it', async () => {
    window.localStorage.setItem(ONBOARDING_WIZARD_SEEN_KEY, '1');
    const { client, getUser } = authClient({});
    await expect(shouldAutoOpenOnboardingWizard(client)).resolves.toBe(false);
    expect(getUser).not.toHaveBeenCalled();
  });

  it('stays closed on a new browser when the account already saw it, and caches it locally', async () => {
    const { client } = authClient({ [ONBOARDING_WIZARD_SEEN_METADATA_KEY]: true });
    await expect(shouldAutoOpenOnboardingWizard(client)).resolves.toBe(false);
    expect(readOnboardingWizardSeen()).toBe(true);
  });

  it('opens when the account flag holds anything other than literal true', async () => {
    const { client } = authClient({ [ONBOARDING_WIZARD_SEEN_METADATA_KEY]: 'true' });
    await expect(shouldAutoOpenOnboardingWizard(client)).resolves.toBe(true);
  });

  it('stays closed and logs when the account read fails', async () => {
    const readError = new Error('network');
    const { client } = authClient(null, { readError });
    await expect(shouldAutoOpenOnboardingWizard(client)).resolves.toBe(false);
    expect(logClientError).toHaveBeenCalledWith('[onboarding] account read failed; wizard stays closed', readError);
    expect(readOnboardingWizardSeen()).toBe(false);
  });

  it('stays closed without a signed-in user', async () => {
    const { client } = authClient(null);
    await expect(shouldAutoOpenOnboardingWizard(client)).resolves.toBe(false);
  });
});

describe('markOnboardingWizardSeen', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.mocked(logClientError).mockClear();
  });

  it('marks this browser and the account', async () => {
    const { client, updateUser } = authClient({});
    await markOnboardingWizardSeen(client);
    expect(readOnboardingWizardSeen()).toBe(true);
    expect(updateUser).toHaveBeenCalledWith({ data: { [ONBOARDING_WIZARD_SEEN_METADATA_KEY]: true } });
    expect(logClientError).not.toHaveBeenCalled();
  });

  it('keeps the local flag and logs when the account write fails', async () => {
    const writeError = new Error('boom');
    const { client } = authClient({}, { writeError });
    await markOnboardingWizardSeen(client);
    expect(readOnboardingWizardSeen()).toBe(true);
    expect(logClientError).toHaveBeenCalledWith('[onboarding] account seen-flag write failed', writeError);
  });
});

describe('useOnboardingWizardStore', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useOnboardingWizardStore.setState({ isOpen: false, step: 1 });
  });

  it('opens at step 1 and advances', () => {
    useOnboardingWizardStore.getState().open();
    expect(useOnboardingWizardStore.getState()).toMatchObject({ isOpen: true, step: 1 });
    useOnboardingWizardStore.getState().next();
    expect(useOnboardingWizardStore.getState()).toMatchObject({ isOpen: true, step: 2 });
  });

  it('never advances past the last step', () => {
    useOnboardingWizardStore.setState({ isOpen: true, step: 4 });
    useOnboardingWizardStore.getState().next();
    expect(useOnboardingWizardStore.getState().step).toBe(4);
  });

  it('close closes and resets to step 1 without touching the seen flag', () => {
    useOnboardingWizardStore.setState({ isOpen: true, step: 3 });
    useOnboardingWizardStore.getState().close();
    expect(useOnboardingWizardStore.getState()).toMatchObject({ isOpen: false, step: 1 });
    expect(readOnboardingWizardSeen()).toBe(false);
  });
});
