import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
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

afterEach(() => {
  vi.useRealTimers();
});

describe('PostsPage', () => {
  it("opens on the calendar with today's posts below it: persona, title, status and account avatars", () => {
    render(<PostsPage />);

    expect(screen.getByText('Upcoming topic')).toBeInTheDocument();
    expect(screen.getByText('Viva Leve')).toBeInTheDocument();
    // An awaiting post carries the calendar's own word for it.
    const card = within(screen.getByText('Upcoming topic').closest('a') as HTMLElement);
    expect(card.getByText('posts.groupScheduled')).toBeInTheDocument();
    expect(card.queryByText('posts.statusPending')).not.toBeInTheDocument();
    // Account names appear in the account filter option and as a chip on the card.
    expect(screen.getAllByText('Europa Na Estrada').length).toBe(2);
    expect(screen.getAllByText('@vivalave').length).toBe(2);
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

    expect(screen.getByText('Upcoming topic')).toBeInTheDocument();
    expect(screen.getByText('posts.noPersona')).toBeInTheDocument();
    expect(screen.queryByText('posts.personaFallback')).not.toBeInTheDocument();
  });

  it('renders the status badge first, then the time only, the title above the persona, and network + account chips', () => {
    render(<PostsPage />);

    const card = screen.getByText('Upcoming topic').closest('a')?.parentElement;
    expect(card).not.toBeNull();
    const text = card?.textContent ?? '';
    // Status label precedes the time, which precedes the title, then the persona.
    const timeIndex = text.search(/\d{1,2}:\d{2}/);
    expect(timeIndex).toBeGreaterThan(-1);
    expect(text.indexOf('posts.groupScheduled')).toBeLessThan(timeIndex);
    expect(timeIndex).toBeLessThan(text.indexOf('Upcoming topic'));
    expect(text.indexOf('Upcoming topic')).toBeLessThan(text.indexOf('Viva Leve'));
    // The day heading already names the date: the card repeats only the time.
    expect(text).not.toContain('·');
    expect(text).not.toContain('2030');
    // The title is the card's main line, the persona the secondary one.
    expect(screen.getByText('Upcoming topic').className.split(/\s+/)).toContain('font-semibold');
    expect(screen.getByText('Viva Leve').className.split(/\s+/)).toContain('text-ink-soft');
    // Chips: network glyph (role img) + account label — they sit in the card root, next to the link.
    const chips = within(card as HTMLElement);
    expect(chips.getByRole('img', { name: 'youtube' })).toBeInTheDocument();
    expect(chips.getByText('Europa Na Estrada')).toBeInTheDocument();
    expect(chips.getByText('@vivalave')).toBeInTheDocument();
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

  it('marks an applied filter and clears every filter with one action', async () => {
    const user = userEvent.setup();
    render(<PostsPage />);
    expect(screen.queryByRole('button', { name: 'posts.clearFilters' })).not.toBeInTheDocument();

    const selects = screen.getAllByRole('combobox');
    await user.selectOptions(selects[0], 'youtube');
    expect(selects[0].className.split(/\s+/)).toContain('border-primary');
    expect(selects[1].className.split(/\s+/)).not.toContain('border-primary');
    // Filter hint lives in the calendar legend and/or the mobile legend near the day list.
    expect(screen.getAllByText('posts.filterActive').length).toBeGreaterThanOrEqual(1);

    const clears = screen.getAllByRole('button', { name: 'posts.clearFilters' });
    expect(clears).toHaveLength(1);
    await user.click(clears[0]);
    expect(selects[0]).toHaveValue('all');
    expect(screen.getByText('Upcoming topic')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'posts.clearFilters' })).not.toBeInTheDocument();
    expect(screen.queryByText('posts.filterActive')).not.toBeInTheDocument();
  });

  it('filters slots by account', async () => {
    const user = userEvent.setup();
    render(<PostsPage />);

    const selects = screen.getAllByRole('combobox');
    // Second select is the account filter — pick the instagram account
    await user.selectOptions(selects[1], 'ig1');

    expect(screen.getByText('Upcoming topic')).toBeInTheDocument();
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
    expect(screen.getByRole('link', { name: 'posts.accountEmptyAction' })).toHaveAttribute('href', '/recipes');
    // The frame stays: a faint calendar and disabled filters. No day to pick,
    // and the line under the title does not say to select one.
    expect(screen.getByRole('grid')).toBeInTheDocument();
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
    expect(screen.getByRole('link', { name: 'posts.schedulePostsAction' })).toHaveAttribute('href', '/recipes');
    // The panel is scoped like its message: it names the month, not a day.
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('posts.calendarMonthHeading');
    expect(screen.queryByText('posts.calendarDayHeading')).not.toBeInTheDocument();
    // Empty month still shows the header Today control (no duplicate in the panel).
    expect(screen.getByRole('button', { name: 'posts.calendarToday' })).toBeInTheDocument();
    // The calendar stays, and an empty day shows no zero-count chips.
    expect(screen.getByRole('grid')).toBeInTheDocument();
    expect(screen.queryByText(/posts\.group(Published|Failed|Scheduled):/)).not.toBeInTheDocument();
  });

  it('tells "no posts yet" apart from an empty month when the account never had a post', () => {
    mockQueries({ range: [] });
    vi.mocked(useHasAnyPostQuery).mockReturnValue({ data: false, isLoading: false, refetch: vi.fn() } as never);
    render(<PostsPage />);

    // Asked only because the month it opens on is empty.
    expect(vi.mocked(useHasAnyPostQuery).mock.calls.at(-1)?.[0]).toBe(true);
    expect(screen.getByText('posts.accountEmptyTitle')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'posts.accountEmptyAction' })).toHaveAttribute('href', '/recipes');
    // No day heading. The calendar and the filters stay, and the filters
    // cannot be used while there is nothing to filter.
    expect(screen.getByRole('grid')).toBeInTheDocument();
    for (const select of screen.getAllByRole('combobox')) expect(select).toBeDisabled();
    expect(screen.queryByText('posts.calendarDayHeading')).not.toBeInTheDocument();
    expect(screen.getByText('posts.subtitle')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('posts.calendarMonthHeading');
  });

  it('does not ask whether the account has any post when the month it opens on has posts', () => {
    render(<PostsPage />);
    expect(vi.mocked(useHasAnyPostQuery).mock.calls.at(-1)?.[0]).toBe(false);
    expect(screen.getByRole('grid')).toBeInTheDocument();
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
    await user.click(screen.getByRole('button', { name: 'posts.calendarToday' }));
    expect(screen.getByText('Upcoming topic')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('posts.calendarDayHeading');
  });

  it('names the day, not the month, for an empty day in a month with posts', async () => {
    const user = userEvent.setup();
    render(<PostsPage />);

    const day2 = within(screen.getByRole('grid'))
      .getAllByRole('button')
      .find((button) => button.textContent === '2' && button.closest('[data-outside]') === null);
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
    const layout = screen.getByRole('grid').closest('.xl\\:grid');
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
    expect(within(alert).getByText('posts.loadErrorSideQuiet')).toBeInTheDocument();
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
    const grid = screen.getByRole('grid');
    const todayCell = grid.querySelector('[data-today]');
    expect(todayCell?.querySelector('[data-day-number]')).toHaveTextContent('1');
    expect(todayCell?.querySelector('[data-today-mark="true"]')).not.toBeNull();

    vi.setSystemTime(new Date('2030-06-02T00:01:00.000Z'));
    rerender(<PostsPage />);

    const nextToday = screen.getByRole('grid').querySelector('[data-today]');
    expect(nextToday?.querySelector('[data-day-number]')).toHaveTextContent('2');
    expect(nextToday?.querySelector('[data-today-mark="true"]')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'posts.calendarToday' }));
    expect(screen.getByRole('grid').querySelector('[data-selected="true"]')?.textContent).toBe('2');
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

    expect(screen.getByText('Awaiting topic')).toBeInTheDocument();
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
    const badge = within(screen.getByText('Upcoming topic').closest('a') as HTMLElement).getByText('posts.groupScheduled');
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

  it('renders at most three account chips per card and collapses the rest into +N', () => {
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

    const card = within(screen.getByText('Upcoming topic').closest('a')?.parentElement as HTMLElement);
    expect(card.getByText('Alpha One')).toBeInTheDocument();
    expect(card.getByText('Beta Two')).toBeInTheDocument();
    expect(card.getByText('Gamma Three')).toBeInTheDocument();
    expect(card.queryByText('Delta Four')).not.toBeInTheDocument();
    expect(card.getByText('+3')).toBeInTheDocument(); // 5 YouTube + the Instagram account = 6 chips, 3 shown
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
// Calendar tab: per-day markers, day selection and the filters applied to
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
  ];

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-06-15T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
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
    expect(screen.getByRole('grid')).toBeInTheDocument();
  });

  it('lists the selected day posts below the calendar, past and future together', async () => {
    mockQueries({ range: rangeSlots });
    const user = userEvent.setup();
    render(<PostsPage />);

    // Today (June 15) is selected on open and has no posts.
    expect(screen.getByText('posts.calendarDayNone')).toBeInTheDocument();
    // Cells with posts carry the summary label (t() echoes keys here); the
    // only one starting with "5" is June 5 — July 5 in the grid is empty.
    const day5 = within(screen.getByRole('grid'))
      .getAllByRole('button', { name: 'posts.calendarDayLabel' })
      .find((button) => button.textContent?.startsWith('5'));
    expect(day5).toBeDefined();
    await user.click(day5 as HTMLElement);

    expect(screen.getByText('Calendar upcoming')).toBeInTheDocument();
    expect(screen.getByText('Calendar published')).toBeInTheDocument();
    expect(screen.queryByText('Calendar failed')).not.toBeInTheDocument();
  });

  it('applies the provider filter to calendar slots', async () => {
    mockQueries({ range: rangeSlots });
    const user = userEvent.setup();
    render(<PostsPage />);

    await user.selectOptions(screen.getAllByRole('combobox')[0], 'linkedin');

    const cells = screen.getAllByRole('gridcell');
    expect(cells.some((cell) => cell.querySelector('[data-day-post-total]') !== null)).toBe(false);
  });

  it('shows only the scheduled status marker in the cell for a day with one awaiting post', () => {
    mockQueries();
    render(<PostsPage />);

    const day1 = within(screen.getByRole('grid'))
      .getAllByRole('button', { name: 'posts.calendarDayLabel' })
      .find((button) => button.querySelector('[data-day-number]')?.textContent === '1');
    expect(day1).toBeDefined();
    expect((day1 as HTMLElement).querySelector('img')).toBeNull();
    expect((day1 as HTMLElement).querySelector('[data-day-post-total]')).toHaveTextContent('1');
    expect((day1 as HTMLElement).querySelector('[data-personas]')).toBeNull();
  });

  it('names only the post count under the day heading — status stays in cells and cards', async () => {
    mockQueries({ range: rangeSlots });
    const user = userEvent.setup();
    render(<PostsPage />);

    const day5 = within(screen.getByRole('grid'))
      .getAllByRole('button', { name: 'posts.calendarDayLabel' })
      .find((button) => button.textContent?.startsWith('5'));
    await user.click(day5 as HTMLElement);

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
    expect(document.querySelector('[data-day-unavailable-note]')).toHaveTextContent('posts.loadErrorSideQuiet');
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
    // Outside days without posts carry the empty-day label, so match by
    // the cell, not by the label.
    const july1 = within(screen.getByRole('grid'))
      .getAllByRole('button')
      .find((button) => button.textContent === '1' && button.closest('[data-outside]') !== null);
    expect(july1).toBeDefined();
    await user.click(july1 as HTMLElement);

    expect(screen.getByText(/July 2030/)).toBeInTheDocument();
    expect(vi.mocked(useScheduleRangeQuery).mock.calls.at(-1)?.[0]).toBe('2030-07');
  });

  const selectedDayNumber = () =>
    screen.getByRole('grid').querySelector('[data-selected="true"] [data-day-number]')?.textContent;

  it('month navigation leaves no day selected in a month without posts', async () => {
    mockQueries({ range: rangeSlots });
    const user = userEvent.setup();
    render(<PostsPage />);

    // Today (June 15) is selected on open. July has no posts, so the panel
    // talks about the month and no day stays highlighted.
    await user.click(screen.getByRole('button', { name: 'posts.calendarNextMonth' }));
    expect(screen.getByText(/July 2030/)).toBeInTheDocument();
    expect(screen.getByRole('grid').querySelector('[data-selected="true"]')).toBeNull();
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
    expect(selectedDayNumber()).toBe('9');
    expect(screen.getByText('July first')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'posts.calendarPrevMonth' }));
    expect(selectedDayNumber()).toBe('15');
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

    const day7 = within(screen.getByRole('grid'))
      .getAllByRole('button', { name: 'posts.calendarDayLabel' })
      .find((button) => button.textContent?.startsWith('7'));
    await user.click(day7 as HTMLElement);

    expect(screen.getByText('Calendar restart failure')).toBeInTheDocument();
    expect(screen.getByText('posts.errorEngineRestart')).toBeInTheDocument();
    expect(screen.queryByText('The engine restarted while generating your video.')).not.toBeInTheDocument();
  });

  it('draws no thumbnail tile at all on a card without video', async () => {
    mockQueries({ range: rangeSlots });
    const user = userEvent.setup();
    render(<PostsPage />);

    // June 7 holds the failed slot: no video, so its thumbnail is the
    // placeholder.
    const day7 = within(screen.getByRole('grid'))
      .getAllByRole('button', { name: 'posts.calendarDayLabel' })
      .find((button) => button.textContent?.startsWith('7'));
    await user.click(day7 as HTMLElement);

    const card = screen.getByText('Calendar failed').closest('a');
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

  it('keeps the month navigation on a load error with a single in-card retry and no day-selection copy', async () => {
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
    // Same frame as a loaded month: readable grid, no "not loaded" pill,
    // no selection, no day list.
    expect(screen.queryByText('posts.calendarNotLoaded')).not.toBeInTheDocument();
    expect(document.querySelector('[data-calendar-grid-outline]')).not.toBeInTheDocument();
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
    expect(screen.queryByText('posts.calendarDayHeading')).not.toBeInTheDocument();
    expect(screen.queryByText('posts.calendarMonthHeading')).not.toBeInTheDocument();
    expect(document.querySelector('[data-day-unavailable-note]')).toHaveTextContent('posts.loadErrorSideQuiet');
    expect(screen.queryAllByRole('button', { name: 'posts.loadErrorRetry' })).toHaveLength(1);
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    const loadError = document.querySelector('[data-calendar-load-error]');
    expect(loadError?.className.split(/\s+/)).not.toContain('min-h-[18rem]');
    expect(document.querySelector('[data-day-unavailable-note]')?.className.split(/\s+/)).toContain('border');
  });

  it('hides the header refresh on a load error so only the in-card retry remains', () => {
    const { unmount } = render(<PostsPage />);
    expect(screen.getAllByRole('button', { name: 'posts.refresh' }).length).toBeGreaterThanOrEqual(1);
    unmount();
    vi.mocked(useScheduleRangeQuery).mockReturnValue({ data: undefined, isLoading: false, isFetching: false, isError: true, refetch: vi.fn() } as never);
    render(<PostsPage />);
    expect(screen.queryByRole('button', { name: 'posts.refresh' })).not.toBeInTheDocument();
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
    const day5 = within(screen.getByRole('grid'))
      .getAllByRole('button', { name: 'posts.calendarDayLabel' })
      .find((button) => button.querySelector('[data-day-number]')?.textContent === '5');
    await user.click(day5 as HTMLElement);
  };

  it('scrolls the day list into view after a day pick on a narrow screen', async () => {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: query === '(max-width: 639px)' })));
    mockQueries({ range: rangeSlots });
    render(<PostsPage />);

    await pickDay5();
    expect(screen.getByText('Phone pick')).toBeInTheDocument();
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
  });

  it('does not scroll on a wide screen', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
    mockQueries({ range: rangeSlots });
    render(<PostsPage />);

    await pickDay5();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
