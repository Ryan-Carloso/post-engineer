import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import * as React from 'react';
import type { ReactNode } from 'react';

vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>();
  function ResponsiveContainerStub({ children }: { children: ReactNode }): React.ReactElement {
    return (
      <div data-testid="responsive-stub">
        {React.Children.map(children, (child) =>
          React.isValidElement(child)
            ? React.cloneElement(child as React.ReactElement<Record<string, unknown>>, { width: 600, height: 300 })
            : child,
        )}
      </div>
    );
  }
  return { ...actual, ResponsiveContainer: ResponsiveContainerStub };
});

vi.mock('@/lib/account-options', () => ({
  PROVIDER_LABELS: { youtube: 'YouTube' },
}));

vi.mock('@/lib/providers/registry', () => ({
  isSocialProvider: (value: string) => value === 'youtube',
}));

vi.mock('@/lib/i18n/provider', async () => {
  const react = await import('react');
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

import {
  PerPairChart,
  ProviderCard,
  VariantComparisonChart,
  WinSplitChart,
} from '../experiment-charts';
import type { ExperimentProviderResult } from '@/lib/experiments/experiments-dashboard';

const A = 'hook-calm';
const B = 'hook-aggressive';
const FIRST = 'Calm question';
const SECOND = 'Direct hook';
const formatNumber = (value: number): string => value.toLocaleString('pt-BR');

const COMPARISONS = [1, 2, 3].map((pair) => ({
  pair,
  values: {
    [A]: { views: 500, likes: 2, comments: 1, averageViewDurationSeconds: 12 },
    [B]: { views: 250, likes: 1, comments: 0, averageViewDurationSeconds: 20 },
  },
  winner: A,
}));

const PROVIDER: ExperimentProviderResult = {
  provider: 'youtube',
  comparisons: COMPARISONS,
  wins: { [A]: 3, [B]: 0 },
  ties: 0,
  pValue: 0.25,
  leader: A,
  label: 'indicative',
};

function variantName(variantId: string): string {
  if (variantId === A) return FIRST;
  if (variantId === B) return SECOND;
  return variantId;
}

describe('VariantComparisonChart', () => {
  it('shows the totals as text and draws both bars for views', () => {
    const { container } = render(
      <VariantComparisonChart
        comparisons={COMPARISONS}
        firstId={A}
        secondId={B}
        firstName={FIRST}
        secondName={SECOND}
        metric="views"
        formatNumber={formatNumber}
      />,
    );
    expect(screen.getByText('experiments.variantComparison')).toBeInTheDocument();
    expect(screen.getByText('Calm question: 1.500 · Direct hook: 750')).toBeInTheDocument();
    expect(screen.getByText(FIRST)).toBeInTheDocument();
    expect(screen.getByText(SECOND)).toBeInTheDocument();
    expect(container.querySelector('style')?.textContent).toContain('--color-a: var(--info);');
    expect(container.querySelector('style')?.textContent).toContain('--color-b: var(--warning);');
  });

  it('shows the singular excluded-nulls caption when one value is missing', () => {
    render(
      <VariantComparisonChart
        comparisons={[{ pair: 1, values: { [A]: { views: null, likes: 1, comments: 0, averageViewDurationSeconds: 5 }, [B]: { views: 10, likes: 1, comments: 0, averageViewDurationSeconds: 5 } }, winner: null }]}
        firstId={A}
        secondId={B}
        firstName={FIRST}
        secondName={SECOND}
        metric="views"
        formatNumber={formatNumber}
      />,
    );
    expect(screen.getByText('experiments.excludedNullOne')).toBeInTheDocument();
    expect(screen.getByText('Calm question: — · Direct hook: 10')).toBeInTheDocument();
    expect(screen.queryByText('experiments.excludedNullOther [1]')).toBeNull();
    expect(screen.queryByText('experiments.noMetricData')).toBeNull();
    expect(screen.queryByText('Calm question')).toBeNull();
    expect(screen.getByText('Direct hook')).toBeInTheDocument();
  });

  it('shows a dash when the second variant has no data for the metric', () => {
    render(
      <VariantComparisonChart
        comparisons={[{ pair: 1, values: { [A]: { views: 10, likes: 1, comments: 0, averageViewDurationSeconds: 5 }, [B]: { views: null, likes: 1, comments: 0, averageViewDurationSeconds: 5 } }, winner: A }]}
        firstId={A}
        secondId={B}
        firstName={FIRST}
        secondName={SECOND}
        metric="views"
        formatNumber={formatNumber}
      />,
    );
    expect(screen.getByText('Calm question: 10 · Direct hook: —')).toBeInTheDocument();
    expect(screen.queryByText('Calm question: 10 · Direct hook: 0')).toBeNull();
  });

  it('counts a pair with both values missing as one excluded pair', () => {
    render(
      <VariantComparisonChart
        comparisons={[
          { pair: 1, values: { [A]: { views: null, likes: 1, comments: 0, averageViewDurationSeconds: 5 }, [B]: { views: null, likes: 1, comments: 0, averageViewDurationSeconds: 5 } }, winner: null },
          { pair: 2, values: { [A]: { views: 100, likes: 1, comments: 0, averageViewDurationSeconds: 5 }, [B]: { views: 50, likes: 1, comments: 0, averageViewDurationSeconds: 5 } }, winner: A },
        ]}
        firstId={A}
        secondId={B}
        firstName={FIRST}
        secondName={SECOND}
        metric="views"
        formatNumber={formatNumber}
      />,
    );
    expect(screen.getByText('experiments.excludedNullOne')).toBeInTheDocument();
    expect(screen.getByText('Calm question: 100 · Direct hook: 50')).toBeInTheDocument();
    expect(screen.queryByText('experiments.excludedNullOther [2]')).toBeNull();
  });

  it('shows the plural excluded-nulls caption when two pairs are missing values', () => {
    render(
      <VariantComparisonChart
        comparisons={[
          { pair: 1, values: { [A]: { views: null, likes: 1, comments: 0, averageViewDurationSeconds: 5 }, [B]: { views: 10, likes: 1, comments: 0, averageViewDurationSeconds: 5 } }, winner: null },
          { pair: 2, values: { [A]: { views: 100, likes: 1, comments: 0, averageViewDurationSeconds: 5 }, [B]: { views: null, likes: 1, comments: 0, averageViewDurationSeconds: 5 } }, winner: null },
          { pair: 3, values: { [A]: { views: 100, likes: 1, comments: 0, averageViewDurationSeconds: 5 }, [B]: { views: 50, likes: 1, comments: 0, averageViewDurationSeconds: 5 } }, winner: A },
        ]}
        firstId={A}
        secondId={B}
        firstName={FIRST}
        secondName={SECOND}
        metric="views"
        formatNumber={formatNumber}
      />,
    );
    expect(screen.getByText('experiments.excludedNullOther [2]')).toBeInTheDocument();
    expect(screen.getByText('Calm question: 200 · Direct hook: 60')).toBeInTheDocument();
    expect(screen.queryByText('experiments.excludedNullOne')).toBeNull();
  });

  it('shows the pending empty states with no published pairs', () => {
    render(
      <VariantComparisonChart
        comparisons={[]}
        firstId={A}
        secondId={B}
        firstName={FIRST}
        secondName={SECOND}
        metric="views"
        formatNumber={formatNumber}
      />,
    );
    expect(screen.getByText('experiments.noPairData')).toBeInTheDocument();
  });

  it('shows the no-metric-data state when every value is null', () => {
    render(
      <VariantComparisonChart
        comparisons={[{ pair: 1, values: { [A]: { views: null, likes: null, comments: null, averageViewDurationSeconds: null }, [B]: { views: null, likes: null, comments: null, averageViewDurationSeconds: null } }, winner: null }]}
        firstId={A}
        secondId={B}
        firstName={FIRST}
        secondName={SECOND}
        metric="views"
        formatNumber={formatNumber}
      />,
    );
    expect(screen.getByText('experiments.noMetricData')).toBeInTheDocument();
  });

  it('never renders NaN for a null total', () => {
    const { container } = render(
      <VariantComparisonChart
        comparisons={[{ pair: 1, values: { [A]: { views: null, likes: null, comments: null, averageViewDurationSeconds: null }, [B]: { views: 10, likes: 1, comments: 0, averageViewDurationSeconds: 5 } }, winner: null }]}
        firstId={A}
        secondId={B}
        firstName={FIRST}
        secondName={SECOND}
        metric="views"
        formatNumber={formatNumber}
      />,
    );
    expect(screen.getByText('Calm question: — · Direct hook: 10')).toBeInTheDocument();
    expect(container.textContent).not.toContain('NaN');
  });
});

describe('PerPairChart', () => {
  it('shows the per-pair chart title, legend and encoding caption', () => {
    render(
      <PerPairChart
        comparisons={COMPARISONS}
        firstId={A}
        secondId={B}
        firstName={FIRST}
        secondName={SECOND}
        metric="views"
        formatNumber={formatNumber}
      />,
    );
    expect(screen.getByText('experiments.perPair')).toBeInTheDocument();
    expect(screen.getByText(FIRST)).toBeInTheDocument();
    expect(screen.getByText(SECOND)).toBeInTheDocument();
    expect(screen.getByText('experiments.perPairCaption')).toBeInTheDocument();
  });

  it('shows the no-metric-data state when every pair value is null', () => {
    render(
      <PerPairChart
        comparisons={[{ pair: 1, values: { [A]: { views: null, likes: null, comments: null, averageViewDurationSeconds: null }, [B]: { views: null, likes: null, comments: null, averageViewDurationSeconds: null } }, winner: null }]}
        firstId={A}
        secondId={B}
        firstName={FIRST}
        secondName={SECOND}
        metric="views"
        formatNumber={formatNumber}
      />,
    );
    expect(screen.getByText('experiments.noMetricData')).toBeInTheDocument();
  });

  it('keeps each variant color with the loser faded, ties grey, and skips nulls', () => {
    const { container } = render(
      <PerPairChart
        comparisons={[
          { pair: 1, values: { [A]: { views: 500, likes: 2, comments: 1, averageViewDurationSeconds: 12 }, [B]: { views: 250, likes: 1, comments: 0, averageViewDurationSeconds: 20 } }, winner: A },
          { pair: 2, values: { [A]: { views: 100, likes: 2, comments: 1, averageViewDurationSeconds: 12 }, [B]: { views: 250, likes: 1, comments: 0, averageViewDurationSeconds: 20 } }, winner: B },
          { pair: 3, values: { [A]: { views: 300, likes: 2, comments: 1, averageViewDurationSeconds: 12 }, [B]: { views: 300, likes: 1, comments: 0, averageViewDurationSeconds: 20 } }, winner: null },
          { pair: 4, values: { [A]: { views: null, likes: 2, comments: 1, averageViewDurationSeconds: 12 }, [B]: { views: 200, likes: 1, comments: 0, averageViewDurationSeconds: 20 } }, winner: B },
        ]}
        firstId={A}
        secondId={B}
        firstName={FIRST}
        secondName={SECOND}
        metric="views"
        formatNumber={formatNumber}
      />,
    );
    const paths = Array.from(container.querySelectorAll('.recharts-bar-rectangle path'));
    const fills = paths.map((path) => path.getAttribute('fill'));
    const opacities = paths.map((path) => path.getAttribute('fill-opacity') ?? path.getAttribute('fillOpacity'));
    expect(fills).toEqual([
      'var(--color-a)', 'var(--color-a)', 'var(--faint)',
      'var(--color-b)', 'var(--color-b)', 'var(--faint)', 'var(--color-b)',
    ]);
    expect(opacities).toEqual([null, '0.35', null, '0.35', null, null, null]);
  });

  it('shows the pending empty state with no published pairs', () => {
    render(
      <PerPairChart
        comparisons={[]}
        firstId={A}
        secondId={B}
        firstName={FIRST}
        secondName={SECOND}
        metric="views"
        formatNumber={formatNumber}
      />,
    );
    expect(screen.getByText('experiments.noPairData')).toBeInTheDocument();
  });
});

describe('WinSplitChart', () => {
  it('states the win split as text next to the stacked bar', () => {
    render(
      <WinSplitChart
        provider={PROVIDER}
        firstName={FIRST}
        secondName={SECOND}
        firstId={A}
        secondId={B}
        formatNumber={formatNumber}
      />,
    );
    expect(screen.getByText('experiments.winSplit')).toBeInTheDocument();
    expect(screen.getByText('Calm question: 3 · experiments.tie: 0 · Direct hook: 0')).toBeInTheDocument();
    expect(screen.queryByText('experiments.noPairData')).toBeNull();
    expect(screen.getByText(FIRST)).toBeInTheDocument();
    expect(screen.getByText(SECOND)).toBeInTheDocument();
    expect(screen.getByText('experiments.tie')).toBeInTheDocument();
  });

  it('draws the stacked bar when wins cancel out to a non-zero total', () => {
    render(
      <WinSplitChart
        provider={{ ...PROVIDER, wins: { [A]: 1, [B]: 1 }, ties: 0 }}
        firstName={FIRST}
        secondName={SECOND}
        firstId={A}
        secondId={B}
        formatNumber={formatNumber}
      />,
    );
    expect(screen.getByText('Calm question: 1 · experiments.tie: 0 · Direct hook: 1')).toBeInTheDocument();
    expect(screen.queryByText('experiments.noPairData')).toBeNull();
  });

  it('shows the pending empty state when there are no wins or ties', () => {
    render(
      <WinSplitChart
        provider={{ ...PROVIDER, wins: {}, ties: 0 }}
        firstName={FIRST}
        secondName={SECOND}
        firstId={A}
        secondId={B}
        formatNumber={formatNumber}
      />,
    );
    expect(screen.getByText('experiments.noPairData')).toBeInTheDocument();
  });
});

describe('ProviderCard charts', () => {
  function renderCard(): ReturnType<typeof render> {
    return render(
      <ProviderCard
        provider={PROVIDER}
        firstName={FIRST}
        secondName={SECOND}
        firstId={A}
        secondId={B}
        variantName={variantName}
        pairsCreated={3}
        formatNumber={formatNumber}
      />,
    );
  }

  it('switches the metric, and the table behind Show table follows it', () => {
    renderCard();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText('Calm question: 1.500 · Direct hook: 750')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'experiments.metricLikes' }));
    fireEvent.click(screen.getByRole('tab', { name: 'experiments.metricLikes' }));
    expect(screen.getByText('Calm question: 6 · Direct hook: 3')).toBeInTheDocument();
    fireEvent.click(screen.getByText('experiments.showTable'));
    const table = screen.getByRole('table', { name: 'experiments.metricLikes' });
    const cells = within(table).getAllByRole('row').slice(1).map((row) =>
      within(row).getAllByRole('cell').slice(1, 3).map((cell) => cell.textContent));
    expect(cells).toEqual([['2', '1'], ['2', '1'], ['2', '1']]);
    expect(within(table).queryByText('500')).toBeNull();
    fireEvent.click(screen.getByText('experiments.hideTable'));
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('switches to comments and average view duration', () => {
    renderCard();
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'experiments.metricComments' }));
    fireEvent.click(screen.getByRole('tab', { name: 'experiments.metricComments' }));
    expect(screen.getByText('Calm question: 3 · Direct hook: 0')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'experiments.metricAvgDuration' }));
    fireEvent.click(screen.getByRole('tab', { name: 'experiments.metricAvgDuration' }));
    expect(screen.getByText('Calm question: 12 · Direct hook: 20')).toBeInTheDocument();
  });

  it('shows the indicative badge, the p-value and no winner', () => {
    const { container } = renderCard();
    const section = container.querySelector('section');
    expect(section?.className).toContain('bg-card');
    expect(section?.className).toContain('rounded-2xl');
    expect(section?.className).toContain('p-4');
    expect(screen.getByText('experiments.labelIndicative')).toBeInTheDocument();
    expect(screen.getByText('experiments.pValue [0.250]')).toBeInTheDocument();
    expect(screen.getByText('experiments.noWinner')).toBeInTheDocument();
    expect(screen.getByText('experiments.wins: Calm question 3 — 0 Direct hook')).toBeInTheDocument();
  });

  it('shows the clear badge and names the winner when the label is clear', () => {
    render(
      <ProviderCard
        provider={{ ...PROVIDER, label: 'clear' }}
        firstName={FIRST}
        secondName={SECOND}
        firstId={A}
        secondId={B}
        variantName={variantName}
        pairsCreated={3}
        formatNumber={formatNumber}
      />,
    );
    expect(screen.getByText('experiments.labelClear')).toBeInTheDocument();
    expect(screen.getByText('experiments.winner [Calm question]')).toBeInTheDocument();
    expect(screen.queryByText('experiments.noWinner')).toBeNull();
  });

  it('shows the pending badge and no winner when pending', () => {
    render(
      <ProviderCard
        provider={{ ...PROVIDER, label: 'pending', leader: null }}
        firstName={FIRST}
        secondName={SECOND}
        firstId={A}
        secondId={B}
        variantName={variantName}
        pairsCreated={3}
        formatNumber={formatNumber}
      />,
    );
    expect(screen.getByText('experiments.labelPending')).toBeInTheDocument();
    expect(screen.getByText('experiments.noWinner')).toBeInTheDocument();
  });

  it('states the win split with ties as text', () => {
    render(
      <ProviderCard
        provider={{ ...PROVIDER, wins: { [A]: 1, [B]: 1 }, ties: 1 }}
        firstName={FIRST}
        secondName={SECOND}
        firstId={A}
        secondId={B}
        variantName={variantName}
        pairsCreated={3}
        formatNumber={formatNumber}
      />,
    );
    expect(screen.getByText('Calm question: 1 · experiments.tie: 1 · Direct hook: 1')).toBeInTheDocument();
  });
});
