import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';

Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
window.HTMLElement.prototype.hasPointerCapture = () => false;
window.HTMLElement.prototype.setPointerCapture = () => {};
window.HTMLElement.prototype.releasePointerCapture = () => {};

vi.mock('@/lib/api', () => ({
  useSchedulesQuery: vi.fn(),
  usePersonaListQuery: vi.fn(),
}));

vi.mock('@/lib/social-accounts-queries', () => ({
  useSocialAccountsQuery: vi.fn(),
}));

vi.mock('@/lib/access-query', () => ({
  useAccessQuery: vi.fn(() => ({ data: { active: true, endsAt: '2030-01-01T00:00:00.000Z', daysLeft: 1, reason: 'trial' } })),
}));
vi.mock('@/lib/schedule-range', () => ({
  RANGE_MAX_SLOTS: 1000,
  useScheduleRangeQuery: vi.fn(),
  useHasAnyPostQuery: vi.fn(() => ({ data: true, isLoading: false, refetch: vi.fn() })),
}));

vi.mock('@/lib/approval-queue', () => ({
  useApprovalQueue: vi.fn(() => ({ slots: [], count: 0, isLoading: false, isError: false })),
  isSlotExpired: vi.fn(() => false),
}));

vi.mock('next/image', () => ({
  default: ({ alt, ...props }: React.ComponentProps<'img'>) => <img alt={alt} {...props} />,
}));

const pushMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({ push: pushMock })),
}));

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/ui', () => ({
  SpinnerIcon: () => <span data-testid="icon-spinner" />,
  ImageIcon: () => <span data-testid="icon-image" />,
  SECTION_LABEL_CLASS: 'section-label',
}));

vi.mock('@/lib/i18n/provider', () => {
  function I18nProvider({ children }: { children: ReactNode }) {
    return <>{children}</>;
  }
  I18nProvider.displayName = 'I18nProvider';
  const useI18n = vi.fn(() => ({ t: (key: string) => key, locale: 'en', setLocale: vi.fn() }));
  return { useI18n, I18nProvider };
});

import PostsPage from '../page';
import { buildMonthGrid, gridRange } from '../calendar-days';
import { postsCalendarStrings } from '@/lib/i18n/posts-calendar-i18n';
import { useHasAnyPostQuery, useScheduleRangeQuery } from '@/lib/schedule-range';
import {
  useSchedulesQuery,
  usePersonaListQuery,
} from '@/lib/api';
import { useSocialAccountsQuery } from '@/lib/social-accounts-queries';
import { useAccessQuery } from '@/lib/access-query';

const SCHEDULE = {
  id: 's1',
  personaId: 'p1',
  providers: ['youtube', 'instagram'],
  youtubeAccountIds: ['ch1'],
  instagramAccountIds: ['ig1'],
  linkedinAccountIds: [],
  daysOfWeek: [1, 2, 3],
  startHour: 9,
  endHour: 17,
  postsPerDay: 1,
  timezone: 'UTC',
  active: true,
};

const UPCOMING_SLOT = {
  id: 'u1',
  scheduleId: 's1',
  slotAt: '2030-06-01T10:00:00.000Z',
  status: 'ready',
  title: 'Upcoming topic',
  error: null,
  publishedAt: null,
};

const PUBLISHED_SLOT = {
  id: 'r1',
  scheduleId: 's1',
  slotAt: '2020-01-01T10:00:00.000Z',
  status: 'published',
  title: 'Past topic',
  error: null,
  publishedAt: '2020-01-01T10:05:00.000Z',
  taskId: 'task-9',
};

const FAILED_SLOT = {
  id: 'r2',
  scheduleId: 's1',
  slotAt: '2020-01-02T10:00:00.000Z',
  status: 'failed',
  title: 'Failed topic',
  error: 'Upload failed',
  publishedAt: null,
};

function mockQueries(overrides: {
  range?: unknown[];
  rangeTruncated?: boolean;
  upcoming?: unknown[];
  schedules?: unknown[];
  personas?: unknown[];
} = {}) {
  vi.mocked(useScheduleRangeQuery).mockReturnValue({
    data: { slots: (overrides.range ?? overrides.upcoming ?? [UPCOMING_SLOT]) as never, truncated: overrides.rangeTruncated ?? false },
    isLoading: false,
    isFetching: false,
    isError: false,
    refetch: vi.fn(),
  } as never);
  vi.mocked(useHasAnyPostQuery).mockReturnValue({ data: true, isLoading: false, isError: false, refetch: vi.fn() } as never);
  vi.mocked(useSchedulesQuery).mockReturnValue({
    data: (overrides.schedules ?? [SCHEDULE]) as never,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  } as never);
  vi.mocked(usePersonaListQuery).mockReturnValue({
    data: (overrides.personas ?? [{ id: 'p1', name: 'Viva Leve', avatarUrl: 'https://example.test/viva.jpg' }]) as never,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  } as never);
  vi.mocked(useSocialAccountsQuery).mockReturnValue({
    data: { authenticated: true, accounts: [{ provider: 'youtube', channelId: 'ch1', channelName: 'Europa Na Estrada' }, { provider: 'instagram', igUserId: 'ig1', username: 'vivalave' }] },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2030-06-01T12:00:00.000Z'));
  mockQueries();
});

const dayPanelCardText = (text: string) =>
  screen.getAllByText(text).find((element) => element.closest('a') !== null);

const calendarCard = () => document.querySelector('[data-calendar-card]') as HTMLElement;

afterEach(() => {
  vi.useRealTimers();
});

describe('posts calendar load failure copy', () => {
  it('uses a short subtitle distinct from the in-card alert sentence', () => {
    expect(postsCalendarStrings.pt.posts.subtitleLoadError).not.toBe(postsCalendarStrings.pt.posts.loadErrorCalendar);
    expect(postsCalendarStrings.en.posts.subtitleLoadError).not.toBe(postsCalendarStrings.en.posts.loadErrorCalendar);
  });
});

describe('PostsPage', () => {
  it("opens on the calendar with today's posts below it: title, persona, status and network glyphs", async () => {
    const user = userEvent.setup();
    render(<PostsPage />);

    expect(dayPanelCardText('Upcoming topic')).toBeInTheDocument();
    expect(dayPanelCardText('Viva Leve')).toBeInTheDocument();
    const row = dayPanelCardText('Upcoming topic')?.closest('a') as HTMLElement;
    expect(within(row).getByText('posts.groupScheduled')).toBeInTheDocument();
    expect(within(row).queryByText('posts.statusPending')).not.toBeInTheDocument();
    expect(row.querySelectorAll('[role="img"]')).toHaveLength(2);
    expect(row.querySelector('[aria-label="youtube"]')).not.toBeNull();
    expect(row.querySelector('[aria-label="instagram"]')).not.toBeNull();
    await user.click(screen.getByLabelText('posts.filterPersona'));
    expect(screen.getByRole('option', { name: 'Viva Leve' })).toBeInTheDocument();
    expect(dayPanelCardText('Upcoming topic')).toBeInTheDocument();
  });

  it('shows the account notice on a publishing card before the slot is finished', () => {
    mockQueries({
      upcoming: [
        {
          ...UPCOMING_SLOT,
          status: 'publishing',
          title: 'Publishing topic',
          userNotices: [
            {
              provider: 'bluesky',
              accountId: 'b1',
              code: 'email_not_verified',
              requiresUser: true,
              notice: 'raw upstream must not render',
            },
          ],
        },
      ],
    });
    render(<PostsPage />);

    expect(screen.getByRole('alert')).toHaveTextContent('posts.userNoticeEmail');
    expect(screen.queryByText('raw upstream must not render')).not.toBeInTheDocument();
  });

  it('labels a slot from a persona-less schedule as "no persona", not a removed persona', () => {
    mockQueries({ schedules: [{ ...SCHEDULE, personaId: null }] });
    render(<PostsPage />);

    expect(dayPanelCardText('Upcoming topic')).toBeInTheDocument();
    expect(dayPanelCardText('posts.noPersona')).toBeInTheDocument();
    expect(screen.queryByText('posts.personaFallback')).not.toBeInTheDocument();
  });

  it('draws one calendar only: no sidebar mini calendar beside the month grid', () => {
    render(<PostsPage />);

    expect(document.querySelectorAll('[data-calendar-card]')).toHaveLength(1);
    expect(document.querySelector('[data-slot="mini-calendar"]')).toBeNull();
    expect(document.querySelector('[data-testid="posts-sidebar"]')).toBeNull();
    expect(screen.queryByText('posts.sidebarCalendars')).not.toBeInTheDocument();
  });

  it('keeps every persona’s posts on the one calendar, with no persona toggles to switch off', () => {
    mockQueries({
      range: [
        UPCOMING_SLOT,
        { ...UPCOMING_SLOT, id: 'u2', scheduleId: 's2', slotAt: '2030-06-01T14:00:00.000Z', title: 'Second topic' },
      ],
      schedules: [SCHEDULE, { ...SCHEDULE, id: 's2', personaId: 'p2' }],
      personas: [
        { id: 'p1', name: 'Viva Leve', avatarUrl: 'https://example.test/viva.jpg' },
        { id: 'p2', name: 'Daily Dose', avatarUrl: 'https://example.test/daily.jpg' },
      ],
    });
    render(<PostsPage />);

    expect(dayPanelCardText('Upcoming topic')).toBeInTheDocument();
    expect(dayPanelCardText('Second topic')).toBeInTheDocument();
    expect(dayPanelCardText('Viva Leve')).toBeInTheDocument();
    expect(dayPanelCardText('Daily Dose')).toBeInTheDocument();
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
  });

  it('reads title first, then persona, time and networks, with the status chip last', () => {
    render(<PostsPage />);

    const row = dayPanelCardText('Upcoming topic')?.closest('a');
    expect(row).not.toBeNull();
    const text = row?.textContent ?? '';
    expect(text.indexOf('Upcoming topic')).toBeLessThan(text.indexOf('Viva Leve'));
    const personaIndex = text.indexOf('Viva Leve');
    const timeIndex = text.search(/\d{1,2}:\d{2}/);
    expect(timeIndex).toBeGreaterThan(personaIndex);
    expect(text.indexOf('posts.groupScheduled')).toBeGreaterThan(timeIndex);
    expect(text).not.toContain('2030');
    expect(text).not.toContain('Jun');
    expect((dayPanelCardText('Upcoming topic') as HTMLElement).className.split(/\s+/)).toContain('font-semibold');
    expect(dayPanelCardText('Viva Leve')?.parentElement?.className.split(/\s+/)).toContain('text-muted-foreground');
    const support = dayPanelCardText('Viva Leve')?.parentElement;
    expect(support?.querySelector('[aria-label="youtube"]')).not.toBeNull();
    expect(support?.textContent).not.toContain('Europa Na Estrada');
  });

  it('filters slots by provider', async () => {
    const user = userEvent.setup();
    render(<PostsPage />);

    const selects = screen.getAllByRole('combobox');
    await user.click(selects[0]);
    await user.click(screen.getByRole('option', { name: 'LinkedIn' }));

    expect(screen.getByText('posts.filterMonthEmptyTitle')).toBeInTheDocument();
    expect(screen.getByText('posts.calendarMonthHeading')).toBeInTheDocument();
    expect(screen.queryByText('Upcoming topic')).not.toBeInTheDocument();
  });

  it('shows the filter empty state, not the day empty state, when a filter empties the selected day', async () => {
    const user = userEvent.setup();
    mockQueries({
      range: [
        UPCOMING_SLOT,
        { ...UPCOMING_SLOT, id: 'u2', scheduleId: 's2', slotAt: '2030-06-05T10:00:00.000Z', title: 'Second topic' },
      ],
      schedules: [
        { ...SCHEDULE, id: 's1', providers: ['youtube'], youtubeAccountIds: ['ch1'], instagramAccountIds: [] },
        { ...SCHEDULE, id: 's2', providers: ['instagram'], youtubeAccountIds: [], instagramAccountIds: ['ig1'] },
      ],
    });
    render(<PostsPage />);
    expect(dayPanelCardText('Upcoming topic')).toBeInTheDocument();

    const selects = screen.getAllByRole('combobox');
    await user.click(selects[0]);
    await user.click(screen.getByRole('option', { name: 'Instagram' }));

    expect(screen.queryByText('Upcoming topic')).not.toBeInTheDocument();
    expect(screen.getByText('posts.filterMonthEmptyTitle')).toBeInTheDocument();
    const daySection = screen.getByText('posts.filterMonthEmptyTitle').closest('section');
    expect(within(daySection as HTMLElement).getByRole('button', { name: 'posts.clearFilters' })).toBeInTheDocument();
    expect(screen.queryByText('posts.calendarDayNone')).not.toBeInTheDocument();
  });

  it('marks an applied filter and clears every filter with one action', async () => {
    const user = userEvent.setup();
    render(<PostsPage />);
    expect(screen.queryByRole('button', { name: 'posts.clearFilters' })).not.toBeInTheDocument();

    const selects = screen.getAllByRole('combobox');
    await user.click(selects[0]);
    await user.click(screen.getByRole('option', { name: 'YouTube' }));
    expect(selects[0].className.split(/\s+/)).toContain('border-primary');
    expect(selects[1].className.split(/\s+/)).not.toContain('border-primary');
    expect(screen.getAllByRole('button', { name: 'posts.clearFilters' })).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'posts.clearFilters' }));
    expect(selects[0]).toHaveTextContent('posts.allProviders');
    expect(dayPanelCardText('Upcoming topic')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'posts.clearFilters' })).not.toBeInTheDocument();
  });

  it('filters slots by persona', async () => {
    const user = userEvent.setup();
    render(<PostsPage />);

    const selects = screen.getAllByRole('combobox');
    await user.click(selects[1]);
    await user.click(screen.getByRole('option', { name: 'Viva Leve' }));

    expect(dayPanelCardText('Upcoming topic')).toBeInTheDocument();
  });

  it('hides slots when the schedule belongs to another persona', async () => {
    const user = userEvent.setup();
    mockQueries({
      schedules: [{ ...SCHEDULE, personaId: 'p2' }],
    });
    render(<PostsPage />);

    const selects = screen.getAllByRole('combobox');
    await user.click(selects[1]);
    await user.click(screen.getByRole('option', { name: 'Viva Leve' }));

    await waitFor(() => {
      expect(screen.queryByText('Upcoming topic')).not.toBeInTheDocument();
    });
    expect(screen.getByText('posts.filterMonthEmptyTitle')).toBeInTheDocument();
  });

  it('hides slots whose schedule no longer exists', () => {
    mockQueries({ schedules: [{ ...SCHEDULE, id: 's-other' }] });
    render(<PostsPage />);

    expect(screen.queryByText('Upcoming topic')).not.toBeInTheDocument();
    expect(screen.getByText('posts.calendarMonthEmptyTitle')).toBeInTheDocument();
  });

  it('shows the account empty state, not an empty calendar, when the account has no schedule at all', () => {
    mockQueries({ schedules: [], range: [] });
    render(<PostsPage />);

    expect(screen.getByText('posts.accountEmptyTitle')).toBeInTheDocument();
    expect(screen.getByText('posts.accountEmptyHint')).toBeInTheDocument();
    const accountEmpty = screen.getByText('posts.accountEmptyTitle').closest('[data-empty-state]');
    expect(within(accountEmpty as HTMLElement).getByRole('link', { name: 'posts.newPostAction' })).toBeInTheDocument();
    expect(document.querySelector('[data-calendar-card]')).not.toBeNull();
    expect(screen.getByText('posts.subtitle')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('posts.calendarMonthHeading');
    expect(screen.queryByText(/posts\.group(Published|Failed|Scheduled):/)).not.toBeInTheDocument();
    for (const select of screen.getAllByRole('combobox')) expect(select).toBeDisabled();
  });

  it('shows the month empty state with a next step when the shown month has no posts', () => {
    mockQueries({ range: [] });
    render(<PostsPage />);

    expect(screen.getByText('posts.calendarMonthEmptyTitle')).toBeInTheDocument();
    expect(screen.getByText('posts.calendarMonthEmptyHint')).toBeInTheDocument();
    const monthEmpty = screen.getByText('posts.calendarMonthEmptyTitle').closest('[data-empty-state]');
    expect(within(monthEmpty as HTMLElement).getByRole('link', { name: 'posts.newPostAction' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('posts.calendarMonthHeading');
    expect(screen.queryByText('posts.calendarDayHeading')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'posts.calendarGoToToday' })).toBeInTheDocument();
    expect(document.querySelector('[data-calendar-card]')).not.toBeNull();
    expect(screen.queryByText(/posts\.group(Published|Failed|Scheduled):/)).not.toBeInTheDocument();
  });

  it('tells "no posts yet" apart from an empty month when the account never had a post', () => {
    mockQueries({ range: [] });
    vi.mocked(useHasAnyPostQuery).mockReturnValue({ data: false, isLoading: false, refetch: vi.fn() } as never);
    render(<PostsPage />);

    expect(vi.mocked(useHasAnyPostQuery).mock.calls.at(-1)?.[0]).toBe(true);
    expect(screen.getByText('posts.accountEmptyTitle')).toBeInTheDocument();
    const neverPosted = screen.getByText('posts.accountEmptyTitle').closest('[data-empty-state]');
    expect(within(neverPosted as HTMLElement).getByRole('link', { name: 'posts.newPostAction' })).toBeInTheDocument();
    expect(document.querySelector('[data-calendar-card]')).not.toBeNull();
    for (const select of screen.getAllByRole('combobox')) expect(select).toBeDisabled();
    expect(screen.queryByText('posts.calendarDayHeading')).not.toBeInTheDocument();
    expect(screen.getByText('posts.subtitle')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('posts.calendarMonthHeading');
  });

  it('does not ask whether the account has any post when the month it opens on has posts', () => {
    render(<PostsPage />);
    expect(vi.mocked(useHasAnyPostQuery).mock.calls.at(-1)?.[0]).toBe(false);
    expect(document.querySelector('[data-calendar-card]')).not.toBeNull();
  });

  it('keeps the month empty state when the "any post" read fails, never a dead end', () => {
    mockQueries({ range: [] });
    vi.mocked(useHasAnyPostQuery).mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch: vi.fn() } as never);
    render(<PostsPage />);

    expect(screen.getByText('posts.calendarMonthEmptyTitle')).toBeInTheDocument();
    expect(screen.queryByText('posts.accountEmptyTitle')).not.toBeInTheDocument();
  });

  it('shows the skeleton, not a flash of the month state, while the "any post" read loads', () => {
    mockQueries({ range: [] });
    vi.mocked(useHasAnyPostQuery).mockReturnValue({ data: undefined, isLoading: true, refetch: vi.fn() } as never);
    render(<PostsPage />);

    expect(screen.getByText('posts.loadingPosts').closest('[role="status"]')).not.toBeNull();
    expect(screen.queryByText('posts.calendarMonthEmptyTitle')).not.toBeInTheDocument();
  });

  it('returns to today from an empty future month using the header Today control', async () => {
    const user = userEvent.setup();
    render(<PostsPage />);

    await user.click(screen.getByRole('button', { name: 'posts.calendarNextMonth' }));
    expect(screen.getByText('posts.calendarMonthEmptyTitle')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'posts.calendarGoToToday' }));
    expect(dayPanelCardText('Upcoming topic')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('posts.calendarDayHeading');
  });

  it('names the day, not the month, for an empty day in a month with posts', async () => {
    const user = userEvent.setup();
    render(<PostsPage />);

    const day2 = screen.getByRole('button', { name: 'Sunday, June 2' });
    await user.click(day2 as HTMLElement);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('posts.calendarDayHeading');
    expect(screen.getByText('posts.calendarDayNone')).toBeInTheDocument();
    expect(screen.queryByText('posts.calendarMonthEmptyTitle')).not.toBeInTheDocument();
  });

  it('shows a loading skeleton with the shown month\'s weeks while the calendar range is loading', () => {
    vi.mocked(useScheduleRangeQuery).mockReturnValue({ data: undefined, isLoading: true, isFetching: false, isError: false, refetch: vi.fn() } as never);

    render(<PostsPage />);
    expect(screen.getByText('posts.loadingPosts').closest('[role="status"]')).not.toBeNull();
    expect(screen.getByText('posts.loadingPosts')).toBeVisible();
    expect(screen.getByText('posts.loadingPosts').className.split(/\s+/)).not.toContain('sr-only');
    expect(document.querySelector('[data-skeleton-panel]')).not.toBeNull();
    for (const select of screen.getAllByRole('combobox')) expect(select).toBeDisabled();
    expect(screen.queryByTestId('icon-spinner')).not.toBeInTheDocument();
    expect(document.querySelectorAll('[data-skeleton-day]')).toHaveLength(42);
  });

  it('puts the day panel beside the calendar on wide screens', () => {
    render(<PostsPage />);
    const layout = document.querySelector('[data-calendar-card]')?.closest('.xl\\:grid');
    expect(layout).not.toBeNull();
    expect(layout?.querySelector('section')).toHaveTextContent('Upcoming topic');
  });

  it('shows the error state when the personas query fails', () => {
    vi.mocked(usePersonaListQuery).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: vi.fn(),
    } as never);

    render(<PostsPage />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('posts.loadErrorSupporting');
    const sideNote = document.querySelector('[data-day-unavailable-note]');
    expect(sideNote).not.toBeNull();
    expect(within(sideNote as HTMLElement).getByText('posts.loadErrorSideQuiet')).toBeInTheDocument();
  });

  it('shows the error state when an account query fails', () => {
    vi.mocked(useSocialAccountsQuery).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: vi.fn(),
    } as never);

    render(<PostsPage />);
    expect(screen.getByRole('alert')).toHaveTextContent('posts.loadErrorSupporting');
  });

  it('retry refetches the account queries as well', async () => {
    const accountsRefetch = vi.fn();
    vi.mocked(useSocialAccountsQuery).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: accountsRefetch,
    } as never);
    const user = userEvent.setup();
    render(<PostsPage />);

    await user.click(screen.getByRole('button', { name: 'posts.loadErrorRetry' }));
    expect(accountsRefetch).toHaveBeenCalledTimes(1);
  });

  it('moves "today" past midnight without a reload', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<PostsPage />);
    const todayButton = () => document.querySelector('[data-date="2030-06-01"] button');
    expect(todayButton()?.getAttribute('aria-label')).toBe('Saturday, June 1');
    expect(todayButton()?.className.split(/\s+/)).toContain('bg-primary');
    expect(document.querySelector('[data-today-pip]')).toBeNull();

    vi.setSystemTime(new Date('2030-06-02T00:01:00.000Z'));
    rerender(<PostsPage />);

    const nextTodayButton = () => document.querySelector('[data-date="2030-06-02"] button');
    expect(nextTodayButton()?.getAttribute('aria-label')).toBe('Sunday, June 2');
    expect(nextTodayButton()?.className.split(/\s+/)).toContain('bg-primary');
    expect(todayButton()?.className.split(/\s+/)).not.toContain('bg-primary');
    await user.click(screen.getByRole('button', { name: 'posts.calendarGoToToday' }));
    expect(screen.getByText('posts.calendarDayNone')).toBeInTheDocument();
    expect(dayPanelCardText('Upcoming topic')).toBeUndefined();
  });

  it('retry refetches the personas query as well', async () => {
    const personasRefetch = vi.fn();
    vi.mocked(usePersonaListQuery).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: personasRefetch,
    } as never);
    const user = userEvent.setup();
    render(<PostsPage />);

    await user.click(screen.getByRole('button', { name: 'posts.loadErrorRetry' }));
    expect(personasRefetch).toHaveBeenCalledTimes(1);
  });

  it('keeps the persona filter when switching networks', async () => {
    const user = userEvent.setup();
    render(<PostsPage />);

    await user.click(screen.getByLabelText('posts.filterPersona'));
    await user.click(screen.getByRole('option', { name: 'Viva Leve' }));
    expect(screen.getByLabelText('posts.filterPersona')).toHaveTextContent('Viva Leve');

    await user.click(screen.getByLabelText('posts.filterProvider'));
    await user.click(screen.getByRole('option', { name: 'Instagram' }));
    expect(screen.getByLabelText('posts.filterPersona')).toHaveTextContent('Viva Leve');

    await user.click(screen.getByLabelText('posts.filterProvider'));
    await user.click(screen.getByRole('option', { name: 'posts.allProviders' }));
    expect(screen.getByLabelText('posts.filterPersona')).toHaveTextContent('Viva Leve');
  });

  it('combines the persona and network filters', async () => {
    const user = userEvent.setup();
    render(<PostsPage />);

    await user.click(screen.getByLabelText('posts.filterPersona'));
    await user.click(screen.getByRole('option', { name: 'Viva Leve' }));
    await user.click(screen.getByLabelText('posts.filterProvider'));
    await user.click(screen.getByRole('option', { name: 'LinkedIn' }));
    expect(screen.queryByText('Upcoming topic')).not.toBeInTheDocument();
  });
});

describe('PostsPage card links', () => {
  it("links today's calendar cards to their detail page", () => {
    render(<PostsPage />);

    const detailLink = screen.getAllByRole('link', { name: 'posts.cardOpenDetail' }).find((link) => link.getAttribute('href') === '/posts/u1');
    expect(detailLink).toBeDefined();
  });

});

describe('PostsPage card progress', () => {
  it('shows no progress bar on a ready card', () => {
    mockQueries({
      upcoming: [{ ...UPCOMING_SLOT, id: 'a1', status: 'ready', title: 'Ready topic' }],
    });
    render(<PostsPage />);

    expect(dayPanelCardText('Ready topic')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('shows no progress bar on a publishing card', () => {
    mockQueries({
      upcoming: [{ ...UPCOMING_SLOT, id: 'p1', status: 'publishing', title: 'Publishing topic' }],
    });
    render(<PostsPage />);

    expect(dayPanelCardText('Publishing topic')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });
});

describe('PostsPage fallbacks', () => {
  it('renders the pending badge style for an unknown slot status', () => {
    mockQueries({
      upcoming: [{ ...UPCOMING_SLOT, id: 'u9', status: 'weird_status', topic: 'Weird topic' }],
    });
    render(<PostsPage />);

    const badge = within(dayPanelCardText('Upcoming topic')?.closest('a') as HTMLElement).getByText('posts.groupScheduled');
    expect(badge.className).toContain('bg-line');
  });

  it('shows no progress bar on a publishing or a ready card', () => {
    const readySlot = {
      ...UPCOMING_SLOT,
      id: 'u7',
      status: 'ready',
      title: 'Ready topic',
    };
    const publishingSlot = {
      ...UPCOMING_SLOT,
      id: 'u8',
      status: 'publishing',
      title: 'Publishing topic',
    };
    mockQueries({ upcoming: [readySlot, publishingSlot] });
    render(<PostsPage />);

    expect(dayPanelCardText('Ready topic')).toBeInTheDocument();
    expect(dayPanelCardText('Publishing topic')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('falls back to the persona placeholder for slots whose persona is gone', () => {
    mockQueries({ schedules: [{ ...SCHEDULE, personaId: 'p-gone' }] });
    render(<PostsPage />);

    expect(dayPanelCardText('posts.personaFallback')).toBeInTheDocument();
  });

  it('draws at most three network glyphs per row, whatever the schedule targets', () => {
    mockQueries();
    const accounts = ['Alpha One', 'Beta Two', 'Gamma Three', 'Delta Four', 'Epsilon Five'].map(
      (name, i) => ({ provider: 'youtube', channelId: `ch${i}`, channelName: name }),
    );
    vi.mocked(useSocialAccountsQuery).mockReturnValue({
      data: { authenticated: true, accounts: [...accounts, { provider: 'instagram', igUserId: 'ig1', username: 'vivalave' }] },
    } as never);
    vi.mocked(useSchedulesQuery).mockReturnValue({
      data: [{ ...SCHEDULE, youtubeAccountIds: accounts.map((a) => a.channelId) }] as never,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as never);
    render(<PostsPage />);

    const row = dayPanelCardText('Upcoming topic')?.closest('a') as HTMLElement;
    expect(row.querySelectorAll('[role="img"]')).toHaveLength(3);
  });

  it('labels every provider filter option with its own network name', async () => {
    const user = userEvent.setup();
    render(<PostsPage />);

    await user.click(screen.getByLabelText('posts.filterProvider'));
    const options = screen
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(options).toEqual(['posts.allProviders', 'YouTube', 'Instagram', 'Bluesky', 'LinkedIn', 'Threads', 'Facebook', 'Pinterest', '3Speak', 'Rumble', 'Fanvue', 'Telegram']);
  });

});

describe('PostsPage calendar view', () => {
  const rangeSlots = [
    {
      ...UPCOMING_SLOT,
      id: 'c1',
      status: 'ready',
      slotAt: '2030-06-05T12:00:00.000Z',
      title: 'Calendar upcoming',
    },
    { ...PUBLISHED_SLOT, id: 'c2', slotAt: '2030-06-05T15:00:00.000Z', title: 'Calendar published' },
    { ...FAILED_SLOT, id: 'c3', slotAt: '2030-06-07T12:00:00.000Z', title: 'Calendar failed' },
    { ...UPCOMING_SLOT, id: 'c4', slotAt: '2030-06-18T10:00:00.000Z', title: 'Future scheduled' },
    { ...UPCOMING_SLOT, id: 'c5', slotAt: '2030-06-15T11:00:00.000Z', title: 'Today slot' },
  ];

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-06-15T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('navigates to the post detail when its calendar chip is clicked', async () => {
    mockQueries({ range: rangeSlots });
    const user = userEvent.setup();
    render(<PostsPage />);

    const day15 = document.querySelector('[data-date="2030-06-15"]') as HTMLElement;
    await user.click(within(day15).getByText('Today slot'));
    expect(pushMock).toHaveBeenCalledWith('/posts/c5');
  });

  it('selects today and lists its posts when go-to-today is clicked in the open month', async () => {
    mockQueries({ range: rangeSlots });
    const user = userEvent.setup();
    render(<PostsPage />);

    const day5 = screen.getByRole('button', { name: 'Wednesday, June 5' });
    await user.click(day5);
    expect(dayPanelCardText('Calendar upcoming')).toBeInTheDocument();
    expect(dayPanelCardText('Today slot')).toBeUndefined();

    await user.click(screen.getByRole('button', { name: 'posts.calendarGoToToday' }));
    expect(dayPanelCardText('Today slot')).toBeInTheDocument();
  });

  it('reads the visible 6-week grid as one range', () => {
    mockQueries({ range: rangeSlots });
    render(<PostsPage />);

    const [monthKey, from, to, enabled] = vi.mocked(useScheduleRangeQuery).mock.calls.at(-1) ?? [];
    expect(enabled).toBe(true);
    expect(monthKey).toBe('2030-06');
    expect(new Date(from as string).getTime()).toBeLessThanOrEqual(new Date(2030, 5, 1).getTime());
    expect(new Date(to as string).getTime()).toBeGreaterThanOrEqual(new Date(2030, 6, 1).getTime());
    expect(document.querySelector('[data-calendar-card]')).not.toBeNull();
  });

  it('lists the selected day posts below the calendar, past and future together', async () => {
    mockQueries({ range: rangeSlots });
    const user = userEvent.setup();
    render(<PostsPage />);

    expect(dayPanelCardText('Today slot')).toBeInTheDocument();
    const day5 = screen.getByRole('button', { name: 'Wednesday, June 5' });
    await user.click(day5);

    expect(dayPanelCardText('Calendar upcoming')).toBeInTheDocument();
    expect(dayPanelCardText('Calendar published')).toBeInTheDocument();
    expect(dayPanelCardText('Calendar failed')).toBeUndefined();
  });

  it('applies the provider filter to calendar slots', async () => {
    mockQueries({ range: rangeSlots });
    const user = userEvent.setup();
    render(<PostsPage />);

    await user.click(screen.getAllByRole('combobox')[0]);
    await user.click(screen.getByRole('option', { name: 'LinkedIn' }));

    expect(document.querySelectorAll('[data-event-id]')).toHaveLength(0);
  });

  it('shows one scheduled chip and no persona in the cell for a day with one ready post', () => {
    mockQueries();
    render(<PostsPage />);

    const day1 = document.querySelector('[data-date="2030-06-01"]');
    expect(day1).not.toBeNull();
    expect((day1 as HTMLElement).querySelector('img')).toBeNull();
    const chips = (day1 as HTMLElement).querySelectorAll('[data-event-id]');
    expect(chips).toHaveLength(1);
    expect(chips[0]).toHaveTextContent('Upcoming topic');
    expect(chips[0]?.querySelector('.bg-event-gray-border')).not.toBeNull();
    expect((day1 as HTMLElement).querySelector('[data-personas]')).toBeNull();
  });

  it('names only the post count under the day heading — status stays in cells and cards', async () => {
    mockQueries({ range: rangeSlots });
    const user = userEvent.setup();
    render(<PostsPage />);

    const day5 = screen.getByRole('button', { name: 'Wednesday, June 5' });
    await user.click(day5);

    expect(screen.getByText('posts.calendarDayPostCountMany')).toBeInTheDocument();
    expect(screen.queryByText(/posts\.groupPublished:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/posts\.groupScheduled:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/posts\.groupInProgress:/)).not.toBeInTheDocument();
  });

  it('warns when the range read was truncated', () => {
    mockQueries({ range: rangeSlots, rangeTruncated: true });
    render(<PostsPage />);

    expect(screen.getByText('posts.calendarTruncated')).toBeInTheDocument();
  });

  it('shows the load error state when the range read fails', () => {
    mockQueries();
    vi.mocked(useScheduleRangeQuery).mockReturnValue({ data: undefined, isLoading: false, isFetching: false, isError: true, refetch: vi.fn() } as never);
    render(<PostsPage />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('posts.loadErrorCalendar');
    expect(within(alert).queryByText('posts.loadErrorSideQuiet')).not.toBeInTheDocument();
    expect(document.querySelector('[data-day-unavailable-note]')).toBeNull();
    expect(document.querySelector('[data-calendar-unavailable-side-note]')).toBeNull();
    expect(screen.getByText('posts.subtitleLoadError')).toBeInTheDocument();
    expect(screen.queryByText('posts.subtitle')).not.toBeInTheDocument();
    expect(screen.queryByTestId('load-error-side-panel')).not.toBeInTheDocument();
  });

  it('clicking an outside day selects it and moves the shown month to it', async () => {
    mockQueries({ range: rangeSlots });
    const user = userEvent.setup();
    render(<PostsPage />);

    const july1 = screen.getByRole('button', { name: 'Monday, July 1' });
    expect(july1.className.split(/\s+/)).toContain('text-muted-foreground');
    await user.click(july1);

    expect(within(calendarCard()).getByText(/July 2030/)).toBeInTheDocument();
    expect(vi.mocked(useScheduleRangeQuery).mock.calls.at(-1)?.[0]).toBe('2030-07');
  });

  it('month navigation leaves no day selected in a month without posts', async () => {
    mockQueries({ range: rangeSlots });
    const user = userEvent.setup();
    render(<PostsPage />);

    await user.click(screen.getByRole('button', { name: 'posts.calendarNextMonth' }));
    expect(within(calendarCard()).getByText(/July 2030/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('posts.calendarMonthHeading');
    expect(screen.queryByText('posts.calendarDayHeading')).not.toBeInTheDocument();
    expect(screen.getByText('posts.calendarMonthEmptyTitle')).toBeInTheDocument();
    expect(vi.mocked(useScheduleRangeQuery).mock.calls.at(-1)?.[0]).toBe('2030-07');
  });

  it("month navigation selects the month's first day with posts, and today back in today's month", async () => {
    const julySlots = [
      { ...UPCOMING_SLOT, id: 'j2', slotAt: '2030-07-20T12:00:00.000Z', title: 'July later' },
      { ...UPCOMING_SLOT, id: 'j1', slotAt: '2030-07-09T12:00:00.000Z', title: 'July first' },
    ];
    mockQueries({ range: [...rangeSlots, ...julySlots] });
    const user = userEvent.setup();
    render(<PostsPage />);

    await user.click(screen.getByRole('button', { name: 'posts.calendarNextMonth' }));
    expect(dayPanelCardText('July first')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'posts.calendarPrevMonth' }));
    expect(dayPanelCardText('Today slot')).toBeInTheDocument();
  });

  it('shows the generic failure label on a failed card, never the raw error text', async () => {
    const failedSlot = {
      ...FAILED_SLOT,
      id: 'c4',
      slotAt: '2030-06-07T14:00:00.000Z',
      title: 'Calendar publish failure',
      error: 'Upload failed with provider detail',
    };
    mockQueries({ range: [failedSlot] });
    const user = userEvent.setup();
    render(<PostsPage />);

    const day7 = screen.getByRole('button', { name: 'Friday, June 7' });
    await user.click(day7);

    expect(dayPanelCardText('Calendar publish failure')).toBeInTheDocument();
    expect(screen.getByText('posts.cardFailedPermanent')).toBeInTheDocument();
    expect(screen.queryByText('Upload failed with provider detail')).not.toBeInTheDocument();
  });

  it('draws no thumbnail tile at all on a card without video', async () => {
    mockQueries({ range: rangeSlots });
    const user = userEvent.setup();
    render(<PostsPage />);

    const day7 = screen.getByRole('button', { name: 'Friday, June 7' });
    await user.click(day7);

    const card = dayPanelCardText('Calendar failed')?.closest('a');
    expect(card).not.toBeNull();
    expect(card?.querySelector('video')).toBeNull();
    expect(card?.querySelector('[data-thumb]')).toBeNull();
  });

  it('shows a bare recovery frame on a load error with a single in-card retry and no day-selection copy', async () => {
    mockQueries();
    const refetch = vi.fn();
    vi.mocked(useScheduleRangeQuery).mockReturnValue({ data: undefined, isLoading: false, isFetching: false, isError: true, refetch } as never);
    const user = userEvent.setup();
    render(<PostsPage />);

    const alert = screen.getByRole('alert');
    expect(within(alert).getByText('posts.loadErrorCalendar')).toBeInTheDocument();
    expect(within(alert).queryByText('posts.loadErrorRetryHint')).not.toBeInTheDocument();
    expect(within(alert).queryByText('posts.loadErrorSideQuiet')).not.toBeInTheDocument();
    expect(alert.closest('[data-calendar-card]')).not.toBeNull();
    expect(screen.getByText('posts.subtitleLoadError')).toBeInTheDocument();
    const retry = within(alert).getByRole('button', { name: 'posts.loadErrorRetry' });
    await user.click(retry);
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-date]')).toBeNull();
    expect(document.querySelector('[data-calendar-unavailable-side-note]')).toBeNull();
    expect(screen.queryByText('posts.calendarNotLoaded')).not.toBeInTheDocument();
    expect(document.querySelector('[data-calendar-grid-outline]')).not.toBeInTheDocument();
    expect(screen.queryByText('posts.calendarDayHeading')).not.toBeInTheDocument();
    expect(screen.queryByText('posts.calendarMonthHeading')).not.toBeInTheDocument();
    expect(document.querySelector('[data-day-unavailable-note]')).toBeNull();
    expect(screen.queryAllByRole('button', { name: 'posts.loadErrorRetry' })).toHaveLength(1);
    expect(document.querySelector('[data-calendar-unavailable-frame]')).not.toBeNull();
    expect(document.querySelector('[data-calendar-load-error-empty]')).not.toBeNull();
    expect(document.querySelector('[data-calendar-error-nav]')).toBeNull();
    expect(document.querySelector('[data-calendar-error-weekdays]')).toBeNull();
    expect(document.querySelector('[data-calendar-grid-footprint]')).toBeNull();
    const loadError = document.querySelector('[data-calendar-load-error]');
    expect(loadError?.className).not.toMatch(/border-dashed/);
    expect(loadError?.className).not.toMatch(/bg-warning\/12/);
    expect(loadError?.closest('[data-calendar-card]')?.className).toMatch(/border-line/);
    expect(document.querySelector('[data-load-error-banner="true"]')).toBeNull();
    expect(alert.closest('.xl\\:col-span-2')).not.toBeNull();
    expect(retry.className).toMatch(/bg-brand/);
    expect(retry.className).toMatch(/text-white/);
    expect(retry.className).toMatch(/min-h-10/);
  });

  it('mutes disabled filters on a load error without a chevron affordance', () => {
    vi.mocked(useScheduleRangeQuery).mockReturnValue({
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: true,
      refetch: vi.fn(),
    } as never);
    render(<PostsPage />);
    for (const select of [screen.getByLabelText('posts.filterProvider'), screen.getByLabelText('posts.filterPersona')]) {
      expect(select).toBeDisabled();
      expect(select.className.split(/\s+/)).toContain('saturate-50');
      expect(select.className.split(/\s+/)).toContain('[&>svg]:hidden');
      expect(select.querySelector('svg.lucide-chevron-down')).not.toBeNull();
    }
  });

});

describe('PostsPage day pick on a phone', () => {
  const rangeSlots = [{ ...UPCOMING_SLOT, id: 'p5', slotAt: '2030-06-05T12:00:00.000Z', title: 'Phone pick' }];
  let scrollIntoView: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    scrollIntoView = vi.fn();
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const pickDay5 = async () => {
    const user = userEvent.setup();
    const day5 = screen.getByRole('button', { name: 'Wednesday, June 5' });
    await user.click(day5);
  };

  it('does not scroll on a wide screen', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined })));
    mockQueries({ range: rangeSlots });
    render(<PostsPage />);

    await pickDay5();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});

describe('PostsPage week view', () => {
  const mobileMatchMedia = (query: string) => ({
    matches: query === '(max-width: 767px)',
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  });

  let scrollIntoView: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    scrollIntoView = vi.fn();
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('opens the month view on a wide screen, with the view switcher', () => {
    render(<PostsPage />);

    expect(screen.getByRole('button', { name: 'posts.calendarPrevMonth' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'posts.calendarPrevWeek' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'posts.calendarViewMonth' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'posts.calendarViewWeek' })).toBeInTheDocument();
  });

  it('opens the month view on a narrow screen, with the view switcher', async () => {
    vi.stubGlobal('matchMedia', vi.fn(mobileMatchMedia));
    render(<PostsPage />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'posts.calendarPrevMonth' })).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'posts.calendarViewMonth' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'posts.calendarViewWeek' })).toBeInTheDocument();
  });

  it('lists the selected day below the month grid on a narrow screen', async () => {
    vi.stubGlobal('matchMedia', vi.fn(mobileMatchMedia));
    render(<PostsPage />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'posts.calendarPrevMonth' })).toBeInTheDocument(),
    );
    const panel = document.querySelector('section[aria-live="polite"]') as HTMLElement;
    expect(panel).not.toBeNull();
    expect(dayPanelCardText('Upcoming topic')).toBeInTheDocument();
    const card = document.querySelector('[data-calendar-card]') as HTMLElement;
    expect(card.parentElement?.nextElementSibling).toBe(panel);
  });

  it('shows the account empty state on a narrow screen without a tap, so an empty account is never a dead end', async () => {
    mockQueries({ schedules: [], range: [] });
    vi.stubGlobal('matchMedia', vi.fn(mobileMatchMedia));
    render(<PostsPage />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'posts.calendarPrevMonth' })).toBeInTheDocument(),
    );
    expect(screen.getByText('posts.accountEmptyTitle')).toBeInTheDocument();
    const accountEmpty = screen.getByText('posts.accountEmptyTitle').closest('[data-empty-state]');
    expect(within(accountEmpty as HTMLElement).getByRole('link', { name: 'posts.newPostAction' })).toBeInTheDocument();
  });

  it('puts the day panel below the week grid on a narrow screen, once a day is tapped', async () => {
    vi.stubGlobal('matchMedia', vi.fn(mobileMatchMedia));
    render(<PostsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'posts.calendarViewWeek' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'posts.calendarPrevWeek' })).toBeInTheDocument(),
    );
    const grid = document.querySelector('[data-posts-calendar-week]');
    if (grid === null) throw new Error('week grid not rendered');
    const columns = grid.querySelectorAll('[role="group"][aria-label]:not([inert])');
    expect(columns).toHaveLength(7);
    fireEvent.click(columns[6]);
    expect(dayPanelCardText('Upcoming topic')).toBeInTheDocument();
    const panel = document.querySelector('section[aria-live="polite"]') as HTMLElement;
    const card = document.querySelector('[data-calendar-card]') as HTMLElement;
    const calendarWrap = card.parentElement as HTMLElement;
    expect(panel.className).toContain('order-2');
    expect(calendarWrap.nextElementSibling).toBe(panel);
    expect(screen.getByText('posts.dayPanelSwitchHint')).toBeInTheDocument();
  });

  it('collapses the day panel when the same day is tapped again', async () => {
    vi.stubGlobal('matchMedia', vi.fn(mobileMatchMedia));
    render(<PostsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'posts.calendarViewWeek' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'posts.calendarPrevWeek' })).toBeInTheDocument(),
    );
    const columnsOf = () => {
      const grid = document.querySelector('[data-posts-calendar-week]');
      if (grid === null) throw new Error('week grid not rendered');
      return grid.querySelectorAll('[role="group"][aria-label]:not([inert])');
    };
    fireEvent.click(columnsOf()[6]);
    expect(dayPanelCardText('Upcoming topic')).toBeInTheDocument();
    fireEvent.click(columnsOf()[6]);
    expect(dayPanelCardText('Upcoming topic')).toBeUndefined();
    expect(document.querySelector('section[aria-live="polite"]')).not.toBeInTheDocument();
  });

  it('keeps today\'s day panel open from the Hoje button on a narrow screen, never toggling it shut', async () => {
    vi.stubGlobal('matchMedia', vi.fn(mobileMatchMedia));
    render(<PostsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'posts.calendarViewWeek' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'posts.calendarPrevWeek' })).toBeInTheDocument(),
    );
    const grid = document.querySelector('[data-posts-calendar-week]');
    if (grid === null) throw new Error('week grid not rendered');
    const columns = grid.querySelectorAll('[role="group"][aria-label]:not([inert])');
    fireEvent.click(columns[6]);
    expect(dayPanelCardText('Upcoming topic')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'posts.calendarGoToToday' }));
    expect(dayPanelCardText('Upcoming topic')).toBeInTheDocument();
  });

  it('switches the day panel to another day on tap', async () => {
    const maySlot = { ...UPCOMING_SLOT, id: 'u2', slotAt: '2030-05-28T10:00:00.000Z', title: 'May topic' };
    mockQueries({ range: [UPCOMING_SLOT, maySlot] });
    vi.stubGlobal('matchMedia', vi.fn(mobileMatchMedia));
    render(<PostsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'posts.calendarViewWeek' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'posts.calendarPrevWeek' })).toBeInTheDocument(),
    );
    const columnsOf = () => {
      const grid = document.querySelector('[data-posts-calendar-week]');
      if (grid === null) throw new Error('week grid not rendered');
      return grid.querySelectorAll('[role="group"][aria-label]:not([inert])');
    };
    fireEvent.click(columnsOf()[6]);
    expect(dayPanelCardText('Upcoming topic')).toBeInTheDocument();
    fireEvent.click(columnsOf()[2]);
    expect(dayPanelCardText('May topic')).toBeInTheDocument();
    expect(dayPanelCardText('Upcoming topic')).toBeUndefined();
  });

  it('shows the tapped day as a summarized card: one line per video, no thumbnails', async () => {
    vi.stubGlobal('matchMedia', vi.fn(mobileMatchMedia));
    render(<PostsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'posts.calendarViewWeek' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'posts.calendarPrevWeek' })).toBeInTheDocument(),
    );
    const grid = document.querySelector('[data-posts-calendar-week]');
    if (grid === null) throw new Error('week grid not rendered');
    const columns = grid.querySelectorAll('[role="group"][aria-label]:not([inert])');
    fireEvent.click(columns[6]);
    const panel = document.querySelector('section[aria-live="polite"]') as HTMLElement;
    expect(panel.querySelector('video')).toBeNull();
    expect(within(panel).getByText('Upcoming topic')).toBeInTheDocument();
    expect(within(panel).getByText('Viva Leve')).toBeInTheDocument();
    expect(within(panel).getByText('posts.groupScheduled')).toBeInTheDocument();
    const heading = panel.querySelector('h2') as HTMLElement;
    expect(heading.textContent).toBe('Saturday, Jun 1 · posts.calendarDayPostCountOne');
  });

  it('switches to the week view from the desktop switcher', async () => {
    render(<PostsPage />);

    fireEvent.click(screen.getByRole('button', { name: 'posts.calendarViewWeek' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'posts.calendarPrevWeek' })).toBeInTheDocument(),
    );
  });

  it('moves the month cursor with the shown week so the range read stays within the API span', async () => {
    vi.stubGlobal('matchMedia', vi.fn(mobileMatchMedia));
    render(<PostsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'posts.calendarViewWeek' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'posts.calendarNextWeek' })).toBeInTheDocument(),
    );
    for (let i = 0; i < 6; i++) {
      fireEvent.click(screen.getByRole('button', { name: 'posts.calendarNextWeek' }));
    }
    const calls = vi.mocked(useScheduleRangeQuery).mock.calls;
    const last = calls[calls.length - 1];
    const expected = gridRange(buildMonthGrid(2030, 6, 0));
    expect(last).toEqual(['2030-07', expected.from, expected.to, true]);
  });

  it('keeps the range read within the API span when browsing many weeks ahead', async () => {
    vi.stubGlobal('matchMedia', vi.fn(mobileMatchMedia));
    render(<PostsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'posts.calendarViewWeek' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'posts.calendarNextWeek' })).toBeInTheDocument(),
    );
    for (let i = 0; i < 10; i++) {
      fireEvent.click(screen.getByRole('button', { name: 'posts.calendarNextWeek' }));
    }
    const calls = vi.mocked(useScheduleRangeQuery).mock.calls;
    const last = calls[calls.length - 1];
    const spanDays = (Date.parse(last[2] as string) - Date.parse(last[1] as string)) / 86400000;
    expect(spanDays).toBeLessThanOrEqual(62);
  });

  it('clears the pick when the shown week moves on, so the panel never names an abandoned day', async () => {
    const julySlot = { ...UPCOMING_SLOT, id: 'u2', slotAt: '2030-07-08T10:00:00.000Z', title: 'July topic' };
    mockQueries({ range: [UPCOMING_SLOT, julySlot] });
    vi.stubGlobal('matchMedia', vi.fn(mobileMatchMedia));
    render(<PostsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'posts.calendarViewWeek' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'posts.calendarPrevWeek' })).toBeInTheDocument(),
    );
    const grid = document.querySelector('[data-posts-calendar-week]');
    if (grid === null) throw new Error('week grid not rendered');
    const columns = grid.querySelectorAll('[role="group"][aria-label]:not([inert])');
    expect(columns).toHaveLength(7);
    fireEvent.click(columns[6]);
    expect(dayPanelCardText('Upcoming topic')).toBeInTheDocument();
    for (let i = 0; i < 6; i++) {
      fireEvent.click(screen.getByRole('button', { name: 'posts.calendarNextWeek' }));
    }
    expect(dayPanelCardText('July topic')).toBeInTheDocument();
  });

  it('keeps the range read within the API span when switching to week from an empty month', async () => {
    render(<PostsPage />);

    fireEvent.click(screen.getByRole('button', { name: 'posts.calendarNextMonth' }));
    fireEvent.click(screen.getByRole('button', { name: 'posts.calendarViewWeek' }));
    const calls = vi.mocked(useScheduleRangeQuery).mock.calls;
    const last = calls[calls.length - 1];
    const spanDays = (Date.parse(last[2] as string) - Date.parse(last[1] as string)) / 86400000;
    expect(spanDays).toBeLessThanOrEqual(62);
  });

  it('shows a picked day in another month even when the cursor month has no posts', async () => {
    const maySlot = { ...UPCOMING_SLOT, id: 'u2', slotAt: '2030-05-28T10:00:00.000Z', title: 'May topic' };
    mockQueries({ range: [maySlot] });
    vi.stubGlobal('matchMedia', vi.fn(mobileMatchMedia));
    render(<PostsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'posts.calendarViewWeek' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'posts.calendarPrevWeek' })).toBeInTheDocument(),
    );
    const grid = document.querySelector('[data-posts-calendar-week]');
    if (grid === null) throw new Error('week grid not rendered');
    const columns = grid.querySelectorAll('[role="group"][aria-label]:not([inert])');
    expect(columns).toHaveLength(7);
    fireEvent.click(columns[2]);
    expect(dayPanelCardText('May topic')).toBeInTheDocument();
  });

  it('scrolls the day panel into view after a column pick on a narrow screen', async () => {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      ...mobileMatchMedia(query),
      matches: query === '(max-width: 767px)' || query === '(max-width: 639px)',
    })));
    render(<PostsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'posts.calendarViewWeek' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'posts.calendarPrevWeek' })).toBeInTheDocument(),
    );
    const grid = document.querySelector('[data-posts-calendar-week]');
    if (grid === null) throw new Error('week grid not rendered');
    const columns = grid.querySelectorAll('[role="group"][aria-label]:not([inert])');
    expect(columns).toHaveLength(7);
    const user = userEvent.setup();
    await user.click(columns[0]);
    expect(screen.getByText('posts.calendarDayNone')).toBeInTheDocument();
    await waitFor(() => {
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    });
  });

  it('scrolls the day panel into view after a column pick at 700px, where only the mobile query matches', async () => {
    vi.stubGlobal('matchMedia', vi.fn(mobileMatchMedia));
    render(<PostsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'posts.calendarViewWeek' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'posts.calendarPrevWeek' })).toBeInTheDocument(),
    );
    const grid = document.querySelector('[data-posts-calendar-week]');
    if (grid === null) throw new Error('week grid not rendered');
    const columns = grid.querySelectorAll('[role="group"][aria-label]:not([inert])');
    expect(columns).toHaveLength(7);
    const user = userEvent.setup();
    await user.click(columns[6]);
    expect(dayPanelCardText('Upcoming topic')).toBeInTheDocument();
    await waitFor(() => {
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    });
  });
});

describe('PostsPage calendar date hints', () => {
  it('marks the Today control pressed while today is the selected day', () => {
    render(<PostsPage />);
    const today = screen.getByRole('button', { name: 'posts.calendarGoToToday' });
    expect(today.getAttribute('aria-pressed')).toBe('true');
  });

  it('marks the Today control unpressed after another day is picked', async () => {
    const user = userEvent.setup();
    render(<PostsPage />);
    await user.click(screen.getByRole('button', { name: 'Sunday, June 2' }));
    const today = screen.getByRole('button', { name: 'posts.calendarGoToToday' });
    expect(today.getAttribute('aria-pressed')).toBe('false');
  });

  it('shows the unknown-title fallback on a slot chip with no title', () => {
    mockQueries({ range: [{ ...UPCOMING_SLOT, title: undefined }] });
    render(<PostsPage />);
    const card = document.querySelector('[data-calendar-card]') as HTMLElement;
    expect(within(card).getByText('posts.unknownTitle')).toBeInTheDocument();
  });
});

describe('PostsPage access pause', () => {
  const access = (active: boolean, reason: 'trial' | 'subscription' | 'none' = 'trial') => ({
    data: { active, endsAt: '2030-01-01T00:00:00.000Z', daysLeft: active ? 3 : 0, reason },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  });

  it('labels a ready slot as paused when the account has no active access', () => {
    vi.mocked(useAccessQuery).mockReturnValue(access(false) as never);
    render(<PostsPage />);
    const badge = document.querySelector('[data-status="paused"]');
    expect(badge).not.toBeNull();
    expect(badge).toHaveTextContent('posts.groupPaused');
  });

  it('keeps a ready slot scheduled while access is active', () => {
    vi.mocked(useAccessQuery).mockReturnValue(access(true) as never);
    render(<PostsPage />);
    expect(document.querySelector('[data-status="paused"]')).toBeNull();
    expect(document.querySelector('[data-status="ready"]')).not.toBeNull();
  });

  it('does nothing while the access window is still loading', () => {
    const refetch = vi.fn();
    vi.mocked(useScheduleRangeQuery).mockReturnValue({
      data: { slots: [UPCOMING_SLOT], truncated: false },
      isLoading: false,
      isFetching: false,
      isError: false,
      refetch,
    } as never);
    vi.mocked(useAccessQuery).mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
      refetch: vi.fn(),
    } as never);
    render(<PostsPage />);
    expect(refetch).not.toHaveBeenCalled();
    expect(document.querySelector('[data-status="paused"]')).toBeNull();
  });

  it('paints the calendar event gray once access is gone', () => {
    vi.mocked(useAccessQuery).mockReturnValue(access(false, 'none') as never);
    render(<PostsPage />);
    const card = calendarCard();
    expect(card.querySelector('[class*="event-gray"]')).not.toBeNull();
  });

  it('refetches the range when access flips from active to inactive', () => {
    const refetch = vi.fn();
    vi.mocked(useScheduleRangeQuery).mockReturnValue({
      data: { slots: [UPCOMING_SLOT], truncated: false },
      isLoading: false,
      isFetching: false,
      isError: false,
      refetch,
    } as never);
    vi.mocked(useAccessQuery).mockReturnValue(access(true) as never);
    const view = render(<PostsPage />);
    expect(refetch).not.toHaveBeenCalled();
    vi.mocked(useAccessQuery).mockReturnValue(access(false) as never);
    view.rerender(<PostsPage />);
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
