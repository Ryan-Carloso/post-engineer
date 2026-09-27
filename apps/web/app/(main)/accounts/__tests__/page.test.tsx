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

vi.mock('@/lib/api', () => ({
  useYouTubeAccountsQuery: vi.fn(),
  useInstagramAccountsQuery: vi.fn(),
  useBlueskyAccountsQuery: vi.fn(),
  useLinkedinAccountsQuery: vi.fn(),
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
  default: ({ name, onSelect, onRemove, selected, showDisconnect, onDisconnect, type }: {
    name: string;
    onSelect?: () => void;
    onRemove?: () => void;
    selected?: boolean;
    showDisconnect?: boolean;
    onDisconnect?: () => void;
    type?: string;
  }) => (
    <div data-testid="account-card">
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
import { useYouTubeAccountsQuery, useInstagramAccountsQuery, useBlueskyAccountsQuery, useLinkedinAccountsQuery, useDisconnectAccountMutation } from '@/lib/api';
import { useYouTubeOAuth } from '@/lib/oauth/google-handler';
import { useInstagramOAuth } from '@/lib/oauth/instagram-handler';
import { useLinkedInOAuth } from '@/lib/oauth/linkedin-handler';

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
    expect(screen.getAllByText('accounts.connectFirst')).toHaveLength(4);
  });

  it('shows the shared connection slot when Instagram has no accounts', () => {
    render(<AccountsPage />, { wrapper: createWrapper() });
    expect(screen.getAllByRole('button', { name: 'accounts.connectFirst' })).toHaveLength(4);
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
});
