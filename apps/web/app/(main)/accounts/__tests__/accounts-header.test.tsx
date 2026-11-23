import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/lib/i18n/provider', () => {
  const t = (key: string) => key;
  return { useI18n: () => ({ t, locale: 'pt', setLocale: vi.fn() }) };
});

vi.mock('@/lib/session-expiry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/session-expiry')>()),
  notifyIfSessionExpired: vi.fn(),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

import { AccountsHeader } from '../accounts-header';

type FetchReply = { ok: boolean; status: number; json: () => Promise<unknown> };
const fetchMock = vi.fn<(url: string) => Promise<FetchReply>>();

function reply(status: number, body: unknown): FetchReply {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function renderHeader(): QueryClient {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  queryClient.setQueryData(['social-accounts'], { authenticated: true, accounts: [] });
  render(
    <QueryClientProvider client={queryClient}>
      <AccountsHeader />
    </QueryClientProvider>,
  );
  return queryClient;
}

function button(): HTMLElement {
  return screen.getByTestId('accounts-refresh-profiles');
}

describe('AccountsHeader refresh button', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the title and an enabled refresh button with no status text', () => {
    renderHeader();
    expect(screen.getByRole('heading', { name: 'accounts.title' })).toBeInTheDocument();
    expect(button()).toBeEnabled();
    expect(button()).toHaveTextContent('accounts.refreshProfiles');
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('disables the button while the refresh is pending', async () => {
    let resolve: (value: FetchReply) => void = () => {};
    fetchMock.mockReturnValue(new Promise((r) => { resolve = r; }));
    renderHeader();
    fireEvent.click(button());
    await waitFor(() => expect(button()).toBeDisabled());
    expect(button()).toHaveTextContent('accounts.refreshingProfiles');
    resolve(reply(200, { authenticated: true, accounts: [] }));
    await waitFor(() => expect(button()).toBeEnabled());
  });

  it('writes the refreshed accounts into the shared social-accounts cache on success', async () => {
    const payload = { authenticated: true, accounts: [{ provider: 'instagram', recordId: 'r1' }] };
    fetchMock.mockResolvedValue(reply(200, payload));
    const queryClient = renderHeader();
    fireEvent.click(button());
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('accounts.refreshProfilesDone'));
    expect(queryClient.getQueryData(['social-accounts'])).toEqual(payload);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/account?refresh=1');
  });

  it('shows the localized error and keeps the cached accounts when the refresh fails', async () => {
    fetchMock.mockResolvedValue(reply(429, { errorType: 'RATE_LIMITED' }));
    const queryClient = renderHeader();
    fireEvent.click(button());
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('accounts.refreshProfilesError'));
    expect(screen.queryByText('HTTP_429')).not.toBeInTheDocument();
    expect(queryClient.getQueryData(['social-accounts'])).toEqual({ authenticated: true, accounts: [] });
    expect(button()).toBeEnabled();
  });

  it('shows the localized error, never the raw transport message, when the request fails', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    renderHeader();
    fireEvent.click(button());
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('accounts.refreshProfilesError'));
    expect(screen.queryByText('Failed to fetch')).not.toBeInTheDocument();
  });
});
