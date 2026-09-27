import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const apiState = vi.hoisted(() => ({
  personas: [{ id: 'p1', name: 'Tech Explorer', niche: 'Tecnologia prática' }] as Array<Record<string, unknown>> | undefined,
  schedules: [] as Array<Record<string, unknown>> | undefined,
  accountsLoading: false,
  personaError: false,
  scheduleError: false,
}));

vi.mock('@/lib/api', () => ({
  usePersonaListQuery: () => ({ data: apiState.personas, isLoading: false, isError: apiState.personaError, refetch: vi.fn() }),
  useSchedulesQuery: () => ({ data: apiState.schedules, isLoading: false, isError: apiState.scheduleError, refetch: vi.fn() }),
  useScheduleStatusQuery: () => ({ data: { upcoming: [] }, isLoading: false }),
  useUpdateScheduleMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteScheduleMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useSessionQuery: () => ({ data: { user_metadata: { name: 'Ryan' } } }),
  useYouTubeAccountsQuery: () => ({ data: apiState.accountsLoading ? undefined : { accounts: [{ channelId: 'yt1', channelName: 'Canal Europa' }] }, isLoading: apiState.accountsLoading }),
  useInstagramAccountsQuery: () => ({ data: { accounts: [{ igUserId: 'ig1', username: 'ryan.tech' }] }, isLoading: false }),
  useLinkedinAccountsQuery: () => ({ data: { accounts: [{ provider: 'linkedin', recordId: 'r', providerAccountId: 'urn:li:person:1', accountName: 'Ryan no LinkedIn', connectedAt: 0, lastUsed: 0 }] }, isLoading: false }),
}));

vi.mock('@/lib/i18n/provider', () => ({ useI18n: () => ({ t: (key: string) => key, locale: 'pt' }) }));

import Home from '../page';

describe('Home dashboard public seam', () => {
  beforeEach(() => {
    apiState.personas = [{ id: 'p1', name: 'Tech Explorer', niche: 'Tecnologia prática' }];
    apiState.schedules = [];
    apiState.accountsLoading = false;
    apiState.personaError = false;
    apiState.scheduleError = false;
  });

  it('guides the user when no autopilot exists', () => {
    render(<Home />);
    expect(screen.getByRole('heading', { name: 'home.emptyTitle' })).toBeVisible();
    expect(screen.getByRole('link', { name: /home.createFirst/ })).toHaveAttribute('href', '/personas');
  });

  it('shows each configured autopilot instead of the setup form', () => {
    apiState.schedules = [{ id: 's1', personaId: 'p1', youtubeAccountIds: ['yt1'], instagramAccountIds: ['ig1'], linkedinAccountIds: [], daysOfWeek: [1, 2, 3, 4, 5], startHour: 9, endHour: 18, postsPerDay: 1, active: true }];
    render(<Home />);
    expect(screen.getByRole('heading', { name: 'Tech Explorer' })).toBeVisible();
    expect(screen.getByText('Canal Europa')).toBeVisible();
    expect(screen.getByText('@ryan.tech')).toBeVisible();
    expect(screen.queryByText('fillSchedule.daysLabel')).not.toBeInTheDocument();
  });

  it('exibe contas LinkedIn do autopiloto como chips', () => {
    apiState.schedules = [{ id: 's1', personaId: 'p1', youtubeAccountIds: [], instagramAccountIds: [], linkedinAccountIds: ['urn:li:person:1'], daysOfWeek: [1], startHour: 9, endHour: 18, postsPerDay: 1, active: true }];
    render(<Home />);
    expect(screen.getByText('Ryan no LinkedIn')).toBeVisible();
  });

  it('renderiza agendamento one-off (daysOfWeek null) sem quebrar e mostra a data agendada', () => {
    // Forma que chega do mapSchedule quando days_of_week/start_hour são null (one-off).
    apiState.schedules = [{ id: 's1', personaId: 'p1', providers: ['youtube'], youtubeAccountIds: ['yt1'], instagramAccountIds: [], linkedinAccountIds: [], daysOfWeek: null, startHour: null, endHour: null, postsPerDay: 1, timezone: 'America/Sao_Paulo', active: true, scheduledAt: '2026-12-25T17:00:00.000Z' }];
    render(<Home />);

    expect(screen.getByRole('heading', { name: 'Tech Explorer' })).toBeVisible();
    expect(screen.getByText(/home\.oneOff/)).toBeInTheDocument();
    expect(screen.getByText(/25\/12\/2026/)).toBeInTheDocument();
    expect(screen.queryByText('home.everyDay')).not.toBeInTheDocument();
    expect(screen.queryByText(/null/)).not.toBeInTheDocument();
  });

  it('shows the skeleton instead of the empty state while query data is unavailable', () => {
    apiState.personas = undefined;
    apiState.schedules = undefined;

    const { container } = render(<Home />);

    expect(container.querySelectorAll('.skeleton-shimmer').length).toBeGreaterThan(0);
    expect(screen.queryByRole('heading', { name: 'home.emptyTitle' })).not.toBeInTheDocument();
  });

  it('waits for account data before showing the complete autopilot card', () => {
    apiState.schedules = [{ id: 's1', personaId: 'p1', youtubeAccountIds: ['yt1'], instagramAccountIds: [], linkedinAccountIds: [], daysOfWeek: [1], startHour: 9, endHour: 18, postsPerDay: 1, active: true }];
    apiState.accountsLoading = true;
    const { container, rerender } = render(<Home />);

    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();

    apiState.accountsLoading = false;
    rerender(<Home />);

    expect(container.querySelector('[aria-busy="true"]')).not.toBeInTheDocument();
    expect(screen.getByRole('article')).toHaveTextContent('Canal Europa');
  });

  it('shows a recovery state when an initial query fails', () => {
    apiState.personas = undefined;
    apiState.personaError = true;

    render(<Home />);

    expect(screen.getByRole('heading', { name: 'home.loadError' })).toBeVisible();
    expect(screen.queryByText('home.emptyTitle')).not.toBeInTheDocument();
  });
});
