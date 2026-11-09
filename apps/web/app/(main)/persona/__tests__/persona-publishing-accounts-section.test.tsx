import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

//---------------
// Tests for PersonaPublishingAccountsSection (issue #212): per-persona
// default publishing accounts. The GET/PUT route is built in parallel, so
// fetch is mocked; the four social-account query hooks are mocked too.
//---------------

vi.mock('@/lib/i18n/provider', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const react = require('react') as typeof import('react');
  const dictionary: Record<string, string> = {
    'persona.publishingAccountsLabel': 'Default publishing accounts',
    'persona.publishingAccountsHint': 'Hint text.',
    'persona.publishingAccountsSave': 'Save defaults',
    'persona.publishingAccountsSaving': 'Saving…',
    'persona.publishingAccountsSaved': 'Defaults saved.',
    'persona.publishingAccountsLoadError': 'Could not load the default accounts.',
    'persona.publishingAccountsSaveError': 'Could not save the default accounts.',
    'persona.publishingAccountsNoAccounts': 'No {provider} accounts connected.',
    'persona.connectAccounts': 'Connect accounts',
    'persona.tryAgain': 'Try again',
    'accounts.connectedAccount': 'Connected',
  };
  const t = (key: string, vars?: Record<string, string | number>) => {
    const template = dictionary[key] ?? key;
    if (!vars) return template;
    return template.replace(/\{(\w+)\}/g, (match, name: string) => {
      const value = vars[name];
      return value === undefined ? match : String(value);
    });
  };
  const useI18n = () => {
    const [locale, setLocale] = react.useState<'pt' | 'en'>('pt');
    return { locale, setLocale, t };
  };
  function I18nProvider({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
  }
  I18nProvider.displayName = 'I18nProvider';
  return { useI18n, I18nProvider };
});

vi.mock('next/image', () => ({
  // eslint-disable-next-line jsx-a11y/alt-text, @next/next/no-img-element
  default: (props: React.ComponentProps<'img'>) => <img {...props} />,
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const mockQueries = vi.hoisted(() => ({
  youtube: { data: null as null | { accounts: unknown[] }, isLoading: false },
  instagram: { data: null as null | { accounts: unknown[] }, isLoading: false },
  bluesky: { data: null as null | { accounts: unknown[] }, isLoading: false },
  linkedin: { data: null as null | { accounts: unknown[] }, isLoading: false },
  threads: { data: { authenticated: true, accounts: [] as unknown[] }, isLoading: false, error: null as null },
  facebook: { data: { authenticated: true, accounts: [] as unknown[] }, isLoading: false, error: null as null },
  pinterest: { data: { authenticated: true, accounts: [] as unknown[] }, isLoading: false, error: null as null },
}));

vi.mock('@/lib/api', () => ({
  useYouTubeAccountsQuery: () => mockQueries.youtube,
  useInstagramAccountsQuery: () => mockQueries.instagram,
  useBlueskyAccountsQuery: () => mockQueries.bluesky,
  useLinkedinAccountsQuery: () => mockQueries.linkedin,
  useThreadsAccountsQuery: () => mockQueries.threads,
  useFacebookAccountsQuery: () => mockQueries.facebook,
}));

vi.mock('@/lib/pinterest-accounts', () => ({
  usePinterestAccountsQuery: () => mockQueries.pinterest,
}));

vi.mock('@/lib/account-card-telemetry', () => ({
  reportAccountCardDisplay: vi.fn(),
}));

// Only notifyIfSessionExpired is doubled; the redirect behavior of the
// module is pinned in lib/__tests__/session-expiry.test.tsx.
vi.mock('@/lib/session-expiry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/session-expiry')>();
  return {
    ...actual,
    notifyIfSessionExpired: vi.fn(),
  };
});

import { PersonaPublishingAccountsSection } from '../persona-publishing-accounts-section';
import { reportAccountCardDisplay } from '@/lib/account-card-telemetry';
import { notifyIfSessionExpired } from '@/lib/session-expiry';

const PERSONA_ID = '11111111-2222-3333-4444-555555555555';
const DEFAULTS_URL = `/api/persona/publishing-accounts?personaId=${PERSONA_ID}`;

const connectedAccounts = {
  youtube: {
    data: {
      accounts: [
        { provider: 'youtube', channelId: 'UC-1', channelName: 'Channel One', email: 'one@x.test', thumbnail: '' },
        { provider: 'youtube', channelId: 'UC-2', channelName: 'Channel Two', email: '', thumbnail: '' },
      ],
    },
    isLoading: false,
  },
  instagram: {
    data: { accounts: [{ provider: 'instagram', igUserId: 'ig-9', username: 'insta.nine', profilePictureUrl: '' }] },
    isLoading: false,
  },
  bluesky: {
    data: { accounts: [{ provider: 'bluesky', did: 'did:plc:abc', handle: 'bsky.test' }] },
    isLoading: false,
  },
  linkedin: { data: { accounts: [] }, isLoading: false },
};

const serverDefaults = {
  success: true,
  defaults: { youtube: ['UC-1'], instagram: [], bluesky: ['did:plc:abc'], linkedin: [], threads: [] },
};

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  const fetchMock = vi.fn().mockResolvedValueOnce({
    ok,
    status,
    json: () => Promise.resolve(body),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function setConnectedAccounts() {
  mockQueries.youtube = { ...connectedAccounts.youtube };
  mockQueries.instagram = { ...connectedAccounts.instagram };
  mockQueries.bluesky = { ...connectedAccounts.bluesky };
  mockQueries.linkedin = { ...connectedAccounts.linkedin };
  mockQueries.threads = { data: { authenticated: true, accounts: [] }, isLoading: false, error: null };
  mockQueries.facebook = { data: { authenticated: true, accounts: [] }, isLoading: false, error: null };
}

beforeEach(() => {
  vi.unstubAllGlobals();
  setConnectedAccounts();
});

describe('PersonaPublishingAccountsSection', () => {

  it('does not fetch for a non-uuid personaId (placeholder callers stopped 400ing)', async () => {
    // The production warnings ("invalid input syntax for type uuid: \"p-1\"")
    // came from a placeholder id reaching the fetch. The guard in the section
    // must skip it entirely: no GET, defaults stay empty, no crash.
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<PersonaPublishingAccountsSection personaId="p-1" />);
    await waitFor(() => {
      expect(screen.queryByTestId('publishing-accounts-loading')).not.toBeInTheDocument();
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('shows a loading skeleton while the defaults load', () => {
    mockFetchOnce(new Promise(() => {}));
    render(<PersonaPublishingAccountsSection personaId={PERSONA_ID} />);
    expect(screen.getByTestId('publishing-accounts-loading')).toBeInTheDocument();
  });

  it('renders account groups with checkboxes initialized from the GET defaults', async () => {
    mockFetchOnce(serverDefaults);
    render(<PersonaPublishingAccountsSection personaId={PERSONA_ID} />);

    const saveButton = await screen.findByTestId('publishing-accounts-save');
    expect(saveButton).toBeInTheDocument();
    expect(screen.getByText('Default publishing accounts')).toBeInTheDocument();

    const checkboxes = screen.getAllByTestId('account-card-select') as HTMLInputElement[];
    // 2 youtube + 1 instagram + 1 bluesky + 0 linkedin
    expect(checkboxes).toHaveLength(4);
    expect(checkboxes[0].checked).toBe(true); // UC-1 in defaults
    expect(checkboxes[1].checked).toBe(false); // UC-2 not in defaults
    expect(checkboxes[3].checked).toBe(true); // did:plc:abc in defaults
  });

  it('shows the load error and retries on demand', async () => {
    const fetchMock = mockFetchOnce({ success: false, error: 'boom' }, false, 500);
    render(<PersonaPublishingAccountsSection personaId={PERSONA_ID} />);

    expect(await screen.findByText('boom')).toBeInTheDocument();
    expect(screen.queryByTestId('publishing-accounts-save')).not.toBeInTheDocument();

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve(serverDefaults),
    });
    fireEvent.click(screen.getByTestId('publishing-accounts-retry'));
    expect(await screen.findByTestId('publishing-accounts-save')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(2, DEFAULTS_URL);
  });

  it('falls back to the generic message when the server error has no detail', async () => {
    mockFetchOnce({ success: false }, false, 500);
    render(<PersonaPublishingAccountsSection personaId={PERSONA_ID} />);
    expect(await screen.findByText('Could not load the default accounts.')).toBeInTheDocument();
  });

  it('notifies the session-expiry handler when the defaults GET answers 401', async () => {
    const notify = vi.mocked(notifyIfSessionExpired);
    notify.mockClear();
    mockFetchOnce({ success: false }, false, 401);
    render(<PersonaPublishingAccountsSection personaId={PERSONA_ID} />);
    expect(await screen.findByText('Could not load the default accounts.')).toBeInTheDocument();
    await waitFor(() => expect(notify).toHaveBeenCalledTimes(1));
  });

  it('notifies the session-expiry handler when the PUT save answers 401', async () => {
    const notify = vi.mocked(notifyIfSessionExpired);
    notify.mockClear();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(serverDefaults) })
      .mockResolvedValueOnce({ ok: false, status: 401, json: () => Promise.resolve({ success: false }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<PersonaPublishingAccountsSection personaId={PERSONA_ID} />);
    fireEvent.click(await screen.findByTestId('publishing-accounts-save'));
    await waitFor(() => expect(notify).toHaveBeenCalledTimes(1));
  });

  it('toggling a checkbox updates the local selection only', async () => {
    const fetchMock = mockFetchOnce(serverDefaults);
    render(<PersonaPublishingAccountsSection personaId={PERSONA_ID} />);
    await screen.findByTestId('publishing-accounts-save');

    const checkboxes = () => screen.getAllByTestId('account-card-select') as HTMLInputElement[];
    expect(checkboxes()[1].checked).toBe(false);
    fireEvent.click(checkboxes()[1]);
    expect(checkboxes()[1].checked).toBe(true);
    // Unchecking a selected box removes it again.
    expect(checkboxes()[0].checked).toBe(true);
    fireEvent.click(checkboxes()[0]);
    expect(checkboxes()[0].checked).toBe(false);
    // The instagram card toggles through the same path.
    expect(checkboxes()[2].checked).toBe(false);
    fireEvent.click(checkboxes()[2]);
    expect(checkboxes()[2].checked).toBe(true);
    // And unchecking the pre-selected bluesky account.
    expect(checkboxes()[3].checked).toBe(true);
    fireEvent.click(checkboxes()[3]);
    expect(checkboxes()[3].checked).toBe(false);
    // Toggling never talks to the server — only the initial GET happened.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('saves the full selection with PUT and shows the confirmation', async () => {
    const fetchMock = mockFetchOnce(serverDefaults);
    render(<PersonaPublishingAccountsSection personaId={PERSONA_ID} />);
    await screen.findByTestId('publishing-accounts-save');

    // Check UC-2 as well, then save.
    fireEvent.click((screen.getAllByTestId('account-card-select') as HTMLInputElement[])[1]);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          success: true,
          defaults: { youtube: ['UC-1', 'UC-2'], instagram: [], bluesky: ['did:plc:abc'], linkedin: [], threads: [] },
        }),
    });
    fireEvent.click(screen.getByTestId('publishing-accounts-save'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        DEFAULTS_URL,
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({
            accounts: { youtube: ['UC-1', 'UC-2'], instagram: [], bluesky: ['did:plc:abc'], linkedin: [], threads: [], facebook: [] },
          }),
        }),
      );
    });
    expect(await screen.findByText('Defaults saved.')).toBeInTheDocument();
  });

  it('shows the server error message when saving fails', async () => {
    const fetchMock = mockFetchOnce(serverDefaults);
    render(<PersonaPublishingAccountsSection personaId={PERSONA_ID} />);
    await screen.findByTestId('publishing-accounts-save');

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ success: false, error: 'db exploded' }),
    });
    fireEvent.click(screen.getByTestId('publishing-accounts-save'));
    expect(await screen.findByText('db exploded')).toBeInTheDocument();
    expect(screen.queryByText('Defaults saved.')).not.toBeInTheDocument();
  });

  it('shows a per-provider "none connected" hint with a link to /accounts', async () => {
    mockFetchOnce(serverDefaults);
    render(<PersonaPublishingAccountsSection personaId={PERSONA_ID} />);
    await screen.findByTestId('publishing-accounts-save');

    expect(screen.getByText('No LinkedIn accounts connected.')).toBeInTheDocument();
    expect(screen.getByText('No Threads accounts connected.')).toBeInTheDocument();
    expect(screen.getByText('No Facebook accounts connected.')).toBeInTheDocument();
    for (const link of screen.getAllByRole('link', { name: 'Connect accounts' })) {
      expect(link).toHaveAttribute('href', '/accounts');
    }
  });

  it('disables Save while the connected accounts are still loading', async () => {
    mockFetchOnce(serverDefaults);
    mockQueries.youtube = { data: null, isLoading: true };
    render(<PersonaPublishingAccountsSection personaId={PERSONA_ID} />);
    const saveButton = await screen.findByTestId('publishing-accounts-save');
    expect(saveButton).toBeDisabled();
  });

  it('refetches the defaults when the personaId changes', async () => {
    const fetchMock = mockFetchOnce(serverDefaults);
    const { rerender } = render(<PersonaPublishingAccountsSection personaId={PERSONA_ID} />);
    await screen.findByTestId('publishing-accounts-save');

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, defaults: { youtube: [], instagram: [], bluesky: [], linkedin: [], threads: [] } }),
    });
    rerender(<PersonaPublishingAccountsSection personaId="22222222-3333-4444-5555-666666666666" />);
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/persona/publishing-accounts?personaId=22222222-3333-4444-5555-666666666666');
    });
  });

  it('renders and toggles linkedin accounts', async () => {
    mockFetchOnce({ success: true, defaults: { youtube: [], instagram: [], bluesky: [], linkedin: [], threads: [] } });
    mockQueries.linkedin = {
      data: {
        accounts: [
          { provider: 'linkedin', providerAccountId: 'li-1', accountName: 'Li One', accountMetadata: { name: 'Li Display' } },
          { provider: 'linkedin', providerAccountId: 'li-2' },
        ],
      },
      isLoading: false,
    };
    mockQueries.threads = {
      data: {
        authenticated: true,
        accounts: [
          { provider: 'threads', providerAccountId: 'th-1', accountName: 'Thread Name' },
          { provider: 'threads', providerAccountId: 'th-2' },
        ],
      },
      isLoading: false,
      error: null,
    };
    render(<PersonaPublishingAccountsSection personaId={PERSONA_ID} />);
    await screen.findByTestId('publishing-accounts-save');

    const checkboxes = () => screen.getAllByTestId('account-card-select') as HTMLInputElement[];
    // 2 youtube + 1 instagram + 1 bluesky + 2 linkedin + 2 threads
    expect(checkboxes()).toHaveLength(8);
    expect(checkboxes()[4].checked).toBe(false);
    fireEvent.click(checkboxes()[4]);
    expect(checkboxes()[4].checked).toBe(true);
    expect(reportAccountCardDisplay).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'linkedin',
      shownLabel: 'Li One',
      storedDisplayName: 'Li Display',
      labelOrigin: 'stored',
    }));
    expect(reportAccountCardDisplay).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'linkedin',
      shownLabel: 'li-2',
      labelOrigin: 'provider_id',
    }));
    expect(reportAccountCardDisplay).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'threads',
      shownLabel: 'Thread Name',
      labelOrigin: 'stored',
    }));
    expect(reportAccountCardDisplay).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'threads',
      shownLabel: 'th-2',
      labelOrigin: 'provider_id',
    }));
  });

  it('renders facebook pages, preselects saved ones and saves the toggled selection', async () => {
    const fetchMock = mockFetchOnce({
      success: true,
      defaults: { youtube: [], instagram: [], bluesky: [], linkedin: [], threads: [], facebook: ['fb-1'] },
    });
    mockQueries.youtube = { data: { accounts: [] }, isLoading: false };
    mockQueries.instagram = { data: { accounts: [] }, isLoading: false };
    mockQueries.bluesky = { data: { accounts: [] }, isLoading: false };
    mockQueries.facebook = {
      data: {
        authenticated: true,
        accounts: [
          { provider: 'facebook', providerAccountId: 'fb-1', accountName: 'My Page' },
          { provider: 'facebook', providerAccountId: 'fb-2' },
        ],
      },
      isLoading: false,
      error: null,
    };
    render(<PersonaPublishingAccountsSection personaId={PERSONA_ID} />);
    await screen.findByTestId('publishing-accounts-save');

    const checkboxes = () => screen.getAllByTestId('account-card-select') as HTMLInputElement[];
    expect(checkboxes()).toHaveLength(2);
    expect(checkboxes()[0].checked).toBe(true);
    expect(checkboxes()[1].checked).toBe(false);
    expect(screen.getByText('My Page')).toBeInTheDocument();
    expect(reportAccountCardDisplay).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'facebook',
      shownLabel: 'fb-2',
      labelOrigin: 'provider_id',
    }));

    fireEvent.click(checkboxes()[1]);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, defaults: { facebook: ['fb-1', 'fb-2'] } }),
    });
    fireEvent.click(screen.getByTestId('publishing-accounts-save'));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        DEFAULTS_URL,
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({
            accounts: { youtube: [], instagram: [], bluesky: [], linkedin: [], threads: [], facebook: ['fb-1', 'fb-2'] },
          }),
        }),
      );
    });
  });

  it('disables Save while the facebook pages are still loading', async () => {
    mockFetchOnce(serverDefaults);
    mockQueries.facebook = { data: { authenticated: true, accounts: [] }, isLoading: true, error: null };
    render(<PersonaPublishingAccountsSection personaId={PERSONA_ID} />);
    expect(await screen.findByTestId('publishing-accounts-save')).toBeDisabled();
  });

  it('ignores non-string ids in the server defaults', async () => {
    mockFetchOnce({
      success: true,
      defaults: { youtube: ['UC-1', 42, null], instagram: [], bluesky: [], linkedin: [], threads: [] },
    });
    render(<PersonaPublishingAccountsSection personaId={PERSONA_ID} />);
    await screen.findByTestId('publishing-accounts-save');
    const checkboxes = screen.getAllByTestId('account-card-select') as HTMLInputElement[];
    expect(checkboxes[0].checked).toBe(true);
    expect(checkboxes[1].checked).toBe(false);
  });
});
