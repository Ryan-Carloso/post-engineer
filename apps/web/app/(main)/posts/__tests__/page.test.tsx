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
  useRumbleAccountsQuery: vi.fn(() => ({ data: { authenticated: true, accounts: [] }, isLoading: false, isError: false, error: null, refetch: vi.fn() })),
  useBlueskyAccountsQuery: vi.fn(),
}));

vi.mock('@/lib/schedule-range', () => ({
  RANGE_MAX_SLOTS: 1000,
  useScheduleRangeQuery: vi.fn(),
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
import { useScheduleRangeQuery } from '@/lib/schedule-range';
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
    expect(screen.getByText('posts.statusPending')).toBeInTheDocument();
    // Account names appear in the account filter option and as a chip on the card.
    expect(screen.getAllByText('Europa Na Estrada').length).toBe(2);
    expect(screen.getAllByText('@vivalave').length).toBe(2);
    // History items are hidden on the calendar tab
    expect(screen.queryByText('Past topic')).not.toBeInTheDocument();
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

  it('renders the status badge first, then date, and network + account chips', () => {
    render(<PostsPage />);

    const card = screen.getByText('Upcoming topic').closest('a')?.parentElement;
    expect(card).not.toBeNull();
    const text = card?.textContent ?? '';
    // Status label precedes the date + time, which precede the persona and title.
    expect(text.indexOf('posts.statusPending')).toBeLessThan(text.indexOf('·'));
    expect(text.indexOf('·')).toBeLessThan(text.indexOf('Viva Leve'));
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

    expect(screen.getByText('posts.noResultsForFilter')).toBeInTheDocument();
    expect(screen.queryByText('Upcoming topic')).not.toBeInTheDocument();
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
    expect(screen.getByText('posts.noResultsForFilter')).toBeInTheDocument();
  });

  it('hides slots whose schedule no longer exists', () => {
    mockQueries({ schedules: [] });
    render(<PostsPage />);

    expect(screen.queryByText('Upcoming topic')).not.toBeInTheDocument();
    expect(screen.getByText('posts.calendarDayNone')).toBeInTheDocument();
  });

  it('shows a loading skeleton while the calendar range is loading', () => {
    vi.mocked(useScheduleRangeQuery).mockReturnValue({ data: undefined, isLoading: true, isFetching: false, isError: false, refetch: vi.fn() } as never);

    render(<PostsPage />);
    // A skeleton keeps the calendar layout in place; no lone spinner on
    // an empty page.
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('posts.loadingPosts')).toBeInTheDocument();
    expect(screen.queryByTestId('icon-spinner')).not.toBeInTheDocument();
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
    expect(screen.getByText('posts.loadErrorSupporting')).toBeInTheDocument();
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
    expect(screen.getByText('posts.loadErrorSupporting')).toBeInTheDocument();
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
    const errorPanel = screen.getByText('posts.loadErrorSupporting').closest('div');
    if (!errorPanel) throw new Error('error panel not rendered');
    await user.click(within(errorPanel).getByRole('button', { name: 'posts.refresh' }));
    expect(youtubeRefetch).toHaveBeenCalledTimes(1);
  });

  it('moves "today" past midnight without a reload', async () => {
    // todayKey is computed on every render, not once at mount — a page left
    // open overnight must mark the new day and jump to it.
    const user = userEvent.setup();
    const { rerender } = render(<PostsPage />);
    const grid = screen.getByRole('grid');
    expect(grid.querySelector('[data-today]')?.textContent).toBe('1');

    vi.setSystemTime(new Date('2030-06-02T00:01:00.000Z'));
    rerender(<PostsPage />);

    expect(screen.getByRole('grid').querySelector('[data-today]')?.textContent).toBe('2');
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
    const errorPanel = screen.getByText('posts.loadErrorSupporting').closest('div');
    if (!errorPanel) throw new Error('error panel not rendered');
    await user.click(within(errorPanel).getByRole('button', { name: 'posts.refresh' }));
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

    expect(screen.getByRole('link', { name: /Upcoming topic/ })).toHaveAttribute('href', '/posts/u1');
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

  it('shows 0% on an awaiting card — a freshly created post is visible with its progress from the first paint', () => {
    mockQueries({ upcoming: [AWAITING_SLOT] });
    render(<PostsPage />);

    expect(screen.getByText('0%')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'posts.progressLabel' })).toHaveAttribute(
      'aria-valuenow',
      '0',
    );
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

    // Unknown statuses degrade to the pending look, never an unstyled badge.
    const badge = screen.getByText('posts.statusPending');
    expect(badge.className).toContain('bg-sunken');
  });

  it('shows progress bars on ready and publishing cards', () => {
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

    expect(screen.getByText('71%')).toBeInTheDocument();
    expect(screen.getByText('88%')).toBeInTheDocument();
    expect(screen.getAllByRole('progressbar', { name: 'posts.progressLabel' })).toHaveLength(2);
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
    expect(options).toEqual(['posts.allProviders', 'YouTube', 'Instagram', 'LinkedIn', 'Bluesky', 'Threads', 'Facebook']);
  });

});

//---------------
// Calendar tab: per-day markers, day selection and the filters applied to
// the range read.
//---------------
describe('PostsPage calendar view', () => {
  const rangeSlots = [
    { ...UPCOMING_SLOT, id: 'c1', slotAt: '2030-06-05T12:00:00.000Z', title: 'Calendar upcoming' },
    { ...PUBLISHED_SLOT, id: 'c2', slotAt: '2030-06-05T15:00:00.000Z', title: 'Calendar published' },
    { ...FAILED_SLOT, id: 'c3', slotAt: '2030-06-07T12:00:00.000Z', title: 'Calendar failed' },
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
    expect(cells.some((cell) => cell.querySelector('[data-ring]') !== null)).toBe(false);
  });

  it('shows the persona photo with the scheduled ring on a day whose post is still to publish', () => {
    mockQueries();
    render(<PostsPage />);

    // June 1 holds the awaiting UPCOMING_SLOT: photo, no status color.
    const day1 = within(screen.getByRole('grid'))
      .getAllByRole('button', { name: 'posts.calendarDayLabel' })
      .find((button) => button.textContent === '1');
    expect(day1).toBeDefined();
    expect((day1 as HTMLElement).querySelector('img[alt="Viva Leve"]')).not.toBeNull();
    expect((day1 as HTMLElement).querySelector('[data-ring]')).toHaveAttribute('data-ring', 'scheduled');
  });

  it('counts the selected day as published, failed and scheduled — never in progress', async () => {
    mockQueries({ range: rangeSlots });
    const user = userEvent.setup();
    render(<PostsPage />);

    // June 5 holds one awaiting and one published post.
    const day5 = within(screen.getByRole('grid'))
      .getAllByRole('button', { name: 'posts.calendarDayLabel' })
      .find((button) => button.textContent?.startsWith('5'));
    await user.click(day5 as HTMLElement);

    expect(screen.getByText('posts.groupPublished: 1')).toBeInTheDocument();
    expect(screen.getByText('posts.groupScheduled: 1')).toBeInTheDocument();
    expect(screen.getByText('posts.groupFailed: 0')).toBeInTheDocument();
    expect(screen.queryByText(/posts\.groupInProgress/)).not.toBeInTheDocument();
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
    expect(screen.getByText('posts.loadErrorCalendar')).toBeInTheDocument();
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

  it('month navigation moves the selection into the new month', async () => {
    mockQueries({ range: rangeSlots });
    const user = userEvent.setup();
    render(<PostsPage />);

    // Today (June 15) is selected on open; next month must select July 15,
    // not keep the detail on a June day below a July calendar.
    await user.click(screen.getByRole('button', { name: 'posts.calendarNextMonth' }));
    expect(screen.getByText(/July 2030/)).toBeInTheDocument();
    const selected = screen.getByRole('grid').querySelector('[data-selected="true"]');
    expect(selected?.textContent).toBe('15');
    expect(vi.mocked(useScheduleRangeQuery).mock.calls.at(-1)?.[0]).toBe('2030-07');
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

  it('marks a card without video with the no-video placeholder, not a bare grey square', async () => {
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
    expect(card?.querySelector('[data-thumb="empty"]')).not.toBeNull();
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

    expect(screen.getByRole('button', { name: 'posts.refresh' })).toBeDisabled();
  });
});
