import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

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
}));

vi.mock('@/lib/api', () => ({
  useYouTubeAccountsQuery: () => mockQueries.youtube,
  useInstagramAccountsQuery: () => mockQueries.instagram,
  useBlueskyAccountsQuery: () => mockQueries.bluesky,
  useLinkedinAccountsQuery: () => mockQueries.linkedin,
}));

import { PersonaPublishingAccountsSection } from '../persona-publishing-accounts-section';

const PERSONA_ID = 'persona-1';
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
  defaults: { youtube: ['UC-1'], instagram: [], bluesky: ['did:plc:abc'], linkedin: [] },
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
}

beforeEach(() => {
  vi.unstubAllGlobals();
  setConnectedAccounts();
});

describe('PersonaPublishingAccountsSection', () => {
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
          defaults: { youtube: ['UC-1', 'UC-2'], instagram: [], bluesky: ['did:plc:abc'], linkedin: [] },
        }),
    });
    fireEvent.click(screen.getByTestId('publishing-accounts-save'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        DEFAULTS_URL,
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({
            accounts: { youtube: ['UC-1', 'UC-2'], instagram: [], bluesky: ['did:plc:abc'], linkedin: [] },
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
    const link = screen.getByRole('link', { name: 'Connect accounts' });
    expect(link).toHaveAttribute('href', '/accounts');
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
      json: () => Promise.resolve({ success: true, defaults: { youtube: [], instagram: [], bluesky: [], linkedin: [] } }),
    });
    rerender(<PersonaPublishingAccountsSection personaId="persona-2" />);
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/persona/publishing-accounts?personaId=persona-2');
    });
  });

  it('renders and toggles linkedin accounts', async () => {
    mockFetchOnce({ success: true, defaults: { youtube: [], instagram: [], bluesky: [], linkedin: [] } });
    mockQueries.linkedin = {
      data: { accounts: [{ provider: 'linkedin', providerAccountId: 'li-1', accountName: 'Li One' }] },
      isLoading: false,
    };
    render(<PersonaPublishingAccountsSection personaId={PERSONA_ID} />);
    await screen.findByTestId('publishing-accounts-save');

    const checkboxes = () => screen.getAllByTestId('account-card-select') as HTMLInputElement[];
    // 2 youtube + 1 instagram + 1 bluesky + 1 linkedin
    expect(checkboxes()).toHaveLength(5);
    expect(checkboxes()[4].checked).toBe(false);
    fireEvent.click(checkboxes()[4]);
    expect(checkboxes()[4].checked).toBe(true);
  });

  it('ignores non-string ids in the server defaults', async () => {
    mockFetchOnce({
      success: true,
      defaults: { youtube: ['UC-1', 42, null], instagram: [], bluesky: [], linkedin: [] },
    });
    render(<PersonaPublishingAccountsSection personaId={PERSONA_ID} />);
    await screen.findByTestId('publishing-accounts-save');
    const checkboxes = screen.getAllByTestId('account-card-select') as HTMLInputElement[];
    expect(checkboxes[0].checked).toBe(true);
    expect(checkboxes[1].checked).toBe(false);
  });
});
