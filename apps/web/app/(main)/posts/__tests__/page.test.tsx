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
  useVideoGenerationsQuery: vi.fn(),
  useUpdateSlotMutation: vi.fn(),
  useDeleteSlotMutation: vi.fn(),
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
  useVideoGenerationsQuery,
  useUpdateSlotMutation,
  useDeleteSlotMutation,
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
  scheduledAt: null,
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
  vi.mocked(useUpdateSlotMutation).mockReturnValue({
    mutate: vi.fn(),
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
    isError: false,
    error: null,
  } as never);
  vi.mocked(useDeleteSlotMutation).mockReturnValue({
    mutate: vi.fn(),
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
    isError: false,
    error: null,
  } as never);
});

describe('PostsPage', () => {
  it('shows upcoming posts by default with persona, topic, status and account chips', () => {
    render(<PostsPage />);

    expect(screen.getByText('Upcoming topic')).toBeInTheDocument();
    expect(screen.getByText('Viva Leve')).toBeInTheDocument();
    expect(screen.getByText('posts.statusPending')).toBeInTheDocument();
    // Account labels appear in the card chip and in the account filter options
    expect(screen.getAllByText('Europa Na Estrada').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('@vivalave').length).toBeGreaterThanOrEqual(2);
    // History items are hidden on the upcoming tab
    expect(screen.queryByText('Past topic')).not.toBeInTheDocument();
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
// Slot detail modal — click a card to open it: watch the video (when the
// engine already produced one), edit the topic of a slot that has not
// started generating, delete a pending/failed slot. Published posts can
// neither be edited nor deleted.
//---------------

describe('PostsPage slot detail modal', () => {
  async function openHistoryCard(name: RegExp): Promise<void> {
    const user = userEvent.setup();
    render(<PostsPage />);
    await user.click(screen.getByRole('button', { name: /posts\.tabHistory/ }));
    await user.click(screen.getByRole('button', { name }));
  }

  it('opens the detail modal from a card and shows the video player for a generated slot', async () => {
    await openHistoryCard(/Past topic/);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    const video = within(dialog).queryByRole('video') ?? dialog.querySelector('video');
    expect(video).not.toBeNull();
    expect(video?.getAttribute('src')).toBe('/api/persona/video-download/task-9/final-1.mp4');
  });

  it('shows the video as the card cover in the history grid', async () => {
    const user = userEvent.setup();
    render(<PostsPage />);
    await user.click(screen.getByRole('button', { name: /posts\.tabHistory/ }));

    // The card cover IS the video: metadata-only preload, muted, no native
    // controls (playback happens in the detail modal).
    const cardVideo = document.querySelector('button video');
    expect(cardVideo).not.toBeNull();
    expect(cardVideo?.getAttribute('src')).toBe('/api/persona/video-download/task-9/final-1.mp4');
    expect(cardVideo?.getAttribute('controls')).toBeNull();
    expect(cardVideo?.getAttribute('preload')).toBe('metadata');
  });

  it('does not render a video cover when the slot has no task id', async () => {
    mockQueries({
      recent: [{ ...PUBLISHED_SLOT, taskId: null }],
    });
    const user = userEvent.setup();
    render(<PostsPage />);
    await user.click(screen.getByRole('button', { name: /posts\.tabHistory/ }));

    expect(document.querySelector('button video')).toBeNull();
  });

  it('closes the modal on the close button', async () => {
    await openHistoryCard(/Past topic/);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'posts.close' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('lets the user edit the topic of an awaiting slot', async () => {
    const user = userEvent.setup();
    render(<PostsPage />);
    await user.click(screen.getByRole('button', { name: /Upcoming topic/ }));

    await user.click(screen.getByRole('button', { name: 'posts.edit' }));
    const textarea = screen.getByLabelText('posts.topicLabel');
    await user.clear(textarea);
    await user.type(textarea, 'New topic');
    await user.click(screen.getByRole('button', { name: 'posts.save' }));

    expect(useUpdateSlotMutation).toHaveBeenCalled();
    const mutate = vi.mocked(useUpdateSlotMutation).mock.results[0].value.mutate as ReturnType<typeof vi.fn>;
    expect(mutate).toHaveBeenCalledWith({ slotId: 'u1', topic: 'New topic' }, expect.anything());
  });

  it('surfaces the mutation error in the modal instead of closing it', async () => {
    vi.mocked(useUpdateSlotMutation).mockReturnValue({
      mutate: vi.fn(),
      mutateAsync: vi.fn().mockRejectedValue(new Error('Only a slot that has not started generating can be edited.')),
      isPending: false,
      isError: true,
      error: new Error('Only a slot that has not started generating can be edited.'),
    } as never);
    const user = userEvent.setup();
    render(<PostsPage />);
    await user.click(screen.getByRole('button', { name: /Upcoming topic/ }));

    await user.click(screen.getByRole('button', { name: 'posts.edit' }));
    await user.click(screen.getByRole('button', { name: 'posts.save' }));

    expect(await screen.findByText('Only a slot that has not started generating can be edited.')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('deletes a failed slot after explicit confirmation', async () => {
    await openHistoryCard(/Failed topic/);
    const user = userEvent.setup();

    // Two-step delete: first click arms the confirmation.
    await user.click(screen.getByRole('button', { name: 'posts.delete' }));
    await user.click(screen.getByRole('button', { name: 'posts.deleteConfirm' }));

    const mutate = vi.mocked(useDeleteSlotMutation).mock.results[0].value.mutate as ReturnType<typeof vi.fn>;
    expect(mutate).toHaveBeenCalledWith('r2', expect.anything());
  });

  it('offers no edit or delete actions for a published post', async () => {
    await openHistoryCard(/Past topic/);

    expect(screen.queryByRole('button', { name: 'posts.edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'posts.delete' })).not.toBeInTheDocument();
  });

  it('surfaces the delete error when the API rejects the deletion', async () => {
    vi.mocked(useDeleteSlotMutation).mockReturnValue({
      mutate: vi.fn(),
      mutateAsync: vi.fn().mockRejectedValue(new Error('A published post cannot be deleted.')),
      isPending: false,
      isError: true,
      error: new Error('A published post cannot be deleted.'),
    } as never);
    await openHistoryCard(/Failed topic/);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'posts.delete' }));
    await user.click(screen.getByRole('button', { name: 'posts.deleteConfirm' }));

    expect(await screen.findByText('A published post cannot be deleted.')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('opens the detail modal with a video player for a completed generation', async () => {
    mockQueries({ generations: [COMPLETED_GENERATION] });
    const user = userEvent.setup();
    render(<PostsPage />);
    await user.click(screen.getByRole('button', { name: /posts\.tabHistory/ }));
    await user.click(screen.getByRole('button', { name: /Launch recap/ }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    const video = screen.getByRole('dialog').querySelector('video');
    expect(video).not.toBeNull();
    expect(video?.getAttribute('src')).toBe('/api/persona/video-download/task-3/final-1.mp4');
    // Generations are history-only: no edit/delete actions.
    expect(screen.queryByRole('button', { name: 'posts.edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'posts.delete' })).not.toBeInTheDocument();
  });

  it('does not render a video player for a failed generation', async () => {
    mockQueries({ generations: [FAILED_GENERATION] });
    const user = userEvent.setup();
    render(<PostsPage />);
    await user.click(screen.getByRole('button', { name: /posts\.tabHistory/ }));
    await user.click(screen.getByRole('button', { name: /Myth busting/ }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('dialog').querySelector('video')).toBeNull();
  });
});
