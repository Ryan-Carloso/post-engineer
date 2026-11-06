import '@testing-library/jest-dom/vitest';
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: React.ComponentProps<'a'> & { href: string }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

vi.mock('next/image', () => ({
  // eslint-disable-next-line jsx-a11y/alt-text, @next/next/no-img-element
  default: (props: React.ComponentProps<'img'>) => <img {...props} />,
}));

vi.mock('@/lib/account-card-telemetry', () => ({
  reportAccountDisconnectFailed: vi.fn(),
  useAccountListErrorTelemetry: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  useYouTubeAccountsQuery: vi.fn(),
  useInstagramAccountsQuery: vi.fn(),
  useBlueskyAccountsQuery: vi.fn(),
  useLinkedinAccountsQuery: vi.fn(),
  useThreadsAccountsQuery: vi.fn(),
  useDisconnectAccountMutation: vi.fn(),
}));

const mockStoreState = {
  selectedAccountIds: { youtube: [] as string[], instagram: [] as string[] },
  toggleSelectedAccount: vi.fn(),
};

vi.mock('@/lib/store', () => ({
  useUploadStore: Object.assign(
    (selector?: (s: typeof mockStoreState) => unknown) =>
      selector ? selector(mockStoreState) : mockStoreState,
    {
      getState: vi.fn(() => mockStoreState),
    },
  ),
}));

vi.mock('@/lib/oauth/google-handler', () => ({
  useYouTubeOAuth: vi.fn(() => ({
    startOAuth: vi.fn().mockResolvedValue(undefined),
    isLoading: false,
    error: null,
  })),
}));

vi.mock('@/lib/oauth/instagram-handler', () => ({
  useInstagramOAuth: vi.fn(() => ({
    startOAuth: vi.fn().mockResolvedValue(undefined),
    isLoading: false,
    error: null,
  })),
}));

vi.mock('@/lib/oauth/threads-handler', () => ({
  useThreadsOAuth: vi.fn(),
}));
vi.mock('@/lib/oauth/linkedin-handler', () => ({
  useLinkedInOAuth: vi.fn(() => ({
    startOAuth: vi.fn().mockResolvedValue(undefined),
    isLoading: false,
    error: null,
  })),
}));

vi.mock('@/lib/ui', () => ({
  AccountsIcon: () => <span data-testid="icon-accounts" />,
  GoogleIcon: () => <span data-testid="icon-google" />,
  InstagramIcon: () => <span data-testid="icon-instagram" />,
  KeyIcon: () => <span data-testid="icon-key" />,
  SpinnerIcon: () => <span data-testid="icon-spinner" />,
}));

vi.mock('@/lib/i18n/provider', () => {
  const t = (key: string) => key;
  return {
    useI18n: () => ({ t, locale: 'pt', setLocale: vi.fn() }),
  };
});

vi.mock('@/components/account-card', () => ({
  default: ({ name, onSelect, onRemove, selected, showDisconnect, onDisconnect, type, storedDisplayName, labelOrigin }: {
    name: string;
    onSelect?: () => void;
    onRemove?: () => void;
    selected?: boolean;
    showDisconnect?: boolean;
    onDisconnect?: () => void;
    type?: string;
    storedDisplayName?: string;
    labelOrigin?: string;
  }) => (
    <div
      data-testid="account-card"
      data-provider={type ?? ''}
      data-label-origin={labelOrigin ?? ''}
      data-stored-display-name={storedDisplayName ?? ''}
    >
      <span>{name}</span>
      {onSelect && (
        <input
          type="checkbox"
          checked={selected}
          onChange={onSelect}
          data-testid="account-card-select"
        />
      )}
      {onRemove && (
        <button onClick={onRemove} data-testid="account-card-remove">remove</button>
      )}
      {showDisconnect && onDisconnect && (
        <button onClick={onDisconnect} data-testid={`${type ?? 'account'}-disconnect-button`}>disconnect</button>
      )}
    </div>
  ),
}));

import AccountsPage from '../page';
import { reportAccountDisconnectFailed, useAccountListErrorTelemetry } from '@/lib/account-card-telemetry';
import { useYouTubeAccountsQuery, useInstagramAccountsQuery, useBlueskyAccountsQuery, useLinkedinAccountsQuery, useThreadsAccountsQuery, useDisconnectAccountMutation } from '@/lib/api';
import { useYouTubeOAuth } from '@/lib/oauth/google-handler';
import { useInstagramOAuth } from '@/lib/oauth/instagram-handler';
import { useLinkedInOAuth } from '@/lib/oauth/linkedin-handler';
import { useThreadsOAuth } from '@/lib/oauth/threads-handler';

function createWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  Wrapper.displayName = 'AccountsWrapper';
  return Wrapper;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useYouTubeAccountsQuery, { partial: true }).mockReturnValue({
    data: { accounts: [], authenticated: true },
    isLoading: false,
  });
  vi.mocked(useInstagramAccountsQuery, { partial: true }).mockReturnValue({
    data: { accounts: [], authenticated: true },
    isLoading: false,
  });
  vi.mocked(useBlueskyAccountsQuery, { partial: true }).mockReturnValue({
    data: { accounts: [], authenticated: true },
    isLoading: false,
  });
  vi.mocked(useLinkedinAccountsQuery, { partial: true }).mockReturnValue({
    data: { accounts: [], authenticated: true },
    isLoading: false,
  });
  vi.mocked(useYouTubeOAuth).mockReturnValue({
    startOAuth: vi.fn().mockResolvedValue(undefined),
    isLoading: false,
    error: null,
  });
  vi.mocked(useInstagramOAuth).mockReturnValue({
    startOAuth: vi.fn().mockResolvedValue(undefined),
    isLoading: false,
    error: null,
  });
  vi.mocked(useThreadsAccountsQuery, { partial: true }).mockReturnValue({ data: { authenticated: true, accounts: [] }, isLoading: false, error: null, refetch: vi.fn() });
  vi.mocked(useThreadsOAuth).mockReturnValue(threadsOAuth);
  vi.mocked(useLinkedInOAuth).mockReturnValue({
    startOAuth: vi.fn().mockResolvedValue(undefined),
    isLoading: false,
    error: null,
  });
  vi.mocked(useDisconnectAccountMutation).mockReturnValue({
    mutateAsync: vi.fn().mockResolvedValue({ success: true }),
    isPending: false,
  } as never);
});

const threadsOAuth = { isLoading: false, error: null, startOAuth: vi.fn() } as unknown as ReturnType<typeof useThreadsOAuth>;

describe('app/(main)/accounts/page — AccountsPage', () => {
  it('renders page header', () => {
    render(<AccountsPage />, { wrapper: createWrapper() });
    expect(screen.getByText('accounts.title')).toBeTruthy();
    expect(screen.getByText('accounts.subtitle')).toBeTruthy();
  });

  it('renders YouTube section label', () => {
    render(<AccountsPage />, { wrapper: createWrapper() });
    expect(screen.getByText('accounts.youtubeLabel')).toBeTruthy();
  });

  it('renders Instagram section label', () => {
    render(<AccountsPage />, { wrapper: createWrapper() });
    expect(screen.getByText('accounts.instagramLabel')).toBeTruthy();
  });

  it('shows the shared connection slot when YouTube has no accounts', () => {
    render(<AccountsPage />, { wrapper: createWrapper() });
    expect(screen.getAllByText('accounts.connectFirst')).toHaveLength(5);
  });

  it('shows the shared connection slot when Instagram has no accounts', () => {
    render(<AccountsPage />, { wrapper: createWrapper() });
    expect(screen.getAllByRole('button', { name: 'accounts.connectFirst' })).toHaveLength(5);
  });

  it('shows loading skeletons while loading', () => {
    vi.mocked(useYouTubeAccountsQuery, { partial: true }).mockReturnValue({
      data: undefined,
      isLoading: true,
    });
    vi.mocked(useInstagramAccountsQuery, { partial: true }).mockReturnValue({
      data: undefined,
      isLoading: true,
    });
    const { container } = render(<AccountsPage />, { wrapper: createWrapper() });
    const skeletons = container.querySelectorAll('.skeleton-shimmer');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('shows YouTube accounts list when authenticated with accounts', () => {
    vi.mocked(useYouTubeAccountsQuery, { partial: true }).mockReturnValue({
      data: { authenticated: true, accounts: [{ provider: 'youtube', recordId: 'r1', channelId: 'ch1', channelName: 'My Channel', connectedAt: 0, lastUsed: 0 }] },
      isLoading: false,
    });
    render(<AccountsPage />, { wrapper: createWrapper() });
    expect(screen.getByText('My Channel')).toBeTruthy();
    expect(screen.getByText('accounts.connectAnother')).toBeTruthy();
    expect(screen.queryByTestId('account-card-remove')).not.toBeInTheDocument();
  });

  it('shows Instagram accounts list when authenticated with accounts', () => {
    vi.mocked(useInstagramAccountsQuery, { partial: true }).mockReturnValue({
      data: { authenticated: true, accounts: [{ provider: 'instagram', recordId: 'r1', igUserId: 'ig1', username: 'instauser', connectedAt: 0, lastUsed: 0 }] },
      isLoading: false,
    });
    render(<AccountsPage />, { wrapper: createWrapper() });
    expect(screen.getByText('@instauser')).toBeTruthy();
    expect(screen.queryByTestId('account-card-remove')).not.toBeInTheDocument();
  });

  it('shows account count in section dividers', () => {
    vi.mocked(useYouTubeAccountsQuery, { partial: true }).mockReturnValue({
      data: { authenticated: true, accounts: [
        { provider: 'youtube', recordId: 'r1', channelId: 'ch1', channelName: 'Ch1', connectedAt: 0, lastUsed: 0 },
        { provider: 'youtube', recordId: 'r2', channelId: 'ch2', channelName: 'Ch2', connectedAt: 0, lastUsed: 0 },
      ] },
      isLoading: false,
    });
    render(<AccountsPage />, { wrapper: createWrapper() });
    const countBadges = screen.getAllByText('(2)');
    expect(countBadges.length).toBeGreaterThanOrEqual(1);
  });

  it('YouTube connect button calls startOAuth', async () => {
    const mockStartOAuth = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useYouTubeOAuth).mockReturnValue({
      startOAuth: mockStartOAuth,
      isLoading: false,
      error: null,
    });
    render(<AccountsPage />, { wrapper: createWrapper() });
    fireEvent.click(screen.getAllByRole('button', { name: 'accounts.connectFirst' })[0]);
    await waitFor(() => expect(mockStartOAuth).toHaveBeenCalled());
  });

  it('Instagram connect button calls startOAuth', async () => {
    const mockStartOAuth = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useInstagramOAuth).mockReturnValue({
      startOAuth: mockStartOAuth,
      isLoading: false,
      error: null,
    });
    render(<AccountsPage />, { wrapper: createWrapper() });
    fireEvent.click(screen.getAllByRole('button', { name: 'accounts.connectFirst' })[1]);
    await waitFor(() => expect(mockStartOAuth).toHaveBeenCalled());
  });

  it('shows OAuth error when present', () => {
    vi.mocked(useYouTubeOAuth).mockReturnValue({
      startOAuth: vi.fn(),
      isLoading: false,
      error: 'Some YouTube error',
    });
    render(<AccountsPage />, { wrapper: createWrapper() });
    expect(screen.getByText('Some YouTube error')).toBeTruthy();
  });

  it('shows LinkedIn OAuth error when present', () => {
    vi.mocked(useLinkedInOAuth).mockReturnValue({
      startOAuth: vi.fn(),
      isLoading: false,
      error: 'Some LinkedIn error',
    });
    render(<AccountsPage />, { wrapper: createWrapper() });
    expect(screen.getByText('Some LinkedIn error')).toBeTruthy();
  });

  it('LinkedIn connect button calls startOAuth', async () => {
    const mockStartOAuth = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useLinkedInOAuth).mockReturnValue({
      startOAuth: mockStartOAuth,
      isLoading: false,
      error: null,
    });
    render(<AccountsPage />, { wrapper: createWrapper() });
    fireEvent.click(screen.getAllByRole('button', { name: 'accounts.connectFirst' })[3]);
    await waitFor(() => expect(mockStartOAuth).toHaveBeenCalled());
  });

  it('shows LinkedIn accounts list with member and org badges when authenticated', () => {
    vi.mocked(useLinkedinAccountsQuery, { partial: true }).mockReturnValue({
      data: {
        authenticated: true,
        accounts: [
          {
            provider: 'linkedin',
            recordId: 'r1',
            providerAccountId: 'member-123',
            accountName: 'Ryan Carlos',
            accountMetadata: { kind: 'member', name: 'Ryan Carlos' },
            connectedAt: 0,
            lastUsed: 0,
          },
          {
            provider: 'linkedin',
            recordId: 'r2',
            providerAccountId: 'urn:li:organization:111',
            accountName: 'Company Inc',
            accountMetadata: { kind: 'organization', name: 'Company Inc' },
            connectedAt: 0,
            lastUsed: 0,
          },
        ],
      },
      isLoading: false,
    });
    render(<AccountsPage />, { wrapper: createWrapper() });
    expect(screen.getByText('Ryan Carlos')).toBeTruthy();
    expect(screen.getByText('Company Inc')).toBeTruthy();
    expect(screen.getByText('accounts.memberBadge')).toBeTruthy();
    expect(screen.getByText('accounts.pageBadge')).toBeTruthy();
  });

  it('shows spinner when YouTube OAuth is loading', () => {
    vi.mocked(useYouTubeOAuth).mockReturnValue({
      startOAuth: vi.fn(),
      isLoading: true,
      error: null,
    });
    render(<AccountsPage />, { wrapper: createWrapper() });
    const spinners = screen.getAllByTestId('icon-spinner');
    expect(spinners.length).toBeGreaterThanOrEqual(1);
  });

  it('shows a disconnect button on each YouTube account', () => {
    vi.mocked(useYouTubeAccountsQuery, { partial: true }).mockReturnValue({
      data: { authenticated: true, accounts: [
        { provider: 'youtube', recordId: 'r1', channelId: 'ch1', channelName: 'Ch1', connectedAt: 0, lastUsed: 0 },
        { provider: 'youtube', recordId: 'r2', channelId: 'ch2', channelName: 'Ch2', connectedAt: 0, lastUsed: 0 },
      ] },
      isLoading: false,
    });
    render(<AccountsPage />, { wrapper: createWrapper() });
    expect(screen.getAllByTestId('youtube-disconnect-button')).toHaveLength(2);
  });

  it('disconnects a YouTube account after confirmation', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({ success: true });
    vi.mocked(useDisconnectAccountMutation).mockReturnValue({ mutateAsync, isPending: false } as never);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(useYouTubeAccountsQuery, { partial: true }).mockReturnValue({
      data: { authenticated: true, accounts: [{ provider: 'youtube', recordId: 'r1', channelId: 'ch1', channelName: 'Ch1', connectedAt: 0, lastUsed: 0 }] },
      isLoading: false,
    });
    render(<AccountsPage />, { wrapper: createWrapper() });
    fireEvent.click(screen.getByTestId('youtube-disconnect-button'));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({ providerAccountId: 'ch1' }));
    expect(useDisconnectAccountMutation).toHaveBeenCalledWith('youtube');
    expect(reportAccountDisconnectFailed).not.toHaveBeenCalled();
  });

  it('does not disconnect when the confirmation is cancelled', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({ success: true });
    vi.mocked(useDisconnectAccountMutation).mockReturnValue({ mutateAsync, isPending: false } as never);
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    vi.mocked(useYouTubeAccountsQuery, { partial: true }).mockReturnValue({
      data: { authenticated: true, accounts: [{ provider: 'youtube', recordId: 'r1', channelId: 'ch1', channelName: 'Ch1', connectedAt: 0, lastUsed: 0 }] },
      isLoading: false,
    });
    render(<AccountsPage />, { wrapper: createWrapper() });
    fireEvent.click(screen.getByTestId('youtube-disconnect-button'));
    await waitFor(() => expect(window.confirm).toHaveBeenCalled());
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(reportAccountDisconnectFailed).not.toHaveBeenCalled();
  });

  it('shows an error message when disconnect throws', async () => {
    const mutateAsync = vi.fn().mockRejectedValue(new Error('db fail'));
    vi.mocked(useDisconnectAccountMutation).mockReturnValue({ mutateAsync, isPending: false } as never);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(useYouTubeAccountsQuery, { partial: true }).mockReturnValue({
      data: { authenticated: true, accounts: [{ provider: 'youtube', recordId: 'r1', channelId: 'ch1', channelName: 'Ch1', connectedAt: 0, lastUsed: 0 }] },
      isLoading: false,
    });
    render(<AccountsPage />, { wrapper: createWrapper() });
    fireEvent.click(screen.getByTestId('youtube-disconnect-button'));
    await waitFor(() => expect(screen.getByTestId('disconnect-error')).toBeInTheDocument());
    expect(screen.getByTestId('disconnect-error')).toHaveTextContent('accounts.disconnectError');
    expect(reportAccountDisconnectFailed).toHaveBeenCalledWith('youtube', 'threw');
  });

  it('reports a YouTube list failure', () => {
    vi.mocked(useYouTubeAccountsQuery, { partial: true }).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('list failed'),
    });
    render(<AccountsPage />, { wrapper: createWrapper() });
    expect(useAccountListErrorTelemetry).toHaveBeenCalledWith('youtube', 'list failed');
  });

  it('reports a list failure for each other provider, including the message', () => {
    vi.mocked(useInstagramAccountsQuery, { partial: true }).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('ig down'),
    });
    vi.mocked(useBlueskyAccountsQuery, { partial: true }).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('bsky down'),
    });
    vi.mocked(useLinkedinAccountsQuery, { partial: true }).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('li down'),
    });
    vi.mocked(useThreadsAccountsQuery, { partial: true }).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('threads down'),
      refetch: vi.fn(),
    });
    render(<AccountsPage />, { wrapper: createWrapper() });
    expect(useAccountListErrorTelemetry).toHaveBeenCalledWith('instagram', 'ig down');
    expect(useAccountListErrorTelemetry).toHaveBeenCalledWith('bluesky', 'bsky down');
    expect(useAccountListErrorTelemetry).toHaveBeenCalledWith('linkedin', 'li down');
    expect(useAccountListErrorTelemetry).toHaveBeenCalledWith('threads', 'threads down');
  });

  it('selects an Instagram account with the instagram provider id', () => {
    vi.mocked(useInstagramAccountsQuery, { partial: true }).mockReturnValue({
      data: { authenticated: true, accounts: [{ provider: 'instagram', recordId: 'r1', igUserId: 'ig1', username: 'instauser', name: 'Insta Name', connectedAt: 0, lastUsed: 0 }] },
      isLoading: false,
    });
    render(<AccountsPage />, { wrapper: createWrapper() });
    fireEvent.click(screen.getByTestId('account-card-select'));
    expect(mockStoreState.toggleSelectedAccount).toHaveBeenCalledWith('instagram', 'ig1');
    expect(screen.getByTestId('account-card')).toHaveAttribute('data-stored-display-name', 'Insta Name');
  });

  it('shows an error message when the server reports failure', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({ success: false });
    vi.mocked(useDisconnectAccountMutation).mockReturnValue({ mutateAsync, isPending: false } as never);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(useYouTubeAccountsQuery, { partial: true }).mockReturnValue({
      data: { authenticated: true, accounts: [{ provider: 'youtube', recordId: 'r1', channelId: 'ch1', channelName: 'Ch1', connectedAt: 0, lastUsed: 0 }] },
      isLoading: false,
    });
    render(<AccountsPage />, { wrapper: createWrapper() });
    fireEvent.click(screen.getByTestId('youtube-disconnect-button'));
    await waitFor(() => expect(screen.getByTestId('disconnect-error')).toBeInTheDocument());
    expect(reportAccountDisconnectFailed).toHaveBeenCalledWith('youtube', 'rejected');
  });

  it('disconnects an Instagram account using its igUserId', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({ success: true });
    vi.mocked(useDisconnectAccountMutation).mockReturnValue({ mutateAsync, isPending: false } as never);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(useInstagramAccountsQuery, { partial: true }).mockReturnValue({
      data: { authenticated: true, accounts: [{ provider: 'instagram', recordId: 'r1', igUserId: 'ig1', username: 'instauser', connectedAt: 0, lastUsed: 0 }] },
      isLoading: false,
    });
    render(<AccountsPage />, { wrapper: createWrapper() });
    fireEvent.click(screen.getByTestId('instagram-disconnect-button'));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({ providerAccountId: 'ig1' }));
    expect(useDisconnectAccountMutation).toHaveBeenCalledWith('instagram');
  });

  it('disconnects a Bluesky account using its did', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({ success: true });
    vi.mocked(useDisconnectAccountMutation).mockReturnValue({ mutateAsync, isPending: false } as never);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(useBlueskyAccountsQuery, { partial: true }).mockReturnValue({
      data: { authenticated: true, accounts: [{ provider: 'bluesky', recordId: 'r1', did: 'did:plc:abc', handle: 'voce.bsky.social', connectedAt: 0, lastUsed: 0 }] },
      isLoading: false,
    });
    render(<AccountsPage />, { wrapper: createWrapper() });
    fireEvent.click(screen.getByTestId('bluesky-disconnect-button'));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({ providerAccountId: 'did:plc:abc' }));
    expect(useDisconnectAccountMutation).toHaveBeenCalledWith('bluesky');
  });

  it('disconnects a LinkedIn account using its providerAccountId', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({ success: true });
    vi.mocked(useDisconnectAccountMutation).mockReturnValue({ mutateAsync, isPending: false } as never);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(useLinkedinAccountsQuery, { partial: true }).mockReturnValue({
      data: {
        authenticated: true,
        accounts: [{ provider: 'linkedin', recordId: 'r1', providerAccountId: 'member-123', accountName: 'Ryan Carlos', accountMetadata: { kind: 'member', name: 'Ryan Carlos' }, connectedAt: 0, lastUsed: 0 }],
      },
      isLoading: false,
    });
    render(<AccountsPage />, { wrapper: createWrapper() });
    fireEvent.click(screen.getByTestId('linkedin-disconnect-button'));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({ providerAccountId: 'member-123' }));
    expect(useDisconnectAccountMutation).toHaveBeenCalledWith('linkedin');
  });

  it('reports the provider when Instagram, Bluesky, or LinkedIn disconnect throws', async () => {
    const mutateAsync = vi.fn().mockRejectedValue(new Error('db fail'));
    vi.mocked(useDisconnectAccountMutation).mockReturnValue({ mutateAsync, isPending: false } as never);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(useInstagramAccountsQuery, { partial: true }).mockReturnValue({
      data: { authenticated: true, accounts: [{ provider: 'instagram', recordId: 'r1', igUserId: 'ig1', username: 'instauser', connectedAt: 0, lastUsed: 0 }] },
      isLoading: false,
    });
    vi.mocked(useBlueskyAccountsQuery, { partial: true }).mockReturnValue({
      data: { authenticated: true, accounts: [{ provider: 'bluesky', recordId: 'r1', did: 'did:plc:abc', handle: 'voce.bsky.social', connectedAt: 0, lastUsed: 0 }] },
      isLoading: false,
    });
    vi.mocked(useLinkedinAccountsQuery, { partial: true }).mockReturnValue({
      data: {
        authenticated: true,
        accounts: [{ provider: 'linkedin', recordId: 'r1', providerAccountId: 'member-123', accountName: 'Ada', accountMetadata: { kind: 'member', name: 'Ada Lovelace' }, connectedAt: 0, lastUsed: 0 }],
      },
      isLoading: false,
    });
    render(<AccountsPage />, { wrapper: createWrapper() });
    fireEvent.click(screen.getByTestId('instagram-disconnect-button'));
    fireEvent.click(screen.getByTestId('bluesky-disconnect-button'));
    fireEvent.click(screen.getByTestId('linkedin-disconnect-button'));
    await waitFor(() => expect(reportAccountDisconnectFailed).toHaveBeenCalledWith('linkedin', 'threw'));
    expect(reportAccountDisconnectFailed).toHaveBeenCalledWith('instagram', 'threw');
    expect(reportAccountDisconnectFailed).toHaveBeenCalledWith('bluesky', 'threw');
  });

  it('passes LinkedIn stored and provider-id labels through to the card', () => {
    vi.mocked(useLinkedinAccountsQuery, { partial: true }).mockReturnValue({
      data: {
        authenticated: true,
        accounts: [
          { provider: 'linkedin', recordId: 'r1', providerAccountId: 'member-1', accountName: 'Ada', accountMetadata: { kind: 'member', name: 'Ada Lovelace' }, connectedAt: 0, lastUsed: 0 },
          { provider: 'linkedin', recordId: 'r2', providerAccountId: 'urn:li:organization:9', accountName: '', connectedAt: 0, lastUsed: 0 },
        ],
      },
      isLoading: false,
    });
    render(<AccountsPage />, { wrapper: createWrapper() });
    const cards = screen.getAllByTestId('account-card').filter((el) => el.getAttribute('data-provider') === 'linkedin');
    expect(cards[0]).toHaveAttribute('data-label-origin', 'stored');
    expect(cards[0]).toHaveAttribute('data-stored-display-name', 'Ada Lovelace');
    expect(cards[1]).toHaveAttribute('data-label-origin', 'provider_id');
    expect(cards[1]).toHaveAttribute('data-stored-display-name', '');
  });
});

describe('Threads accounts section', () => {
  it('renders the section with its localized copy and starts OAuth from its button', () => {
    render(<AccountsPage />, { wrapper: createWrapper() });
    expect(screen.getByText('accounts.threadsLabel')).toBeTruthy();
    expect(screen.getByText('accounts.threadsDescription')).toBeTruthy();
    // Threads is the last section on the page, so its connect button is last.
    fireEvent.click(screen.getAllByRole('button', { name: 'accounts.connectFirst' }).at(-1) as HTMLElement);
    expect(threadsOAuth.startOAuth).toHaveBeenCalledTimes(1);
  });

  it('lists a connected account by its handle', () => {
    vi.mocked(useThreadsAccountsQuery, { partial: true }).mockReturnValue({
      data: { authenticated: true, accounts: [{ provider: 'threads', recordId: 'r1', providerAccountId: '42', accountName: 'ana', connectedAt: 0, lastUsed: 0 }] },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    render(<AccountsPage />, { wrapper: createWrapper() });
    expect(screen.getByText('ana')).toBeTruthy();
  });

  it('marks a Threads label as stored or as the provider id', () => {
    vi.mocked(useThreadsAccountsQuery, { partial: true }).mockReturnValue({
      data: {
        authenticated: true,
        accounts: [
          { provider: 'threads', recordId: 'r1', providerAccountId: '42', accountName: 'ana', connectedAt: 0, lastUsed: 0 },
          { provider: 'threads', recordId: 'r2', providerAccountId: '99', accountName: null, connectedAt: 0, lastUsed: 0 },
        ],
      },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    render(<AccountsPage />, { wrapper: createWrapper() });
    const cards = screen.getAllByTestId('account-card').filter((el) => el.getAttribute('data-provider') === 'threads');
    expect(cards[0]).toHaveAttribute('data-label-origin', 'stored');
    expect(cards[1]).toHaveAttribute('data-label-origin', 'provider_id');
    expect(screen.getByText('99')).toBeTruthy();
  });

  it('reports a Threads disconnect failure for that provider', async () => {
    const mutateAsync = vi.fn().mockRejectedValue(new Error('db fail'));
    vi.mocked(useDisconnectAccountMutation).mockReturnValue({ mutateAsync, isPending: false } as never);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(useThreadsAccountsQuery, { partial: true }).mockReturnValue({
      data: { authenticated: true, accounts: [{ provider: 'threads', recordId: 'r1', providerAccountId: '42', accountName: 'ana', connectedAt: 0, lastUsed: 0 }] },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    render(<AccountsPage />, { wrapper: createWrapper() });
    fireEvent.click(screen.getByTestId('threads-disconnect-button'));
    await waitFor(() => expect(reportAccountDisconnectFailed).toHaveBeenCalledWith('threads', 'threw'));
  });
});
