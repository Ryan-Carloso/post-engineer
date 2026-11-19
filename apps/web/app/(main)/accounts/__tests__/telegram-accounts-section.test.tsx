import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/lib/account-card-telemetry', () => ({
  reportAccountDisconnectFailed: vi.fn(),
  reportAccountCardDisplay: vi.fn(),
  useAccountListErrorTelemetry: vi.fn(),
}));

vi.mock('@/lib/i18n/provider', () => {
  const t = (key: string) => key;
  return { useI18n: () => ({ t, locale: 'pt', setLocale: vi.fn() }) };
});

vi.mock('@/lib/api', () => ({
  useDisconnectAccountMutation: vi.fn(() => ({ mutateAsync: vi.fn().mockResolvedValue({ success: true }), isPending: false })),
}));

vi.mock('@/lib/social-accounts-queries', () => ({
  useTelegramAccountsQuery: vi.fn(),
}));

vi.mock('@/lib/session-expiry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/session-expiry')>()),
  notifyIfSessionExpired: vi.fn(),
}));

import { TelegramAccountsSection } from '../telegram-accounts-section';
import { useTelegramAccountsQuery } from '@/lib/social-accounts-queries';
import { notifyIfSessionExpired } from '@/lib/session-expiry';

const TOKEN = `123456789:${'A'.repeat(35)}`;
const refetch = vi.fn();

function accounts(list: Array<Record<string, unknown>>): void {
  vi.mocked(useTelegramAccountsQuery, { partial: true }).mockReturnValue({
    data: { authenticated: true, accounts: list as never },
    isLoading: false,
    error: null,
    refetch,
  });
}

function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function openAndFill(chatId = '@news'): void {
  fireEvent.click(screen.getByRole('button', { name: 'accounts.connectFirst' }));
  fireEvent.change(screen.getByTestId('telegram-handle-input'), { target: { value: `  ${chatId}  ` } });
  fireEvent.change(screen.getByTestId('telegram-password-input'), { target: { value: TOKEN } });
}

beforeEach(() => {
  vi.clearAllMocks();
  accounts([]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TelegramAccountsSection', () => {
  it('opens the connect dialog with the channel setup guide by default', () => {
    render(<TelegramAccountsSection />);
    expect(screen.getByText('accounts.telegramLabel')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'accounts.connectFirst' }));
    expect(screen.getByRole('dialog')).toHaveAccessibleName('accounts.telegramConnectTitle');
    expect(screen.getByTestId('telegram-kind-channel')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('accounts.telegramSetupBotFather')).toBeInTheDocument();
    expect(screen.getByText('accounts.telegramSetupAddChannel')).toBeInTheDocument();
    expect(screen.queryByText('accounts.telegramSetupAddGroup')).not.toBeInTheDocument();
    expect(screen.getByText('accounts.telegramSetupChatId')).toBeInTheDocument();
  });

  it('switches the guide to the group steps when Group is picked', () => {
    render(<TelegramAccountsSection />);
    fireEvent.click(screen.getByRole('button', { name: 'accounts.connectFirst' }));
    fireEvent.click(screen.getByTestId('telegram-kind-group'));
    expect(screen.getByTestId('telegram-kind-group')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('telegram-kind-channel')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('accounts.telegramSetupAddGroup')).toBeInTheDocument();
    expect(screen.queryByText('accounts.telegramSetupAddChannel')).not.toBeInTheDocument();
  });

  it('keeps the connect button disabled until both fields are non-blank', () => {
    render(<TelegramAccountsSection />);
    fireEvent.click(screen.getByRole('button', { name: 'accounts.connectFirst' }));
    expect(screen.getByTestId('telegram-connect-button')).toBeDisabled();
    fireEvent.change(screen.getByTestId('telegram-handle-input'), { target: { value: '@news' } });
    expect(screen.getByTestId('telegram-connect-button')).toBeDisabled();
    fireEvent.change(screen.getByTestId('telegram-password-input'), { target: { value: '   ' } });
    expect(screen.getByTestId('telegram-connect-button')).toBeDisabled();
  });

  it('posts the trimmed chat, the token and the picked kind, then closes and refetches', async () => {
    const fetchMock = stubFetch(200, { success: true });
    render(<TelegramAccountsSection />);
    openAndFill();
    fireEvent.click(screen.getByTestId('telegram-kind-group'));
    fireEvent.click(screen.getByTestId('telegram-connect-button'));
    await waitFor(() => expect(refetch).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/telegram-connect');
    const body = init.body;
    if (!(body instanceof FormData)) throw new Error('expected a form body');
    expect(body.get('chatId')).toBe('@news');
    expect(body.get('botToken')).toBe(TOKEN);
    expect(body.get('chatType')).toBe('group');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it.each([
    ['TELEGRAM_TOKEN_REJECTED', 'channel', 'accounts.telegramErrorToken'],
    ['TELEGRAM_CHAT_NOT_FOUND', 'channel', 'accounts.telegramErrorChatNotFound'],
    ['TELEGRAM_CHAT_KIND_MISMATCH', 'channel', 'accounts.telegramErrorIsGroup'],
    ['TELEGRAM_CHAT_KIND_MISMATCH', 'group', 'accounts.telegramErrorIsChannel'],
    ['TELEGRAM_BOT_NOT_MEMBER', 'channel', 'accounts.telegramErrorNotMember'],
    ['TELEGRAM_BOT_CANNOT_POST', 'channel', 'accounts.telegramErrorCannotPost'],
    ['SOMETHING_ELSE', 'channel', 'accounts.telegramConnectError'],
  ])('names the fix for %s (picked %s) and clears the token', async (code, kind, key) => {
    stubFetch(400, { success: false, code });
    render(<TelegramAccountsSection />);
    openAndFill();
    if (kind === 'group') fireEvent.click(screen.getByTestId('telegram-kind-group'));
    fireEvent.click(screen.getByTestId('telegram-connect-button'));
    expect(await screen.findByTestId('telegram-connect-error')).toHaveTextContent(key);
    expect(screen.getByTestId('telegram-password-input')).toHaveValue('');
    expect(refetch).not.toHaveBeenCalled();
  });

  it('shows the generic error for a non-JSON failure body and reports a dead hub session', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 401, json: async () => { throw new Error('html'); } }));
    vi.stubGlobal('fetch', fetchMock);
    render(<TelegramAccountsSection />);
    openAndFill();
    fireEvent.click(screen.getByTestId('telegram-connect-button'));
    expect(await screen.findByTestId('telegram-connect-error')).toHaveTextContent('accounts.telegramConnectError');
    expect(notifyIfSessionExpired).toHaveBeenCalledWith(expect.objectContaining({ status: 401 }));
  });

  it('shows the generic error when the request throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    render(<TelegramAccountsSection />);
    openAndFill();
    fireEvent.click(screen.getByTestId('telegram-connect-button'));
    expect(await screen.findByTestId('telegram-connect-error')).toHaveTextContent('accounts.telegramConnectError');
  });

  it('lists each chat with its kind badge and reconnects with the stored chat and kind', () => {
    accounts([
      { provider: 'telegram', recordId: 'r1', providerAccountId: '-1001', accountName: 'News', chatType: 'channel', connectedAt: 0, lastUsed: 0 },
      { provider: 'telegram', recordId: 'r2', providerAccountId: '-1002', accountName: null, chatType: 'supergroup', connectedAt: 0, lastUsed: 0, status: 'error' },
    ]);
    render(<TelegramAccountsSection />);
    expect(screen.getByText('News')).toBeInTheDocument();
    expect(screen.getByText('-1002')).toBeInTheDocument();
    expect(screen.getByText('accounts.telegramChannelBadge')).toBeInTheDocument();
    expect(screen.getByText('accounts.telegramGroupBadge')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /reconnect/i }));
    expect(screen.getByTestId('telegram-handle-input')).toHaveValue('-1002');
    expect(screen.getByTestId('telegram-kind-group')).toHaveAttribute('aria-checked', 'true');
  });
});
