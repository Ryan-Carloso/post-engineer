import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';

window.HTMLElement.prototype.scrollIntoView = vi.fn();
window.HTMLElement.prototype.hasPointerCapture = () => false;
window.HTMLElement.prototype.setPointerCapture = () => {};
window.HTMLElement.prototype.releasePointerCapture = () => {};

vi.mock('@/lib/api', () => ({
  useScheduleStatusQuery: vi.fn(),
  useSchedulesQuery: vi.fn(),
  usePersonaListQuery: vi.fn(),
  useVideoGenerationsQuery: vi.fn(),
}));

vi.mock('@/lib/social-accounts-queries', () => ({
  useSocialAccountsQuery: vi.fn(),
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
  useVideoGenerationsQuery,
} from '@/lib/api';
import { useSocialAccountsQuery } from '@/lib/social-accounts-queries';

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

function mockQueries(overrides: { recent?: unknown[]; schedules?: unknown[]; generations?: unknown[]; personas?: unknown[] } = {}) {
  vi.mocked(useScheduleStatusQuery).mockReturnValue(ok({ upcoming: [], recent: overrides.recent ?? [PUBLISHED_SLOT, FAILED_SLOT] }));
  vi.mocked(useSchedulesQuery).mockReturnValue(ok(overrides.schedules ?? [SCHEDULE]));
  vi.mocked(usePersonaListQuery).mockReturnValue(ok(overrides.personas ?? [{ id: 'p1', name: 'Viva Leve' }]));
  vi.mocked(useSocialAccountsQuery).mockReturnValue({
    data: { authenticated: true, accounts: [{ provider: 'youtube', channelId: 'ch1', channelName: 'Europa Na Estrada' }, { provider: 'instagram', igUserId: 'ig1', username: 'vivalave' }] },
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
    expect(screen.getByText('posts.groupPublished')).toBeInTheDocument();
    expect(screen.getByText('Failed topic')).toBeInTheDocument();
    expect(screen.getByText('posts.groupFailed')).toBeInTheDocument();
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

  it('titles the past posts section', () => {
    render(<PostHistoryPage />);

    expect(screen.getByText('posts.historyPostsTitle')).toBeInTheDocument();
    expect(screen.getByText('posts.generationsTitle')).toBeInTheDocument();
  });

  it('shows a loading skeleton while the history is loading', () => {
    vi.mocked(useScheduleStatusQuery).mockReturnValue({
      data: undefined,
      isLoading: true,
      isFetching: false,
      isError: false,
      refetch: vi.fn(),
    } as never);
    render(<PostHistoryPage />);

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('posts.loadingPosts')).toBeInTheDocument();
  });

  it('names the generations when the generations query fails', () => {
    vi.mocked(useVideoGenerationsQuery).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: vi.fn(),
    } as never);
    render(<PostHistoryPage />);

    expect(screen.getByText('posts.loadErrorGenerations')).toBeInTheDocument();
  });

  it('shows the categorized failure reason on a failed card, never the raw engine text', () => {
    mockQueries({
      recent: [{ ...FAILED_SLOT, error: 'The engine restarted while generating your video.', retryable: true }],
    });
    render(<PostHistoryPage />);

    expect(screen.getByText('posts.errorEngineRestart')).toBeInTheDocument();
    expect(screen.queryByText('The engine restarted while generating your video.')).not.toBeInTheDocument();
  });

  it('truncates the failure line to one row in the dense list', () => {
    mockQueries({ generations: [FAILED_GENERATION] });
    render(<PostHistoryPage />);

    const message = screen.getByText('posts.errorCustomAudio');
    expect(message.className.split(/\s+/)).toContain('truncate');
    const slotMessage = screen.getByText('posts.cardFailedPermanent');
    expect(slotMessage.className.split(/\s+/)).toContain('truncate');
  });

  it('draws no thumbnail tile on a card without video, and keeps the full date on history cards', () => {
    render(<PostHistoryPage />);

    const card = screen.getByText('Failed topic').closest('a');
    expect(card).not.toBeNull();
    expect(card?.querySelector('video')).toBeNull();
    expect(card?.textContent).toContain('·');
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

    expect(screen.getByText('posts.loadErrorHistory')).toBeInTheDocument();
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

    const errorPanel = screen.getByText('posts.loadErrorHistory').closest('div');
    if (!errorPanel) throw new Error('error panel not rendered');
    await user.click(within(errorPanel).getByRole('button', { name: 'posts.refresh' }));
    expect(statusRefetch).toHaveBeenCalledTimes(1);
    expect(schedulesRefetch).toHaveBeenCalledTimes(1);
  });

  it('shows a capped-list hint when the list hits the fetch limit', () => {
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
    const recent = Array.from({ length: POSTS_LIMIT }, (_, i) => ({ ...PUBLISHED_SLOT, id: `r${i}` }));
    mockQueries({ recent });
    const user = userEvent.setup();
    render(<PostHistoryPage />);

    await user.click(screen.getByLabelText('posts.filterProvider'));
    await user.click(screen.getByRole('option', { name: 'LinkedIn' }));
    expect(screen.getByText('posts.noResultsForFilter')).toBeInTheDocument();
    expect(screen.getByText('posts.listCapped')).toBeInTheDocument();
  });

  it('filters history slots by persona', async () => {
    const user = userEvent.setup();
    render(<PostHistoryPage />);

    await user.click(screen.getByLabelText('posts.filterPersona'));
    await user.click(screen.getByRole('option', { name: 'Viva Leve' }));

    expect(screen.getByText('Past topic')).toBeInTheDocument();
    expect(screen.getByText('Failed topic')).toBeInTheDocument();
  });

  it('hides persona slots for the no-persona option', async () => {
    const user = userEvent.setup();
    render(<PostHistoryPage />);

    await user.click(screen.getByLabelText('posts.filterPersona'));
    await user.click(screen.getByRole('option', { name: 'posts.noPersona' }));

    expect(screen.queryByText('Past topic')).not.toBeInTheDocument();
    expect(screen.queryByText('Failed topic')).not.toBeInTheDocument();
    expect(screen.getByText('posts.noResultsForFilter')).toBeInTheDocument();
  });

  it('shows the generations section with friendly errors and refund badges', () => {
    mockQueries({ generations: [FAILED_GENERATION, RUNNING_GENERATION] });
    render(<PostHistoryPage />);

    expect(screen.getByText('posts.generationsTitle')).toBeInTheDocument();
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

    const pastCard = screen.getByText('Past topic').closest('a');
    expect(pastCard).not.toBeNull();
    expect(pastCard).toHaveAttribute('href', '/posts/r1');
    const failedCard = screen.getByText('Failed topic').closest('a');
    expect(failedCard).not.toBeNull();
    expect(failedCard).toHaveAttribute('href', '/posts/r2');
    expect(screen.getByRole('link', { name: /Launch recap/ })).toHaveAttribute('href', '/posts/gen-3');
  });

  it('links generation cards to the id the detail lookup resolves by', () => {
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

    const errorPanel = screen.getByText('posts.loadErrorHistory').closest('div');
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
