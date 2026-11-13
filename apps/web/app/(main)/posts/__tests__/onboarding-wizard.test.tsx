import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

//---------------
// Tests for the first-visit onboarding wizard (issue #573). The i18n mock
// carries the real English copy, so assertions pin the words, not the keys.
// The store is reset and localStorage cleared before every test, because
// both survive across tests in one file.
//---------------

vi.mock('@/lib/i18n/provider', () => ({
  useI18n: () => ({
    t: (key: string, vars?: Record<string, string | number>) => {
      const dict: Record<string, string> = {
        'onboarding.stepOf': 'Step {step} of 4',
        'onboarding.reopen': 'See onboarding',
        'onboarding.step1Title': 'Welcome to Post Engineer',
        'onboarding.step1Body':
          'Create persona videos and publish them on your accounts. Your agent does it all through the MCP: routines and automation.',
        'onboarding.continue': 'Continue',
        'onboarding.step2Title': 'Connect your account',
        'onboarding.step2Body': 'Choose where to publish.',
        'onboarding.connectAccount': 'Connect account',
        'onboarding.skip': 'Skip for now',
        'onboarding.step3Title': 'Connect your agent',
        'onboarding.step3Step1': 'Create an API key.',
        'onboarding.step3Step2': 'Paste the setup into your agent.',
        'onboarding.step3Step3': 'Say what to publish and when.',
        'onboarding.step3SetupLink': 'Open the setup prompt',
        'onboarding.step3Done': 'I connected my agent',
        'onboarding.step4Title': 'Your tokens',
        'onboarding.step4Body': 'Talk to us and get 3 free tokens. No automatic purchase yet.',
        'onboarding.talkToUs': 'Talk to us',
        'onboarding.startPublishing': 'Start publishing',
        'onboarding.step4Whatsapp': "Hi! I'd like my 3 free Post Engineer tokens.",
      };
      let out = dict[key] ?? key;
      if (vars) {
        for (const [name, value] of Object.entries(vars)) out = out.split(`{${name}}`).join(String(value));
      }
      return out;
    },
    locale: 'en',
    setLocale: vi.fn(),
  }),
}));

import { OnboardingWizard, OnboardingWizardButton } from '../onboarding-wizard';
import {
  ONBOARDING_WIZARD_SEEN_KEY,
  ONBOARDING_WIZARD_STEP_KEY,
  useOnboardingWizardStore,
} from '@/lib/onboarding-wizard';

const WHATSAPP_ENV = 'NEXT_PUBLIC_WHATSAPP_NUMBER';
const TEST_NUMBER = '15551234567';
const PROVIDERS = ['YouTube', 'Instagram', 'Bluesky', 'LinkedIn', 'Threads', 'Facebook', 'Pinterest', 'Fanvue', '3Speak', 'Rumble'];

function renderWizard() {
  return render(<OnboardingWizard />);
}

describe('OnboardingWizard first visit', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useOnboardingWizardStore.setState({ isOpen: false, step: 1 });
    vi.stubEnv(WHATSAPP_ENV, TEST_NUMBER);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('opens on the first visit at step 1', async () => {
    renderWizard();
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Welcome to Post Engineer')).toBeInTheDocument();
    expect(within(dialog).getByText('Step 1 of 4')).toBeInTheDocument();
  });

  it('stays closed once the visit was seen', () => {
    window.localStorage.setItem(ONBOARDING_WIZARD_SEEN_KEY, '1');
    renderWizard();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('resumes at the saved step after a detour', async () => {
    window.localStorage.setItem(ONBOARDING_WIZARD_STEP_KEY, '3');
    renderWizard();
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Connect your agent')).toBeInTheDocument();
    expect(within(dialog).getByText('Step 3 of 4')).toBeInTheDocument();
  });

  it('walks all four steps and finishes, marking the visit seen', async () => {
    const user = userEvent.setup();
    renderWizard();
    const dialog = await screen.findByRole('dialog');

    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    expect(within(dialog).getByText('Connect your account')).toBeInTheDocument();
    expect(window.localStorage.getItem(ONBOARDING_WIZARD_STEP_KEY)).toBe('2');

    await user.click(within(dialog).getByRole('button', { name: 'Skip for now' }));
    expect(within(dialog).getByText('Connect your agent')).toBeInTheDocument();
    expect(within(dialog).getByText('Create an API key.')).toBeInTheDocument();
    expect(within(dialog).getByText('Paste the setup into your agent.')).toBeInTheDocument();
    expect(within(dialog).getByText('Say what to publish and when.')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'I connected my agent' }));
    expect(within(dialog).getByText('Your tokens')).toBeInTheDocument();
    expect(within(dialog).getByText('Talk to us and get 3 free tokens. No automatic purchase yet.')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Start publishing' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(window.localStorage.getItem(ONBOARDING_WIZARD_SEEN_KEY)).toBe('1');
  });

  it('closes with Escape and marks the visit seen', async () => {
    const user = userEvent.setup();
    renderWizard();
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(window.localStorage.getItem(ONBOARDING_WIZARD_SEEN_KEY)).toBe('1');
  });
});

describe('OnboardingWizard step 2', () => {
  beforeEach(() => {
    window.localStorage.clear();
    // The wizard opens at the saved step: step 2 is reached by resuming,
    // the same way a return from /accounts gets there.
    window.localStorage.setItem(ONBOARDING_WIZARD_STEP_KEY, '2');
    useOnboardingWizardStore.setState({ isOpen: false, step: 1 });
    vi.stubEnv(WHATSAPP_ENV, TEST_NUMBER);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('lists every connectable provider as a link to /accounts', async () => {
    renderWizard();
    await screen.findByRole('dialog');
    for (const provider of PROVIDERS) {
      const chip = screen.getByTestId(`onboarding-provider-${provider.toLowerCase()}`);
      expect(chip).toHaveAttribute('href', '/accounts');
      expect(chip).toHaveTextContent(provider);
    }
    expect(screen.getByRole('link', { name: 'Connect account' })).toHaveAttribute('href', '/accounts');
  });
});

describe('OnboardingWizard step 3', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(ONBOARDING_WIZARD_STEP_KEY, '3');
    useOnboardingWizardStore.setState({ isOpen: false, step: 1 });
    vi.stubEnv(WHATSAPP_ENV, TEST_NUMBER);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('links the setup prompt to /recipes in a new tab', async () => {
    renderWizard();
    await screen.findByRole('dialog');
    const link = screen.getByRole('link', { name: 'Open the setup prompt ↗' });
    expect(link).toHaveAttribute('href', '/recipes');
    expect(link).toHaveAttribute('target', '_blank');
  });
});

describe('OnboardingWizard step 4', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(ONBOARDING_WIZARD_STEP_KEY, '4');
    useOnboardingWizardStore.setState({ isOpen: false, step: 1 });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('links Talk to us to WhatsApp and email', async () => {
    vi.stubEnv(WHATSAPP_ENV, TEST_NUMBER);
    renderWizard();
    await screen.findByRole('dialog');
    const wa = screen.getByTestId('onboarding-whatsapp-cta');
    expect(wa).toHaveAttribute('href', expect.stringContaining(`https://wa.me/${TEST_NUMBER}`));
    expect(wa.getAttribute('href')).toContain(encodeURIComponent("Hi! I'd like my 3 free Post Engineer tokens."));
    expect(screen.getByTestId('onboarding-email-cta')).toHaveAttribute('href', 'mailto:madebyryandev@gmail.com');
  });

  it('hides the WhatsApp button when the support number is not configured', async () => {
    vi.stubEnv(WHATSAPP_ENV, undefined);
    renderWizard();
    await screen.findByRole('dialog');
    expect(screen.queryByTestId('onboarding-whatsapp-cta')).not.toBeInTheDocument();
    expect(screen.getByTestId('onboarding-email-cta')).toHaveAttribute('href', 'mailto:madebyryandev@gmail.com');
  });
});

describe('OnboardingWizardButton', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useOnboardingWizardStore.setState({ isOpen: false, step: 1 });
    vi.stubEnv(WHATSAPP_ENV, TEST_NUMBER);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reopens the wizard from step 1', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(ONBOARDING_WIZARD_SEEN_KEY, '1');
    render(
      <>
        <OnboardingWizardButton testId="onboarding-reopen-button" />
        <OnboardingWizard />
      </>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('onboarding-reopen-button'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Welcome to Post Engineer')).toBeInTheDocument();
  });
});
