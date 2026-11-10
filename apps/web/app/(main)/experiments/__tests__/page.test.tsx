import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

//---------------
// /experiments page tests (issue #532). The data hooks are mocked; the
// assertions cover what the API cannot: human variant names only (never
// A/B letters), the winner only on a clear label, and the live badge
// with a real formatted timestamp.
//---------------

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: React.ComponentProps<'a'> & { href: string }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

vi.mock('@/lib/ui', () => ({
  AlertIcon: () => <span data-testid="icon-alert" />,
  ChartIcon: () => <span data-testid="icon-chart" />,
  SpinnerIcon: () => <span data-testid="icon-spinner" />,
}));

vi.mock('@/lib/account-options', () => ({
  PROVIDER_LABELS: { youtube: 'YouTube' },
}));

vi.mock('@/lib/providers/registry', () => ({
  isSocialProvider: (value: string) => value === 'youtube',
}));

vi.mock('@/lib/i18n/provider', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const react = require('react') as typeof import('react');
  // Interpolating mock: the real t() substitutes {params} into the
  // translated string, so the test can assert the formatted date instead
  // of the key (PR #528 lesson). Params are appended after the key.
  const t = (key: string, params?: Record<string, unknown>) => {
    if (params === undefined) return key;
    return `${key} [${Object.values(params).join(', ')}]`;
  };
  const useI18n = () => {
    const [locale, setLocale] = react.useState<'pt' | 'en'>('pt');
    return { locale, setLocale, t };
  };
  function I18nProvider({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
  }
  I18nProvider.displayName = 'I18nProvider';
  return { useI18n, I18nProvider };
});

vi.mock('@/lib/experiments/experiments-dashboard', () => ({
  useExperimentsQuery: vi.fn(),
  useExperimentDetailQuery: vi.fn(),
}));

import ExperimentsPage from '../page';
import {
  useExperimentDetailQuery,
  useExperimentsQuery,
  type ExperimentDetailResult,
} from '@/lib/experiments/experiments-dashboard';

const EXPERIMENT = {
  id: '7b0e6c1e-0000-4000-8000-000000000001',
  name: 'Hook test',
  variable: 'hook',
  personaId: null,
  targetPairs: 3,
  createdAt: '2026-11-10T09:00:00Z',
  variants: [
    { variantId: 'hook-calm', name: 'Calm question', description: 'Calm, curious opening.' },
    { variantId: 'hook-aggressive', name: 'Direct hook', description: 'Direct, provocative opening.' },
  ],
};

function detailFixture(overrides: Partial<ExperimentDetailResult> = {}): ExperimentDetailResult {
  return {
    success: true as const,
    experiment: EXPERIMENT,
    window: '7d' as const,
    videos: [],
    results: {
      targetPairs: 3,
      pairsCreated: 3,
      pairsPublished: 3,
      providers: [
        {
          provider: 'youtube',
          comparisons: [1, 2, 3].map((pair) => ({
            pair,
            values: {
              'hook-calm': { views: 500, likes: 2, comments: 1, averageViewDurationSeconds: 12 },
              'hook-aggressive': { views: 250, likes: 1, comments: 0, averageViewDurationSeconds: 20 },
            },
            winner: 'hook-calm',
          })),
          wins: { 'hook-calm': 3, 'hook-aggressive': 0 },
          ties: 0,
          pValue: 0.25,
          leader: 'hook-calm',
          label: 'indicative',
        },
      ],
    },
    truncated: false,
    source: 'live' as const,
    liveAt: '2026-11-10T12:00:00.000Z',
    liveFailures: [],
    frozen: false,
    ...overrides,
  };
}

function mockQueries(detail: unknown) {
  vi.mocked(useExperimentsQuery).mockReturnValue({
    data: { success: true, experiments: [EXPERIMENT], truncated: false },
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  } as never);
  vi.mocked(useExperimentDetailQuery).mockReturnValue({
    data: detail,
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('/experiments page', () => {
  it('shows both variants by human name only, with the live badge and updated time', () => {
    mockQueries(detailFixture());
    render(<ExperimentsPage />);
    expect(screen.getByText('experiments.title')).toBeInTheDocument();
    // Human names appear (table headers + wins tally); A/B variant
    // labels never do.
    expect(screen.getAllByText('Calm question').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Direct hook').length).toBeGreaterThan(0);
    expect(screen.queryByText(/variante a/i)).toBeNull();
    expect(screen.queryByText(/variant a/i)).toBeNull();
    expect(screen.getByText('experiments.liveBadge')).toBeInTheDocument();
    expect(screen.getByText('experiments.liveBadge').className).toContain('bg-success-soft');
    expect(screen.getByText(/10 de nov\. de 2026/)).toBeInTheDocument();
    expect(screen.getByText('YouTube')).toBeInTheDocument();
    expect(screen.getByText('experiments.labelIndicative')).toBeInTheDocument();
    expect(screen.getByText('experiments.labelIndicative').className).toContain('bg-warning-soft');
    expect(screen.getByRole('combobox')).not.toBeDisabled();
    expect(screen.getByText(/experiments\.pValue/)).toBeInTheDocument();
    expect(screen.getAllByText('500')).toHaveLength(3);
  });

  it('names no winner while the label is indicative, even with a leader', () => {
    mockQueries(detailFixture());
    render(<ExperimentsPage />);
    expect(screen.getByText('experiments.noWinner')).toBeInTheDocument();
    expect(screen.queryByText(/experiments\.winner:/)).toBeNull();
  });

  it('names the winner only when the label is clear', () => {
    const detail = detailFixture();
    detail.results.providers[0] = { ...detail.results.providers[0], label: 'clear', pValue: 0.01 };
    mockQueries(detail);
    render(<ExperimentsPage />);
    expect(screen.getByText('experiments.labelClear')).toBeInTheDocument();
    expect(screen.getByText('experiments.labelClear').className).toContain('bg-success-soft');
    expect(screen.getByText('experiments.winner [Calm question]')).toBeInTheDocument();
    expect(screen.queryByText('experiments.noWinner')).toBeNull();
  });

  it('shows the frozen badge and the snapshot note when live reads failed', () => {
    const detail = detailFixture({
      source: 'snapshot',
      liveAt: null,
      liveFailures: [{ postId: 'calm-1', provider: 'youtube' }],
      frozen: true,
    });
    mockQueries(detail);
    render(<ExperimentsPage />);
    expect(screen.getByText('experiments.frozenBadge')).toBeInTheDocument();
    expect(screen.getByText(/experiments\.liveFailures/)).toBeInTheDocument();
  });

  it('shows the empty state with no experiments', () => {
    vi.mocked(useExperimentsQuery).mockReturnValue({
      data: { success: true, experiments: [], truncated: false },
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    } as never);
    vi.mocked(useExperimentDetailQuery).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    } as never);
    render(<ExperimentsPage />);
    expect(screen.getByText('experiments.empty')).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeDisabled();
  });

  it('shows the partial badge in warning and the snapshot badge muted, with matching styles', () => {
    const partial = detailFixture({
      source: 'partial',
      liveAt: '2026-11-10T12:00:00.000Z',
      liveFailures: [{ postId: 'calm-1', provider: 'youtube' }],
    });
    mockQueries(partial);
    const { unmount } = render(<ExperimentsPage />);
    expect(screen.getByText('experiments.partialBadge')).toBeInTheDocument();
    expect(screen.getByText('experiments.partialBadge').className).toContain('bg-warning-soft');
    expect(screen.getByText(/experiments\.liveFailures/)).toBeInTheDocument();
    unmount();
    const snapshot = detailFixture({ source: 'snapshot', liveAt: null, liveFailures: [] });
    mockQueries(snapshot);
    render(<ExperimentsPage />);
    expect(screen.getByText('experiments.snapshotBadge')).toBeInTheDocument();
    expect(screen.getByText('experiments.snapshotBadge').className).toContain('bg-surface');
    expect(screen.queryByText(/experiments\.updatedAt/)).toBeNull();
    expect(screen.queryByText(/experiments\.liveFailures/)).toBeNull();
  });

  it('shows the frozen badge muted when every video is past 7d', () => {
    const detail = detailFixture({ source: 'snapshot', liveAt: null, liveFailures: [], frozen: true });
    mockQueries(detail);
    render(<ExperimentsPage />);
    expect(screen.getByText('experiments.frozenBadge')).toBeInTheDocument();
    expect(screen.getByText('experiments.frozenBadge').className).toContain('bg-surface');
  });

  it('shows the empty detail state when no provider has results yet', () => {
    const detail = detailFixture();
    detail.results.providers = [];
    mockQueries(detail);
    render(<ExperimentsPage />);
    expect(screen.getByText('experiments.emptyDetail')).toBeInTheDocument();
  });

  it('shows a dash for a missing p-value', () => {
    const detail = detailFixture();
    detail.results.providers[0] = { ...detail.results.providers[0], pValue: null };
    mockQueries(detail);
    render(<ExperimentsPage />);
    expect(screen.getByText('experiments.pValue [—]')).toBeInTheDocument();
  });

  it('shows a tie for an undecided pair and no data for a missing comparison', () => {
    const detail = detailFixture();
    detail.results.providers[0] = {
      ...detail.results.providers[0],
      comparisons: [1, 2].map((pair) => ({
        pair,
        values: {
          'hook-calm': { views: 500, likes: 2, comments: 1, averageViewDurationSeconds: 12 },
          'hook-aggressive': { views: 500, likes: 1, comments: 0, averageViewDurationSeconds: 20 },
        },
        winner: null,
      })),
    };
    mockQueries(detail);
    render(<ExperimentsPage />);
    expect(screen.getAllByText('experiments.tie')).toHaveLength(2);
    expect(screen.getByText('experiments.noData')).toBeInTheDocument();
    // Pair 3 has no comparison: both view cells are a dash.
    expect(screen.getAllByText('—')).toHaveLength(2);
  });

  it('shows the pending label while nothing is decided', () => {
    const detail = detailFixture();
    detail.results.providers[0] = {
      ...detail.results.providers[0],
      label: 'pending',
      pValue: null,
      leader: null,
      wins: { 'hook-calm': 1, 'hook-aggressive': 1 },
      ties: 1,
    };
    mockQueries(detail);
    render(<ExperimentsPage />);
    const badge = screen.getByText('experiments.labelPending');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('bg-surface');
    expect(screen.getByText('experiments.noWinner')).toBeInTheDocument();
  });

  it('renders an unknown provider by its id', () => {
    const detail = detailFixture();
    detail.results.providers[0] = { ...detail.results.providers[0], provider: 'rumble' };
    mockQueries(detail);
    render(<ExperimentsPage />);
    expect(screen.getByText('rumble')).toBeInTheDocument();
    expect(screen.queryByText('YouTube')).toBeNull();
  });

  it('counts a missing variant as zero wins', () => {
    const detail = detailFixture();
    detail.results.providers[0] = { ...detail.results.providers[0], wins: { 'hook-calm': 3 } };
    mockQueries(detail);
    render(<ExperimentsPage />);
    expect(screen.getByText('experiments.wins: Calm question 3 — 0 Direct hook')).toBeInTheDocument();
  });

  it('names no winner when the label is clear but there is no leader', () => {
    const detail = detailFixture();
    detail.results.providers[0] = { ...detail.results.providers[0], label: 'clear', leader: null };
    mockQueries(detail);
    render(<ExperimentsPage />);
    expect(screen.getByText('experiments.labelClear')).toBeInTheDocument();
    expect(screen.getByText('experiments.noWinner')).toBeInTheDocument();
    expect(screen.queryByText(/experiments\.winner:/)).toBeNull();
  });

  it('defaults to the first experiment once the list loads', () => {
    mockQueries(detailFixture());
    render(<ExperimentsPage />);
    expect(vi.mocked(useExperimentDetailQuery)).toHaveBeenCalledWith(EXPERIMENT.id, '7d');
  });

  it('switches the window when the 24h segment is clicked', () => {
    mockQueries(detailFixture());
    render(<ExperimentsPage />);
    expect(screen.getByText('experiments.window7d')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('experiments.window7d').className).toContain('bg-card');
    expect(screen.getByText('experiments.window24h')).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByText('experiments.window24h'));
    expect(screen.getByText('experiments.window24h')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('experiments.window24h').className).toContain('bg-card');
    expect(vi.mocked(useExperimentDetailQuery).mock.calls.at(-1)).toEqual([EXPERIMENT.id, '24h']);
  });

  it('loads the picked experiment and resets to the first when the placeholder is picked', () => {
    const second = { ...EXPERIMENT, id: '8b0e6c1e-0000-4000-8000-000000000002', name: 'Second test' };
    vi.mocked(useExperimentsQuery).mockReturnValue({
      data: { success: true, experiments: [EXPERIMENT, second], truncated: false },
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    } as never);
    vi.mocked(useExperimentDetailQuery).mockReturnValue({
      data: detailFixture(),
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    } as never);
    render(<ExperimentsPage />);
    expect(vi.mocked(useExperimentDetailQuery).mock.calls.at(-1)).toEqual([EXPERIMENT.id, '7d']);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: second.id } });
    expect(vi.mocked(useExperimentDetailQuery).mock.calls.at(-1)).toEqual([second.id, '7d']);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } });
    expect(vi.mocked(useExperimentDetailQuery).mock.calls.at(-1)).toEqual([EXPERIMENT.id, '7d']);
  });

  it('shows the spinner while the list loads and disables the select', () => {
    vi.mocked(useExperimentsQuery).mockReturnValue({
      data: { success: true, experiments: [EXPERIMENT], truncated: false },
      isLoading: true,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    } as never);
    vi.mocked(useExperimentDetailQuery).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    } as never);
    render(<ExperimentsPage />);
    expect(screen.getByTestId('icon-spinner')).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeDisabled();
  });

  it('shows the spinner while the detail loads for the selected experiment', () => {
    vi.mocked(useExperimentsQuery).mockReturnValue({
      data: { success: true, experiments: [EXPERIMENT], truncated: false },
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    } as never);
    vi.mocked(useExperimentDetailQuery).mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    } as never);
    render(<ExperimentsPage />);
    expect(screen.getByTestId('icon-spinner')).toBeInTheDocument();
  });

  it('does not show the spinner for a loading detail with no experiment selected', () => {
    vi.mocked(useExperimentsQuery).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    } as never);
    vi.mocked(useExperimentDetailQuery).mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    } as never);
    render(<ExperimentsPage />);
    expect(screen.queryByTestId('icon-spinner')).toBeNull();
    expect(screen.getByText('experiments.empty')).toBeInTheDocument();
  });

  it('shows the error panel and retries both queries', () => {
    const listRefetch = vi.fn();
    const detailRefetch = vi.fn();
    vi.mocked(useExperimentsQuery).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      isFetching: false,
      refetch: listRefetch,
    } as never);
    vi.mocked(useExperimentDetailQuery).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: detailRefetch,
    } as never);
    render(<ExperimentsPage />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByTestId('icon-alert')).toBeInTheDocument();
    expect(screen.getByText('experiments.loadError')).toBeInTheDocument();
    fireEvent.click(screen.getByText('experiments.retry'));
    expect(listRefetch).toHaveBeenCalledTimes(1);
    expect(detailRefetch).toHaveBeenCalledTimes(1);
  });

  it('shows the error panel when the list or the detail answers unsuccessfully', () => {
    vi.mocked(useExperimentsQuery).mockReturnValue({
      data: { success: false, error: 'boom' },
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    } as never);
    vi.mocked(useExperimentDetailQuery).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    } as never);
    const { unmount } = render(<ExperimentsPage />);
    expect(screen.getByText('experiments.loadError')).toBeInTheDocument();
    unmount();
    mockQueries({ success: false, error: 'boom' });
    render(<ExperimentsPage />);
    expect(screen.getByText('experiments.loadError')).toBeInTheDocument();
  });

  it('shows the empty detail state when no detail has loaded yet', () => {
    vi.mocked(useExperimentsQuery).mockReturnValue({
      data: { success: true, experiments: [EXPERIMENT], truncated: false },
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    } as never);
    vi.mocked(useExperimentDetailQuery).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    } as never);
    render(<ExperimentsPage />);
    expect(screen.getByText('experiments.emptyDetail')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the error panel when the detail query alone errors', () => {
    vi.mocked(useExperimentsQuery).mockReturnValue({
      data: { success: true, experiments: [EXPERIMENT], truncated: false },
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    } as never);
    vi.mocked(useExperimentDetailQuery).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      isFetching: false,
      refetch: vi.fn(),
    } as never);
    render(<ExperimentsPage />);
    expect(screen.getByText('experiments.loadError')).toBeInTheDocument();
  });

  it('disables the retry button while a query is refetching', () => {
    vi.mocked(useExperimentsQuery).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      isFetching: true,
      refetch: vi.fn(),
    } as never);
    vi.mocked(useExperimentDetailQuery).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    } as never);
    render(<ExperimentsPage />);
    expect(screen.getByText('experiments.retry')).toBeDisabled();
  });

  it('falls back to the variant id when the winner is unknown', () => {
    const detail = detailFixture();
    detail.results.providers[0] = {
      ...detail.results.providers[0],
      comparisons: [
        {
          pair: 1,
          values: {
            'hook-calm': { views: 500, likes: 2, comments: 1, averageViewDurationSeconds: 12 },
            'hook-aggressive': { views: 250, likes: 1, comments: 0, averageViewDurationSeconds: 20 },
          },
          winner: 'hook-mystery',
        },
      ],
    };
    mockQueries(detail);
    render(<ExperimentsPage />);
    expect(screen.getByText('hook-mystery')).toBeInTheDocument();
  });

  it('formats large numbers for the pt-BR locale', () => {
    const detail = detailFixture();
    detail.results.providers[0] = {
      ...detail.results.providers[0],
      comparisons: [1, 2, 3].map((pair) => ({
        pair,
        values: {
          'hook-calm': { views: 1500, likes: 2, comments: 1, averageViewDurationSeconds: 12 },
          'hook-aggressive': { views: 250, likes: 1, comments: 0, averageViewDurationSeconds: 20 },
        },
        winner: 'hook-calm',
      })),
    };
    mockQueries(detail);
    render(<ExperimentsPage />);
    expect(screen.getAllByText('1.500')).toHaveLength(3);
  });
});
