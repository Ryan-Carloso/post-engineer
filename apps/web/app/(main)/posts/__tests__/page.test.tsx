import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';

//---------------
// Tests for the Posts page (history + upcoming posts across all accounts).
// Network (lib/api) mocked; everything else real.
//---------------

vi.mock('@/lib/api', () => ({
  useScheduleStatusQuery: vi.fn(),
  useSchedulesQuery: vi.fn(),
  usePersonaListQuery: vi.fn(),
  useYouTubeAccountsQuery: vi.fn(),
  useInstagramAccountsQuery: vi.fn(),
  useLinkedinAccountsQuery: vi.fn(),
  useBlueskyAccountsQuery: vi.fn(),
  useVideoGenerationsQuery: vi.fn(),
}));

vi.mock('@/lib/ui', () => ({
  SpinnerIcon: () => <span data-testid="icon-spinner" />,
}));

vi.mock('@/lib/i18n/provider', () => {
  function I18nProvider({ children }: { children: ReactNode }) {
    return <>{children}</>;
  }
  I18nProvider.displayName = 'I18nProvider';
  const useI18n = vi.fn(() => ({ t: (key: string) => key, locale: 'en', setLocale: vi.fn() }));
  return { useI18n, I18nProvider };
});

import PostsPage, { POSTS_LIMIT } from '../page';
import {
  useScheduleStatusQuery,
  useSchedulesQuery,
  usePersonaListQuery,
  useYouTubeAccountsQuery,
  useInstagramAccountsQuery,
  useLinkedinAccountsQuery,
  useBlueskyAccountsQuery,
  useVideoGenerationsQuery,
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
  topic: 'Upcoming topic',
  error: null,
  publishedAt: null,
};

const PUBLISHED_SLOT = {
  id: 'r1',
  scheduleId: 's1',
  slotAt: '2020-01-01T10:00:00.000Z',
  status: 'published',
  topic: 'Past topic',
  error: null,
  publishedAt: '2020-01-01T10:05:00.000Z',
  taskId: 'task-9',
};

const FAILED_SLOT = {
  id: 'r2',
  scheduleId: 's1',
  slotAt: '2020-01-02T10:00:00.000Z',
  status: 'failed',
  topic: 'Failed topic',
  error: 'Upload failed',
  publishedAt: null,
};

function mockQueries(overrides: {
  upcoming?: unknown[];
  recent?: unknown[];
  schedules?: unknown[];
  generations?: unknown[];
} = {}) {
  vi.mocked(useScheduleStatusQuery).mockReturnValue({
    data: {
      upcoming: (overrides.upcoming ?? [UPCOMING_SLOT]) as never,
      recent: (overrides.recent ?? [PUBLISHED_SLOT, FAILED_SLOT]) as never,
    },
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
    data: [{ id: 'p1', name: 'Viva Leve' }] as never,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  } as never);
  vi.mocked(useYouTubeAccountsQuery).mockReturnValue({
    data: { authenticated: true, accounts: [{ channelId: 'ch1', channelName: 'Europa Na Estrada' }] },
  } as never);
  vi.mocked(useInstagramAccountsQuery).mockReturnValue({
    data: { authenticated: true, accounts: [{ igUserId: 'ig1', username: 'vivalave' }] },
  } as never);
  vi.mocked(useLinkedinAccountsQuery).mockReturnValue({
    data: { authenticated: true, accounts: [] },
  } as never);
  vi.mocked(useBlueskyAccountsQuery).mockReturnValue({
    data: { authenticated: true, accounts: [] },
  } as never);
  vi.mocked(useVideoGenerationsQuery).mockReturnValue({
    data: (overrides.generations ?? []) as never,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockQueries();
});

describe('PostsPage', () => {
  it('shows upcoming posts by default with persona, topic, status and account avatars', () => {
    render(<PostsPage />);

    expect(screen.getByText('Upcoming topic')).toBeInTheDocument();
    expect(screen.getByText('Viva Leve')).toBeInTheDocument();
    expect(screen.getByText('posts.statusPending')).toBeInTheDocument();
    // Account names appear only in the account filter now — the card
    // footer shows compact initial avatars instead of full-name chips.
    expect(screen.getAllByText('Europa Na Estrada').length).toBe(1);
    expect(screen.getAllByText('@vivalave').length).toBe(1);
    // History items are hidden on the upcoming tab
    expect(screen.queryByText('Past topic')).not.toBeInTheDocument();
  });

  // The primary CTA must open the create-post screen, not the persona list:
  // a post is a video + publishing slot, a persona is its face/voice.
  it('links the new-post CTA to /posts/new', () => {
    render(<PostsPage />);

    expect(screen.getByRole('link', { name: 'posts.newPost' })).toHaveAttribute('href', '/posts/new');
  });

  it('renders the network icon at the card top and initial avatars in the footer', () => {
    render(<PostsPage />);

    // Network icon (role img) labelled by the provider name.
    expect(screen.getAllByRole('img', { name: 'youtube' }).length).toBeGreaterThanOrEqual(1);
    // Avatar fallbacks use the accounts' initials.
    expect(screen.getByText('EN')).toBeInTheDocument();
    expect(screen.getByText('V')).toBeInTheDocument();
  });

  it('switches to the history tab showing published and failed posts', async () => {
    const user = userEvent.setup();
    render(<PostsPage />);

    await user.click(screen.getByRole('button', { name: /posts\.tabHistory/ }));

    expect(screen.getByText('Past topic')).toBeInTheDocument();
    expect(screen.getByText('posts.statusPublished')).toBeInTheDocument();
    expect(screen.getByText('Failed topic')).toBeInTheDocument();
    expect(screen.getByText('posts.statusFailed')).toBeInTheDocument();
    expect(screen.getByText('Upload failed')).toBeInTheDocument();
    expect(screen.queryByText('Upcoming topic')).not.toBeInTheDocument();
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
    expect(screen.getByText('posts.noUpcoming')).toBeInTheDocument();
  });

  it('shows the history empty state when there are no past posts', async () => {
    const user = userEvent.setup();
    mockQueries({ recent: [] });
    render(<PostsPage />);

    await user.click(screen.getByRole('button', { name: /posts\.tabHistory/ }));
    expect(screen.getByText('posts.noHistory')).toBeInTheDocument();
  });

  it('shows a loading spinner while queries are loading', () => {
    vi.mocked(useScheduleStatusQuery).mockReturnValue({
      data: undefined,
      isLoading: true,
      isFetching: false,
      isError: false,
      refetch: vi.fn(),
    } as never);

    render(<PostsPage />);
    expect(screen.getByTestId('icon-spinner')).toBeInTheDocument();
  });

  it('shows the error state with a retry button', () => {
    const refetch = vi.fn();
    vi.mocked(useScheduleStatusQuery).mockReturnValue({
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: true,
      refetch,
    } as never);

    render(<PostsPage />);
    expect(screen.getByText('posts.loadError')).toBeInTheDocument();
  });

  it('renders the tab counts from the query data', () => {
    render(<PostsPage />);
    expect(screen.getByRole('button', { name: /posts\.tabUpcoming.*1/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /posts\.tabHistory.*2/ })).toBeInTheDocument();
  });

  it('excludes slots with a deleted schedule from the tab counts', () => {
    const orphanSlot = { ...UPCOMING_SLOT, id: 'u-orphan', scheduleId: 'deleted-schedule', topic: 'Orphan topic' };
    mockQueries({ upcoming: [UPCOMING_SLOT, orphanSlot] });
    render(<PostsPage />);

    // The tab count must agree with the rendered list: the orphan slot is
    // dropped from both.
    expect(screen.getByRole('button', { name: /posts\.tabUpcoming.*1/ })).toBeInTheDocument();
    expect(screen.queryByText('Orphan topic')).not.toBeInTheDocument();
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
    expect(screen.getByText('posts.loadError')).toBeInTheDocument();
  });

  it('retry refetches the status and the schedules queries', async () => {
    const statusRefetch = vi.fn();
    const schedulesRefetch = vi.fn();
    vi.mocked(useScheduleStatusQuery).mockReturnValue({
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: true,
      refetch: statusRefetch,
    } as never);
    vi.mocked(useSchedulesQuery).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: schedulesRefetch,
    } as never);
    const user = userEvent.setup();
    render(<PostsPage />);

    // A failed schedules query must be retryable too — refetching only the
    // status query would leave the error state stuck.
    const errorPanel = screen.getByText('posts.loadError').closest('div');
    if (!errorPanel) throw new Error('error panel not rendered');
    await user.click(within(errorPanel).getByRole('button', { name: 'posts.refresh' }));
    expect(statusRefetch).toHaveBeenCalledTimes(1);
    expect(schedulesRefetch).toHaveBeenCalledTimes(1);
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
    const errorPanel = screen.getByText('posts.loadError').closest('div');
    if (!errorPanel) throw new Error('error panel not rendered');
    await user.click(within(errorPanel).getByRole('button', { name: 'posts.refresh' }));
    expect(personasRefetch).toHaveBeenCalledTimes(1);
  });

  it('shows a capped-list hint when the tab hits the fetch limit', async () => {
    // The fetch silently truncates at POSTS_LIMIT rows, so the page must
    // say so instead of implying the list is complete.
    const recent = Array.from({ length: POSTS_LIMIT }, (_, i) => ({ ...PUBLISHED_SLOT, id: `r${i}` }));
    mockQueries({ recent });
    const user = userEvent.setup();
    render(<PostsPage />);

    await user.click(screen.getByRole('button', { name: /posts\.tabHistory/ }));
    expect(screen.getByText('posts.listCapped')).toBeInTheDocument();
  });

  it('hides the capped-list hint below the fetch limit', () => {
    render(<PostsPage />);
    expect(screen.queryByText('posts.listCapped')).not.toBeInTheDocument();
  });

  it('keeps the capped-list hint when a filter shrinks the visible rows', async () => {
    // The dataset is still truncated at POSTS_LIMIT even when a network
    // filter narrows the visible rows below it — the hint must not
    // disappear.
    const recent = Array.from({ length: POSTS_LIMIT }, (_, i) => ({ ...PUBLISHED_SLOT, id: `r${i}` }));
    mockQueries({ recent });
    const user = userEvent.setup();
    render(<PostsPage />);

    await user.click(screen.getByRole('button', { name: /posts\.tabHistory/ }));
    await user.selectOptions(screen.getByLabelText('posts.filterProvider'), 'linkedin');
    expect(screen.getByText('posts.noResultsForFilter')).toBeInTheDocument();
    expect(screen.getByText('posts.listCapped')).toBeInTheDocument();
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

const FAILED_GENERATION = {
  id: 'g1',
  generationId: 'gen-1',
  engineTaskId: 'task-1',
  personaName: 'Viva Leve',
  videoSubject: 'Myth busting',
  status: 'failed',
  errorCode: 'custom_audio_invalid',
  tokensRefunded: true,
  createdAt: '2026-09-23T10:00:00.000Z',
  completedAt: '2026-09-23T10:01:00.000Z',
};

const RUNNING_GENERATION = {
  id: 'g2',
  generationId: 'gen-2',
  engineTaskId: 'task-2',
  personaName: 'Viva Leve',
  videoSubject: 'Morning routine',
  status: 'running',
  errorCode: null,
  tokensRefunded: false,
  createdAt: '2026-09-23T11:00:00.000Z',
  completedAt: null,
};

const COMPLETED_GENERATION = {
  id: 'g3',
  generationId: 'gen-3',
  engineTaskId: 'task-3',
  personaName: 'Viva Leve',
  videoSubject: 'Launch recap',
  status: 'completed',
  errorCode: null,
  tokensRefunded: false,
  createdAt: '2026-09-23T12:00:00.000Z',
  completedAt: '2026-09-23T12:02:00.000Z',
};

describe('PostsPage generation history', () => {
  it('shows the generations section in the history tab with friendly errors and refund badges', async () => {
    const user = userEvent.setup();
    mockQueries({ generations: [FAILED_GENERATION, RUNNING_GENERATION] });
    render(<PostsPage />);

    await user.click(screen.getByRole('button', { name: /posts.tabHistory/ }));

    expect(screen.getByText('posts.generationsTitle')).toBeInTheDocument();
    // Friendly, translated error — never the raw engine text.
    expect(screen.getByText('posts.errorCustomAudio')).toBeInTheDocument();
    expect(screen.queryByText('custom audio file is invalid: boom')).not.toBeInTheDocument();
    expect(screen.getByText('posts.refundedBadge')).toBeInTheDocument();
    expect(screen.getByText('posts.statusRunning')).toBeInTheDocument();
    // The history tab count includes generations.
    expect(screen.getByRole('button', { name: /posts.tabHistory \(4\)/ })).toBeInTheDocument();
  });

  it('shows the generations empty state when there are no generations', async () => {
    const user = userEvent.setup();
    mockQueries({ generations: [] });
    render(<PostsPage />);

    await user.click(screen.getByRole('button', { name: /posts.tabHistory/ }));

    expect(screen.getByText('posts.generationsTitle')).toBeInTheDocument();
    expect(screen.getByText('posts.generationsEmpty')).toBeInTheDocument();
  });

  it('does not show the generations section in the upcoming tab', () => {
    mockQueries({ generations: [FAILED_GENERATION] });
    render(<PostsPage />);

    expect(screen.queryByText('posts.generationsTitle')).not.toBeInTheDocument();
  });
});

//---------------
// Detail navigation — cards are links to the full-page detail view
// (/posts/[id]); the route param carries the id only.
//---------------

describe('PostsPage card links', () => {
  it('links upcoming cards to their detail page', () => {
    render(<PostsPage />);

    expect(screen.getByRole('link', { name: /Upcoming topic/ })).toHaveAttribute('href', '/posts/u1');
  });

  it('links history cards and generation cards to their detail pages', async () => {
    mockQueries({ generations: [COMPLETED_GENERATION] });
    const user = userEvent.setup();
    render(<PostsPage />);
    await user.click(screen.getByRole('button', { name: /posts\.tabHistory/ }));

    expect(screen.getByRole('link', { name: /Past topic/ })).toHaveAttribute('href', '/posts/r1');
    expect(screen.getByRole('link', { name: /Failed topic/ })).toHaveAttribute('href', '/posts/r2');
    // Generation cards link by generationId (the business id the detail
    // endpoint resolves via .eq('generation_id', ...)), NOT the DB row PK.
    expect(screen.getByRole('link', { name: /Launch recap/ })).toHaveAttribute('href', '/posts/gen-3');
  });

  it('links generation cards to the id the detail lookup resolves by', async () => {
    // Fixture has DISTINCT id/generationId: the href must be the value the
    // detail endpoint filters on, otherwise the card 404s on click.
    const generation = { ...COMPLETED_GENERATION, id: 'row-uuid-9', generationId: 'gen-9' };
    mockQueries({ generations: [generation] });
    const user = userEvent.setup();
    render(<PostsPage />);
    await user.click(screen.getByRole('button', { name: /posts\.tabHistory/ }));

    expect(screen.getByRole('link', { name: /Launch recap/ })).toHaveAttribute('href', '/posts/gen-9');
  });

  it('keeps showing the video thumbnail with the #t=0.1 frame in the card', async () => {
    const user = userEvent.setup();
    render(<PostsPage />);
    await user.click(screen.getByRole('button', { name: /posts\.tabHistory/ }));

    const cardVideo = document.querySelector('button video, a video');
    expect(cardVideo).not.toBeNull();
    expect(cardVideo?.getAttribute('src')).toBe('/api/persona/video-download/task-9/final-1.mp4#t=0.1');
    expect(cardVideo?.getAttribute('controls')).toBeNull();
  });
});

describe('PostsPage card progress', () => {
  const GENERATING_SLOT = {
    id: 'g1',
    scheduleId: 's1',
    slotAt: '2030-06-01T10:00:00.000Z',
    status: 'generating',
    topic: 'Generating topic',
    error: null,
    publishedAt: null,
    taskId: 'task-42',
    progress: 42,
    stage: 'lipsync',
  };

  const AWAITING_SLOT = {
    id: 'a1',
    scheduleId: 's1',
    slotAt: '2030-06-02T10:00:00.000Z',
    status: 'awaiting',
    topic: 'Awaiting topic',
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

  it('shows no progress bar on terminal cards', async () => {
    const user = userEvent.setup();
    render(<PostsPage />);
    await user.click(screen.getByRole('button', { name: /posts\.tabHistory/ }));

    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });
});
