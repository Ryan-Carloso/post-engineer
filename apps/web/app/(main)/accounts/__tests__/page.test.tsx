import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
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
  useFacebookAccountsQuery: vi.fn(),
  useThreespeakAccountsQuery: vi.fn(),
  useDisconnectAccountMutation: vi.fn(),
}));

vi.mock('@/lib/social-accounts-queries', () => ({
  useRumbleAccountsQuery: vi.fn(),
}));

// Only notifyIfSessionExpired is doubled; the module's redirect behavior is
// pinned in lib/__tests__/session-expiry.test.tsx.
vi.mock('@/lib/session-expiry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/session-expiry')>();
  return {
    ...actual,
    notifyIfSessionExpired: vi.fn(),
  };
});

const mockStoreState = {
  selectedAccountIds: { youtube: [] as string[], instagram: [] as string[] },
  toggleSelectedAccount: vi.fn(),
};

vi.mock('@/lib/store', () => ({  useUploadStore: Object.assign(
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
vi.mock('@/lib/oauth/facebook-handler', () => ({
  useFacebookOAuth: vi.fn(),
}));
vi.mock('@/lib/oauth/pinterest-handler', () => ({
  usePinterestOAuth: vi.fn(),
}));
vi.mock('@/lib/pinterest-accounts', () => ({
  usePinterestAccountsQuery: vi.fn(),
}));
vi.mock('@/lib/oauth/fanvue-handler', () => ({
  useFanvueOAuth: vi.fn(),
}));
vi.mock('@/lib/fanvue-accounts', () => ({
  useFanvueAccountsQuery: vi.fn(),
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
  default: ({ name, onSelect, onRemove, selected, showDisconnect, onDisconnect, type, storedDisplayName, labelOrigin, error, onReconnect }: {
    name: string;
    onSelect?: () => void;
    onRemove?: () => void;
    selected?: boolean;
    showDisconnect?: boolean;
    onDisconnect?: () => void;
    type?: string;
    storedDisplayName?: string;
    labelOrigin?: string;
    error?: boolean;
    onReconnect?: () => void;
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
      {error && onReconnect ? (
        <button onClick={onReconnect} data-testid={`${type ?? 'account'}-reconnect-button`}>reconnect</button>
      ) : showDisconnect && onDisconnect ? (
        <button onClick={onDisconnect} data-testid={`${type ?? 'account'}-disconnect-button`}>disconnect</button>
      ) : null}
    </div>
  ),
}));

import AccountsPage from '../page';
import { reportAccountDisconnectFailed, useAccountListErrorTelemetry } from '@/lib/account-card-telemetry';
import { useYouTubeAccountsQuery, useInstagramAccountsQuery, useBlueskyAccountsQuery, useLinkedinAccountsQuery, useThreadsAccountsQuery, useFacebookAccountsQuery, useThreespeakAccountsQuery, useDisconnectAccountMutation } from '@/lib/api';
import { useRumbleAccountsQuery } from '@/lib/social-accounts-queries';
import { useYouTubeOAuth } from '@/lib/oauth/google-handler';
import { notifyIfSessionExpired } from '@/lib/session-expiry';
import { useInstagramOAuth } from '@/lib/oauth/instagram-handler';
import { useLinkedInOAuth } from '@/lib/oauth/linkedin-handler';
import { useThreadsOAuth } from '@/lib/oauth/threads-handler';
import { useFacebookOAuth } from '@/lib/oauth/facebook-handler';
import { usePinterestOAuth } from '@/lib/oauth/pinterest-handler';
import { usePinterestAccountsQuery } from '@/lib/pinterest-accounts';
import { useFanvueOAuth } from '@/lib/oauth/fanvue-handler';
import { useFanvueAccountsQuery } from '@/lib/fanvue-accounts';

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
  vi.mocked(useFacebookAccountsQuery, { partial: true }).mockReturnValue({ data: { authenticated: true, accounts: [] }, isLoading: false, error: null, refetch: vi.fn() });
  vi.mocked(useThreespeakAccountsQuery, { partial: true }).mockReturnValue({ data: { authenticated: true, accounts: [] }, isLoading: false, error: null, refetch: vi.fn() });
  vi.mocked(useFacebookOAuth).mockReturnValue(facebookOAuth);
  vi.mocked(usePinterestAccountsQuery, { partial: true }).mockReturnValue({ data: { authenticated: true, accounts: [] }, isLoading: false, error: null, refetch: vi.fn() });
  vi.mocked(usePinterestOAuth).mockReturnValue(pinterestOAuth);
  vi.mocked(useFanvueAccountsQuery, { partial: true }).mockReturnValue({ data: { authenticated: true, accounts: [] }, isLoading: false, error: null, refetch: vi.fn() });
  vi.mocked(useFanvueOAuth).mockReturnValue(fanvueOAuth);
  vi.mocked(useRumbleAccountsQuery, { partial: true }).mockReturnValue({ data: { authenticated: true, accounts: [] }, isLoading: false, error: null, refetch: vi.fn() });
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
const facebookOAuth = { isLoading: false, error: null, startOAuth: vi.fn() } as unknown as ReturnType<typeof useFacebookOAuth>;
const pinterestOAuth = { isLoading: false, error: null, startOAuth: vi.fn() } as unknown as ReturnType<typeof usePinterestOAuth>;
const fanvueOAuth = { isLoading: false, error: null, startOAuth: vi.fn() } as unknown as ReturnType<typeof useFanvueOAuth>;

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

  it('renders Fanvue section label', () => {
    render(<AccountsPage />, { wrapper: createWrapper() });
    expect(screen.getByText('accounts.fanvueLabel')).toBeTruthy();
  });

  it('shows the shared connection slot when YouTube has no accounts', () => {
    render(<AccountsPage />, { wrapper: createWrapper() });
    expect(screen.getAllByText('accounts.connectFirst')).toHaveLength(10);
  });

  it('shows the shared connection slot when Instagram has no accounts', () => {
    render(<AccountsPage />, { wrapper: createWrapper() });
    expect(screen.getAllByRole('button', { name: 'accounts.connectFirst' })).toHaveLength(10);
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
    vi.mocked(useYouTubeAccountsQuery, { partial: true }).mockReturnValue({
      data: { authenticated: true, accounts: [{ provider: 'youtube', recordId: 'r1', channelId: 'ch1', channelName: 'Ch1', connectedAt: 0, lastUsed: 0 }] },
      isLoading: false,
    });
    render(<AccountsPage />, { wrapper: createWrapper() });
    fireEvent.click(screen.getByTestId('youtube-disconnect-button'));
    await screen.findByTestId('disconnect-dialog');
    fireEvent.click(screen.getByTestId('disconnect-confirm-button'));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({ providerAccountId: 'ch1' }));
    expect(useDisconnectAccountMutation).toHaveBeenCalledWith('youtube');
    expect(reportAccountDisconnectFailed).not.toHaveBeenCalled();
  });

  it('does not disconnect when the confirmation dialog is cancelled', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({ success: true });
    vi.mocked(useDisconnectAccountMutation).mockReturnValue({ mutateAsync, isPending: false } as never);
    vi.mocked(useYouTubeAccountsQuery, { partial: true }).mockReturnValue({
      data: { authenticated: true, accounts: [{ provider: 'youtube', recordId: 'r1', channelId: 'ch1', channelName: 'Ch1', connectedAt: 0, lastUsed: 0 }] },
      isLoading: false,
    });
    render(<AccountsPage />, { wrapper: createWrapper() });
    fireEvent.click(screen.getByTestId('youtube-disconnect-button'));
    // The dialog names the account before it can be removed.
    expect(await screen.findByTestId('disconnect-dialog')).toBeVisible();
    fireEvent.click(screen.getByTestId('disconnect-cancel-button'));
    await waitFor(() => expect(screen.queryByTestId('disconnect-dialog')).not.toBeInTheDocument());
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(reportAccountDisconnectFailed).not.toHaveBeenCalled();
  });

  it('shows an error message when disconnect throws', async () => {
    const mutateAsync = vi.fn().mockRejectedValue(new Error('db fail'));
    vi.mocked(useDisconnectAccountMutation).mockReturnValue({ mutateAsync, isPending: false } as never);
    vi.mocked(useYouTubeAccountsQuery, { partial: true }).mockReturnValue({
      data: { authenticated: true, accounts: [{ provider: 'youtube', recordId: 'r1', channelId: 'ch1', channelName: 'Ch1', connectedAt: 0, lastUsed: 0 }] },
      isLoading: false,
    });
    render(<AccountsPage />, { wrapper: createWrapper() });
    fireEvent.click(screen.getByTestId('youtube-disconnect-button'));
    await screen.findByTestId('disconnect-dialog');
    fireEvent.click(screen.getByTestId('disconnect-confirm-button'));
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
    vi.mocked(useThreespeakAccountsQuery, { partial: true }).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('3speak down'),
      refetch: vi.fn(),
    });
    render(<AccountsPage />, { wrapper: createWrapper() });
    expect(useAccountListErrorTelemetry).toHaveBeenCalledWith('instagram', 'ig down');
    expect(useAccountListErrorTelemetry).toHaveBeenCalledWith('bluesky', 'bsky down');
    expect(useAccountListErrorTelemetry).toHaveBeenCalledWith('linkedin', 'li down');
    expect(useAccountListErrorTelemetry).toHaveBeenCalledWith('threads', 'threads down');
    expect(useAccountListErrorTelemetry).toHaveBeenCalledWith('3speak', '3speak down');
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

  it('shows a Bluesky display name over the handle when the row carries one', () => {
    vi.mocked(useBlueskyAccountsQuery, { partial: true }).mockReturnValue({
      data: {
        authenticated: true,
        accounts: [
          { provider: 'bluesky', recordId: 'r1', did: 'did:plc:a', handle: 'a.bsky.social', displayName: 'Habit Loom', connectedAt: 0, lastUsed: 0 },
          { provider: 'bluesky', recordId: 'r2', did: 'did:plc:b', handle: 'b.bsky.social', connectedAt: 0, lastUsed: 0 },
        ],
      },
      isLoading: false,
    });
    render(<AccountsPage />, { wrapper: createWrapper() });
    const cards = screen.getAllByTestId('account-card').filter((el) => el.getAttribute('data-provider') === 'bluesky');
    expect(cards).toHaveLength(2);
    expect(within(cards[0]).getByText('Habit Loom')).toBeTruthy();
    expect(within(cards[1]).getByText('b.bsky.social')).toBeTruthy();
  });

  it('shows an error message when the server reports failure', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({ success: false });
    vi.mocked(useDisconnectAccountMutation).mockReturnValue({ mutateAsync, isPending: false } as never);
    vi.mocked(useYouTubeAccountsQuery, { partial: true }).mockReturnValue({
      data: { authenticated: true, accounts: [{ provider: 'youtube', recordId: 'r1', channelId: 'ch1', channelName: 'Ch1', connectedAt: 0, lastUsed: 0 }] },
      isLoading: false,
    });
    render(<AccountsPage />, { wrapper: createWrapper() });
    fireEvent.click(screen.getByTestId('youtube-disconnect-button'));
    await screen.findByTestId('disconnect-dialog');
    fireEvent.click(screen.getByTestId('disconnect-confirm-button'));
    await waitFor(() => expect(screen.getByTestId('disconnect-error')).toBeInTheDocument());
    expect(reportAccountDisconnectFailed).toHaveBeenCalledWith('youtube', 'rejected');
  });

  it('disconnects an Instagram account using its igUserId', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({ success: true });
    vi.mocked(useDisconnectAccountMutation).mockReturnValue({ mutateAsync, isPending: false } as never);
    vi.mocked(useInstagramAccountsQuery, { partial: true }).mockReturnValue({
      data: { authenticated: true, accounts: [{ provider: 'instagram', recordId: 'r1', igUserId: 'ig1', username: 'instauser', connectedAt: 0, lastUsed: 0 }] },
      isLoading: false,
    });
    render(<AccountsPage />, { wrapper: createWrapper() });
    fireEvent.click(screen.getByTestId('instagram-disconnect-button'));
    await screen.findByTestId('disconnect-dialog');
    fireEvent.click(screen.getByTestId('disconnect-confirm-button'));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({ providerAccountId: 'ig1' }));
    expect(useDisconnectAccountMutation).toHaveBeenCalledWith('instagram');
  });

  it('renders the dialog copy and starts closed with empty fields', async () => {
    render(<AccountsPage />, { wrapper: createWrapper() });
    expect(screen.queryByTestId('bluesky-handle-input')).not.toBeInTheDocument();
    // Section order: youtube, instagram, bluesky, linkedin, threads.
    fireEvent.click(screen.getAllByRole('button', { name: 'accounts.connectFirst' })[2]);
    expect(await screen.findByTestId('bluesky-handle-input')).toBeTruthy();
    expect(screen.getByText('accounts.blueskyConnectTitle')).toBeTruthy();
    expect(screen.getByText('accounts.blueskyConnectHint')).toBeTruthy();
    expect(screen.getByText('accounts.blueskyHandleLabel')).toBeTruthy();
    expect(screen.getByText('accounts.blueskyPasswordLabel')).toBeTruthy();
    expect(screen.getByText('accounts.blueskyConnect')).toBeTruthy();
    expect(screen.getByText('accounts.blueskySecurityHint')).toBeTruthy();
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-labelledby', 'bluesky-dialog-title');
    expect(document.getElementById('bluesky-dialog-title')).toHaveTextContent('accounts.blueskyConnectTitle');
    expect(screen.getByTestId('bluesky-handle-input')).toHaveValue('');
    expect(screen.getByTestId('bluesky-password-input')).toHaveValue('');
  });

  it('closes the Bluesky dialog from its close button', async () => {
    render(<AccountsPage />, { wrapper: createWrapper() });
    fireEvent.click(screen.getAllByRole('button', { name: 'accounts.connectFirst' })[2]);
    expect(await screen.findByTestId('bluesky-handle-input')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'accounts.closeDialog' }));
    await waitFor(() => expect(screen.queryByTestId('bluesky-handle-input')).not.toBeInTheDocument());
  });

  async function submitBlueskyConnect(status: number, body: unknown): Promise<void> {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status, json: async () => body })));
    render(<AccountsPage />, { wrapper: createWrapper() });
    // Section order: youtube, instagram, bluesky, linkedin, threads.
    fireEvent.click(screen.getAllByRole('button', { name: 'accounts.connectFirst' })[2]);
    fireEvent.change(await screen.findByTestId('bluesky-handle-input'), { target: { value: 'voce.bsky.social' } });
    fireEvent.change(screen.getByTestId('bluesky-password-input'), { target: { value: 'app-password' } });
    fireEvent.click(screen.getByTestId('bluesky-connect-button'));
    expect(await screen.findByTestId('bluesky-connect-error')).toBeInTheDocument();
  }

  it('bluesky connect dialog shows its title, hint, labels and security note', async () => {
    render(<AccountsPage />, { wrapper: createWrapper() });
    fireEvent.click(screen.getAllByRole('button', { name: 'accounts.connectFirst' })[2]);
    expect(await screen.findByRole('dialog', { name: 'accounts.blueskyConnectTitle' })).toBeInTheDocument();
    expect(screen.getByText('accounts.blueskyConnectHint')).toBeInTheDocument();
    expect(screen.getByText('accounts.blueskyHandleLabel')).toBeInTheDocument();
    expect(screen.getByText('accounts.blueskyPasswordLabel')).toBeInTheDocument();
    expect(screen.getByTestId('bluesky-connect-button')).toHaveTextContent('accounts.blueskyConnect');
    expect(screen.getByText('accounts.blueskySecurityHint')).toBeInTheDocument();
    expect(screen.getByLabelText('accounts.closeDialog')).toBeInTheDocument();
  });

  it('bluesky connect dialog does NOT log the user out when the credential is rejected (422)', async () => {
    const notify = vi.mocked(notifyIfSessionExpired);
    notify.mockClear();
    await submitBlueskyConnect(422, { success: false, code: 'BLUESKY_CREDENTIAL_REJECTED' });
    // The 422 response still goes through the session-expiry check, which
    // only acts on 401 (pinned in lib/__tests__/session-expiry.test.tsx).
    expect(notify).toHaveBeenCalledTimes(1);
    expect(vi.mocked(notify).mock.calls[0][0]).toMatchObject({ status: 422 });
  });

  it('bluesky connect dialog reports a dead hub session (401) to the session-expiry handler', async () => {
    const notify = vi.mocked(notifyIfSessionExpired);
    notify.mockClear();
    await submitBlueskyConnect(401, { success: false, error: 'Authentication required.' });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(vi.mocked(notify).mock.calls[0][0]).toMatchObject({ status: 401 });
  });

  it('disconnects a Bluesky account using its did', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({ success: true });
    vi.mocked(useDisconnectAccountMutation).mockReturnValue({ mutateAsync, isPending: false } as never);
    vi.mocked(useBlueskyAccountsQuery, { partial: true }).mockReturnValue({
      data: { authenticated: true, accounts: [{ provider: 'bluesky', recordId: 'r1', did: 'did:plc:abc', handle: 'voce.bsky.social', connectedAt: 0, lastUsed: 0 }] },
      isLoading: false,
    });
    render(<AccountsPage />, { wrapper: createWrapper() });
    fireEvent.click(screen.getByTestId('bluesky-disconnect-button'));
    await screen.findByTestId('disconnect-dialog');
    fireEvent.click(screen.getByTestId('disconnect-confirm-button'));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({ providerAccountId: 'did:plc:abc' }));
    expect(useDisconnectAccountMutation).toHaveBeenCalledWith('bluesky');
  });

  it('disconnects a LinkedIn account using its providerAccountId', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({ success: true });
    vi.mocked(useDisconnectAccountMutation).mockReturnValue({ mutateAsync, isPending: false } as never);
    vi.mocked(useLinkedinAccountsQuery, { partial: true }).mockReturnValue({
      data: {
        authenticated: true,
        accounts: [{ provider: 'linkedin', recordId: 'r1', providerAccountId: 'member-123', accountName: 'Ryan Carlos', accountMetadata: { kind: 'member', name: 'Ryan Carlos' }, connectedAt: 0, lastUsed: 0 }],
      },
      isLoading: false,
    });
    render(<AccountsPage />, { wrapper: createWrapper() });
    fireEvent.click(screen.getByTestId('linkedin-disconnect-button'));
    await screen.findByTestId('disconnect-dialog');
    fireEvent.click(screen.getByTestId('disconnect-confirm-button'));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({ providerAccountId: 'member-123' }));
    expect(useDisconnectAccountMutation).toHaveBeenCalledWith('linkedin');
  });

  it('reports the provider when Instagram, Bluesky, or LinkedIn disconnect throws', async () => {
    const mutateAsync = vi.fn().mockRejectedValue(new Error('db fail'));
    vi.mocked(useDisconnectAccountMutation).mockReturnValue({ mutateAsync, isPending: false } as never);
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
    await screen.findByTestId('disconnect-dialog');
    fireEvent.click(screen.getByTestId('disconnect-confirm-button'));
    fireEvent.click(screen.getByTestId('bluesky-disconnect-button'));
    await screen.findByTestId('disconnect-dialog');
    fireEvent.click(screen.getByTestId('disconnect-confirm-button'));
    fireEvent.click(screen.getByTestId('linkedin-disconnect-button'));
    await screen.findByTestId('disconnect-dialog');
    fireEvent.click(screen.getByTestId('disconnect-confirm-button'));
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
    // Section order: youtube, instagram, bluesky, linkedin, threads, facebook, pinterest, fanvue, 3speak, rumble.
    fireEvent.click(screen.getAllByRole('button', { name: 'accounts.connectFirst' })[4]);
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
    vi.mocked(useThreadsAccountsQuery, { partial: true }).mockReturnValue({
      data: { authenticated: true, accounts: [{ provider: 'threads', recordId: 'r1', providerAccountId: '42', accountName: 'ana', connectedAt: 0, lastUsed: 0 }] },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    render(<AccountsPage />, { wrapper: createWrapper() });
    fireEvent.click(screen.getByTestId('threads-disconnect-button'));
    await screen.findByTestId('disconnect-dialog');
    fireEvent.click(screen.getByTestId('disconnect-confirm-button'));
    await waitFor(() => expect(reportAccountDisconnectFailed).toHaveBeenCalledWith('threads', 'threw'));
  });
});

describe('Facebook Pages accounts section', () => {
  beforeEach(() => {
    vi.mocked(facebookOAuth.startOAuth).mockClear();
  });

  it('renders the section with its localized copy and starts OAuth from its button', () => {
    render(<AccountsPage />, { wrapper: createWrapper() });
    expect(screen.getByText('accounts.facebookLabel')).toBeTruthy();
    expect(screen.getByText('accounts.facebookDescription')).toBeTruthy();
    // Section order: youtube, instagram, bluesky, linkedin, threads, facebook, pinterest, fanvue, 3speak, rumble.
    fireEvent.click(screen.getAllByRole('button', { name: 'accounts.connectFirst' })[5]);
    expect(facebookOAuth.startOAuth).toHaveBeenCalledTimes(1);
  });

  it('lists each connected Page, marking a stored name or the Page id', () => {
    vi.mocked(useFacebookAccountsQuery, { partial: true }).mockReturnValue({
      data: {
        authenticated: true,
        accounts: [
          { provider: 'facebook', recordId: 'r1', providerAccountId: '111', accountName: 'My Page', connectedAt: 0, lastUsed: 0 },
          { provider: 'facebook', recordId: 'r2', providerAccountId: '222', accountName: null, connectedAt: 0, lastUsed: 0 },
        ],
      },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    render(<AccountsPage />, { wrapper: createWrapper() });
    const cards = screen.getAllByTestId('account-card').filter((el) => el.getAttribute('data-provider') === 'facebook');
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveAttribute('data-label-origin', 'stored');
    expect(cards[1]).toHaveAttribute('data-label-origin', 'provider_id');
    expect(screen.getByText('My Page')).toBeTruthy();
    expect(screen.getByText('222')).toBeTruthy();
    // With a Page connected the button offers another one.
    expect(screen.getAllByRole('button', { name: 'accounts.connectAnother' }).length).toBeGreaterThan(0);
  });

  it('reports a list error for the facebook provider', () => {
    vi.mocked(useFacebookAccountsQuery, { partial: true }).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('fb down'),
      refetch: vi.fn(),
    });
    render(<AccountsPage />, { wrapper: createWrapper() });
    expect(useAccountListErrorTelemetry).toHaveBeenCalledWith('facebook', 'fb down');
  });

  it('disables the connect button while the OAuth popup is opening', () => {
    vi.mocked(useFacebookOAuth).mockReturnValue({ ...facebookOAuth, isLoading: true });
    render(<AccountsPage />, { wrapper: createWrapper() });
    // Section order: youtube, instagram, bluesky, linkedin, threads, facebook, pinterest, fanvue, 3speak, rumble.
    const button = screen.getAllByRole('button', { name: 'accounts.connectFirst' })[5] as HTMLButtonElement;
    expect(button).toBeDisabled();
  });

  it('lists each connected Page, marking a stored name or the Page id', () => {
    vi.mocked(useFacebookAccountsQuery, { partial: true }).mockReturnValue({
      data: {
        authenticated: true,
        accounts: [
          { provider: 'facebook', recordId: 'r1', providerAccountId: '111', accountName: 'My Page', connectedAt: 0, lastUsed: 0 },
          { provider: 'facebook', recordId: 'r2', providerAccountId: '222', accountName: null, connectedAt: 0, lastUsed: 0 },
        ],
      },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    render(<AccountsPage />, { wrapper: createWrapper() });
    const cards = screen.getAllByTestId('account-card').filter((el) => el.getAttribute('data-provider') === 'facebook');
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveAttribute('data-label-origin', 'stored');
    expect(cards[1]).toHaveAttribute('data-label-origin', 'provider_id');
    expect(screen.getByText('My Page')).toBeTruthy();
    expect(screen.getByText('222')).toBeTruthy();
    // With a Page connected the button offers another one.
    expect(screen.getAllByRole('button', { name: 'accounts.connectAnother' }).length).toBeGreaterThan(0);
  });
  it('reports a Facebook disconnect failure for that provider', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({ success: false });
    vi.mocked(useDisconnectAccountMutation).mockReturnValue({ mutateAsync, isPending: false } as never);
    vi.mocked(useFacebookAccountsQuery, { partial: true }).mockReturnValue({
      data: { authenticated: true, accounts: [{ provider: 'facebook', recordId: 'r1', providerAccountId: '111', accountName: 'My Page', connectedAt: 0, lastUsed: 0 }] },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    render(<AccountsPage />, { wrapper: createWrapper() });
    fireEvent.click(screen.getByTestId('facebook-disconnect-button'));
    await screen.findByTestId('disconnect-dialog');
    fireEvent.click(screen.getByTestId('disconnect-confirm-button'));
    await waitFor(() => expect(reportAccountDisconnectFailed).toHaveBeenCalledWith('facebook', 'rejected'));
  });

  it('shows a 3Speak stored name over the Hive username when the row carries one', () => {
    vi.mocked(useThreespeakAccountsQuery, { partial: true }).mockReturnValue({
      data: {
        authenticated: true,
        accounts: [
          { provider: '3speak', recordId: 'r1', providerAccountId: 'alice', accountName: 'Alice in Hive', connectedAt: 0, lastUsed: 0 },
          { provider: '3speak', recordId: 'r2', providerAccountId: 'bob', accountName: null, connectedAt: 0, lastUsed: 0 },
        ],
      },
      isLoading: false,
    });
    render(<AccountsPage />, { wrapper: createWrapper() });
    const cards = screen.getAllByTestId('account-card').filter((el) => el.getAttribute('data-provider') === '3speak');
    expect(cards).toHaveLength(2);
    expect(within(cards[0]).getByText('Alice in Hive')).toBeTruthy();
    expect(within(cards[1]).getByText('bob')).toBeTruthy();
  });

  it('disconnects a 3Speak account using its Hive username', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({ success: true });
    vi.mocked(useDisconnectAccountMutation).mockReturnValue({ mutateAsync, isPending: false } as never);
    vi.mocked(useThreespeakAccountsQuery, { partial: true }).mockReturnValue({
      data: { authenticated: true, accounts: [{ provider: '3speak', recordId: 'r1', providerAccountId: 'alice', accountName: 'Alice', connectedAt: 0, lastUsed: 0 }] },
      isLoading: false,
    });
    render(<AccountsPage />, { wrapper: createWrapper() });
    fireEvent.click(screen.getByTestId('3speak-disconnect-button'));
    await screen.findByTestId('disconnect-dialog');
    fireEvent.click(screen.getByTestId('disconnect-confirm-button'));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({ providerAccountId: 'alice' }));
    expect(useDisconnectAccountMutation).toHaveBeenCalledWith('3speak');
  });

  async function submitThreespeakConnect(status: number, body: unknown): Promise<ReturnType<typeof vi.fn>> {
    const fetchMock = vi.fn(async () => ({ ok: false, status, json: async () => body }));
    vi.stubGlobal('fetch', fetchMock);
    render(<AccountsPage />, { wrapper: createWrapper() });
    // Section order: youtube, instagram, bluesky, linkedin, threads, facebook, pinterest, fanvue, 3speak, rumble.
    fireEvent.click(screen.getAllByRole('button', { name: 'accounts.connectFirst' })[8]);
    fireEvent.change(await screen.findByTestId('threespeak-handle-input'), { target: { value: 'alice' } });
    fireEvent.change(screen.getByTestId('threespeak-password-input'), { target: { value: '5K-posting-key' } });
    fireEvent.click(screen.getByTestId('threespeak-connect-button'));
    expect(await screen.findByTestId('threespeak-connect-error')).toBeInTheDocument();
    return fetchMock;
  }

  it('3speak connect dialog shows its title, hint, labels and security note', async () => {
    render(<AccountsPage />, { wrapper: createWrapper() });
    fireEvent.click(screen.getAllByRole('button', { name: 'accounts.connectFirst' })[8]);
    expect(await screen.findByRole('dialog', { name: 'accounts.threespeakConnectTitle' })).toBeInTheDocument();
    expect(screen.getByText('accounts.threespeakConnectHint')).toBeInTheDocument();
    expect(screen.getByText('accounts.threespeakHandleLabel')).toBeInTheDocument();
    expect(screen.getByText('accounts.threespeakPasswordLabel')).toBeInTheDocument();
    expect(screen.getByTestId('threespeak-connect-button')).toHaveTextContent('accounts.threespeakConnect');
    expect(screen.getByText('accounts.threespeakSecurityHint')).toBeInTheDocument();
    expect(screen.getByLabelText('accounts.closeDialog')).toBeInTheDocument();
  });

  it('3speak connect dialog posts the username and posting key to /api/threespeak-connect', async () => {
    const fetchMock = await submitThreespeakConnect(422, { success: false, code: 'THREESPEAK_CREDENTIAL_REJECTED' });
    expect(fetchMock).toHaveBeenCalledWith('/api/threespeak-connect', expect.objectContaining({ method: 'POST' }));
    const sent = fetchMock.mock.calls[0][1].body as FormData;
    expect(sent.get('username')).toBe('alice');
    expect(sent.get('postingKey')).toBe('5K-posting-key');
    // A rejected credential names itself instead of the generic error.
    expect(screen.getByTestId('threespeak-connect-error')).toHaveTextContent('accounts.threespeakCredentialRejected');
  });

  it('3speak connect dialog shows the generic error when the failure is not a rejected credential', async () => {
    await submitThreespeakConnect(500, { success: false, error: 'boom' });
    expect(screen.getByTestId('threespeak-connect-error')).toHaveTextContent('accounts.threespeakConnectError');
  });

  it('3speak connect dialog closes and refetches on success', async () => {
    const refetch = vi.fn();
    vi.mocked(useThreespeakAccountsQuery, { partial: true }).mockReturnValue({
      data: { authenticated: true, accounts: [] },
      isLoading: false,
      error: null,
      refetch,
    });
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true, accountId: 'row-1', username: 'alice' }) }));
    vi.stubGlobal('fetch', fetchMock);
    render(<AccountsPage />, { wrapper: createWrapper() });
    fireEvent.click(screen.getAllByRole('button', { name: 'accounts.connectFirst' })[8]);
    fireEvent.change(await screen.findByTestId('threespeak-handle-input'), { target: { value: 'alice' } });
    fireEvent.change(screen.getByTestId('threespeak-password-input'), { target: { value: '5K-posting-key' } });
    fireEvent.click(screen.getByTestId('threespeak-connect-button'));
    await waitFor(() => expect(screen.queryByTestId('threespeak-handle-input')).toBeNull());
    expect(fetchMock).toHaveBeenCalledWith('/api/threespeak-connect', expect.objectContaining({ method: 'POST' }));
    expect(refetch).toHaveBeenCalled();
  });

  it('3speak connect dialog does not submit with empty fields', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    vi.stubGlobal('fetch', fetchMock);
    render(<AccountsPage />, { wrapper: createWrapper() });
    fireEvent.click(screen.getAllByRole('button', { name: 'accounts.connectFirst' })[8]);
    fireEvent.click(await screen.findByTestId('threespeak-connect-button'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('3speak connect dialog does NOT log the user out when the credential is rejected (422)', async () => {
    const notify = vi.mocked(notifyIfSessionExpired);
    notify.mockClear();
    await submitThreespeakConnect(422, { success: false, code: 'THREESPEAK_CREDENTIAL_REJECTED' });
    // The 422 response still goes through the session-expiry check, which
    // only acts on 401 (pinned in lib/__tests__/session-expiry.test.tsx).
    expect(notify).toHaveBeenCalledTimes(1);
    expect(vi.mocked(notify).mock.calls[0][0]).toMatchObject({ status: 422 });
  });

  it('3speak connect dialog reports a dead hub session (401) to the session-expiry handler', async () => {
    const notify = vi.mocked(notifyIfSessionExpired);
    notify.mockClear();
    await submitThreespeakConnect(401, { success: false, error: 'Authentication required.' });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(vi.mocked(notify).mock.calls[0][0]).toMatchObject({ status: 401 });
  });
});

describe('Pinterest accounts section', () => {
  beforeEach(() => {
    vi.mocked(pinterestOAuth.startOAuth).mockClear();
  });

  it('renders the section with its localized copy and starts OAuth from its button', () => {
    render(<AccountsPage />, { wrapper: createWrapper() });
    expect(screen.getByText('accounts.pinterestLabel')).toBeTruthy();
    expect(screen.getByText('accounts.pinterestDescription')).toBeTruthy();
    // Section order: youtube, instagram, bluesky, linkedin, threads, facebook, pinterest, fanvue, 3speak, rumble.
    fireEvent.click(screen.getAllByRole('button', { name: 'accounts.connectFirst' })[6] as HTMLElement);
    expect(pinterestOAuth.startOAuth).toHaveBeenCalledTimes(1);
  });

  it('lists each connected Pinterest account, marking a stored name or the account id', () => {
    vi.mocked(usePinterestAccountsQuery, { partial: true }).mockReturnValue({
      data: {
        authenticated: true,
        accounts: [
          { provider: 'pinterest', recordId: 'r1', providerAccountId: '111', accountName: 'Maker', connectedAt: 0, lastUsed: 0 },
          { provider: 'pinterest', recordId: 'r2', providerAccountId: '222', accountName: null, connectedAt: 0, lastUsed: 0 },
        ],
      },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    render(<AccountsPage />, { wrapper: createWrapper() });
    const cards = screen.getAllByTestId('account-card').filter((el) => el.getAttribute('data-provider') === 'pinterest');
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveAttribute('data-label-origin', 'stored');
    expect(cards[1]).toHaveAttribute('data-label-origin', 'provider_id');
    expect(screen.getByText('Maker')).toBeTruthy();
    expect(screen.getByText('222')).toBeTruthy();
    // With an account connected the button offers another one.
    expect(screen.getAllByRole('button', { name: 'accounts.connectAnother' }).length).toBeGreaterThan(0);
  });

  it('reports a list error for the pinterest provider', () => {
    vi.mocked(usePinterestAccountsQuery, { partial: true }).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('pin down'),
      refetch: vi.fn(),
    });
    render(<AccountsPage />, { wrapper: createWrapper() });
    expect(useAccountListErrorTelemetry).toHaveBeenCalledWith('pinterest', 'pin down');
  });

  it('disables the connect button while the OAuth popup is opening', () => {
    vi.mocked(usePinterestOAuth).mockReturnValue({ ...pinterestOAuth, isLoading: true });
    render(<AccountsPage />, { wrapper: createWrapper() });
    const button = screen.getAllByRole('button', { name: 'accounts.connectFirst' })[6] as HTMLButtonElement;
    expect(button).toBeDisabled();
  });
});

describe('Fanvue accounts section', () => {
  it('renders the section with its localized copy and starts OAuth from its button', () => {
    render(<AccountsPage />, { wrapper: createWrapper() });
    expect(screen.getByText('accounts.fanvueLabel')).toBeTruthy();
    expect(screen.getByText('accounts.fanvueDescription')).toBeTruthy();
    // Section order: youtube, instagram, bluesky, linkedin, threads, facebook, pinterest, fanvue, 3speak, rumble.
    fireEvent.click(screen.getAllByRole('button', { name: 'accounts.connectFirst' })[7] as HTMLElement);
    expect(fanvueOAuth.startOAuth).toHaveBeenCalledTimes(1);
  });

  it('lists each connected Fanvue account, marking a stored name or the account id', () => {
    vi.mocked(useFanvueAccountsQuery, { partial: true }).mockReturnValue({
      data: {
        authenticated: true,
        accounts: [
          { provider: 'fanvue', recordId: 'r1', providerAccountId: 'fv-1', accountName: 'Maker', profilePictureUrl: 'https://media.fanvue.com/a.jpg', connectedAt: 0, lastUsed: 0 },
          { provider: 'fanvue', recordId: 'r2', providerAccountId: 'fv-2', accountName: null, connectedAt: 0, lastUsed: 0 },
        ],
      },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    render(<AccountsPage />, { wrapper: createWrapper() });
    const cards = screen.getAllByTestId('account-card').filter((el) => el.getAttribute('data-provider') === 'fanvue');
    expect(cards).toHaveLength(2);
    expect(within(cards[0]).getByText('Maker')).toBeTruthy();
    expect(within(cards[1]).getByText('fv-2')).toBeTruthy();
  });
});

describe('Rumble accounts section', () => {
  async function submitRumbleConnect(status: number, body: unknown) {
    const fetchMock = vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body }));
    vi.stubGlobal('fetch', fetchMock);
    render(<AccountsPage />, { wrapper: createWrapper() });
    // Rumble is the last section on the page, so its connect button is last.
    fireEvent.click(screen.getAllByRole('button', { name: 'accounts.connectFirst' }).at(-1) as HTMLElement);
    fireEvent.change(await screen.findByTestId('rumble-handle-input'), { target: { value: 'chan-1' } });
    fireEvent.change(screen.getByTestId('rumble-password-input'), { target: { value: 'a'.repeat(40) } });
    fireEvent.click(screen.getByTestId('rumble-connect-button'));
    return fetchMock;
  }

  it('renders the section with its localized copy and opens the credential dialog from its button', async () => {
    render(<AccountsPage />, { wrapper: createWrapper() });
    expect(screen.getByText('accounts.rumbleLabel')).toBeTruthy();
    expect(screen.getByText('accounts.rumbleDescription')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'accounts.connectFirst' }).at(-1) as HTMLElement);
    expect(await screen.findByTestId('rumble-handle-input')).toBeTruthy();
    expect(screen.getByTestId('rumble-password-input')).toBeTruthy();
  });

  it('lists each connected channel, marking a stored name or the channel id', () => {
    vi.mocked(useRumbleAccountsQuery, { partial: true }).mockReturnValue({
      data: {
        authenticated: true,
        accounts: [
          { provider: 'rumble', recordId: 'r1', providerAccountId: 'chan-1', accountName: 'My Channel', connectedAt: 0, lastUsed: 0 },
          { provider: 'rumble', recordId: 'r2', providerAccountId: 'chan-2', accountName: null, connectedAt: 0, lastUsed: 0 },
        ],
      },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    render(<AccountsPage />, { wrapper: createWrapper() });
    const cards = screen.getAllByTestId('account-card').filter((el) => el.getAttribute('data-provider') === 'rumble');
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveAttribute('data-label-origin', 'stored');
    expect(cards[1]).toHaveAttribute('data-label-origin', 'provider_id');
    expect(screen.getByText('My Channel')).toBeTruthy();
    expect(screen.getByText('chan-2')).toBeTruthy();
    // With a channel connected the button offers another one.
    expect(screen.getAllByRole('button', { name: 'accounts.connectAnother' }).length).toBeGreaterThan(0);
  });

  it('reports a list error for the rumble provider', () => {
    vi.mocked(useRumbleAccountsQuery, { partial: true }).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('rumble down'),
      refetch: vi.fn(),
    });
    render(<AccountsPage />, { wrapper: createWrapper() });
    expect(useAccountListErrorTelemetry).toHaveBeenCalledWith('rumble', 'rumble down');
  });

  it('renders the dialog copy and starts closed with empty fields', async () => {
    render(<AccountsPage />, { wrapper: createWrapper() });
    expect(screen.queryByTestId('rumble-handle-input')).not.toBeInTheDocument();
    // Rumble is the last section on the page, so its connect button is last.
    fireEvent.click(screen.getAllByRole('button', { name: 'accounts.connectFirst' }).at(-1) as HTMLElement);
    expect(await screen.findByTestId('rumble-handle-input')).toBeTruthy();
    expect(screen.getByText('accounts.rumbleConnectTitle')).toBeTruthy();
    expect(screen.getByText('accounts.rumbleConnectHint')).toBeTruthy();
    expect(screen.getByText('accounts.rumbleChannelLabel')).toBeTruthy();
    expect(screen.getByText('accounts.rumbleTokenLabel')).toBeTruthy();
    expect(screen.getByText('accounts.rumbleConnect')).toBeTruthy();
    expect(screen.getByText('accounts.rumbleSecurityHint')).toBeTruthy();
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-labelledby', 'rumble-dialog-title');
    expect(document.getElementById('rumble-dialog-title')).toHaveTextContent('accounts.rumbleConnectTitle');
    expect(screen.getByTestId('rumble-handle-input')).toHaveValue('');
    expect(screen.getByTestId('rumble-password-input')).toHaveValue('');
  });

  it('closes the Rumble dialog from its close button', async () => {
    render(<AccountsPage />, { wrapper: createWrapper() });
    fireEvent.click(screen.getAllByRole('button', { name: 'accounts.connectFirst' }).at(-1) as HTMLElement);
    expect(await screen.findByTestId('rumble-handle-input')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'accounts.closeDialog' }));
    await waitFor(() => expect(screen.queryByTestId('rumble-handle-input')).not.toBeInTheDocument());
  });

  it('keeps the Rumble connect button disabled until both fields are non-blank', async () => {
    render(<AccountsPage />, { wrapper: createWrapper() });
    fireEvent.click(screen.getAllByRole('button', { name: 'accounts.connectFirst' }).at(-1) as HTMLElement);
    const button = await screen.findByTestId('rumble-connect-button');
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByTestId('rumble-handle-input'), { target: { value: '   ' } });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByTestId('rumble-handle-input'), { target: { value: 'chan-1' } });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByTestId('rumble-password-input'), { target: { value: '   ' } });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByTestId('rumble-password-input'), { target: { value: 'a'.repeat(40) } });
    expect(button).not.toBeDisabled();
  });

  it('renders no Rumble cards when the query has no data', () => {
    vi.mocked(useRumbleAccountsQuery, { partial: true }).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    render(<AccountsPage />, { wrapper: createWrapper() });
    expect(screen.queryAllByTestId('account-card')).toHaveLength(0);
  });

  it('posts trimmed values, closes the dialog and refetches on success', async () => {
    const refetch = vi.fn();
    vi.mocked(useRumbleAccountsQuery, { partial: true }).mockReturnValue({
      data: { authenticated: true, accounts: [] },
      isLoading: false,
      error: null,
      refetch,
    });
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true }) }));
    vi.stubGlobal('fetch', fetchMock);
    render(<AccountsPage />, { wrapper: createWrapper() });
    fireEvent.click(screen.getAllByRole('button', { name: 'accounts.connectFirst' }).at(-1) as HTMLElement);
    fireEvent.change(await screen.findByTestId('rumble-handle-input'), { target: { value: '  chan-1  ' } });
    fireEvent.change(screen.getByTestId('rumble-password-input'), { target: { value: 'a'.repeat(40) } });
    fireEvent.click(screen.getByTestId('rumble-connect-button'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/rumble-connect');
    expect(init.method).toBe('POST');
    expect((init.body as FormData).get('channelId')).toBe('chan-1');
    await waitFor(() => expect(screen.queryByTestId('rumble-handle-input')).not.toBeInTheDocument());
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('rumble-connect-error')).not.toBeInTheDocument();
  });

  it('disables the connect button while the request is pending and re-enables it after', async () => {
    let resolveFetch: (value: unknown) => void = () => undefined;
    const fetchMock = vi.fn(
      () => new Promise((resolve) => { resolveFetch = resolve as (value: unknown) => void; }),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<AccountsPage />, { wrapper: createWrapper() });
    fireEvent.click(screen.getAllByRole('button', { name: 'accounts.connectFirst' }).at(-1) as HTMLElement);
    fireEvent.change(await screen.findByTestId('rumble-handle-input'), { target: { value: 'chan-1' } });
    fireEvent.change(screen.getByTestId('rumble-password-input'), { target: { value: 'a'.repeat(40) } });
    fireEvent.click(screen.getByTestId('rumble-connect-button'));
    await waitFor(() => expect(screen.getByTestId('rumble-connect-button')).toBeDisabled());
    resolveFetch({ ok: true, status: 200, json: async () => ({ success: true }) });
    await waitFor(() => expect(screen.queryByTestId('rumble-handle-input')).not.toBeInTheDocument());
  });

  it('reports a dead hub session (401), shows the error text and clears the token', async () => {
    const notify = vi.mocked(notifyIfSessionExpired);
    notify.mockClear();
    const fetchMock = await submitRumbleConnect(401, { success: false, error: 'Authentication required.' });
    expect(await screen.findByTestId('rumble-connect-error')).toHaveTextContent('accounts.rumbleConnectError');
    expect(notify).toHaveBeenCalledTimes(1);
    expect(vi.mocked(notify).mock.calls[0][0]).toMatchObject({ status: 401 });
    expect(screen.getByTestId('rumble-password-input')).toHaveValue('');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('shows the error text when the connect request throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    render(<AccountsPage />, { wrapper: createWrapper() });
    fireEvent.click(screen.getAllByRole('button', { name: 'accounts.connectFirst' }).at(-1) as HTMLElement);
    fireEvent.change(await screen.findByTestId('rumble-handle-input'), { target: { value: 'chan-1' } });
    fireEvent.change(screen.getByTestId('rumble-password-input'), { target: { value: 'a'.repeat(40) } });
    fireEvent.click(screen.getByTestId('rumble-connect-button'));
    expect(await screen.findByTestId('rumble-connect-error')).toHaveTextContent('accounts.rumbleConnectError');
  });

  it('names the stored channel in the disconnect dialog', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({ success: true });
    vi.mocked(useDisconnectAccountMutation).mockReturnValue({ mutateAsync, isPending: false } as never);
    vi.mocked(useRumbleAccountsQuery, { partial: true }).mockReturnValue({
      data: { authenticated: true, accounts: [{ provider: 'rumble', recordId: 'r1', providerAccountId: 'chan-1', accountName: 'My Channel', connectedAt: 0, lastUsed: 0 }] },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    render(<AccountsPage />, { wrapper: createWrapper() });
    fireEvent.click(screen.getByTestId('rumble-disconnect-button'));
    expect(await screen.findByTestId('disconnect-dialog')).toHaveTextContent('My Channel');
  });

  it('posts channelId + accessToken to /api/rumble-connect and shows the error on a 400', async () => {
    const fetchMock = await submitRumbleConnect(400, { success: false, error: 'bad token' });
    expect(await screen.findByTestId('rumble-connect-error')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/rumble-connect');
    const form = init.body as FormData;
    expect(form.get('channelId')).toBe('chan-1');
    expect(form.get('accessToken')).toBe('a'.repeat(40));
  });

  it('reports a Rumble disconnect failure for that provider', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({ success: false });
    vi.mocked(useDisconnectAccountMutation).mockReturnValue({ mutateAsync, isPending: false } as never);
    vi.mocked(useRumbleAccountsQuery, { partial: true }).mockReturnValue({
      data: { authenticated: true, accounts: [{ provider: 'rumble', recordId: 'r1', providerAccountId: 'chan-1', accountName: 'My Channel', connectedAt: 0, lastUsed: 0 }] },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    render(<AccountsPage />, { wrapper: createWrapper() });
    fireEvent.click(screen.getByTestId('rumble-disconnect-button'));
    await screen.findByTestId('disconnect-dialog');
    fireEvent.click(screen.getByTestId('disconnect-confirm-button'));
    await waitFor(() => expect(reportAccountDisconnectFailed).toHaveBeenCalledWith('rumble', 'rejected'));
  });
});

describe('error state wiring — broken cards offer reconnect, healthy cards keep trash', () => {
  function sectionByLabel(labelKey: string): HTMLElement {
    const section = screen.getByText(labelKey).closest('section');
    if (!section) throw new Error(`missing section ${labelKey}`);
    return section;
  }

  function expectBrokenSection(section: HTMLElement, type: string): void {
    expect(within(section).getByTestId(`${type}-reconnect-button`)).toBeTruthy();
    expect(within(section).getByTestId(`${type}-disconnect-button`)).toBeTruthy();
    expect(within(section).getByText('accounts.accountWithIssue')).toBeTruthy();
  }

  function expectHealthySection(section: HTMLElement, type: string): void {
    expect(within(section).queryByTestId(`${type}-reconnect-button`)).toBeNull();
    expect(within(section).queryByText('accounts.accountWithIssue')).toBeNull();
    expect(within(section).queryByText('accounts.accountsWithIssues')).toBeNull();
  }

  interface OAuthSection {
    type: string;
    label: string;
    brokenName: string;
    healthyName: string;
    setAccounts: (which: 'broken' | 'healthy' | 'both') => void;
    armOAuth: () => ReturnType<typeof vi.fn>;
  }

  const youtubeStart = { fn: vi.fn() };
  const instagramStart = { fn: vi.fn() };
  const linkedinStart = { fn: vi.fn() };

  const oauthSections: OAuthSection[] = [
    {
      type: 'youtube',
      label: 'accounts.youtubeLabel',
      brokenName: 'Broken Channel',
      healthyName: 'OK Channel',
      setAccounts: (which) => {
        const broken = { provider: 'youtube', recordId: 'r-broken', channelId: 'ch-broken', channelName: 'Broken Channel', status: 'error', connectedAt: 0, lastUsed: 0 } as const;
        const healthy = { provider: 'youtube', recordId: 'r-ok', channelId: 'ch-ok', channelName: 'OK Channel', status: 'ok', connectedAt: 0, lastUsed: 0 } as const;
        const accounts = which === 'broken' ? [broken] : which === 'healthy' ? [healthy] : [broken, healthy];
        vi.mocked(useYouTubeAccountsQuery, { partial: true }).mockReturnValue({ data: { authenticated: true, accounts }, isLoading: false });
      },
      armOAuth: () => {
        youtubeStart.fn = vi.fn().mockResolvedValue(undefined);
        vi.mocked(useYouTubeOAuth).mockReturnValue({ startOAuth: youtubeStart.fn, isLoading: false, error: null });
        return youtubeStart.fn;
      },
    },
    {
      type: 'instagram',
      label: 'accounts.instagramLabel',
      brokenName: '@brokenuser',
      healthyName: '@okuser',
      setAccounts: (which) => {
        const broken = { provider: 'instagram', recordId: 'r-broken', igUserId: 'ig-broken', username: 'brokenuser', status: 'error', connectedAt: 0, lastUsed: 0 } as const;
        const healthy = { provider: 'instagram', recordId: 'r-ok', igUserId: 'ig-ok', username: 'okuser', status: 'ok', connectedAt: 0, lastUsed: 0 } as const;
        const accounts = which === 'broken' ? [broken] : which === 'healthy' ? [healthy] : [broken, healthy];
        vi.mocked(useInstagramAccountsQuery, { partial: true }).mockReturnValue({ data: { authenticated: true, accounts }, isLoading: false });
      },
      armOAuth: () => {
        instagramStart.fn = vi.fn().mockResolvedValue(undefined);
        vi.mocked(useInstagramOAuth).mockReturnValue({ startOAuth: instagramStart.fn, isLoading: false, error: null });
        return instagramStart.fn;
      },
    },
    {
      type: 'linkedin',
      label: 'accounts.linkedinLabel',
      brokenName: 'Broken Org',
      healthyName: 'OK Member',
      setAccounts: (which) => {
        const broken = { provider: 'linkedin', recordId: 'r-broken', providerAccountId: 'urn:li:organization:999', accountName: 'Broken Org', accountMetadata: { kind: 'organization', name: 'Broken Org' }, status: 'error', connectedAt: 0, lastUsed: 0 } as const;
        const healthy = { provider: 'linkedin', recordId: 'r-ok', providerAccountId: 'member-ok', accountName: 'OK Member', accountMetadata: { kind: 'member', name: 'OK Member' }, status: 'ok', connectedAt: 0, lastUsed: 0 } as const;
        const accounts = which === 'broken' ? [broken] : which === 'healthy' ? [healthy] : [broken, healthy];
        vi.mocked(useLinkedinAccountsQuery, { partial: true }).mockReturnValue({ data: { authenticated: true, accounts }, isLoading: false });
      },
      armOAuth: () => {
        linkedinStart.fn = vi.fn().mockResolvedValue(undefined);
        vi.mocked(useLinkedInOAuth).mockReturnValue({ startOAuth: linkedinStart.fn, isLoading: false, error: null });
        return linkedinStart.fn;
      },
    },
    {
      type: 'threads',
      label: 'accounts.threadsLabel',
      brokenName: 'broken',
      healthyName: 'ok',
      setAccounts: (which) => {
        const broken = { provider: 'threads', recordId: 'r-broken', providerAccountId: '42', accountName: 'broken', status: 'error', connectedAt: 0, lastUsed: 0 } as const;
        const healthy = { provider: 'threads', recordId: 'r-ok', providerAccountId: '43', accountName: 'ok', status: 'ok', connectedAt: 0, lastUsed: 0 } as const;
        const accounts = which === 'broken' ? [broken] : which === 'healthy' ? [healthy] : [broken, healthy];
        vi.mocked(useThreadsAccountsQuery, { partial: true }).mockReturnValue({ data: { authenticated: true, accounts }, isLoading: false, error: null, refetch: vi.fn() });
      },
      armOAuth: () => threadsOAuth.startOAuth,
    },
    {
      type: 'facebook',
      label: 'accounts.facebookLabel',
      brokenName: 'Broken Page',
      healthyName: 'OK Page',
      setAccounts: (which) => {
        const broken = { provider: 'facebook', recordId: 'r-broken', providerAccountId: '111', accountName: 'Broken Page', status: 'error', connectedAt: 0, lastUsed: 0 } as const;
        const healthy = { provider: 'facebook', recordId: 'r-ok', providerAccountId: '222', accountName: 'OK Page', status: 'ok', connectedAt: 0, lastUsed: 0 } as const;
        const accounts = which === 'broken' ? [broken] : which === 'healthy' ? [healthy] : [broken, healthy];
        vi.mocked(useFacebookAccountsQuery, { partial: true }).mockReturnValue({ data: { authenticated: true, accounts }, isLoading: false, error: null, refetch: vi.fn() });
      },
      armOAuth: () => facebookOAuth.startOAuth,
    },
    {
      type: 'pinterest',
      label: 'accounts.pinterestLabel',
      brokenName: 'Broken Pin',
      healthyName: 'OK Pin',
      setAccounts: (which) => {
        const broken = { provider: 'pinterest', recordId: 'r-broken', providerAccountId: 'p1', accountName: 'Broken Pin', status: 'error', connectedAt: 0, lastUsed: 0 } as const;
        const healthy = { provider: 'pinterest', recordId: 'r-ok', providerAccountId: 'p2', accountName: 'OK Pin', status: 'ok', connectedAt: 0, lastUsed: 0 } as const;
        const accounts = which === 'broken' ? [broken] : which === 'healthy' ? [healthy] : [broken, healthy];
        vi.mocked(usePinterestAccountsQuery, { partial: true }).mockReturnValue({ data: { authenticated: true, accounts }, isLoading: false, error: null, refetch: vi.fn() });
      },
      armOAuth: () => pinterestOAuth.startOAuth,
    },
    {
      type: 'fanvue',
      label: 'accounts.fanvueLabel',
      brokenName: 'Broken Fan',
      healthyName: 'OK Fan',
      setAccounts: (which) => {
        const broken = { provider: 'fanvue', recordId: 'r-broken', providerAccountId: 'f1', accountName: 'Broken Fan', status: 'error', connectedAt: 0, lastUsed: 0 } as const;
        const healthy = { provider: 'fanvue', recordId: 'r-ok', providerAccountId: 'f2', accountName: 'OK Fan', status: 'ok', connectedAt: 0, lastUsed: 0 } as const;
        const accounts = which === 'broken' ? [broken] : which === 'healthy' ? [healthy] : [broken, healthy];
        vi.mocked(useFanvueAccountsQuery, { partial: true }).mockReturnValue({ data: { authenticated: true, accounts }, isLoading: false, error: null, refetch: vi.fn() });
      },
      armOAuth: () => fanvueOAuth.startOAuth,
    },
  ];

  for (const section of oauthSections) {
    it(`${section.type}: broken card offers reconnect, healthy card keeps trash, pill shows`, () => {
      section.setAccounts('both');
      render(<AccountsPage />, { wrapper: createWrapper() });
      const el = sectionByLabel(section.label);
      expectBrokenSection(el, section.type);
      expect(within(el).getByText(section.brokenName)).toBeTruthy();
      expect(within(el).getByText(section.healthyName)).toBeTruthy();
    });

    it(`${section.type}: healthy-only section shows no pill and no reconnect`, () => {
      section.setAccounts('healthy');
      render(<AccountsPage />, { wrapper: createWrapper() });
      const el = sectionByLabel(section.label);
      expectHealthySection(el, section.type);
      expect(within(el).getAllByTestId(`${section.type}-disconnect-button`)).toHaveLength(1);
    });

    it(`${section.type}: reconnect starts OAuth`, () => {
      const startOAuth = section.armOAuth();
      section.setAccounts('broken');
      render(<AccountsPage />, { wrapper: createWrapper() });
      const el = sectionByLabel(section.label);
      fireEvent.click(within(el).getByTestId(`${section.type}-reconnect-button`));
      expect(startOAuth).toHaveBeenCalledTimes(1);
    });
  }

  it('youtube: selecting an account toggles it with the youtube provider id', () => {
    oauthSections[0].setAccounts('both');
    render(<AccountsPage />, { wrapper: createWrapper() });
    const el = sectionByLabel('accounts.youtubeLabel');
    fireEvent.click(within(el).getAllByTestId('account-card-select')[0]);
    expect(mockStoreState.toggleSelectedAccount).toHaveBeenCalledWith('youtube', 'ch-broken');
  });

  it('linkedin: reconnect on the org card still starts OAuth', () => {
    // The org row is the broken one here; the member row stays healthy.
    const section = oauthSections[2];
    const startOAuth = section.armOAuth();
    section.setAccounts('both');
    render(<AccountsPage />, { wrapper: createWrapper() });
    const el = sectionByLabel('accounts.linkedinLabel');
    expect(within(el).getByText('accounts.pageBadge')).toBeTruthy();
    expect(within(el).getByText('accounts.memberBadge')).toBeTruthy();
    fireEvent.click(within(el).getByTestId('linkedin-reconnect-button'));
    expect(startOAuth).toHaveBeenCalledTimes(1);
  });

  it('fanvue: marks a stored name or the account id on the card', () => {
    vi.mocked(useFanvueAccountsQuery, { partial: true }).mockReturnValue({
      data: {
        authenticated: true,
        accounts: [
          { provider: 'fanvue', recordId: 'r-1', providerAccountId: 'f1', accountName: 'My Fan', status: 'ok', connectedAt: 0, lastUsed: 0 },
          { provider: 'fanvue', recordId: 'r-2', providerAccountId: 'f2', accountName: null, status: 'ok', connectedAt: 0, lastUsed: 0 },
        ],
      },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    render(<AccountsPage />, { wrapper: createWrapper() });
    const el = sectionByLabel('accounts.fanvueLabel');
    const cards = within(el).getAllByTestId('account-card').filter((node) => node.getAttribute('data-provider') === 'fanvue');
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveAttribute('data-label-origin', 'stored');
    expect(cards[1]).toHaveAttribute('data-label-origin', 'provider_id');
    expect(within(el).getByText('f2')).toBeTruthy();
  });

  interface CredentialSection {
    type: string;
    label: string;
    inputTestId: string;
    prefilled: string;
    setAccounts: (which: 'broken' | 'healthy' | 'both') => void;
  }

  const credentialSections: CredentialSection[] = [
    {
      type: 'bluesky',
      label: 'accounts.blueskyLabel',
      inputTestId: 'bluesky-handle-input',
      prefilled: 'broken.bsky.social',
      setAccounts: (which) => {
        const broken = { provider: 'bluesky', recordId: 'r-broken', did: 'did:plc:broken', handle: 'broken.bsky.social', displayName: 'Broken', status: 'error', connectedAt: 0, lastUsed: 0 } as const;
        const healthy = { provider: 'bluesky', recordId: 'r-ok', did: 'did:plc:ok', handle: 'ok.bsky.social', status: 'ok', connectedAt: 0, lastUsed: 0 } as const;
        const accounts = which === 'broken' ? [broken] : which === 'healthy' ? [healthy] : [broken, healthy];
        vi.mocked(useBlueskyAccountsQuery, { partial: true }).mockReturnValue({ data: { authenticated: true, accounts }, isLoading: false });
      },
    },
    {
      type: 'rumble',
      label: 'accounts.rumbleLabel',
      inputTestId: 'rumble-handle-input',
      prefilled: 'chan-broken',
      setAccounts: (which) => {
        const broken = { provider: 'rumble', recordId: 'r-broken', providerAccountId: 'chan-broken', accountName: 'chan-broken', status: 'error', connectedAt: 0, lastUsed: 0 } as const;
        const healthy = { provider: 'rumble', recordId: 'r-ok', providerAccountId: 'chan-ok', accountName: 'chan-ok', status: 'ok', connectedAt: 0, lastUsed: 0 } as const;
        const accounts = which === 'broken' ? [broken] : which === 'healthy' ? [healthy] : [broken, healthy];
        vi.mocked(useRumbleAccountsQuery, { partial: true }).mockReturnValue({ data: { authenticated: true, accounts }, isLoading: false, error: null, refetch: vi.fn() });
      },
    },
    {
      type: '3speak',
      label: 'accounts.threespeakLabel',
      inputTestId: 'threespeak-handle-input',
      prefilled: 'broken-hive',
      setAccounts: (which) => {
        const broken = { provider: '3speak', recordId: 'r-broken', providerAccountId: 'broken-hive', accountName: 'Broken Hive', status: 'error', connectedAt: 0, lastUsed: 0 } as const;
        const healthy = { provider: '3speak', recordId: 'r-ok', providerAccountId: 'ok-hive', accountName: 'OK Hive', status: 'ok', connectedAt: 0, lastUsed: 0 } as const;
        const accounts = which === 'broken' ? [broken] : which === 'healthy' ? [healthy] : [broken, healthy];
        vi.mocked(useThreespeakAccountsQuery, { partial: true }).mockReturnValue({ data: { authenticated: true, accounts }, isLoading: false, error: null, refetch: vi.fn() });
      },
    },
  ];

  for (const section of credentialSections) {
    it(`${section.type}: broken card offers reconnect, healthy card keeps trash, pill shows`, () => {
      section.setAccounts('both');
      render(<AccountsPage />, { wrapper: createWrapper() });
      const el = sectionByLabel(section.label);
      expectBrokenSection(el, section.type);
    });

    it(`${section.type}: healthy-only section shows no pill and no reconnect`, () => {
      section.setAccounts('healthy');
      render(<AccountsPage />, { wrapper: createWrapper() });
      const el = sectionByLabel(section.label);
      expectHealthySection(el, section.type);
      expect(within(el).getAllByTestId(`${section.type}-disconnect-button`)).toHaveLength(1);
    });

    it(`${section.type}: reconnect reopens the dialog with the handle prefilled`, async () => {
      section.setAccounts('broken');
      render(<AccountsPage />, { wrapper: createWrapper() });
      const el = sectionByLabel(section.label);
      fireEvent.click(within(el).getByTestId(`${section.type}-reconnect-button`));
      const input = await screen.findByTestId(section.inputTestId);
      expect(input).toHaveValue(section.prefilled);
    });
  }

  it('3speak: marks a stored name or the Hive username on the card', () => {
    vi.mocked(useThreespeakAccountsQuery, { partial: true }).mockReturnValue({
      data: {
        authenticated: true,
        accounts: [
          { provider: '3speak', recordId: 'r-1', providerAccountId: 'alice', accountName: 'Alice in Hive', status: 'ok', connectedAt: 0, lastUsed: 0 },
          { provider: '3speak', recordId: 'r-2', providerAccountId: 'bob', accountName: null, status: 'ok', connectedAt: 0, lastUsed: 0 },
        ],
      },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    render(<AccountsPage />, { wrapper: createWrapper() });
    const el = sectionByLabel('accounts.threespeakLabel');
    const cards = within(el).getAllByTestId('account-card').filter((node) => node.getAttribute('data-provider') === '3speak');
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveAttribute('data-label-origin', 'stored');
    expect(cards[1]).toHaveAttribute('data-label-origin', 'provider_id');
    expect(within(el).getByText('bob')).toBeTruthy();
  });

  it('two broken accounts show the plural issue pill', () => {
    vi.mocked(useYouTubeAccountsQuery, { partial: true }).mockReturnValue({
      data: {
        authenticated: true,
        accounts: [
          { provider: 'youtube', recordId: 'r-1', channelId: 'ch-1', channelName: 'Ch 1', status: 'error', connectedAt: 0, lastUsed: 0 },
          { provider: 'youtube', recordId: 'r-2', channelId: 'ch-2', channelName: 'Ch 2', status: 'error', connectedAt: 0, lastUsed: 0 },
        ],
      },
      isLoading: false,
    });
    render(<AccountsPage />, { wrapper: createWrapper() });
    const el = sectionByLabel('accounts.youtubeLabel');
    expect(within(el).getByText('accounts.accountsWithIssues')).toBeTruthy();
    expect(within(el).queryByText('accounts.accountWithIssue')).toBeNull();
    expect(within(el).getAllByTestId('youtube-reconnect-button')).toHaveLength(2);
  });
});

describe('disconnect dialog names the account', () => {
  async function openDisconnect(buttonTestId: string): Promise<HTMLElement> {
    fireEvent.click(screen.getByTestId(buttonTestId));
    return screen.findByTestId('disconnect-dialog');
  }

  function dialogAccount(dialog: HTMLElement): string {
    return within(dialog).getByTestId('disconnect-dialog-account').textContent ?? '';
  }

  it('instagram: names the handle with @', async () => {
    vi.mocked(useInstagramAccountsQuery, { partial: true }).mockReturnValue({
      data: { authenticated: true, accounts: [{ provider: 'instagram', recordId: 'r1', igUserId: 'ig1', username: 'instauser', connectedAt: 0, lastUsed: 0 }] },
      isLoading: false,
    });
    render(<AccountsPage />, { wrapper: createWrapper() });
    const dialog = await openDisconnect('instagram-disconnect-button');
    expect(dialogAccount(dialog)).toBe('@instauser');
  });

  it('linkedin: names the member by name and the org by its id', async () => {
    vi.mocked(useLinkedinAccountsQuery, { partial: true }).mockReturnValue({
      data: {
        authenticated: true,
        accounts: [
          { provider: 'linkedin', recordId: 'r1', providerAccountId: 'member-123', accountName: 'Ryan Carlos', accountMetadata: { kind: 'member', name: 'Ryan Carlos' }, connectedAt: 0, lastUsed: 0 },
          { provider: 'linkedin', recordId: 'r2', providerAccountId: 'urn:li:organization:111', accountName: '', accountMetadata: { kind: 'organization', name: 'Company Inc' }, connectedAt: 0, lastUsed: 0 },
        ],
      },
      isLoading: false,
    });
    render(<AccountsPage />, { wrapper: createWrapper() });
    const buttons = screen.getAllByTestId('linkedin-disconnect-button');
    fireEvent.click(buttons[0]);
    expect(dialogAccount(await screen.findByTestId('disconnect-dialog'))).toBe('Ryan Carlos');
    fireEvent.click(screen.getByTestId('disconnect-cancel-button'));
    await waitFor(() => expect(screen.queryByTestId('disconnect-dialog')).not.toBeInTheDocument());
    fireEvent.click(buttons[1]);
    expect(dialogAccount(await screen.findByTestId('disconnect-dialog'))).toBe('urn:li:organization:111');
  });

  it('threads: names the account by its handle', async () => {
    vi.mocked(useThreadsAccountsQuery, { partial: true }).mockReturnValue({
      data: { authenticated: true, accounts: [{ provider: 'threads', recordId: 'r1', providerAccountId: '42', accountName: 'ana', connectedAt: 0, lastUsed: 0 }] },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    render(<AccountsPage />, { wrapper: createWrapper() });
    const dialog = await openDisconnect('threads-disconnect-button');
    expect(dialogAccount(dialog)).toBe('ana');
  });

  it('facebook: names the Page by its stored name', async () => {
    vi.mocked(useFacebookAccountsQuery, { partial: true }).mockReturnValue({
      data: { authenticated: true, accounts: [{ provider: 'facebook', recordId: 'r1', providerAccountId: '111', accountName: 'My Page', connectedAt: 0, lastUsed: 0 }] },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    render(<AccountsPage />, { wrapper: createWrapper() });
    const dialog = await openDisconnect('facebook-disconnect-button');
    expect(dialogAccount(dialog)).toBe('My Page');
  });

  it('pinterest: disconnects the account after confirmation', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({ success: true });
    vi.mocked(useDisconnectAccountMutation).mockReturnValue({ mutateAsync, isPending: false } as never);
    vi.mocked(usePinterestAccountsQuery, { partial: true }).mockReturnValue({
      data: { authenticated: true, accounts: [{ provider: 'pinterest', recordId: 'r1', providerAccountId: 'p1', accountName: 'My Pin', connectedAt: 0, lastUsed: 0 }] },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    render(<AccountsPage />, { wrapper: createWrapper() });
    const dialog = await openDisconnect('pinterest-disconnect-button');
    expect(dialogAccount(dialog)).toBe('My Pin');
    fireEvent.click(screen.getByTestId('disconnect-confirm-button'));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({ providerAccountId: 'p1' }));
    expect(useDisconnectAccountMutation).toHaveBeenCalledWith('pinterest');
  });

  it('fanvue: disconnects the account after confirmation', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({ success: true });
    vi.mocked(useDisconnectAccountMutation).mockReturnValue({ mutateAsync, isPending: false } as never);
    vi.mocked(useFanvueAccountsQuery, { partial: true }).mockReturnValue({
      data: { authenticated: true, accounts: [{ provider: 'fanvue', recordId: 'r1', providerAccountId: 'f1', accountName: 'My Fan', connectedAt: 0, lastUsed: 0 }] },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    render(<AccountsPage />, { wrapper: createWrapper() });
    const dialog = await openDisconnect('fanvue-disconnect-button');
    expect(dialogAccount(dialog)).toBe('My Fan');
    fireEvent.click(screen.getByTestId('disconnect-confirm-button'));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({ providerAccountId: 'f1' }));
    expect(useDisconnectAccountMutation).toHaveBeenCalledWith('fanvue');
  });

  it('bluesky: names the account by its display name', async () => {
    vi.mocked(useBlueskyAccountsQuery, { partial: true }).mockReturnValue({
      data: { authenticated: true, accounts: [{ provider: 'bluesky', recordId: 'r1', did: 'did:plc:a', handle: 'a.bsky.social', displayName: 'Habit Loom', connectedAt: 0, lastUsed: 0 }] },
      isLoading: false,
    });
    render(<AccountsPage />, { wrapper: createWrapper() });
    const dialog = await openDisconnect('bluesky-disconnect-button');
    expect(dialogAccount(dialog)).toBe('Habit Loom');
  });

  it('3speak: names the account by its stored name', async () => {
    vi.mocked(useThreespeakAccountsQuery, { partial: true }).mockReturnValue({
      data: { authenticated: true, accounts: [{ provider: '3speak', recordId: 'r1', providerAccountId: 'alice', accountName: 'Alice in Hive', connectedAt: 0, lastUsed: 0 }] },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    render(<AccountsPage />, { wrapper: createWrapper() });
    const dialog = await openDisconnect('3speak-disconnect-button');
    expect(dialogAccount(dialog)).toBe('Alice in Hive');
  });
});
