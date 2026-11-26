import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const navigation = vi.hoisted(() => ({ back: vi.fn(), push: vi.fn() }));
const searchParams = vi.hoisted(() => ({ value: new URLSearchParams() }));
const pathname = vi.hoisted(() => ({ value: '/persona' }));
vi.mock('next/image', () => ({
  default: ({ alt, ...props }: React.ComponentProps<'img'>) => <img alt={alt} {...props} />,
}));

vi.mock('next/navigation', () => ({
  usePathname: () => pathname.value,
  useRouter: () => navigation,
  useSearchParams: () => searchParams.value,
}));

vi.mock('@/lib/scroll-to-error', () => ({
  scrollToErrorField: vi.fn(),
}));

vi.mock('@/lib/session-expiry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/session-expiry')>();
  return {
    ...actual,
    notifyIfSessionExpired: vi.fn(),
  };
});

vi.mock('@/lib/api', () => ({
  createPersona: vi.fn(),
  useUpdatePersonaMutation: vi.fn(),
  usePersonaListQuery: vi.fn(),
  useSchedulesQuery: vi.fn(),
  useYouTubeAccountsQuery: vi.fn(),
  useInstagramAccountsQuery: vi.fn(),
  useBlueskyAccountsQuery: vi.fn(),
  useLinkedinAccountsQuery: vi.fn(),
  useThreadsAccountsQuery: vi.fn(() => ({ data: { authenticated: true, accounts: [] }, isLoading: false, error: null })),
  useFacebookAccountsQuery: vi.fn(() => ({ data: { authenticated: true, accounts: [] }, isLoading: false, error: null })),
  useThreespeakAccountsQuery: vi.fn(() => ({ data: { authenticated: true, accounts: [] }, isLoading: false, error: null })),
}));

vi.mock('@/lib/social-accounts-queries', () => ({
  useRumbleAccountsQuery: vi.fn(() => ({ data: { authenticated: true, accounts: [] }, isLoading: false, error: null })),
  useTelegramAccountsQuery: vi.fn(() => ({ data: { authenticated: true, accounts: [] }, isLoading: false, error: null })),
}));

vi.mock('@/lib/pinterest-accounts', () => ({
  usePinterestAccountsQuery: vi.fn(() => ({ data: { authenticated: true, accounts: [] }, isLoading: false, error: null })),
}));

vi.mock('@/lib/fanvue-accounts', () => ({
  useFanvueAccountsQuery: vi.fn(() => ({ data: { authenticated: true, accounts: [] }, isLoading: false, error: null })),
}));

vi.mock('@/lib/ui', () => ({
  AlertIcon: () => <span data-testid="icon-alert" />,
  CheckIcon: () => <span data-testid="icon-check" />,
  ImageIcon: () => <span data-testid="icon-image" />,
  UploadIcon: () => <span data-testid="icon-upload" />,
  SpinnerIcon: () => <span data-testid="icon-spinner" />,
  SparklesIcon: () => <span data-testid="icon-sparkles" />,
  SECTION_LABEL_CLASS: '',
  INPUT_CLASS: '',
  formatFileSize: (v: number) => `${v} B`,
}));

vi.mock('@/lib/i18n/provider', () => {
  const t = (key: string) => key;
  function I18nProvider({ children }: { children: ReactNode }) {
    return <>{children}</>;
  }
  I18nProvider.displayName = 'I18nProvider';
  const useI18n = vi.fn(() => ({ t, locale: 'pt', setLocale: vi.fn() }));
  return {
    useI18n,
    I18nProvider,
  };
});

import PersonaPage from '../page';
import { createPersona, useUpdatePersonaMutation, usePersonaListQuery, useSchedulesQuery, useYouTubeAccountsQuery, useInstagramAccountsQuery, useBlueskyAccountsQuery, useLinkedinAccountsQuery } from '@/lib/api';
import type { AccountData } from '@/lib/types';
import { I18nProvider, useI18n } from '@/lib/i18n/provider';
import { usePersonaStore } from '@/lib/store';
import { emptyPersonaDefaultAccounts } from '@/lib/persona-publishing-accounts';

function createWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <I18nProvider>{children}</I18nProvider>
      </QueryClientProvider>
    );
  }
  Wrapper.displayName = 'PersonaWrapper';
  return Wrapper;
}

const YOUTUBE_ACCOUNTS: AccountData[] = [
  { provider: 'youtube', recordId: 'yt-record', channelId: 'yt-1', channelName: 'Meu canal', connectedAt: 0, lastUsed: 0 },
];

function mockAccounts(youtube: AccountData[]) {
  vi.mocked(useYouTubeAccountsQuery, { partial: true }).mockReturnValue({ data: { authenticated: true, accounts: youtube }, isLoading: false });
  vi.mocked(useInstagramAccountsQuery, { partial: true }).mockReturnValue({ data: { authenticated: true, accounts: [] }, isLoading: false });
  vi.mocked(useBlueskyAccountsQuery, { partial: true }).mockReturnValue({ data: { authenticated: true, accounts: [] }, isLoading: false });
  vi.mocked(useLinkedinAccountsQuery, { partial: true }).mockReturnValue({ data: { authenticated: true, accounts: [] }, isLoading: false });
}

function seedBoundAccount() {
  usePersonaStore.getState().setPublishingAccounts({ ...emptyPersonaDefaultAccounts(), youtube: ['yt-1'] });
}

function renderPage() {
  return render(<PersonaPage />, { wrapper: createWrapper() });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, defaults: emptyPersonaDefaultAccounts(), card: null }),
    }),
  );
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake-photo');
  URL.revokeObjectURL = vi.fn();
  vi.mocked(useI18n).mockReturnValue({ t: (key: string) => key, locale: 'pt', setLocale: vi.fn() });
  usePersonaStore.getState().resetForm();
  searchParams.value = new URLSearchParams();
  pathname.value = '/persona';
  vi.mocked(createPersona).mockResolvedValue({ success: true, personaId: 'p-1' } as never);
  vi.mocked(useSchedulesQuery).mockReturnValue({ data: [], isLoading: false } as never);
  vi.mocked(useUpdatePersonaMutation).mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as never);
  vi.mocked(usePersonaListQuery).mockReturnValue({ data: [], isLoading: false, isPending: false, isError: false } as never);
  mockAccounts(YOUTUBE_ACCOUNTS);
});

describe('app/(main)/persona/page — create', () => {
  it('renders the header, the name field, the photo picker and the account binding, with no voice or generation fields', () => {
    renderPage();
    expect(screen.getByText('persona.title')).toBeInTheDocument();
    expect(screen.getByLabelText('persona.name')).toBeInTheDocument();
    expect(screen.getAllByText('persona.photoLabel').length).toBeGreaterThan(0);
    expect(screen.getByText('persona.photoHint')).toBeInTheDocument();
    expect(screen.queryByText(/voice/i)).toBeNull();
    expect(screen.queryByText(/niche/i)).toBeNull();
  });

  it('submit without a name shows the name error and creates nothing', async () => {
    const user = userEvent.setup();
    seedBoundAccount();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'persona.submit' }));
    await waitFor(() => expect(screen.getAllByText('persona.errName').length).toBeGreaterThan(0));
    expect(createPersona).not.toHaveBeenCalled();
  });

  it('submit without a bound account shows the binding error and creates nothing', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText('persona.name'), 'Ana');
    await user.click(screen.getByRole('button', { name: 'persona.submit' }));
    await waitFor(() => expect(usePersonaStore.getState().result?.error).toBe('publishing.mustSelectAccount'));
    expect(createPersona).not.toHaveBeenCalled();
  });

  it('a valid submit creates the persona with the name and the binding, then goes to the list', async () => {
    const user = userEvent.setup();
    renderPage();
    act(() => seedBoundAccount());
    await user.type(screen.getByLabelText('persona.name'), 'Ana');
    await user.click(screen.getByRole('button', { name: 'persona.submit' }));
    await waitFor(() => expect(createPersona).toHaveBeenCalledTimes(1));
    const formData = vi.mocked(createPersona).mock.calls[0]?.[0] as FormData;
    expect(formData.get('name')).toBe('Ana');
    expect(JSON.parse(String(formData.get('publishingAccounts')))).toMatchObject({ youtube: ['yt-1'] });
    expect(formData.has('voiceId')).toBe(false);
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith('/personas'));
  });

  it('a server rejection shows the error dialog', async () => {
    const user = userEvent.setup();
    vi.mocked(createPersona).mockResolvedValue({ success: false, error: 'Failed to create persona.' } as never);
    renderPage();
    act(() => seedBoundAccount());
    await user.type(screen.getByLabelText('persona.name'), 'Ana');
    await user.click(screen.getByRole('button', { name: 'persona.submit' }));
    await waitFor(() => expect(screen.getByText('Failed to create persona.')).toBeInTheDocument());
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it('a network failure shows errServer', async () => {
    const user = userEvent.setup();
    vi.mocked(createPersona).mockRejectedValue(new TypeError('Failed to fetch'));
    renderPage();
    act(() => seedBoundAccount());
    await user.type(screen.getByLabelText('persona.name'), 'Ana');
    await user.click(screen.getByRole('button', { name: 'persona.submit' }));
    await waitFor(() => expect(usePersonaStore.getState().result?.error).toBe('persona.errServer'));
  });

  it('shows an error page with a retry when the persona list fails to load', async () => {
    const refetch = vi.fn();
    vi.mocked(usePersonaListQuery).mockReturnValue({ data: undefined, isError: true, isFetching: false, isPending: false, refetch } as never);
    const user = userEvent.setup();
    renderPage();
    expect(screen.getByText('persona.loadError')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'persona.tryAgain' }));
    expect(refetch).toHaveBeenCalled();
  });
});

describe('app/(main)/persona/page — edit', () => {
  beforeEach(() => {
    searchParams.value = new URLSearchParams('edit=p-1');
    vi.mocked(usePersonaListQuery).mockReturnValue({
      data: [{ id: 'p-1', name: 'Ana', createdAt: '2026-01-01T00:00:00Z', photoUrl: 'https://x.test/p.png' }],
      isLoading: false,
      isPending: false,
      isError: false,
    } as never);
  });

  it('loads the persona into the form and shows the edit header and save button', async () => {
    renderPage();
    await waitFor(() => expect(usePersonaStore.getState().name).toBe('Ana'));
    expect(usePersonaStore.getState().storedPhotoUrl).toBe('https://x.test/p.png');
    expect(screen.getByText('personas.editTitle')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'personas.save' })).toBeInTheDocument();
  });

  it('saves through the update mutation, never the create POST', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({ success: true });
    vi.mocked(useUpdatePersonaMutation).mockReturnValue({ mutateAsync, isPending: false } as never);
    usePersonaStore.getState().setLoadedPublishingAccounts({ ...emptyPersonaDefaultAccounts(), youtube: ['yt-1'] });
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(usePersonaStore.getState().name).toBe('Ana'));
    seedBoundAccount();
    usePersonaStore.getState().setLoadedPublishingAccounts({ ...emptyPersonaDefaultAccounts(), youtube: ['yt-1'] });
    usePersonaStore.getState().setPublishingAccountsLoaded(true);
    await user.click(await screen.findByRole('button', { name: 'personas.save' }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync.mock.calls[0]?.[0]).toMatchObject({ personaId: 'p-1' });
    expect(createPersona).not.toHaveBeenCalled();
  });
});
