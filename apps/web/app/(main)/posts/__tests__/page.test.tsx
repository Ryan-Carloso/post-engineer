import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';

//---------------
// Tests for the Posts page (the posts calendar across all accounts).
// Network (lib/api) mocked; everything else real. "Today" is pinned to
// 2030-06-01 (UPCOMING_SLOT's day), so the calendar opens on a day that
// lists it below the grid.
//---------------

vi.mock('@/lib/api', () => ({
  useSchedulesQuery: vi.fn(),
  usePersonaListQuery: vi.fn(),
  useYouTubeAccountsQuery: vi.fn(),
  useInstagramAccountsQuery: vi.fn(),
  useLinkedinAccountsQuery: vi.fn(),
  useThreadsAccountsQuery: vi.fn(() => ({ data: { authenticated: true, accounts: [] }, isLoading: false, isError: false, error: null, refetch: vi.fn() })),
  useFacebookAccountsQuery: vi.fn(() => ({ data: { authenticated: true, accounts: [] }, isLoading: false, isError: false, error: null, refetch: vi.fn() })),
  useBlueskyAccountsQuery: vi.fn(),
}));

vi.mock('@/lib/social-accounts-queries', () => ({
  useRumbleAccountsQuery: vi.fn(() => ({ data: { authenticated: true, accounts: [] }, isLoading: false, isError: false, error: null, refetch: vi.fn() })),
}));

vi.mock('@/lib/schedule-range', () => ({
  RANGE_MAX_SLOTS: 1000,
  useScheduleRangeQuery: vi.fn(),
  useHasAnyPostQuery: vi.fn(() => ({ data: true, isLoading: false, refetch: vi.fn() })),
}));

vi.mock('next/image', () => ({
  // eslint-disable-next-line jsx-a11y/alt-text, @next/next/no-img-element
  default: (props: React.ComponentProps<'img'>) => <img {...props} />,
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
  useYouTubeAccountsQuery,
  useInstagramAccountsQuery,
  useLinkedinAccountsQuery,
  useBlueskyAccountsQuery,
} from '@/lib/api';

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
  status: 'awaiting',
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
} = {}) {
  vi.mocked(useScheduleRangeQuery).mockReturnValue({
    // The calendar reads the range; `upcoming` fixtures feed it too.
    data: { slots: (overrides.range ?? overrides.upcoming ?? [UPCOMING_SLOT]) as never, truncated: overrides.rangeTruncated ?? false },
    isLoading: false,
    isFetching: false,
    isError: false,
    refetch: vi.fn(),
  } as never);
  // The account has posts somewhere unless a test says otherwise.
  vi.mocked(useHasAnyPostQuery).mockReturnValue({ data: true, isLoading: false, isError: false, refetch: vi.fn() } as never);
  vi.mocked(useSchedulesQuery).mockReturnValue({
    data: (overrides.schedules ?? [SCHEDULE]) as never,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  } as never);
  vi.mocked(usePersonaListQuery).mockReturnValue({
    data: [{ id: 'p1', name: 'Viva Leve', avatarUrl: 'https://example.test/viva.jpg' }] as never,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  } as never);
  vi.mocked(useYouTubeAccountsQuery).mockReturnValue({
    data: { authenticated: true, accounts: [{ provider: 'youtube', channelId: 'ch1', channelName: 'Europa Na Estrada' }] },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  } as never);
  vi.mocked(useInstagramAccountsQuery).mockReturnValue({
    data: { authenticated: true, accounts: [{ provider: 'instagram', igUserId: 'ig1', username: 'vivalave' }] },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  } as never);
  vi.mocked(useLinkedinAccountsQuery).mockReturnValue({
    data: { authenticated: true, accounts: [] },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  } as never);
  vi.mocked(useBlueskyAccountsQuery).mockReturnValue({
    data: { authenticated: true, accounts: [] },
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

// A selected day's slot shows twice: the grid chip and the day-panel card.
// The card is the link; the chip is not. These assertions pin the card.
const dayPanelCardTitle = (title: string) =>
  screen.getAllByText(title).find((element) => element.closest('a') !== null);

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
  it("opens on the calendar with today's posts below it: title, persona, status and network glyphs", () => {
    render(<PostsPage />);

    expect(dayPanelCardTitle('Upcoming topic')).toBeInTheDocument();
    expect(screen.getByText('Viva Leve')).toBeInTheDocument();
    // An awaiting post carries the calendar's own word for it.
    const row = dayPanelCardTitle('Upcoming topic')?.closest('a') as HTMLElement;
    expect(within(row).getByText('posts.groupScheduled')).toBeInTheDocument();
    expect(within(row).queryByText('posts.statusPending')).not.toBeInTheDocument();
    // The row names the networks it targets; the account labels stay in the
    // filter, where a full name belongs, and the row keeps a glyph per network.
    expect(row.querySelectorAll('[role="img"]')).toHaveLength(2);
    expect(row.querySelector('[aria-label="youtube"]')).not.toBeNull();
    expect(row.querySelector('[aria-label="instagram"]')).not.toBeNull();
    expect(screen.getAllByText('Europa Na Estrada').length).toBe(1);
    // History items are hidden on the calendar tab
    expect(screen.queryByText('Past topic')).not.toBeInTheDocument();
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
    // A post created without a persona (migration 012) never had one:
    // saying "persona removed" would be a lie about it.
    mockQueries({ schedules: [{ ...SCHEDULE, personaId: null }] });
    render(<PostsPage />);

    expect(dayPanelCardTitle('Upcoming topic')).toBeInTheDocument();
    expect(screen.getByText('posts.noPersona')).toBeInTheDocument();
    expect(screen.queryByText('posts.personaFallback')).not.toBeInTheDocument();
  });

  it('reads title first, then persona, time and networks, with the status chip last', () => {
    render(<PostsPage />);

    const row = dayPanelCardTitle('Upcoming topic')?.closest('a');
    expect(row).not.toBeNull();
    const text = row?.textContent ?? '';
    // One dense line: the title is the row's main line, the persona and the
    // time are its supporting line, and the status chip closes the row.
    expect(text.indexOf('Upcoming topic')).toBeLessThan(text.indexOf('Viva Leve'));
    const personaIndex = text.indexOf('Viva Leve');
    const timeIndex = text.search(/\d{1,2}:\d{2}/);
    expect(timeIndex).toBeGreaterThan(personaIndex);
    expect(text.indexOf('posts.groupScheduled')).toBeGreaterThan(timeIndex);
    // The day heading already names the date: the row repeats only the time.
    expect(text).not.toContain('2030');
    expect(text).not.toContain('Jun');
    // The title is the row's main line, the persona the supporting one.
    expect((dayPanelCardTitle('Upcoming topic') as HTMLElement).className.split(/\s+/)).toContain('font-semibold');
    expect(screen.getByText('Viva Leve').parentElement?.className.split(/\s+/)).toContain('text-muted-foreground');
    // The networks sit on the supporting line as glyphs, with no label.
    const support = screen.getByText('Viva Leve').parentElement;
    expect(support?.querySelector('[aria-label="youtube"]')).not.toBeNull();
    expect(support?.textContent).not.toContain('Europa Na Estrada');
  });

  it('filters slots by provider', async () => {
    const user = userEvent.setup();
    render(<PostsPage />);

    const selects = screen.getAllByRole('combobox');
    // First select is the provider filter
    await user.selectOptions(selects[0], 'linkedin');

    // The filter empties the whole month: the panel names the month and
    // offers to clear the filters.
    expect(screen.getByText('posts.filterMonthEmptyTitle')).toBeInTheDocument();
    expect(screen.getByText('posts.calendarMonthHeading')).toBeInTheDocument();
    expect(screen.queryByText('Upcoming topic')).not.toBeInTheDocument();
  });

  it('shows the filter empty state, not the day empty state, when a filter empties the selected day', async () => {
    const user = userEvent.setup();
    // Two schedules, one per network: the June 1 post is YouTube-only, the
    // June 5 post Instagram-only. Today (June 1) stays selected while the
    // filter hides its post, so the month still has posts but the day has none.
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
    expect(dayPanelCardTitle('Upcoming topic')).toBeInTheDocument();

    const selects = screen.getAllByRole('combobox');
    await user.selectOptions(selects[0], 'instagram');

    expect(screen.queryByText('Upcoming topic')).not.toBeInTheDocument();
    expect(screen.getByText('posts.filterMonthEmptyTitle')).toBeInTheDocument();
    // The filter bar has its own clear button; scope to the day section to
    // prove the empty state itself offers to clear the filters.
    const daySection = screen.getByText('posts.filterMonthEmptyTitle').closest('section');
    expect(within(daySection as HTMLElement).getByRole('button', { name: 'posts.clearFilters' })).toBeInTheDocument();
    expect(screen.queryByText('posts.calendarDayNone')).not.toBeInTheDocument();
  });

  it('marks an applied filter and clears every filter with one action', async () => {
    const user = userEvent.setup();
    render(<PostsPage />);
    expect(screen.queryByRole('button', { name: 'posts.clearFilters' })).not.toBeInTheDocument();

    const selects = screen.getAllByRole('combobox');
    await user.selectOptions(selects[0], 'youtube');
    expect(selects[0].className.split(/\s+/)).toContain('border-primary');
    expect(selects[1].className.split(/\s+/)).not.toContain('border-primary');
    // The applied filter marks the select and offers one clear action.
    expect(screen.getAllByRole('button', { name: 'posts.clearFilters' })).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'posts.clearFilters' }));
    expect(selects[0]).toHaveValue('all');
    expect(dayPanelCardTitle('Upcoming topic')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'posts.clearFilters' })).not.toBeInTheDocument();
  });

  it('filters slots by account', async () => {
    const user = userEvent.setup();
    render(<PostsPage />);

    const selects = screen.getAllByRole('combobox');
    // Second select is the account filter — pick the instagram account
    await user.selectOptions(selects[1], 'ig1');

    expect(dayPanelCardTitle('Upcoming topic')).toBeInTheDocument();
  });

  it('hides slots when the schedule does not target the filtered account', async () => {
    const user = userEvent.setup();
    mockQueries({
      schedules: [{ ...SCHEDULE, youtubeAccountIds: [], instagramAccountIds: [] }],
    });
    render(<PostsPage />);

    const selects = screen.getAllByRole('combobox');
    await user.selectOptions(selects[1], 'ig1');

    await waitFor(() => {
      expect(screen.queryByText('Upcoming topic')).not.toBeInTheDocument();
    });
    expect(screen.getByText('posts.filterMonthEmptyTitle')).toBeInTheDocument();
  });

  it('hides slots whose schedule no longer exists', () => {
    mockQueries({ schedules: [{ ...SCHEDULE, id: 's-other' }] });
    render(<PostsPage />);

    expect(screen.queryByText('Upcoming topic')).not.toBeInTheDocument();
    // No post left in the month: the month empty state, with its next step.
    expect(screen.getByText('posts.calendarMonthEmptyTitle')).toBeInTheDocument();
  });

  it('shows the account empty state, not an empty calendar, when the account has no schedule at all', () => {
    // Every post belongs to a schedule: without one, no month has posts.
    mockQueries({ schedules: [], range: [] });
    render(<PostsPage />);

    expect(screen.getByText('posts.accountEmptyTitle')).toBeInTheDocument();
    expect(screen.getByText('posts.accountEmptyHint')).toBeInTheDocument();
    const accountEmpty = screen.getByText('posts.accountEmptyTitle').closest('[data-empty-state]');
    expect(within(accountEmpty as HTMLElement).getByRole('link', { name: 'posts.newPostAction' })).toBeInTheDocument();
    // The frame stays: a faint calendar and disabled filters. No day to pick,
    // and the line under the title does not say to select one.
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
    // The panel is scoped like its message: it names the month, not a day.
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('posts.calendarMonthHeading');
    expect(screen.queryByText('posts.calendarDayHeading')).not.toBeInTheDocument();
    // Empty month still shows the header Today control (no duplicate in the panel).
    expect(screen.getByRole('button', { name: 'posts.calendarGoToToday' })).toBeInTheDocument();
    // The calendar stays, and an empty day shows no event chips.
    expect(document.querySelector('[data-calendar-card]')).not.toBeNull();
    expect(screen.queryByText(/posts\.group(Published|Failed|Scheduled):/)).not.toBeInTheDocument();
  });

  it('tells "no posts yet" apart from an empty month when the account never had a post', () => {
    mockQueries({ range: [] });
    vi.mocked(useHasAnyPostQuery).mockReturnValue({ data: false, isLoading: false, refetch: vi.fn() } as never);
    render(<PostsPage />);

    // Asked only because the month it opens on is empty.
    expect(vi.mocked(useHasAnyPostQuery).mock.calls.at(-1)?.[0]).toBe(true);
    expect(screen.getByText('posts.accountEmptyTitle')).toBeInTheDocument();
    const neverPosted = screen.getByText('posts.accountEmptyTitle').closest('[data-empty-state]');
    expect(within(neverPosted as HTMLElement).getByRole('link', { name: 'posts.newPostAction' })).toBeInTheDocument();
    // No day heading. The calendar and the filters stay, and the filters
    // cannot be used while there is nothing to filter.
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

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('posts.calendarMonthEmptyTitle')).not.toBeInTheDocument();
  });

  it('returns to today from an empty future month using the header Today control', async () => {
    const user = userEvent.setup();
    render(<PostsPage />);

    await user.click(screen.getByRole('button', { name: 'posts.calendarNextMonth' }));
    expect(screen.getByText('posts.calendarMonthEmptyTitle')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'posts.calendarGoToToday' }));
    expect(dayPanelCardTitle('Upcoming topic')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('posts.calendarDayHeading');
  });

  it('names the day, not the month, for an empty day in a month with posts', async () => {
    const user = userEvent.setup();
    render(<PostsPage />);

    // The day-number button carries the full date as its accessible name.
    const day2 = screen.getByRole('button', { name: 'Sunday, June 2' });
    await user.click(day2 as HTMLElement);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('posts.calendarDayHeading');
    expect(screen.getByText('posts.calendarDayNone')).toBeInTheDocument();
    expect(screen.queryByText('posts.calendarMonthEmptyTitle')).not.toBeInTheDocument();
  });

  it('shows a loading skeleton with the shown month\'s weeks while the calendar range is loading', () => {
    vi.mocked(useScheduleRangeQuery).mockReturnValue({ data: undefined, isLoading: true, isFetching: false, isError: false, refetch: vi.fn() } as never);

    render(<PostsPage />);
    // A skeleton keeps the calendar layout in place, including the side
    // panel. The loading text is visible, and the filters wait for data.
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('posts.loadingPosts')).toBeVisible();
    expect(screen.getByText('posts.loadingPosts').className.split(/\s+/)).not.toContain('sr-only');
    expect(document.querySelector('[data-skeleton-panel]')).not.toBeNull();
    for (const select of screen.getAllByRole('combobox')) expect(select).toBeDisabled();
    expect(screen.queryByTestId('icon-spinner')).not.toBeInTheDocument();
    // June 2030 starts on a Saturday and spans 6 weeks.
    expect(document.querySelectorAll('[data-skeleton-day]')).toHaveLength(42);
  });

  it('puts the day panel beside the calendar on wide screens', () => {
    render(<PostsPage />);
    const layout = document.querySelector('[data-calendar-card]')?.closest('.xl\\:grid');
    expect(layout).not.toBeNull();
    expect(layout?.querySelector('section')).toHaveTextContent('Upcoming topic');
  });

  it('shows the error state when the personas query fails', () => {
    // A failed personas fetch must not silently render "Removed persona"
    // labels — the error state covers it, same as the other queries.
    vi.mocked(usePersonaListQuery).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: vi.fn(),
    } as never);

    render(<PostsPage />);
    // The error names the supporting data, not the calendar posts.
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('posts.loadErrorSupporting');
    const sideNote = document.querySelector('[data-day-unavailable-note]');
    expect(sideNote).not.toBeNull();
    expect(within(sideNote as HTMLElement).getByText('posts.loadErrorSideQuiet')).toBeInTheDocument();
  });

  it('shows the error state when an account query fails', () => {
    // A failed account fetch must not silently render empty filter
    // dropdowns — the error state covers it, same as the other queries.
    vi.mocked(useYouTubeAccountsQuery).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: vi.fn(),
    } as never);

    render(<PostsPage />);
    expect(screen.getByRole('alert')).toHaveTextContent('posts.loadErrorSupporting');
  });

  it('retry refetches the account queries as well', async () => {
    const youtubeRefetch = vi.fn();
    vi.mocked(useYouTubeAccountsQuery).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: youtubeRefetch,
    } as never);
    const user = userEvent.setup();
    render(<PostsPage />);

    // Without this, a failed account fetch could never clear without a
    // full page reload.
    await user.click(screen.getByRole('button', { name: 'posts.loadErrorRetry' }));
    expect(youtubeRefetch).toHaveBeenCalledTimes(1);
  });

  it('moves "today" past midnight without a reload', async () => {
    // todayKey is computed on every render, not once at mount — a page left
    // open overnight must mark the new day and jump to it.
    const user = userEvent.setup();
    const { rerender } = render(<PostsPage />);
    // Today is the lib's filled primary chip on its day number (the gold
    // numeral is a CSS override, checked visually, not in jsdom).
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
    // June 2 has no posts: the day panel says so, and June 1's card is gone.
    expect(screen.getByText('posts.calendarDayNone')).toBeInTheDocument();
    expect(dayPanelCardTitle('Upcoming topic')).toBeUndefined();
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

    // Without this, a failed personas fetch could never clear without a
    // full page reload.
    await user.click(screen.getByRole('button', { name: 'posts.loadErrorRetry' }));
    expect(personasRefetch).toHaveBeenCalledTimes(1);
  });

  it('resets the account filter when switching to a network the account does not belong to', async () => {
    // Otherwise the stale selection silently reactivates when switching
    // the network filter back.
    const user = userEvent.setup();
    render(<PostsPage />);

    await user.selectOptions(screen.getByLabelText('posts.filterAccount'), 'ch1');
    expect(screen.getByLabelText('posts.filterAccount')).toHaveValue('ch1');

    await user.selectOptions(screen.getByLabelText('posts.filterProvider'), 'instagram');
    expect(screen.getByLabelText('posts.filterAccount')).toHaveValue('all');

    await user.selectOptions(screen.getByLabelText('posts.filterProvider'), 'all');
    expect(screen.getByLabelText('posts.filterAccount')).toHaveValue('all');
  });

  it('keeps the account filter when switching to a network the account belongs to', async () => {
    const user = userEvent.setup();
    render(<PostsPage />);

    await user.selectOptions(screen.getByLabelText('posts.filterAccount'), 'ch1');
    await user.selectOptions(screen.getByLabelText('posts.filterProvider'), 'youtube');
    expect(screen.getByLabelText('posts.filterAccount')).toHaveValue('ch1');
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
  const GENERATING_SLOT = {
    id: 'g1',
    scheduleId: 's1',
    slotAt: '2030-06-01T10:00:00.000Z',
    status: 'generating',
    title: 'Generating topic',
    error: null,
    publishedAt: null,
    taskId: 'task-42',
    progress: 42,
    stage: 'lipsync',
  };

  const AWAITING_SLOT = {
    id: 'a1',
    scheduleId: 's1',
    slotAt: '2030-06-01T11:00:00.000Z',
    status: 'awaiting',
    title: 'Awaiting topic',
    error: null,
    publishedAt: null,
    taskId: null,
    progress: 0,
    stage: null,
  };

  it('shows the live progress percent on a generating card', () => {
    mockQueries({ upcoming: [GENERATING_SLOT] });
    render(<PostsPage />);

    expect(screen.getByText('42%')).toBeInTheDocument();
    const bar = screen.getByRole('progressbar', { name: 'posts.progressLabel' });
    expect(bar).toHaveAttribute('aria-valuenow', '42');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
  });

  it('shows no progress bar on an awaiting card — 0% of work not started yet looks stuck', () => {
    mockQueries({ upcoming: [AWAITING_SLOT] });
    render(<PostsPage />);

    expect(dayPanelCardTitle('Awaiting topic')).toBeInTheDocument();
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

});

//---------------
// Mutation hardening — fallback branches and statuses the 58%
// ui-coverage-gates Stryker run flagged as surviving (threshold 60%).
// Each test pins one fallback so the gate stays green.
//---------------

describe('PostsPage fallbacks', () => {
  it('renders the pending badge style for an unknown slot status', () => {
    mockQueries({
      upcoming: [{ ...UPCOMING_SLOT, id: 'u9', status: 'weird_status', topic: 'Weird topic' }],
    });
    render(<PostsPage />);

    // Unknown statuses degrade to the scheduled look the calendar counts
    // them under, never an unstyled badge.
    const badge = within(dayPanelCardTitle('Upcoming topic')?.closest('a') as HTMLElement).getByText('posts.groupScheduled');
    expect(badge.className).toContain('bg-line');
  });

  it('shows a progress bar on a publishing card but not on a ready one', () => {
    const readySlot = {
      ...UPCOMING_SLOT,
      id: 'u7',
      status: 'ready',
      title: 'Ready topic',
      progress: 71,
      taskId: 'task-7',
    };
    const publishingSlot = {
      ...UPCOMING_SLOT,
      id: 'u8',
      status: 'publishing',
      title: 'Publishing topic',
      progress: 88,
      taskId: 'task-8',
    };
    mockQueries({ upcoming: [readySlot, publishingSlot] });
    render(<PostsPage />);

    // A ready video has nothing left to fill; publishing is live work.
    expect(screen.queryByText('71%')).not.toBeInTheDocument();
    expect(screen.getByText('88%')).toBeInTheDocument();
    expect(screen.getAllByRole('progressbar', { name: 'posts.progressLabel' })).toHaveLength(1);
  });

  it('falls back to the persona placeholder for slots whose persona is gone', () => {
    mockQueries({ schedules: [{ ...SCHEDULE, personaId: 'p-gone' }] });
    render(<PostsPage />);

    expect(screen.getByText('posts.personaFallback')).toBeInTheDocument();
  });

  it('draws at most three network glyphs per row, whatever the schedule targets', () => {
    mockQueries();
    const accounts = ['Alpha One', 'Beta Two', 'Gamma Three', 'Delta Four', 'Epsilon Five'].map(
      (name, i) => ({ channelId: `ch${i}`, channelName: name }),
    );
    vi.mocked(useYouTubeAccountsQuery).mockReturnValue({
      data: { authenticated: true, accounts },
    } as never);
    vi.mocked(useSchedulesQuery).mockReturnValue({
      data: [{ ...SCHEDULE, youtubeAccountIds: accounts.map((a) => a.channelId) }] as never,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as never);
    render(<PostsPage />);

    const row = dayPanelCardTitle('Upcoming topic')?.closest('a') as HTMLElement;
    // 5 YouTube accounts + the Instagram account resolve to 6 accounts; the
    // glyph strip stops at 3 so the row never wraps.
    expect(row.querySelectorAll('[role="img"]')).toHaveLength(3);
  });

  it('labels every provider filter option with its own network name', () => {
    render(<PostsPage />);

    const providerSelect = screen.getByLabelText('posts.filterProvider');
    const options = within(providerSelect)
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(options).toEqual(['posts.allProviders', 'YouTube', 'Instagram', 'LinkedIn', 'Bluesky', 'Threads', 'Facebook', 'Rumble']);
  });

});

//---------------
// Calendar tab: per-day chips, day selection and the filters applied to
// the range read.
//---------------
describe('PostsPage calendar view', () => {
  const rangeSlots = [
    {
      ...UPCOMING_SLOT,
      id: 'c1',
      status: 'generating',
      slotAt: '2030-06-05T12:00:00.000Z',
      title: 'Calendar upcoming',
      taskId: 'task-42',
      progress: 42,
      stage: 'lipsync',
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
    expect(dayPanelCardTitle('Calendar upcoming')).toBeInTheDocument();
    expect(dayPanelCardTitle('Today slot')).toBeUndefined();

    await user.click(screen.getByRole('button', { name: 'posts.calendarGoToToday' }));
    expect(dayPanelCardTitle('Today slot')).toBeInTheDocument();
  });

  it('reads the visible 6-week grid as one range', () => {
    mockQueries({ range: rangeSlots });
    render(<PostsPage />);

    const [monthKey, from, to, enabled] = vi.mocked(useScheduleRangeQuery).mock.calls.at(-1) ?? [];
    expect(enabled).toBe(true);
    expect(monthKey).toBe('2030-06');
    // The 6-week grid covers the month plus leading/trailing days.
    expect(new Date(from as string).getTime()).toBeLessThanOrEqual(new Date(2030, 5, 1).getTime());
    expect(new Date(to as string).getTime()).toBeGreaterThanOrEqual(new Date(2030, 6, 1).getTime());
    expect(document.querySelector('[data-calendar-card]')).not.toBeNull();
  });

  it('lists the selected day posts below the calendar, past and future together', async () => {
    mockQueries({ range: rangeSlots });
    const user = userEvent.setup();
    render(<PostsPage />);

    // Today (June 15) is selected on open.
    expect(dayPanelCardTitle('Today slot')).toBeInTheDocument();
    const day5 = screen.getByRole('button', { name: 'Wednesday, June 5' });
    await user.click(day5);

    expect(dayPanelCardTitle('Calendar upcoming')).toBeInTheDocument();
    expect(dayPanelCardTitle('Calendar published')).toBeInTheDocument();
    expect(dayPanelCardTitle('Calendar failed')).toBeUndefined();
  });

  it('applies the provider filter to calendar slots', async () => {
    mockQueries({ range: rangeSlots });
    const user = userEvent.setup();
    render(<PostsPage />);

    await user.selectOptions(screen.getAllByRole('combobox')[0], 'linkedin');

    // No slot matches the filter: no event chip anywhere in the grid.
    expect(document.querySelectorAll('[data-event-id]')).toHaveLength(0);
  });

  it('shows one scheduled chip and no persona in the cell for a day with one awaiting post', () => {
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

    // The error names the calendar posts, not the supporting data.
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

    // The June grid's last week shows July 1-6 as outside days; picking
    // one must not leave the calendar on June with a July detail below.
    // Outside days are the muted day numbers of the next month.
    const july1 = screen.getByRole('button', { name: 'Monday, July 1' });
    expect(july1.className.split(/\s+/)).toContain('text-muted-foreground');
    await user.click(july1);

    expect(screen.getByText(/July 2030/)).toBeInTheDocument();
    expect(vi.mocked(useScheduleRangeQuery).mock.calls.at(-1)?.[0]).toBe('2030-07');
  });

  it('month navigation leaves no day selected in a month without posts', async () => {
    mockQueries({ range: rangeSlots });
    const user = userEvent.setup();
    render(<PostsPage />);

    // Today (June 15) is selected on open. July has no posts, so the panel
    // talks about the month and no day stays highlighted.
    await user.click(screen.getByRole('button', { name: 'posts.calendarNextMonth' }));
    expect(screen.getByText(/July 2030/)).toBeInTheDocument();
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
    expect(dayPanelCardTitle('July first')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'posts.calendarPrevMonth' }));
    expect(dayPanelCardTitle('Today slot')).toBeInTheDocument();
  });

  it('shows the categorized failure reason on a failed card, never the raw engine text', async () => {
    const restartSlot = {
      ...FAILED_SLOT,
      id: 'c4',
      slotAt: '2030-06-07T14:00:00.000Z',
      title: 'Calendar restart failure',
      error: 'The engine restarted while generating your video.',
      retryable: true,
    };
    mockQueries({ range: [restartSlot] });
    const user = userEvent.setup();
    render(<PostsPage />);

    const day7 = screen.getByRole('button', { name: 'Friday, June 7' });
    await user.click(day7);

    expect(dayPanelCardTitle('Calendar restart failure')).toBeInTheDocument();
    expect(screen.getByText('posts.errorEngineRestart')).toBeInTheDocument();
    expect(screen.queryByText('The engine restarted while generating your video.')).not.toBeInTheDocument();
  });

  it('draws no thumbnail tile at all on a card without video', async () => {
    mockQueries({ range: rangeSlots });
    const user = userEvent.setup();
    render(<PostsPage />);

    // June 7 holds the failed slot: no video, so its thumbnail is the
    // placeholder.
    const day7 = screen.getByRole('button', { name: 'Friday, June 7' });
    await user.click(day7);

    const card = dayPanelCardTitle('Calendar failed')?.closest('a');
    expect(card).not.toBeNull();
    expect(card?.querySelector('video')).toBeNull();
    expect(card?.querySelector('[data-thumb]')).toBeNull();
  });

  it('disables the refresh button while a refetch is in flight', () => {
    // The header refresh stays clickable while idle but must not fire a
    // second refetch while one is already running.
    vi.mocked(useScheduleRangeQuery).mockReturnValue({
      data: { slots: [UPCOMING_SLOT], truncated: false },
      isLoading: false,
      isFetching: true,
      isError: false,
      refetch: vi.fn(),
    } as never);
    render(<PostsPage />);

    for (const button of screen.getAllByRole('button', { name: 'posts.refresh' })) {
      expect(button).toBeDisabled();
    }
  });

  it('refetches the has-any-post read too when the month is empty', async () => {
    // The "never posted" read only exists while the month is empty, so a
    // refresh there must refetch it as well as the range.
    mockQueries({ range: [] });
    const hasAnyRefetch = vi.fn();
    vi.mocked(useHasAnyPostQuery).mockReturnValue({ data: false, isLoading: false, isError: false, refetch: hasAnyRefetch } as never);
    const user = userEvent.setup();
    render(<PostsPage />);

    const refresh = screen.getAllByRole('button', { name: 'posts.refresh' })[0];
    await user.click(refresh as HTMLElement);
    expect(hasAnyRefetch).toHaveBeenCalledTimes(1);
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
    expect(screen.queryByRole('button', { name: 'posts.refresh' })).not.toBeInTheDocument();
    const retry = within(alert).getByRole('button', { name: 'posts.loadErrorRetry' });
    await user.click(retry);
    expect(refetch).toHaveBeenCalledTimes(1);
    // Recovery frame: alert + retry only — no day grid, no month chrome, no day list.
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
    for (const select of [screen.getByLabelText('posts.filterProvider'), screen.getByLabelText('posts.filterAccount')]) {
      expect(select).toBeDisabled();
      expect(select.className.split(/\s+/)).toContain('appearance-none');
      expect(select.className.split(/\s+/)).toContain('saturate-50');
      expect(select.className).not.toMatch(/bg-\[image:/);
    }
  });

  it('hides the header refresh on a load error so only the in-card retry remains', () => {
    const { unmount } = render(<PostsPage />);
    expect(screen.getAllByRole('button', { name: 'posts.refresh' }).length).toBeGreaterThanOrEqual(1);
    unmount();
    vi.mocked(useScheduleRangeQuery).mockReturnValue({ data: undefined, isLoading: false, isFetching: false, isError: true, refetch: vi.fn() } as never);
    render(<PostsPage />);
    expect(screen.queryByRole('button', { name: 'posts.refresh' })).not.toBeInTheDocument();
    expect(screen.getByTestId('new-post-button')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'posts.loadErrorRetry' })).toBeInTheDocument();
  });
});

describe('PostsPage day pick on a phone', () => {
  const rangeSlots = [{ ...UPCOMING_SLOT, id: 'p5', slotAt: '2030-06-05T12:00:00.000Z', title: 'Phone pick' }];
  let scrollIntoView: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    scrollIntoView = vi.fn();
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });
    // The day list sits below the fold.
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ top: 5000 } as DOMRect);
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

  it('scrolls the day list into view after a day pick on a narrow screen', async () => {
    // The stub also answers the calendar lib's media query (its hook
    // subscribes through addEventListener), not just the page's width check.
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: query === '(max-width: 639px)', addEventListener: () => undefined, removeEventListener: () => undefined })));
    mockQueries({ range: rangeSlots });
    render(<PostsPage />);

    await pickDay5();
    expect(dayPanelCardTitle('Phone pick')).toBeInTheDocument();
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
  });

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

  it('opens the week view on a narrow screen, with no switcher', async () => {
    vi.stubGlobal('matchMedia', vi.fn(mobileMatchMedia));
    render(<PostsPage />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'posts.calendarPrevWeek' })).toBeInTheDocument(),
    );
    expect(screen.queryByRole('button', { name: 'posts.calendarViewMonth' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'posts.calendarViewWeek' })).not.toBeInTheDocument();
  });

  it('puts the day panel above the week grid on a narrow screen', async () => {
    vi.stubGlobal('matchMedia', vi.fn(mobileMatchMedia));
    render(<PostsPage />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'posts.calendarPrevWeek' })).toBeInTheDocument(),
    );
    // Flex `order` is visual, not DOM order: the panel carries order-1 and
    // the calendar wrapper order-2, so the panel renders above the grid.
    const panel = document.querySelector('section[aria-live="polite"]') as HTMLElement;
    const card = document.querySelector('[data-calendar-card]') as HTMLElement;
    const calendarWrap = card.parentElement as HTMLElement;
    expect(panel.className).toContain('order-1');
    expect(calendarWrap.className).toContain('order-2');
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

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'posts.calendarNextWeek' })).toBeInTheDocument(),
    );
    for (let i = 0; i < 6; i++) {
      fireEvent.click(screen.getByRole('button', { name: 'posts.calendarNextWeek' }));
    }
    const calls = vi.mocked(useScheduleRangeQuery).mock.calls;
    const last = calls[calls.length - 1];
    // Six weeks forward from the week of 2030-06-01: the week of 2030-07-07,
    // so the cursor follows to July and the read is July's grid (42 days),
    // never the June grid plus a runaway week.
    const expected = gridRange(buildMonthGrid(2030, 6, 0));
    expect(last).toEqual(['2030-07', expected.from, expected.to, true]);
  });

  it('keeps the range read within the API span when browsing many weeks ahead', async () => {
    vi.stubGlobal('matchMedia', vi.fn(mobileMatchMedia));
    render(<PostsPage />);

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

  it('shows a picked day in another month even when the cursor month has no posts', async () => {
    // May slot only: June (the cursor month) has no posts, but the shown
    // week (May 26 – Jun 1) does — the pick must not be discarded for the
    // cursor month's emptiness.
    const maySlot = { ...UPCOMING_SLOT, id: 'u2', slotAt: '2030-05-28T10:00:00.000Z', title: 'May topic' };
    mockQueries({ range: [maySlot] });
    vi.stubGlobal('matchMedia', vi.fn(mobileMatchMedia));
    render(<PostsPage />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'posts.calendarPrevWeek' })).toBeInTheDocument(),
    );
    const grid = document.querySelector('[data-posts-calendar-week]');
    if (grid === null) throw new Error('week grid not rendered');
    const columns = grid.querySelectorAll('[role="group"][aria-label]:not([inert])');
    expect(columns).toHaveLength(7);
    // May 28 is the Tuesday column (index 2) of the week starting Sunday May 26.
    fireEvent.click(columns[2]);
    expect(dayPanelCardTitle('May topic')).toBeInTheDocument();
  });

  it('scrolls the day panel into view after a column pick on a narrow screen', async () => {
    // Narrow here means both the page's mobile query (767px, week view)
    // and its scroll query (639px): a 390px screen matches both.
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      ...mobileMatchMedia(query),
      matches: query === '(max-width: 767px)' || query === '(max-width: 639px)',
    })));
    render(<PostsPage />);

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
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
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
    // The chip lives in the calendar card; the day panel card below shows
    // the same slot, so scope the assertion to the grid.
    const card = document.querySelector('[data-calendar-card]') as HTMLElement;
    expect(within(card).getByText('posts.unknownTitle')).toBeInTheDocument();
  });
});
