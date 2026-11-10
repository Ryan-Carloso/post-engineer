import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

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
import { useExperimentsQuery, useExperimentDetailQuery } from '@/lib/experiments/experiments-dashboard';

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

function detailFixture(overrides: Record<string, unknown> = {}) {
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
    expect(screen.getByText(/10 de nov\. de 2026/)).toBeInTheDocument();
    expect(screen.getByText('YouTube')).toBeInTheDocument();
    expect(screen.getByText('experiments.labelIndicative')).toBeInTheDocument();
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
  });
});
