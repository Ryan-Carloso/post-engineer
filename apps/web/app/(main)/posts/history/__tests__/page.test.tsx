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

function mockQueries(overrides: { recent?: unknown[]; schedules?: unknown[]; personas?: unknown[] } = {}) {
  vi.mocked(useScheduleStatusQuery).mockReturnValue(ok({ upcoming: [], recent: overrides.recent ?? [PUBLISHED_SLOT, FAILED_SLOT] }));
  vi.mocked(useSchedulesQuery).mockReturnValue(ok(overrides.schedules ?? [SCHEDULE]));
  vi.mocked(usePersonaListQuery).mockReturnValue(ok(overrides.personas ?? [{ id: 'p1', name: 'Viva Leve' }]));
  vi.mocked(useSocialAccountsQuery).mockReturnValue({
    data: { authenticated: true, accounts: [{ provider: 'youtube', channelId: 'ch1', channelName: 'Europa Na Estrada' }, { provider: 'instagram', igUserId: 'ig1', username: 'vivalave' }] },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockQueries();
});

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

  it('shows the history empty state when there are no past posts', () => {
    mockQueries({ recent: [] });
    render(<PostHistoryPage />);

    expect(screen.getByText('posts.noHistory')).toBeInTheDocument();
  });

  it('titles the past posts section', () => {
    render(<PostHistoryPage />);

    expect(screen.getByText('posts.historyPostsTitle')).toBeInTheDocument();
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

  it('truncates the failure line to one row in the dense list', () => {
    render(<PostHistoryPage />);

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

  it('links history cards to their detail pages', () => {
    render(<PostHistoryPage />);

    const pastCard = screen.getByText('Past topic').closest('a');
    expect(pastCard).not.toBeNull();
    expect(pastCard).toHaveAttribute('href', '/posts/r1');
    const failedCard = screen.getByText('Failed topic').closest('a');
    expect(failedCard).not.toBeNull();
    expect(failedCard).toHaveAttribute('href', '/posts/r2');
  });

  it('shows no progress bar on terminal cards', () => {
    render(<PostHistoryPage />);

    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
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
