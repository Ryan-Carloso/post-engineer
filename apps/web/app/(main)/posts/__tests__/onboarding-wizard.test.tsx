import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
        'onboarding.step2OAuthHint': 'Connect in one tap',
        'onboarding.step2KeyHint': 'Connect with a key',
        'onboarding.connected': 'Connected',
        'onboarding.backToProviders': 'Back to providers',
        'onboarding.skip': 'Skip for now',
        'accounts.connectFirst': 'Connect an account',
        'accounts.connectAnother': '+ Connect another account',
        'accounts.loadError': 'We could not load the accounts.',
        'accounts.youtubeDescription': 'Publish videos and Shorts, and manage your channels.',
        'accounts.instagramDescription': 'Publish reels, stories, and posts automatically.',
        'accounts.blueskyDescription': 'Publish text posts, links, and videos.',
        'accounts.linkedinDescription': 'Publish videos to your profile and managed pages.',
        'accounts.threadsDescription': 'Publish videos to your Threads profile.',
        'accounts.facebookDescription': 'Publish videos to the Facebook Pages you manage.',
        'accounts.pinterestDescription': 'Publish video Pins to your Pinterest boards.',
        'accounts.fanvueDescription': 'Publish videos to your Fanvue account.',
        'accounts.threespeakDescription': 'Publish videos to the Hive blockchain and earn HIVE rewards.',
        'accounts.rumbleDescription': 'Publish videos to your Rumble channel with a manually issued access token.',
        'accounts.blueskyConnectTitle': 'Connect your Bluesky account',
        'accounts.blueskyConnectHint':
          'Create an app password under Settings → Privacy → App passwords and paste it below to publish videos.',
        'accounts.blueskyHandleLabel': 'Handle (e.g. you.bsky.social)',
        'accounts.blueskyPasswordLabel': 'App password',
        'accounts.blueskyConnect': 'Connect with Bluesky',
        'accounts.blueskyConnectError': 'Could not connect: check the handle and the app password.',
        'accounts.blueskySecurityHint':
          'The app password works like your password — you can revoke it anytime in Bluesky settings.',
        'accounts.threespeakConnectTitle': 'Connect your 3Speak account',
        'accounts.threespeakConnectHint':
          'Enter your Hive username and posting key. The posting key only authorizes posts — it cannot move funds or change your account keys.',
        'accounts.threespeakHandleLabel': 'Hive username (e.g. alice)',
        'accounts.threespeakPasswordLabel': 'Hive posting key',
        'accounts.threespeakConnect': 'Connect with 3Speak',
        'accounts.threespeakConnectError': 'Could not connect: check the username and the posting key.',
        'accounts.threespeakCredentialRejected': '3Speak rejected this username or posting key — check both and try again.',
        'accounts.threespeakSecurityHint':
          'Your posting key is stored encrypted. Never paste your owner, active, or master password — only the posting key.',
        'accounts.rumbleConnectTitle': 'Connect Rumble',
        'accounts.rumbleConnectHint':
          'Rumble has no OAuth: request the 40-character access token by emailing bd@rumble.com, then paste it here with your channel ID. The token is stored encrypted and never shown again.',
        'accounts.rumbleChannelLabel': 'Channel ID',
        'accounts.rumbleTokenLabel': 'Access token',
        'accounts.rumbleConnect': 'Connect Rumble',
        'accounts.rumbleSecurityHint':
          'The access token is like a password for your Rumble account: anyone with it can upload as you. Keep it private — if it leaks, email Rumble to revoke it.',
        'accounts.rumbleConnectError': 'Could not connect Rumble. Check the channel ID and the 40-character access token.',
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

// The inline credential connect calls notifyIfSessionExpired on a failed
// POST; the redirect itself is pinned in lib/__tests__/session-expiry.test.tsx.
vi.mock('@/lib/session-expiry', () => ({
  notifyIfSessionExpired: vi.fn(),
}));

import { OnboardingWizard, OnboardingWizardButton } from '../onboarding-wizard';
import {
  ONBOARDING_WIZARD_SEEN_KEY,
  ONBOARDING_WIZARD_STEP_KEY,
  useOnboardingWizardStore,
} from '@/lib/onboarding-wizard';
import { notifyIfSessionExpired } from '@/lib/session-expiry';

const WHATSAPP_ENV = 'NEXT_PUBLIC_WHATSAPP_NUMBER';
const TEST_NUMBER = '15551234567';
const PROVIDERS = ['YouTube', 'Instagram', 'Bluesky', 'LinkedIn', 'Threads', 'Facebook', 'Pinterest', 'Fanvue', '3Speak', 'Rumble'];

function renderWizard() {
  // Step 2 reads the shared ['social-accounts'] query, so every render
  // needs a client; the stub answers the accounts read with an empty
  // list (the step-2 describe installs its own fetch mock instead).
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ authenticated: true, accounts: [] }) }) as Response),
  );
  return render(
    <QueryClientProvider client={client}>
      <OnboardingWizard />
    </QueryClientProvider>,
  );
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

//---------------
// Step-2 harness: a real QueryClient and a fetch mock, so the inline
// connect exercises the real query invalidation after a connect. The
// /api/account mock serves one queued response per call, in order: the
// first call is the list render, the next is the refetch after a connect.
//---------------

const YOUTUBE_ACCOUNT = {
  provider: 'youtube',
  recordId: 'rec-youtube-1',
  channelId: 'UC-1',
  channelName: 'My Channel',
  email: '',
  connectedAt: 1,
  lastUsed: 1,
} as const;

const BLUESKY_ACCOUNT = {
  provider: 'bluesky',
  recordId: 'rec-bluesky-1',
  did: 'did:plc:alice',
  handle: 'alice.bsky.social',
  displayName: 'Alice',
  connectedAt: 1,
  lastUsed: 1,
} as const;

// Same YouTube account with a dead token: /api/account reports it with
// status 'error', so the wizard must not show it as Connected.
const YOUTUBE_ERROR_ACCOUNT = {
  ...YOUTUBE_ACCOUNT,
  status: 'error',
} as const;

const RUMBLE_ACCOUNT = {
  provider: 'rumble',
  recordId: 'rec-rumble-1',
  channelId: 'ch-1',
  channelName: 'Rumble Channel',
  connectedAt: 1,
  lastUsed: 1,
} as const;

let accountResponseQueue: Array<Array<Record<string, unknown>>> = [];
let accountFetchFails = false;
let connectResponse: { ok: boolean; status?: number; body: unknown } = { ok: true, body: { success: true } };
const fetchMock = vi.fn();
const popup = { closed: false, close: vi.fn() };

function installStep2Mocks() {
  accountResponseQueue = [[], []];
  accountFetchFails = false;
  connectResponse = { ok: true, body: { success: true } };
  fetchMock.mockReset();
  popup.close.mockClear();
  fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/account') {
      if (accountFetchFails) {
        return { ok: false, status: 500, json: async () => ({}) } as Response;
      }
      const accounts = accountResponseQueue.shift() ?? [];
      return { ok: true, json: async () => ({ authenticated: true, accounts }) } as Response;
    }
    if (url === '/api/google-oauth/start') {
      return { ok: true, json: async () => ({ success: true, auth_url: 'https://accounts.google.com/o/oauth2/auth' }) } as Response;
    }
    if (url === '/api/bluesky-connect' || url === '/api/threespeak-connect' || url === '/api/rumble-connect') {
      return {
        ok: connectResponse.ok,
        status: connectResponse.status ?? (connectResponse.ok ? 200 : 400),
        json: async () => connectResponse.body,
      } as Response;
    }
    throw new Error(`unexpected fetch in wizard test: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
}

function renderWizardWithClient() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <OnboardingWizard />
    </QueryClientProvider>,
  );
}

async function openStep2List() {
  renderWizardWithClient();
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText('Connect your account')).toBeInTheDocument();
  return dialog;
}

function dispatchOAuthMessage(type: string, error?: string) {
  window.dispatchEvent(
    new MessageEvent('message', { data: { type, error }, origin: window.location.origin }),
  );
}

describe('OnboardingWizard step 2', () => {
  beforeEach(() => {
    window.localStorage.clear();
    // The wizard opens at the saved step: step 2 is reached by resuming,
    // the same way a return from /accounts used to get there.
    window.localStorage.setItem(ONBOARDING_WIZARD_STEP_KEY, '2');
    useOnboardingWizardStore.setState({ isOpen: false, step: 1 });
    vi.stubEnv(WHATSAPP_ENV, TEST_NUMBER);
    installStep2Mocks();
    vi.mocked(notifyIfSessionExpired).mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('lists every provider as a row button with a brand icon, not a link', async () => {
    const dialog = await openStep2List();
    for (const provider of PROVIDERS) {
      const row = screen.getByTestId(`onboarding-provider-${provider.toLowerCase()}`);
      expect(row.tagName).toBe('BUTTON');
      expect(row).toHaveTextContent(provider);
      expect(within(row).getByRole('img')).toBeInTheDocument();
    }
    expect(within(dialog).queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByText('Connect account')).not.toBeInTheDocument();
  });

  it('shows the one-tap hint for OAuth providers and the key hint for key providers', async () => {
    await openStep2List();
    expect(within(screen.getByTestId('onboarding-provider-youtube')).getByText('Connect in one tap')).toBeInTheDocument();
    expect(within(screen.getByTestId('onboarding-provider-bluesky')).getByText('Connect with a key')).toBeInTheDocument();
    expect(within(screen.getByTestId('onboarding-provider-3speak')).getByText('Connect with a key')).toBeInTheDocument();
  });

  it('shows a Connected badge only for providers with a linked account', async () => {
    accountResponseQueue = [[YOUTUBE_ACCOUNT as unknown as Record<string, unknown>], []];
    const dialog = await openStep2List();
    await waitFor(() => {
      expect(within(screen.getByTestId('onboarding-provider-youtube')).getByText('Connected')).toBeInTheDocument();
    });
    expect(within(screen.getByTestId('onboarding-provider-instagram')).queryByText('Connected')).not.toBeInTheDocument();
    expect(within(dialog).getByText('Connect your account')).toBeInTheDocument();
  });

  it('does not show Connected for an account whose sync status is error', async () => {
    accountResponseQueue = [[YOUTUBE_ERROR_ACCOUNT as unknown as Record<string, unknown>], []];
    await openStep2List();
    // Wait until the queued accounts read has been consumed before
    // asserting the badge is absent, so the guard is actually exercised:
    // the row renders before the query resolves.
    await waitFor(() => {
      expect(accountResponseQueue).toHaveLength(1);
    });
    expect(within(screen.getByTestId('onboarding-provider-youtube')).queryByText('Connected')).not.toBeInTheDocument();
    expect(screen.queryByText('Connected')).not.toBeInTheDocument();
  });

  it('does not offer Continue for an error-status account in the connect view', async () => {
    const user = userEvent.setup();
    accountResponseQueue = [[YOUTUBE_ERROR_ACCOUNT as unknown as Record<string, unknown>], []];
    const dialog = await openStep2List();
    // Same synchronization as the list test: the connect view reads the
    // same query, so wait for the accounts read before opening it.
    await waitFor(() => {
      expect(accountResponseQueue).toHaveLength(1);
    });
    await user.click(screen.getByTestId('onboarding-provider-youtube'));
    expect(within(dialog).getByRole('button', { name: 'Connect an account' })).toBeInTheDocument();
    expect(within(dialog).queryByText('Connected')).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();
  });

  it('shows the load error when the accounts read fails', async () => {
    const user = userEvent.setup();
    accountFetchFails = true;
    const dialog = await openStep2List();
    await waitFor(() => {
      expect(within(dialog).getByText('We could not load the accounts.')).toBeInTheDocument();
    });
    expect(within(screen.getByTestId('onboarding-provider-youtube')).queryByText('Connected')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('onboarding-provider-youtube'));
    await waitFor(() => {
      expect(within(dialog).getByText('We could not load the accounts.')).toBeInTheDocument();
    });
    expect(within(dialog).queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();
  });

  it('opens the inline connect view on tap and stays on step 2', async () => {
    const user = userEvent.setup();
    const dialog = await openStep2List();
    await user.click(screen.getByTestId('onboarding-provider-youtube'));
    expect(within(dialog).getByText('Step 2 of 4')).toBeInTheDocument();
    expect(within(dialog).getByTestId('onboarding-provider-back')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Connect an account' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('link')).not.toBeInTheDocument();
  });

  it('returns to the provider list from the back button', async () => {
    const user = userEvent.setup();
    const dialog = await openStep2List();
    await user.click(screen.getByTestId('onboarding-provider-youtube'));
    await user.click(within(dialog).getByTestId('onboarding-provider-back'));
    expect(within(dialog).getByText('Connect your account')).toBeInTheDocument();
    expect(screen.getByTestId('onboarding-provider-instagram')).toBeInTheDocument();
  });

  it('connects YouTube inline and shows Connected plus Continue', async () => {
    const user = userEvent.setup();
    accountResponseQueue = [[], [YOUTUBE_ACCOUNT as unknown as Record<string, unknown>]];
    const dialog = await openStep2List();
    await user.click(screen.getByTestId('onboarding-provider-youtube'));
    await user.click(within(dialog).getByRole('button', { name: 'Connect an account' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/google-oauth/start');
    });
    expect(window.open).toHaveBeenCalledWith(
      'https://accounts.google.com/o/oauth2/auth',
      'YouTube OAuth',
      expect.any(String),
    );
    dispatchOAuthMessage('youtube-oauth-success');
    await waitFor(() => {
      expect(within(dialog).getByText('Connected')).toBeInTheDocument();
    });
    expect(within(dialog).getByRole('button', { name: 'Continue' })).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    expect(within(dialog).getByText('Connect your agent')).toBeInTheDocument();
  });

  it('shows the OAuth error inline and stays on step 2', async () => {
    const user = userEvent.setup();
    const dialog = await openStep2List();
    await user.click(screen.getByTestId('onboarding-provider-youtube'));
    await user.click(within(dialog).getByRole('button', { name: 'Connect an account' }));
    await waitFor(() => {
      expect(window.open).toHaveBeenCalled();
    });
    dispatchOAuthMessage('youtube-oauth-error', 'YouTube refused the connection.');
    await waitFor(() => {
      expect(within(dialog).getByText('YouTube refused the connection.')).toBeInTheDocument();
    });
    expect(within(dialog).getByText('Step 2 of 4')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeInTheDocument();
  });

  it('connects Bluesky inline with handle plus app password', async () => {
    const user = userEvent.setup();
    accountResponseQueue = [[], [BLUESKY_ACCOUNT as unknown as Record<string, unknown>]];
    const dialog = await openStep2List();
    await user.click(screen.getByTestId('onboarding-provider-bluesky'));
    await user.type(screen.getByTestId('bluesky-handle-input'), 'alice.bsky.social');
    await user.type(screen.getByTestId('bluesky-password-input'), 'app-password-1');
    await user.click(screen.getByTestId('bluesky-connect-button'));
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url]) => url === '/api/bluesky-connect')).toBe(true);
    });
    const postCall = fetchMock.mock.calls.find(([url]) => url === '/api/bluesky-connect');
    const body = postCall?.[1]?.body as FormData;
    expect(body.get('handle')).toBe('alice.bsky.social');
    expect(body.get('appPassword')).toBe('app-password-1');
    await waitFor(() => {
      expect(within(dialog).getByText('Connected')).toBeInTheDocument();
    });
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    expect(within(dialog).getByText('Connect your agent')).toBeInTheDocument();
  });

  it('shows the Bluesky connect error inline and clears the password', async () => {
    const user = userEvent.setup();
    connectResponse = { ok: false, body: {} };
    const dialog = await openStep2List();
    await user.click(screen.getByTestId('onboarding-provider-bluesky'));
    await user.type(screen.getByTestId('bluesky-handle-input'), 'alice.bsky.social');
    const passwordInput = screen.getByTestId('bluesky-password-input');
    await user.type(passwordInput, 'wrong-password');
    await user.click(screen.getByTestId('bluesky-connect-button'));
    await waitFor(() => {
      expect(within(dialog).getByText('Could not connect: check the handle and the app password.')).toBeInTheDocument();
    });
    expect(passwordInput).toHaveValue('');
    expect(screen.getByTestId('bluesky-handle-input')).toHaveValue('alice.bsky.social');
    expect(within(dialog).getByText('Step 2 of 4')).toBeInTheDocument();
    // The failed POST delegates to the session-expiry latch: deleting the
    // notifyIfSessionExpired call must fail this test.
    expect(notifyIfSessionExpired).toHaveBeenCalledTimes(1);
    expect(notifyIfSessionExpired).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
  });

  it('delegates the session-expiry redirect on a 401 credential POST', async () => {
    const user = userEvent.setup();
    connectResponse = { ok: false, status: 401, body: {} };
    const dialog = await openStep2List();
    await user.click(screen.getByTestId('onboarding-provider-bluesky'));
    await user.type(screen.getByTestId('bluesky-handle-input'), 'alice.bsky.social');
    await user.type(screen.getByTestId('bluesky-password-input'), 'app-password-1');
    await user.click(screen.getByTestId('bluesky-connect-button'));
    await waitFor(() => {
      expect(within(dialog).getByText('Could not connect: check the handle and the app password.')).toBeInTheDocument();
    });
    expect(notifyIfSessionExpired).toHaveBeenCalledTimes(1);
    expect(notifyIfSessionExpired).toHaveBeenCalledWith(expect.objectContaining({ status: 401 }));
    expect(within(dialog).getByText('Step 2 of 4')).toBeInTheDocument();
  });

  it('maps a rejected 3Speak key to the specific error', async () => {
    const user = userEvent.setup();
    connectResponse = { ok: false, body: { code: 'THREESPEAK_CREDENTIAL_REJECTED' } };
    const dialog = await openStep2List();
    await user.click(screen.getByTestId('onboarding-provider-3speak'));
    await user.type(screen.getByTestId('3speak-handle-input'), 'alice');
    await user.type(screen.getByTestId('3speak-password-input'), 'wrong-key');
    await user.click(screen.getByTestId('3speak-connect-button'));
    await waitFor(() => {
      expect(
        within(dialog).getByText('3Speak rejected this username or posting key — check both and try again.'),
      ).toBeInTheDocument();
    });
    const postCall = fetchMock.mock.calls.find(([url]) => url === '/api/threespeak-connect');
    const body = postCall?.[1]?.body as FormData;
    expect(body.get('username')).toBe('alice');
    expect(body.get('postingKey')).toBe('wrong-key');
  });

  it('connects Rumble inline with channel ID plus access token', async () => {
    const user = userEvent.setup();
    accountResponseQueue = [[], [RUMBLE_ACCOUNT as unknown as Record<string, unknown>]];
    const dialog = await openStep2List();
    await user.click(screen.getByTestId('onboarding-provider-rumble'));
    await user.type(screen.getByTestId('rumble-handle-input'), 'ch-1');
    await user.type(screen.getByTestId('rumble-password-input'), 't'.repeat(40));
    await user.click(screen.getByTestId('rumble-connect-button'));
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url]) => url === '/api/rumble-connect')).toBe(true);
    });
    const postCall = fetchMock.mock.calls.find(([url]) => url === '/api/rumble-connect');
    const body = postCall?.[1]?.body as FormData;
    expect(body.get('channelId')).toBe('ch-1');
    expect(body.get('accessToken')).toBe('t'.repeat(40));
    await waitFor(() => {
      expect(within(dialog).getByText('Connected')).toBeInTheDocument();
    });
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    expect(within(dialog).getByText('Connect your agent')).toBeInTheDocument();
  });

  it('keeps step 2 across unmount and remount', async () => {
    const first = renderWizardWithClient();
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Connect your account')).toBeInTheDocument();
    first.unmount();
    renderWizardWithClient();
    const reopened = await screen.findByRole('dialog');
    expect(within(reopened).getByText('Connect your account')).toBeInTheDocument();
    expect(within(reopened).getByText('Step 2 of 4')).toBeInTheDocument();
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
