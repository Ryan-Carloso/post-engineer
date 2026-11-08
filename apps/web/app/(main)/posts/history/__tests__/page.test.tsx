import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';

//---------------
// Tests for the post history page (/posts/history): past posts and video
// generations as a list. Network (lib/api) mocked; everything else real.
//---------------

vi.mock('@/lib/api', () => ({
  useScheduleStatusQuery: vi.fn(),
  useSchedulesQuery: vi.fn(),
  usePersonaListQuery: vi.fn(),
  useYouTubeAccountsQuery: vi.fn(),
  useInstagramAccountsQuery: vi.fn(),
  useLinkedinAccountsQuery: vi.fn(() => ({ data: { authenticated: true, accounts: [] }, isLoading: false, isError: false, refetch: vi.fn() })),
  useThreadsAccountsQuery: vi.fn(() => ({ data: { authenticated: true, accounts: [] }, isLoading: false, isError: false, refetch: vi.fn() })),
  useBlueskyAccountsQuery: vi.fn(() => ({ data: { authenticated: true, accounts: [] }, isLoading: false, isError: false, refetch: vi.fn() })),
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

import PostHistoryPage, { POSTS_LIMIT } from '../page';
import {
  useScheduleStatusQuery,
  useSchedulesQuery,
  usePersonaListQuery,
  useYouTubeAccountsQuery,
  useInstagramAccountsQuery,
  useVideoGenerationsQuery,
} from '@/lib/api';

const SCHEDULE = {
  id: 's1',
  personaId: 'p1',
  providers: ['youtube', 'instagram'],
  youtubeAccountIds: ['ch1'],
  instagramAccountIds: ['ig1'],
  linkedinAccountIds: [],
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

const ok = (data: unknown, refetch = vi.fn()) => ({ data, isLoading: false, isFetching: false, isError: false, refetch }) as never;

function mockQueries(overrides: { recent?: unknown[]; schedules?: unknown[]; generations?: unknown[] } = {}) {
  vi.mocked(useScheduleStatusQuery).mockReturnValue(ok({ upcoming: [], recent: overrides.recent ?? [PUBLISHED_SLOT, FAILED_SLOT] }));
  vi.mocked(useSchedulesQuery).mockReturnValue(ok(overrides.schedules ?? [SCHEDULE]));
  vi.mocked(usePersonaListQuery).mockReturnValue(ok([{ id: 'p1', name: 'Viva Leve' }]));
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
  vi.mocked(useVideoGenerationsQuery).mockReturnValue(ok(overrides.generations ?? []));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockQueries();
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

describe('PostHistoryPage', () => {
  it('lists published and failed posts', () => {
    render(<PostHistoryPage />);

    expect(screen.getByText('Past topic')).toBeInTheDocument();
    expect(screen.getByText('posts.statusPublished')).toBeInTheDocument();
    expect(screen.getByText('Failed topic')).toBeInTheDocument();
    expect(screen.getByText('posts.statusFailed')).toBeInTheDocument();
    // The failure is localized inline; the raw engine/upstream text is never rendered.
    expect(screen.getByText('posts.cardFailedPermanent')).toBeInTheDocument();
    expect(screen.queryByText('Upload failed')).not.toBeInTheDocument();
  });

  it('tells a retryable failed card apart from a permanent one', () => {
    mockQueries({ recent: [{ ...FAILED_SLOT, retryable: true }] });
    render(<PostHistoryPage />);

    expect(screen.getByText('posts.cardFailedRetryable')).toBeInTheDocument();
    expect(screen.queryByText('posts.cardFailedPermanent')).not.toBeInTheDocument();
  });

  it('shows the history empty state when there are no past posts', () => {
    mockQueries({ recent: [] });
    render(<PostHistoryPage />);

    expect(screen.getByText('posts.noHistory')).toBeInTheDocument();
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
    render(<PostHistoryPage />);

    expect(screen.getByText('posts.loadError')).toBeInTheDocument();
  });

  it('drops slots whose schedule was deleted', () => {
    const orphanSlot = { ...PUBLISHED_SLOT, id: 'r-orphan', scheduleId: 'deleted-schedule', title: 'Orphan topic' };
    mockQueries({ recent: [PUBLISHED_SLOT, FAILED_SLOT, orphanSlot] });
    render(<PostHistoryPage />);

    expect(screen.getByText('Past topic')).toBeInTheDocument();
    expect(screen.queryByText('Orphan topic')).not.toBeInTheDocument();
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
    render(<PostHistoryPage />);

    // A failed schedules query must be retryable too — refetching only the
    // status query would leave the error state stuck.
    const errorPanel = screen.getByText('posts.loadError').closest('div');
    if (!errorPanel) throw new Error('error panel not rendered');
    await user.click(within(errorPanel).getByRole('button', { name: 'posts.refresh' }));
    expect(statusRefetch).toHaveBeenCalledTimes(1);
    expect(schedulesRefetch).toHaveBeenCalledTimes(1);
  });

  it('shows a capped-list hint when the list hits the fetch limit', () => {
    // The fetch silently truncates at POSTS_LIMIT rows, so the page must
    // say so instead of implying the list is complete.
    const recent = Array.from({ length: POSTS_LIMIT }, (_, i) => ({ ...PUBLISHED_SLOT, id: `r${i}` }));
    mockQueries({ recent });
    render(<PostHistoryPage />);

    expect(screen.getByText('posts.listCapped')).toBeInTheDocument();
  });

  it('hides the capped-list hint below the fetch limit', () => {
    render(<PostHistoryPage />);
    expect(screen.queryByText('posts.listCapped')).not.toBeInTheDocument();
  });

  it('keeps the capped-list hint when a filter shrinks the visible rows', async () => {
    // The dataset is still truncated at POSTS_LIMIT even when a network
    // filter narrows the visible rows below it — the hint must not
    // disappear.
    const recent = Array.from({ length: POSTS_LIMIT }, (_, i) => ({ ...PUBLISHED_SLOT, id: `r${i}` }));
    mockQueries({ recent });
    const user = userEvent.setup();
    render(<PostHistoryPage />);

    await user.selectOptions(screen.getByLabelText('posts.filterProvider'), 'linkedin');
    expect(screen.getByText('posts.noResultsForFilter')).toBeInTheDocument();
    expect(screen.getByText('posts.listCapped')).toBeInTheDocument();
  });

  it('shows the generations section with friendly errors and refund badges', () => {
    mockQueries({ generations: [FAILED_GENERATION, RUNNING_GENERATION] });
    render(<PostHistoryPage />);

    expect(screen.getByText('posts.generationsTitle')).toBeInTheDocument();
    // Friendly, translated error — never the raw engine text.
    expect(screen.getByText('posts.errorCustomAudio')).toBeInTheDocument();
    expect(screen.queryByText('custom audio file is invalid: boom')).not.toBeInTheDocument();
    expect(screen.getByText('posts.refundedBadge')).toBeInTheDocument();
    expect(screen.getByText('posts.statusRunning')).toBeInTheDocument();
  });

  it('shows the generations empty state when there are no generations', () => {
    mockQueries({ generations: [] });
    render(<PostHistoryPage />);

    expect(screen.getByText('posts.generationsTitle')).toBeInTheDocument();
    expect(screen.getByText('posts.generationsEmpty')).toBeInTheDocument();
  });

  it('links history cards and generation cards to their detail pages', () => {
    mockQueries({ generations: [COMPLETED_GENERATION] });
    render(<PostHistoryPage />);

    expect(screen.getByRole('link', { name: /Past topic/ })).toHaveAttribute('href', '/posts/r1');
    expect(screen.getByRole('link', { name: /Failed topic/ })).toHaveAttribute('href', '/posts/r2');
    // Generation cards link by generationId (the business id the detail
    // endpoint resolves via .eq('generation_id', ...)), NOT the DB row PK.
    expect(screen.getByRole('link', { name: /Launch recap/ })).toHaveAttribute('href', '/posts/gen-3');
  });

  it('links generation cards to the id the detail lookup resolves by', () => {
    // Fixture has DISTINCT id/generationId: the href must be the value the
    // detail endpoint filters on, otherwise the card 404s on click.
    const generation = { ...COMPLETED_GENERATION, id: 'row-uuid-9', generationId: 'gen-9' };
    mockQueries({ generations: [generation] });
    render(<PostHistoryPage />);

    expect(screen.getByRole('link', { name: /Launch recap/ })).toHaveAttribute('href', '/posts/gen-9');
  });

  it('keeps showing the video thumbnail with the #t=0.1 frame in the card', () => {
    render(<PostHistoryPage />);

    const cardVideo = document.querySelector('button video, a video');
    expect(cardVideo).not.toBeNull();
    expect(cardVideo?.getAttribute('src')).toBe('/api/persona/video-download/task-9/final-1.mp4#t=0.1');
    expect(cardVideo?.getAttribute('controls')).toBeNull();
  });

  it('shows no progress bar on terminal cards', () => {
    render(<PostHistoryPage />);

    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('retry refetches the generations query as well', async () => {
    const user = userEvent.setup();
    const generationsRefetch = vi.fn();
    vi.mocked(useScheduleStatusQuery).mockReturnValue({
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: true,
      refetch: vi.fn(),
    } as never);
    vi.mocked(useVideoGenerationsQuery).mockReturnValue({
      data: [],
      isLoading: false,
      isError: true,
      refetch: generationsRefetch,
    } as never);
    render(<PostHistoryPage />);

    // The generations query feeds the history list — dropping its
    // refetch would leave a failed generations fetch stuck forever.
    const errorPanel = screen.getByText('posts.loadError').closest('div');
    if (!errorPanel) throw new Error('error panel not rendered');
    await user.click(within(errorPanel).getByRole('button', { name: 'posts.refresh' }));
    expect(generationsRefetch).toHaveBeenCalledTimes(1);
  });

  it('falls back to the generic error copy for an unmapped generation error code', () => {
    mockQueries({ generations: [{ ...FAILED_GENERATION, errorCode: 'future_code_123' }] });
    render(<PostHistoryPage />);

    expect(screen.getByText('posts.errorUnknown')).toBeInTheDocument();
  });

  it('falls back to placeholders when a generation has no persona or subject', () => {
    mockQueries({
      generations: [{ ...FAILED_GENERATION, personaName: null, videoSubject: null }],
    });
    render(<PostHistoryPage />);

    expect(screen.getByText('posts.personaFallback')).toBeInTheDocument();
    expect(screen.getAllByText('posts.unknownTitle').length).toBeGreaterThanOrEqual(1);
  });

  it('prefers publishedAt for history slots but falls back to slotAt', () => {
    const withPublishedAt = {
      ...PUBLISHED_SLOT,
      id: 'r3',
      slotAt: '2020-03-10T10:00:00.000Z',
      publishedAt: '2020-05-20T10:00:00.000Z',
      title: 'Dated topic',
    };
    const withoutPublishedAt = {
      ...PUBLISHED_SLOT,
      id: 'r4',
      slotAt: '2020-03-10T10:00:00.000Z',
      publishedAt: null,
      title: 'Undated topic',
    };
    mockQueries({ recent: [withPublishedAt, withoutPublishedAt] });
    render(<PostHistoryPage />);

    const may20 = new Date('2020-05-20T10:00:00.000Z').toLocaleDateString('en-US', {
      dateStyle: 'medium',
    });
    const mar10 = new Date('2020-03-10T10:00:00.000Z').toLocaleDateString('en-US', {
      dateStyle: 'medium',
    });
    const datedCard = screen.getByText('Dated topic').closest('a');
    const undatedCard = screen.getByText('Undated topic').closest('a');
    expect(datedCard?.textContent).toContain(may20);
    expect(undatedCard?.textContent).toContain(mar10);
  });

  it('disables the refresh button while a refetch is in flight', () => {
    vi.mocked(useScheduleStatusQuery).mockReturnValue({
      data: { upcoming: [], recent: [PUBLISHED_SLOT] },
      isLoading: false,
      isFetching: true,
      isError: false,
      refetch: vi.fn(),
    } as never);
    render(<PostHistoryPage />);

    expect(screen.getByRole('button', { name: 'posts.refresh' })).toBeDisabled();
  });
});
