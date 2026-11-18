import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { ReactNode } from 'react';

//---------------
// Tests for the /metrics chart cards: each card renders its loading,
// error and empty state, the donut appears only with five or fewer
// groups, the top-videos bars report clicks, and captions state the
// rows excluded from the sums. Recharts is replaced with data-driven
// stand-ins (jsdom has no layout, so the real charts render nothing) that
// still exercise the metric/grouping toggles and the click wiring.
//---------------

vi.mock('recharts', () => {
  function DatumButtons({ data, onClick }: { data?: Array<Record<string, unknown>>; onClick?: (data: unknown, index: number) => void }): ReactNode {
    return (
      <div>
        {(data ?? []).map((datum, index) => (
          <button
            key={index}
            type="button"
            onClick={() => onClick?.(datum, index)}
          >
            {String(datum.label ?? datum.day ?? index)} {String(datum.value)}
          </button>
        ))}
      </div>
    );
  }
  const nullComponent = (): null => null;
  return {
    Area: nullComponent,
    AreaChart: ({ data, children }: { data?: Array<Record<string, unknown>>; children?: ReactNode }) => (
      <div data-testid="area-chart"><DatumButtons data={data} />{children}</div>
    ),
    Bar: nullComponent,
    BarChart: ({
      data, children, onClick,
    }: {
      data?: Array<Record<string, unknown>>;
      children?: ReactNode;
      onClick?: (data: unknown, index: number) => void;
    }) => (
      <div data-testid="bar-chart"><DatumButtons data={data} onClick={onClick} />{children}</div>
    ),
    CartesianGrid: nullComponent,
    Cell: nullComponent,
    Pie: nullComponent,
    PieChart: ({ data, children }: { data?: Array<Record<string, unknown>>; children?: ReactNode }) => (
      <div data-testid="pie-chart"><DatumButtons data={data} />{children}</div>
    ),
    ResponsiveContainer: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    Tooltip: nullComponent,
    XAxis: nullComponent,
    YAxis: nullComponent,
  };
});

vi.mock('@/components/ui/chart', () => ({
  ChartContainer: ({ children }: { children?: ReactNode }) => <div data-testid="chart-container">{children}</div>,
  ChartTooltip: () => null,
  ChartTooltipContent: () => null,
}));

vi.mock('@/lib/i18n/provider', () => ({
  useI18n: () => ({
    t: (key: string, vars?: Record<string, unknown>) => (vars === undefined ? key : `${key} ${JSON.stringify(vars)}`),
    locale: 'en',
    setLocale: vi.fn(),
  }),
}));

vi.mock('@/lib/ui', () => ({
  AlertIcon: () => <span data-testid="icon-alert" />,
  ChartIcon: () => <span data-testid="icon-chart" />,
  SpinnerIcon: () => <span data-testid="icon-spinner" />,
}));

import { MetricsCharts, MetricsViewToggle, withoutViewsKey, withoutPublishDateKey, withoutMetricKey } from '../metrics-charts';
import type { MetricsRowView } from '@/lib/metrics/metrics-query';

const DAY = new Date(Date.now() - 86400000).toISOString();

function row(overrides: Partial<MetricsRowView> = {}): MetricsRowView {
  return {
    postId: 'post-1', personaId: null, provider: 'youtube', accountId: 'UC1', externalId: 'v1',
    scriptAngle: 'myth', publishedAt: DAY, views: 100, likes: 10, comments: 3, saves: 1, collectedAt: '2026-10-21T12:00:00Z',
    analyticsViews: null, engagedViews: null, stayedToWatchPct: null, averageViewDurationSeconds: null,
    averageViewPercentage: null, contentType: null, analyticsStatus: null, provisional: false,
    ...overrides,
  };
}

const BASE_PROPS = {
  isLoading: false,
  isError: false,
  truncated: false,
  personaLabel: (id: string | null): string => (id === null ? 'metrics.noPersona' : `Persona ${id}`),
  rowTitle: (item: MetricsRowView): string => item.scriptAngle ?? `${item.provider} video`,
  onSelectRow: vi.fn(),
};

function renderCharts(rows: MetricsRowView[], props: Partial<typeof BASE_PROPS> = {}): void {
  render(<MetricsCharts rows={rows} {...BASE_PROPS} {...props} />);
}

// Radix Tabs activates on mousedown, not on click alone in jsdom.
function activateTab(label: string): void {
  const trigger = screen.getByText(label);
  fireEvent.mouseDown(trigger);
  fireEvent.click(trigger);
}

describe('MetricsCharts', () => {
  it('shows the loading state in every card', () => {
    renderCharts([row()], { isLoading: true });
    expect(screen.getAllByText('metrics.chartsLoading')).toHaveLength(3);
    expect(screen.queryByTestId('area-chart')).not.toBeInTheDocument();
  });

  it('shows the error state in every card', () => {
    renderCharts([row()], { isError: true });
    expect(screen.getAllByText('metrics.loadError')).toHaveLength(3);
  });

  it('shows the empty state when nothing is plottable', () => {
    renderCharts([row({ views: null, likes: null, comments: null, saves: null })]);
    expect(screen.getAllByText('metrics.chartsEmpty')).toHaveLength(3);
  });

  it('plots the over-time totals and re-plots on metric toggle', () => {
    renderCharts([row({ views: 100, likes: 10, comments: 3, saves: 1 })]);
    // Views: 100; engagement: 10 + 3 + 1 = 14.
    const area = () => within(screen.getByTestId('area-chart'));
    expect(screen.getByTestId('area-chart')).toBeInTheDocument();
    expect(area().getByRole('button', { name: /100/ })).toBeInTheDocument();
    activateTab('metrics.chartsMetricEngagement');
    expect(area().getByRole('button', { name: /14/ })).toBeInTheDocument();
    activateTab('metrics.chartsMetricLikes');
    expect(area().getByRole('button', { name: /10/ })).toBeInTheDocument();
  });

  it('draws a donut for five or fewer breakdown groups', () => {
    renderCharts([
      row({ postId: 'a', provider: 'youtube', views: 10 }),
      row({ postId: 'b', provider: 'instagram', views: 30 }),
    ]);
    expect(screen.getByTestId('pie-chart')).toBeInTheDocument();
    // Only the top-videos chart is a bar chart in this case.
    expect(screen.getAllByTestId('bar-chart')).toHaveLength(1);
  });

  it('draws bars past five breakdown groups', () => {
    renderCharts([
      row({ postId: 'a', provider: 'youtube', views: 10 }),
      row({ postId: 'b', provider: 'instagram', views: 30 }),
      row({ postId: 'c', provider: 'linkedin', views: 20 }),
      row({ postId: 'd', provider: 'bluesky', views: 40 }),
      row({ postId: 'e', provider: 'threads', views: 50 }),
      row({ postId: 'f', provider: 'facebook', views: 60 }),
    ]);
    expect(screen.queryByTestId('pie-chart')).not.toBeInTheDocument();
    // The breakdown bars plus the top-videos chart.
    expect(screen.getAllByTestId('bar-chart')).toHaveLength(2);
  });

  it('groups by persona after the breakdown toggle', () => {
    renderCharts([
      row({ postId: 'a', personaId: 'p1', views: 10 }),
      row({ postId: 'b', personaId: null, views: 20 }),
    ]);
    activateTab('metrics.chartsByPersona');
    expect(screen.getByTestId('pie-chart')).toBeInTheDocument();
    expect(screen.getByText(/Persona p1/)).toBeInTheDocument();
  });

  it('reports the clicked top video to the page', () => {
    const onSelectRow = vi.fn();
    renderCharts([
      row({ postId: 'a', scriptAngle: 'best', views: 500 }),
      row({ postId: 'b', scriptAngle: 'second', views: 9 }),
    ], { onSelectRow });
    fireEvent.click(screen.getByRole('button', { name: /best 500/ }));
    expect(onSelectRow).toHaveBeenCalledTimes(1);
    expect((onSelectRow.mock.calls[0][0] as MetricsRowView).postId).toBe('a');
  });

  it('states the rows excluded from the sums and the truncation', () => {
    renderCharts([
      row({ postId: 'a', views: null }),
      row({ postId: 'b', publishedAt: '', views: 9 }),
      row({ postId: 'c', views: 4 }),
    ], { truncated: true });
    // Stated on both charts that sum views — singular copy for count 1.
    expect(screen.getAllByText('metrics.chartsWithoutView {"count":1}')).toHaveLength(2);
    expect(screen.getByText('metrics.chartsWithoutPublishDateOne {"count":1}')).toBeInTheDocument();
    expect(screen.getAllByText('metrics.chartsTruncated {"limit":500}')).toHaveLength(3);
  });

  it('uses plural copy for counts above one', () => {
    renderCharts([
      row({ postId: 'a', views: null }),
      row({ postId: 'b', views: null }),
      row({ postId: 'c', views: 4 }),
    ]);
    expect(screen.getAllByText('metrics.chartsWithoutViews {"count":2}')).toHaveLength(2);
  });
});

describe('MetricsViewToggle', () => {
  it('reports the chosen view', () => {
    const onChange = vi.fn();
    render(<MetricsViewToggle value="list" onChange={onChange} />);
    activateTab('metrics.viewChart');
    expect(onChange).toHaveBeenCalledWith('chart');
  });
});

describe('without*Key pluralization', () => {
  it('picks singular copy at count 1 and plural above 1', () => {
    expect(withoutViewsKey(1)).toBe('metrics.chartsWithoutView');
    expect(withoutViewsKey(0)).toBe('metrics.chartsWithoutViews');
    expect(withoutViewsKey(2)).toBe('metrics.chartsWithoutViews');
    expect(withoutPublishDateKey(1)).toBe('metrics.chartsWithoutPublishDateOne');
    expect(withoutPublishDateKey(3)).toBe('metrics.chartsWithoutPublishDate');
    expect(withoutMetricKey(1)).toBe('metrics.chartsWithoutMetricOne');
    expect(withoutMetricKey(5)).toBe('metrics.chartsWithoutMetric');
  });
});
