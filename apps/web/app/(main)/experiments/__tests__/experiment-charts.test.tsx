import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import type { ReactNode } from 'react';

//---------------
// experiment-charts tests (issue #647). Recharts' ResponsiveContainer
// never gets a size in jsdom: stub it with a fixed-size clone (same as
// chart.test.tsx); the text totals, captions, empty states and the
// Show-table fallback are the real rendered output.
//---------------

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
    render(
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
  });

  it('shows the plural excluded-nulls caption when two values are missing', () => {
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
    expect(screen.getByText('experiments.excludedNullOther [2]')).toBeInTheDocument();
    expect(screen.getByText('Calm question: 100 · Direct hook: 50')).toBeInTheDocument();
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
});

describe('PerPairChart', () => {
  it('shows one row per pair with the A/B totals stated in the fallback table', () => {
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

  it('switches the metric and keeps the table behind Show table', () => {
    renderCard();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText('Calm question: 1.500 · Direct hook: 750')).toBeInTheDocument();
    // Radix Tabs activates on mouseDown + click in jsdom.
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'experiments.metricLikes' }));
    fireEvent.click(screen.getByRole('tab', { name: 'experiments.metricLikes' }));
    expect(screen.getByText('Calm question: 6 · Direct hook: 3')).toBeInTheDocument();
    fireEvent.click(screen.getByText('experiments.showTable'));
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getAllByText('500')).toHaveLength(3);
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
    renderCard();
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
