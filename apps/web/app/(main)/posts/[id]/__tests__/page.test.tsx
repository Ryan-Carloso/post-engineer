import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';

//---------------
// Tests for the post detail page (/posts/[id]) — a full page, not a
// modal: big video player when the engine produced one, live progress
// while generating, topic editing for awaiting slots, delete for
// awaiting/failed slots. Route params carry the id only; the entities
// come from the React Query cache.
//---------------

const pushMock = vi.fn();

vi.mock('next/navigation', () => ({
  useParams: vi.fn(() => ({ id: 'u1' })),
  useRouter: vi.fn(() => ({ push: pushMock })),
}));

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

import DetailPage from '../page';
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
import { useParams } from 'next/navigation';

const SCHEDULE = {
  id: 's1',
  personaId: 'p1',
  providers: ['youtube'],
  youtubeAccountIds: ['ch1'],
  instagramAccountIds: [],
  linkedinAccountIds: [],
  blueskyAccountIds: [],
  daysOfWeek: [1],
  startHour: 9,
  endHour: 17,
  postsPerDay: 1,
  timezone: 'UTC',
  active: true,
  scheduledAt: null,
};

const AWAITING_SLOT = {
  id: 'u1',
  scheduleId: 's1',
  slotAt: '2030-06-01T10:00:00.000Z',
  status: 'awaiting',
  topic: 'Upcoming topic',
  error: null,
  publishedAt: null,
  taskId: null,
  progress: 0,
  stage: null,
  queuePosition: 1,
  queueTotal: 2,
  retryable: null,
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
  progress: 100,
  stage: 'done',
  queuePosition: null,
  queueTotal: null,
  retryable: null,
};

const GENERATING_SLOT = {
  ...AWAITING_SLOT,
  id: 'gen-slot',
  status: 'generating',
  topic: 'Cooking topic',
  taskId: 'task-7',
  progress: 45,
  stage: 'lipsync',
  queuePosition: null,
  queueTotal: null,
};

const FAILED_SLOT = {
  ...PUBLISHED_SLOT,
  id: 'r2',
  status: 'failed',
  topic: 'Failed topic',
  taskId: 'task-8',
  error: 'Upload failed',
  progress: 80,
  publishedAt: null,
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

function mockQueries(overrides: {
  upcoming?: unknown[];
  recent?: unknown[];
  generations?: unknown[];
} = {}) {
  vi.mocked(useScheduleStatusQuery).mockReturnValue({
    data: {
      upcoming: (overrides.upcoming ?? [AWAITING_SLOT]) as never,
      recent: (overrides.recent ?? []) as never,
    },
    isLoading: false,
    isFetching: false,
    isError: false,
    refetch: vi.fn(),
  } as never);
  vi.mocked(useSchedulesQuery).mockReturnValue({
    data: [SCHEDULE] as never,
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
    data: { authenticated: true, accounts: [] },
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

function mockMutations() {
  // Real react-query invokes the per-call callbacks on success — the
  // mocks mirror that so onSuccess side effects (close editor, redirect)
  // are exercised.
  vi.mocked(useUpdateSlotMutation).mockReturnValue({
    mutate: vi.fn((...args: unknown[]) => {
      const options = args[args.length - 1] as { onSuccess?: () => void } | undefined;
      options?.onSuccess?.();
    }),
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
    isError: false,
    error: null,
  } as never);
  vi.mocked(useDeleteSlotMutation).mockReturnValue({
    mutate: vi.fn((...args: unknown[]) => {
      const options = args[args.length - 1] as { onSuccess?: () => void } | undefined;
      options?.onSuccess?.();
    }),
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
    isError: false,
    error: null,
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockQueries();
  mockMutations();
  vi.mocked(useParams).mockReturnValue({ id: 'u1' });
});

describe('PostDetailPage', () => {
  it('shows the awaiting slot with its topic and the edit/delete actions', async () => {
    const user = userEvent.setup();
    render(<DetailPage />);

    expect(screen.getByText('Upcoming topic')).toBeInTheDocument();
    expect(screen.getByText('Viva Leve')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'posts.edit' }));
    expect(screen.getByLabelText('posts.topicLabel')).toHaveValue('Upcoming topic');
    expect(screen.getByRole('button', { name: 'posts.delete' })).toBeInTheDocument();
  });

  it('saves an edited topic through the mutation', async () => {
    const user = userEvent.setup();
    render(<DetailPage />);

    await user.click(screen.getByRole('button', { name: 'posts.edit' }));
    const textarea = screen.getByLabelText('posts.topicLabel');
    await user.clear(textarea);
    await user.type(textarea, 'New topic');
    await user.click(screen.getByRole('button', { name: 'posts.save' }));

    const mutate = vi.mocked(useUpdateSlotMutation).mock.results[0].value.mutate as ReturnType<typeof vi.fn>;
    expect(mutate).toHaveBeenCalledWith({ slotId: 'u1', topic: 'New topic' }, expect.anything());
  });

  it('plays the video full-width for a published slot and hides the actions', () => {
    mockQueries({ upcoming: [], recent: [PUBLISHED_SLOT] });
    vi.mocked(useParams).mockReturnValue({ id: 'r1' });
    render(<DetailPage />);

    const video = screen.getByRole('region', { name: 'posts.detailsTitle' }).querySelector('video');
    expect(video).not.toBeNull();
    expect(video?.getAttribute('src')).toBe('/api/persona/video-download/task-9/final-1.mp4');
    expect(video?.getAttribute('controls')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'posts.edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'posts.delete' })).not.toBeInTheDocument();
  });

  it('shows live progress and stage for a generating slot, without a player', () => {
    mockQueries({ upcoming: [GENERATING_SLOT] });
    vi.mocked(useParams).mockReturnValue({ id: 'gen-slot' });
    render(<DetailPage />);

    expect(document.querySelector('video')).toBeNull();
    expect(screen.getByText('45%')).toBeInTheDocument();
    expect(screen.getByText('lipsync')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '45');
  });

  it('shows the error and allows deleting a failed slot after confirmation', async () => {
    mockQueries({ upcoming: [], recent: [FAILED_SLOT] });
    vi.mocked(useParams).mockReturnValue({ id: 'r2' });
    const user = userEvent.setup();
    render(<DetailPage />);

    expect(screen.getByText('Upload failed')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'posts.delete' }));
    await user.click(screen.getByRole('button', { name: 'posts.deleteConfirm' }));

    const mutate = vi.mocked(useDeleteSlotMutation).mock.results[0].value.mutate as ReturnType<typeof vi.fn>;
    expect(mutate).toHaveBeenCalledWith('r2', expect.anything());
  });

  it('redirects back to /posts after a successful deletion', async () => {
    mockQueries({ upcoming: [], recent: [FAILED_SLOT] });
    vi.mocked(useParams).mockReturnValue({ id: 'r2' });
    const user = userEvent.setup();
    render(<DetailPage />);

    await user.click(screen.getByRole('button', { name: 'posts.delete' }));
    await user.click(screen.getByRole('button', { name: 'posts.deleteConfirm' }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/posts'));
  });

  it('surfaces the mutation error instead of navigating away', async () => {
    vi.mocked(useUpdateSlotMutation).mockReturnValue({
      mutate: vi.fn(),
      mutateAsync: vi.fn().mockRejectedValue(new Error('Only a slot that has not started generating can be edited.')),
      isPending: false,
      isError: true,
      error: new Error('Only a slot that has not started generating can be edited.'),
    } as never);
    const user = userEvent.setup();
    render(<DetailPage />);

    await user.click(screen.getByRole('button', { name: 'posts.edit' }));
    await user.click(screen.getByRole('button', { name: 'posts.save' }));

    expect(await screen.findByText('Only a slot that has not started generating can be edited.')).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('resolves a completed generation with its video and no slot actions', () => {
    mockQueries({ upcoming: [], generations: [COMPLETED_GENERATION] });
    vi.mocked(useParams).mockReturnValue({ id: 'g3' });
    render(<DetailPage />);

    const video = screen.getByRole('region', { name: 'posts.detailsTitle' }).querySelector('video');
    expect(video).not.toBeNull();
    expect(video?.getAttribute('src')).toBe('/api/persona/video-download/task-3/final-1.mp4');
    expect(screen.queryByRole('button', { name: 'posts.delete' })).not.toBeInTheDocument();
  });

  it('shows a not-found state with a way back for an unknown id', () => {
    vi.mocked(useParams).mockReturnValue({ id: 'unknown-id' });
    render(<DetailPage />);

    expect(screen.getByText('posts.notFound')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'posts.back' })).toHaveAttribute('href', '/posts');
  });

  it('shows a loading skeleton while the queries load', () => {
    vi.mocked(useScheduleStatusQuery).mockReturnValue({
      data: undefined,
      isLoading: true,
      isFetching: false,
      isError: false,
      refetch: vi.fn(),
    } as never);
    render(<DetailPage />);

    expect(screen.getByTestId('detail-skeleton')).toBeInTheDocument();
  });
});
