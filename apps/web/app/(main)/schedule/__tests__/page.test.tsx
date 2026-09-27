import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const navigation = vi.hoisted(() => ({ push: vi.fn() }));
const searchParams = vi.hoisted(() => ({ value: new URLSearchParams() }));

vi.mock('next/navigation', () => ({
  usePathname: () => '/schedule',
  useRouter: () => navigation,
  useSearchParams: () => searchParams.value,
}));

//---------------
// Schedule page creation tests (autofill for persona
// existente). Rede (lib/api) mockada; resto real.
//---------------

vi.mock('@/lib/api', () => ({
  ScheduleError: class ScheduleError extends Error {
    constructor(public status: number, message: string) {
      super(message);
      this.name = 'ScheduleError';
    }
  },
  usePersonaListQuery: vi.fn(),
  useSchedulesQuery: vi.fn(),
  createSchedule: vi.fn(),
  useYouTubeAccountsQuery: vi.fn(),
  useInstagramAccountsQuery: vi.fn(),
  useLinkedinAccountsQuery: vi.fn(),
}));

vi.mock('@/lib/ui', () => ({
  CheckIcon: () => <span data-testid="icon-check" />,
  SpinnerIcon: () => <span data-testid="icon-spinner" />,
  SparklesIcon: () => <span data-testid="icon-sparkles" />,
  SECTION_LABEL_CLASS: '',
  INPUT_CLASS: '',
}));

vi.mock('@/lib/i18n/provider', () => {
  function I18nProvider({ children }: { children: ReactNode }) {
    return <>{children}</>;
  }
  I18nProvider.displayName = 'I18nProvider';
  const useI18n = vi.fn(() => ({ t: (key: string) => key, locale: 'pt', setLocale: vi.fn() }));
  return { useI18n, I18nProvider };
});

import SchedulePage from '../page';
import {
  usePersonaListQuery,
  useSchedulesQuery,
  createSchedule,
  ScheduleError,
  useYouTubeAccountsQuery,
  useInstagramAccountsQuery,
  useLinkedinAccountsQuery,
} from '@/lib/api';
import type { AccountData, InstagramAccountData } from '@/lib/types';
import type { LinkedinAccountData } from '@/lib/providers/registry';
import type { PersonaRecord } from '@/lib/api';
import { I18nProvider } from '@/lib/i18n/provider';

function createWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <I18nProvider>{children}</I18nProvider>
      </QueryClientProvider>
    );
  }
  Wrapper.displayName = 'ScheduleWrapper';
  return Wrapper;
}

const PERSONAS: PersonaRecord[] = [
  { id: 'p-1', name: 'Ana Voyeur', createdAt: '2026-01-01' },
  { id: 'p-2', name: 'Canal Ninja', createdAt: '2026-01-02' },
];

const YOUTUBE_ACCOUNTS: AccountData[] = [
  { provider: 'youtube', recordId: 'yt-record', channelId: 'yt-1', channelName: 'Meu canal', connectedAt: 0, lastUsed: 0 },
];

const INSTAGRAM_ACCOUNTS: InstagramAccountData[] = [
  { provider: 'instagram', recordId: 'ig-record', igUserId: 'ig-1', username: 'meu.user', connectedAt: 0, lastUsed: 0 },
];

const LINKEDIN_ACCOUNTS: LinkedinAccountData[] = [
  { provider: 'linkedin', recordId: 'li-record', providerAccountId: 'urn:li:person:1', accountName: 'Ryan Pessoa', accountMetadata: { kind: 'member' }, connectedAt: 0, lastUsed: 0 },
];

function mockReady({ personas = PERSONAS, scheduledIds = [] as string[] } = {}) {
  vi.mocked(usePersonaListQuery).mockReturnValue({ data: personas, isLoading: false } as never);
  vi.mocked(useSchedulesQuery).mockReturnValue({
    data: scheduledIds.map((personaId) => ({ id: `s-${personaId}`, personaId })),
    isLoading: false,
  } as never);
  vi.mocked(useYouTubeAccountsQuery).mockReturnValue({
    data: { authenticated: true, accounts: YOUTUBE_ACCOUNTS },
    isLoading: false,
  } as never);
  vi.mocked(useInstagramAccountsQuery).mockReturnValue({
    data: { authenticated: true, accounts: INSTAGRAM_ACCOUNTS },
    isLoading: false,
  } as never);
  vi.mocked(useLinkedinAccountsQuery).mockReturnValue({
    data: { authenticated: true, accounts: LINKEDIN_ACCOUNTS },
    isLoading: false,
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  searchParams.value = new URLSearchParams();
  vi.mocked(createSchedule).mockResolvedValue(undefined as never);
  mockReady();
});

describe('SchedulePage — schedule creation', () => {
  it('renders title and existing-persona selector', () => {
    render(<SchedulePage />, { wrapper: createWrapper() });

    expect(screen.getByRole('heading', { name: 'fillSchedule.title' })).toBeInTheDocument();
    expect(screen.getByLabelText('fillSchedule.personaLabel')).toBeInTheDocument();
    const personaSelect = screen.getByLabelText('fillSchedule.personaLabel');
    expect(within(personaSelect).getByRole('option', { name: 'Ana Voyeur' })).toBeInTheDocument();
    expect(within(personaSelect).getByRole('option', { name: 'Canal Ninja' })).toBeInTheDocument();
  });

  it('pre-selects the persona coming from ?personaId=', () => {
    searchParams.value = new URLSearchParams('personaId=p-2');
    render(<SchedulePage />, { wrapper: createWrapper() });

    expect(
      (screen.getByLabelText('fillSchedule.personaLabel') as HTMLSelectElement).value,
    ).toBe('p-2');
  });

  it('scheduled persona disappears from the selector; only free ones stay available', () => {
    mockReady({ scheduledIds: ['p-2'] });
    render(<SchedulePage />, { wrapper: createWrapper() });

    const selector = screen.getByLabelText('fillSchedule.personaLabel') as HTMLSelectElement;
    const options = [...selector.options].map((option) => option.value);
    expect(options).toContain('p-1');
    expect(options).not.toContain('p-2');
    expect(screen.getByRole('button', { name: 'fillSchedule.activate' })).toBeEnabled();
  });

  it('all personas scheduled: shows empty without the accounts form', () => {
    mockReady({ scheduledIds: ['p-1', 'p-2'] });
    render(<SchedulePage />, { wrapper: createWrapper() });

    expect(screen.getByText('fillSchedule.allScheduled')).toBeInTheDocument();
    expect(screen.queryByTitle('Meu canal')).toBeNull();
  });

  it('sem contas conectadas mostra CTA para conectar em vez dos pickers', () => {
    vi.mocked(useYouTubeAccountsQuery).mockReturnValue({ data: { authenticated: true, accounts: [] }, isLoading: false } as never);
    vi.mocked(useInstagramAccountsQuery).mockReturnValue({ data: { authenticated: true, accounts: [] }, isLoading: false } as never);
    vi.mocked(useLinkedinAccountsQuery).mockReturnValue({ data: { authenticated: true, accounts: [] }, isLoading: false } as never);
    render(<SchedulePage />, { wrapper: createWrapper() });

    expect(screen.getByText('fillSchedule.noAccountsHint')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'fillSchedule.noAccountsCta' })).toHaveAttribute('href', '/accounts');
  });

  it('submit without a selected persona shows an error and does not send', async () => {
    const user = userEvent.setup();
    render(<SchedulePage />, { wrapper: createWrapper() });

    await user.click(screen.getByRole('button', { name: 'fillSchedule.activate' }));

    expect(screen.getByText('fillSchedule.needPersona')).toBeInTheDocument();
    expect(createSchedule).not.toHaveBeenCalled();
  });

  it('submit without a selected account shows an error and does not send', async () => {
    const user = userEvent.setup();
    render(<SchedulePage />, { wrapper: createWrapper() });

    await user.selectOptions(screen.getByLabelText('fillSchedule.personaLabel'), 'p-1');
    await user.click(screen.getByRole('button', { name: 'fillSchedule.activate' }));

    expect(screen.getByText('fillSchedule.mustSelectAccount')).toBeInTheDocument();
    expect(createSchedule).not.toHaveBeenCalled();
  });

  it('modo recorrente: submit envia personaId, contas, dias, janela derivada e timezone', async () => {
    const user = userEvent.setup();
    render(<SchedulePage />, { wrapper: createWrapper() });

    await user.selectOptions(screen.getByLabelText('fillSchedule.personaLabel'), 'p-1');
    await user.click(screen.getByTitle('Meu canal'));
    for (const day of [0, 1, 2, 4, 5, 6]) {
      await user.click(screen.getByRole('button', { name: `fillSchedule.day${day}` }));
    }
    await user.click(screen.getByRole('button', { name: 'fillSchedule.activate' }));

    await waitFor(() => expect(createSchedule).toHaveBeenCalledTimes(1));
    expect(vi.mocked(createSchedule).mock.calls[0][0]).toMatchObject({
      personaId: 'p-1',
      youtubeAccountIds: ['yt-1'],
      instagramAccountIds: [],
      linkedinAccountIds: [],
      daysOfWeek: [3],
      times: ['09:00'],
    });
  });

  it('one-off mode: sends scheduledAt as ISO with the device offset (not a local string)', async () => {
    const user = userEvent.setup();
    render(<SchedulePage />, { wrapper: createWrapper() });

    await user.selectOptions(screen.getByLabelText('fillSchedule.personaLabel'), 'p-1');
    await user.click(screen.getByRole('radio', { name: 'fillSchedule.oneOff' }));
    const when = new Date();
    when.setDate(when.getDate() + 3);
    const dateStr = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, '0')}-${String(when.getDate()).padStart(2, '0')}`;
    fireEvent.change(screen.getByLabelText('fillSchedule.oneOffDate'), { target: { value: dateStr } });
    fireEvent.change(screen.getByLabelText('fillSchedule.oneOffTime'), { target: { value: '15:30' } });
    await user.click(screen.getByTitle('Meu canal'));
    await user.click(screen.getByRole('button', { name: 'fillSchedule.activate' }));

    await waitFor(() => expect(createSchedule).toHaveBeenCalledTimes(1));
    const payload = vi.mocked(createSchedule).mock.calls[0][0] as unknown as Record<string, unknown>;
    const scheduledAt = String(payload.scheduledAt);
    // Full ISO-8601 with timezone (Z or ±HH:MM)
    expect(scheduledAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/);
    // O instante representa 15:30 no fuso local do dispositivo
    const parsed = new Date(scheduledAt);
    expect(parsed.getHours()).toBe(15);
    expect(parsed.getMinutes()).toBe(30);
    expect(payload.daysOfWeek).toEqual([]);
    expect(payload.youtubeAccountIds).toEqual(['yt-1']);
  });

  it('recurring mode with all times cleared shows an error and does not send (no NaN)', async () => {
    const user = userEvent.setup();
    render(<SchedulePage />, { wrapper: createWrapper() });

    await user.selectOptions(screen.getByLabelText('fillSchedule.personaLabel'), 'p-1');
    await user.click(screen.getByTitle('Meu canal'));
    fireEvent.change(screen.getByLabelText('fillSchedule.scheduleTime 1'), { target: { value: '' } });
    await user.click(screen.getByRole('button', { name: 'fillSchedule.activate' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(createSchedule).not.toHaveBeenCalled();
  });

  it('backend 400 error (24h-30d window) shows the real message, not a generic one', async () => {
    vi.mocked(createSchedule).mockRejectedValue(new ScheduleError(400, 'Schedule must be at least 24 hours in advance.'));
    const user = userEvent.setup();
    render(<SchedulePage />, { wrapper: createWrapper() });

    await user.selectOptions(screen.getByLabelText('fillSchedule.personaLabel'), 'p-1');
    await user.click(screen.getByTitle('Meu canal'));
    await user.click(screen.getByRole('button', { name: 'fillSchedule.activate' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Schedule must be at least 24 hours in advance.');
  });

  it('one-off without a filled date shows an error and does not send', async () => {
    const user = userEvent.setup();
    render(<SchedulePage />, { wrapper: createWrapper() });

    await user.selectOptions(screen.getByLabelText('fillSchedule.personaLabel'), 'p-1');
    await user.click(screen.getByRole('radio', { name: 'fillSchedule.oneOff' }));
    await user.click(screen.getByTitle('Meu canal'));
    await user.click(screen.getByRole('button', { name: 'fillSchedule.activate' }));

    expect(screen.getByText('fillSchedule.oneOffRequired')).toBeInTheDocument();
    expect(createSchedule).not.toHaveBeenCalled();
  });

  it('409 (persona already scheduled): shows a warning and does not navigate', async () => {
    vi.mocked(createSchedule).mockRejectedValue(new ScheduleError(409, 'PERSONA_ALREADY_SCHEDULED'));
    const user = userEvent.setup();
    render(<SchedulePage />, { wrapper: createWrapper() });

    await user.selectOptions(screen.getByLabelText('fillSchedule.personaLabel'), 'p-1');
    await user.click(screen.getByTitle('Meu canal'));
    await user.click(screen.getByRole('button', { name: 'fillSchedule.activate' }));

    expect(await screen.findByText('fillSchedule.alreadyScheduled')).toBeInTheDocument();
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it('sucesso navega para a home onde os autopilots aparecem', async () => {
    const user = userEvent.setup();
    render(<SchedulePage />, { wrapper: createWrapper() });

    await user.selectOptions(screen.getByLabelText('fillSchedule.personaLabel'), 'p-1');
    await user.click(screen.getByTitle('Meu canal'));
    await user.click(screen.getByRole('button', { name: 'fillSchedule.activate' }));

    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith('/'));
  });

  it('sem personas: mostra estado vazio com CTA para criar persona', () => {
    mockReady({ personas: [] });
    render(<SchedulePage />, { wrapper: createWrapper() });

    expect(screen.getByText('fillSchedule.noPersonasFound')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'fillSchedule.createPersona' })).toHaveAttribute('href', '/persona');
  });
});
