import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { ReactNode } from 'react';

vi.mock('recharts', async () => {
  const { Children, cloneElement, isValidElement } = await vi.importActual<typeof import('react')>('react');
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
    Bar: ({ chartData, onClick }: { chartData?: Array<Record<string, unknown>>; onClick?: (data: unknown, index: number) => void }) => (
      <DatumButtons data={chartData} onClick={onClick} />
    ),
    BarChart: ({ data, children }: { data?: Array<Record<string, unknown>>; children?: ReactNode }) => (
      <div data-testid="bar-chart">
        {Children.map(children, (child) => (isValidElement(child) ? cloneElement(child, { chartData: data } as Record<string, unknown>) : child))}
      </div>
    ),
    CartesianGrid: nullComponent,
    Cell: ({ fill }: { fill?: string }) => <span data-testid="chart-cell" data-fill={String(fill)} />,
    Pie: ({ data, children }: { data?: Array<Record<string, unknown>>; children?: ReactNode }) => (
      <div data-testid="pie"><DatumButtons data={data} />{children}</div>
    ),
    PieChart: ({ data, children }: { data?: Array<Record<string, unknown>>; children?: ReactNode }) => (
      <div data-testid="pie-chart"><DatumButtons data={data} />{children}</div>
    ),
    ResponsiveContainer: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    Tooltip: nullComponent,
    XAxis: ({ dataKey, tickFormatter }: { dataKey?: string; tickFormatter?: (value: never) => ReactNode }) => (
      <span data-testid="x-tick">{tickFormatter?.(dataKey === 'day' ? ('2026-10-21' as never) : (1500 as never))}</span>
    ),
    YAxis: ({ dataKey, tickFormatter }: { dataKey?: string; tickFormatter?: (value: never) => ReactNode }) => {
      if (tickFormatter === undefined) return null;
      if (dataKey === 'label') {
        return (
          <span data-testid="y-tick">
            {tickFormatter('a'.repeat(25) as never)}|{tickFormatter('a'.repeat(21) as never)}|{tickFormatter('a'.repeat(20) as never)}
          </span>
        );
      }
      return <span data-testid="y-tick">{tickFormatter(1500 as never)}</span>;
    },
  };
});

vi.mock('@/components/ui/chart', () => ({
  ChartContainer: ({ children }: { children?: ReactNode }) => <div data-testid="chart-container">{children}</div>,
  ChartTooltip: ({ content }: { content?: ReactNode }) => <>{content}</>,
  ChartTooltipContent: ({ formatter }: { formatter?: (value: unknown, name: unknown) => string }) => (
    <span data-testid="chart-tooltip">{formatter?.(1500, 'value')}</span>
  ),
}));

vi.mock('@/lib/i18n/provider', () => ({
  useI18n: vi.fn(() => ({
    t: (key: string, vars?: Record<string, unknown>) => (vars === undefined ? key : `${key} ${JSON.stringify(vars)}`),
    locale: 'en',
    setLocale: vi.fn(),
  })),
}));

vi.mock('@/lib/ui', () => ({
  AlertIcon: () => <span data-testid="icon-alert" />,
  ChartIcon: () => <span data-testid="icon-chart" />,
  SpinnerIcon: () => <span data-testid="icon-spinner" />,
}));

import { MetricsCharts, MetricsViewToggle, readMetricsView, rowElementId, withoutViewsKey, withoutPublishDateKey, withoutMetricKey, writeMetricsView } from '../metrics-charts';
import { useI18n } from '@/lib/i18n/provider';
import type { MetricsRowView } from '@/lib/metrics/metrics-query';

function setLocale(locale: 'en' | 'pt'): void {
  vi.mocked(useI18n).mockReturnValue({
    t: (key: string, vars?: Record<string, unknown>) => (vars === undefined ? key : `${key} ${JSON.stringify(vars)}`),
    locale,
    setLocale: vi.fn(),
  } as never);
}

beforeEach(() => {
  setLocale('en');
});

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

function activateTab(label: string): void {
  const trigger = screen.getByText(label);
  fireEvent.mouseDown(trigger);
  fireEvent.click(trigger);
}

describe('MetricsCharts', () => {
  it('shows the loading state in every card', () => {
    renderCharts([row()], { isLoading: true });
    expect(screen.getAllByText('metrics.chartsLoading')).toHaveLength(3);
    expect(screen.getAllByRole('status', { name: 'metrics.chartsLoading' })).toHaveLength(3);
    expect(screen.queryByTestId('area-chart')).not.toBeInTheDocument();
  });

  it('exposes each chart card by its accessible name', () => {
    renderCharts([row({ views: 100 })]);
    expect(screen.getByRole('region', { name: 'metrics.chartsOverTimeTitle' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'metrics.chartsBreakdownTitle' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'metrics.chartsTopTitle' })).toBeInTheDocument();
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
    expect(screen.getAllByTestId('bar-chart')).toHaveLength(2);
    expect(screen.getAllByText('1.5K')).toHaveLength(3);
    expect(screen.getAllByText('metrics.chartsMetricViews: 1,500')).toHaveLength(3);
  });

  it('groups by persona after the breakdown toggle', () => {
    renderCharts([
      row({ postId: 'a', personaId: 'p1', views: 10 }),
      row({ postId: 'b', personaId: null, views: 20 }),
    ]);
    activateTab('metrics.chartsByPersona');
    expect(screen.getByTestId('pie-chart')).toBeInTheDocument();
    expect(screen.getByText('Persona p1 · 10')).toBeInTheDocument();
  });

  it('returns to the provider breakdown after toggling to persona', () => {
    renderCharts([
      row({ postId: 'a', personaId: 'p1', provider: 'youtube', views: 10 }),
      row({ postId: 'b', personaId: null, provider: 'instagram', views: 20 }),
    ]);
    activateTab('metrics.chartsByPersona');
    expect(screen.getByText('Persona p1 · 10')).toBeInTheDocument();
    activateTab('metrics.chartsByNetwork');
    expect(screen.getByText('YouTube · 10')).toBeInTheDocument();
    expect(screen.queryByText(/Persona p1/)).toBeNull();
    expect(screen.getByText('metrics.chartsByNetwork')).toHaveAttribute('data-state', 'active');
  });

  it('re-plots views after toggling away to another metric', () => {
    renderCharts([row({ views: 100, likes: 10, comments: 3, saves: 1 })]);
    const area = () => within(screen.getByTestId('area-chart'));
    activateTab('metrics.chartsMetricEngagement');
    expect(area().getByRole('button', { name: /14/ })).toBeInTheDocument();
    activateTab('metrics.chartsMetricViews');
    expect(area().getByRole('button', { name: /100/ })).toBeInTheDocument();
  });

  it('reports the clicked top video to the page', () => {
    const onSelectRow = vi.fn<(item: MetricsRowView) => void>();
    renderCharts([
      row({ postId: 'a', scriptAngle: 'best', views: 500 }),
      row({ postId: 'b', scriptAngle: 'second', views: 9 }),
    ], { onSelectRow });
    fireEvent.click(screen.getByRole('button', { name: /best 500/ }));
    expect(onSelectRow).toHaveBeenCalledTimes(1);
    expect(onSelectRow.mock.calls[0][0].postId).toBe('a');
  });

  it('states the rows excluded from the sums and the truncation', () => {
    renderCharts([
      row({ postId: 'a', views: null }),
      row({ postId: 'b', publishedAt: '', views: 9 }),
      row({ postId: 'c', views: 4 }),
    ], { truncated: true });
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

  it('draws a donut with exactly five breakdown groups', () => {
    renderCharts([
      row({ postId: 'a', provider: 'youtube', views: 10 }),
      row({ postId: 'b', provider: 'instagram', views: 30 }),
      row({ postId: 'c', provider: 'linkedin', views: 20 }),
      row({ postId: 'd', provider: 'bluesky', views: 40 }),
      row({ postId: 'e', provider: 'threads', views: 50 }),
    ]);
    expect(screen.getByTestId('pie-chart')).toBeInTheDocument();
    expect(screen.getAllByTestId('bar-chart')).toHaveLength(1);
    expect(screen.getAllByTestId('chart-cell').map((cell) => cell.getAttribute('data-fill'))).toEqual([
      'var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)',
    ]);
  });

  it('labels the donut legend with provider names and grouped totals', () => {
    renderCharts([
      row({ postId: 'a', provider: 'youtube', views: 1500 }),
      row({ postId: 'b', provider: 'instagram', views: 250 }),
    ]);
    expect(screen.getByText('YouTube · 1,500')).toBeInTheDocument();
    expect(screen.getByText('Instagram · 250')).toBeInTheDocument();
  });

  it('labels the voiceover persona group with the no-persona copy in the persona view', () => {
    renderCharts([
      row({ postId: 'a', personaId: 'p1', views: 10 }),
      row({ postId: 'b', personaId: null, views: 20 }),
    ]);
    activateTab('metrics.chartsByPersona');
    expect(screen.getByText('Persona p1 · 10')).toBeInTheDocument();
    expect(screen.getByText('metrics.noPersona · 20')).toBeInTheDocument();
  });

  it('colors donut slices and legend swatches from the chart palette in order', () => {
    renderCharts([
      row({ postId: 'a', provider: 'youtube', views: 10 }),
      row({ postId: 'b', provider: 'instagram', views: 30 }),
    ]);
    const cells = screen.getAllByTestId('chart-cell');
    expect(cells).toHaveLength(2);
    expect(cells[0]).toHaveAttribute('data-fill', 'var(--chart-1)');
    expect(cells[1]).toHaveAttribute('data-fill', 'var(--chart-2)');
    const youtube = screen.getByText('YouTube · 10').closest('li');
    const instagram = screen.getByText('Instagram · 30').closest('li');
    expect(youtube?.querySelector('span')?.style.backgroundColor).toBe('var(--chart-2)');
    expect(instagram?.querySelector('span')?.style.backgroundColor).toBe('var(--chart-1)');
  });

  it('shows metric labels and grouped values in the chart tooltips', () => {
    renderCharts([row({ views: 100 })]);
    expect(screen.getAllByText('metrics.chartsMetricViews: 1,500')).toHaveLength(3);
  });

  it('relabels the over-time tooltip when the metric toggle changes', () => {
    renderCharts([row({ views: 100 })]);
    activateTab('metrics.chartsMetricEngagement');
    expect(screen.getAllByText('metrics.chartsMetricEngagement: 1,500')).toHaveLength(1);
    expect(screen.getAllByText('metrics.chartsMetricViews: 1,500')).toHaveLength(2);
  });

  it('plots the comments total after the comments toggle', () => {
    renderCharts([row({ views: 100, likes: 10, comments: 3, saves: 1 })]);
    activateTab('metrics.chartsMetricComments');
    const area = () => within(screen.getByTestId('area-chart'));
    expect(area().getByRole('button', { name: /3/ })).toBeInTheDocument();
    expect(screen.getAllByText('metrics.chartsMetricComments: 1,500')).toHaveLength(1);
  });

  it('reports the second top video when its bar is clicked', () => {
    const onSelectRow = vi.fn<(item: MetricsRowView) => void>();
    renderCharts([
      row({ postId: 'a', scriptAngle: 'best', views: 500 }),
      row({ postId: 'b', scriptAngle: 'second', views: 9 }),
    ], { onSelectRow });
    fireEvent.click(screen.getByRole('button', { name: /second 9/ }));
    expect(onSelectRow).toHaveBeenCalledTimes(1);
    expect(onSelectRow.mock.calls[0][0].postId).toBe('b');
  });

  it('truncates long top-video labels on the axis and leaves short ones untouched', () => {
    renderCharts([row({ views: 100 })]);
    const ticks = screen.getAllByTestId('y-tick').map((el) => el.textContent ?? '');
    expect(ticks).toContain(`${'a'.repeat(19)}…|${'a'.repeat(19)}…|${'a'.repeat(20)}`);
  });

  it('formats the over-time day axis and compact value axis', () => {
    renderCharts([row({ views: 100 })]);
    const overTime = within(screen.getByLabelText('metrics.chartsOverTimeTitle'));
    expect(overTime.getByTestId('x-tick')).toHaveTextContent('Oct 21, 2026');
    expect(overTime.getByTestId('y-tick')).toHaveTextContent('1.5K');
  });

  it('states the excluded-metric caption with the lowercase metric name per metric', () => {
    renderCharts([
      row({ postId: 'a', views: null, likes: null, comments: null, saves: null }),
      row({ postId: 'b', views: 10, likes: null, comments: 5, saves: 2 }),
    ]);
    expect(screen.getByText('metrics.chartsWithoutMetricOne {"count":1,"metric":"metrics.chartsmetricviews"}')).toBeInTheDocument();
    activateTab('metrics.chartsMetricLikes');
    expect(screen.getByText('metrics.chartsWithoutMetric {"count":2,"metric":"metrics.chartsmetriclikes"}')).toBeInTheDocument();
    activateTab('metrics.chartsMetricComments');
    expect(screen.getByText('metrics.chartsWithoutMetricOne {"count":1,"metric":"metrics.chartsmetriccomments"}')).toBeInTheDocument();
  });

  it('states no excluded-row captions or footnote paragraphs when nothing was excluded', () => {
    renderCharts([row({ views: 100 })]);
    expect(screen.queryByText(/metrics\.chartsWithout/)).toBeNull();
    for (const title of ['metrics.chartsOverTimeTitle', 'metrics.chartsBreakdownTitle', 'metrics.chartsTopTitle']) {
      expect(screen.getByLabelText(title).querySelectorAll('p')).toHaveLength(0);
    }
  });

  it('states no truncation caption when the rows were not truncated', () => {
    renderCharts([row({ views: 100 })]);
    expect(screen.queryByText(/metrics\.chartsTruncated/)).toBeNull();
  });

  it('formats legend totals, ticks and tooltips with the pt-BR locale', () => {
    setLocale('pt');
    renderCharts([
      row({ postId: 'a', provider: 'youtube', views: 1500 }),
      row({ postId: 'b', provider: 'instagram', views: 250 }),
    ]);
    expect(screen.getByText('YouTube · 1.500')).toBeInTheDocument();
    expect(screen.getAllByText('metrics.chartsMetricViews: 1.500')).toHaveLength(3);
    const overTime = within(screen.getByLabelText('metrics.chartsOverTimeTitle'));
    expect(overTime.getByTestId('x-tick')).toHaveTextContent('21 de out. de 2026');
    expect(overTime.getByTestId('y-tick')).toHaveTextContent('1,5 mil');
  });
});

describe('readMetricsView', () => {
  it('defaults to the chart view when nothing is stored', () => {
    window.localStorage.clear();
    expect(readMetricsView()).toBe('chart');
  });

  it('returns the stored list only when the viewer saved it', () => {
    window.localStorage.setItem('metrics-view-mode', 'list');
    expect(readMetricsView()).toBe('list');
  });

  it('returns the chart when the viewer stored the chart', () => {
    window.localStorage.setItem('metrics-view-mode', 'chart');
    expect(readMetricsView()).toBe('chart');
  });

  it('falls back to the chart when localStorage throws', () => {
    const getItem = vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    try {
      expect(readMetricsView()).toBe('chart');
    } finally {
      getItem.mockRestore();
    }
  });

  it('returns the chart for an unrecognized stored view', () => {
    window.localStorage.setItem('metrics-view-mode', 'garbage');
    expect(readMetricsView()).toBe('chart');
  });
});

describe('writeMetricsView', () => {
  it('persists the chosen view under the storage key', () => {
    window.localStorage.clear();
    writeMetricsView('list');
    expect(window.localStorage.getItem('metrics-view-mode')).toBe('list');
    writeMetricsView('chart');
    expect(window.localStorage.getItem('metrics-view-mode')).toBe('chart');
  });

  it('does not throw when the storage write fails', () => {
    const setItem = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    try {
      expect(() => writeMetricsView('list')).not.toThrow();
    } finally {
      setItem.mockRestore();
    }
  });
});

describe('rowElementId', () => {
  it('builds the anchor id from post, provider and external id', () => {
    expect(rowElementId(row({ postId: 'p', provider: 'instagram', externalId: 'e' })))
      .toBe('metric-row-p-instagram-e');
  });
});

describe('MetricsViewToggle', () => {
  it('reports the chosen view', () => {
    const onChange = vi.fn();
    render(<MetricsViewToggle value="list" onChange={onChange} />);
    activateTab('metrics.viewChart');
    expect(onChange).toHaveBeenCalledWith('chart');
  });

  it('marks the current view trigger as active and the other as inactive', () => {
    render(<MetricsViewToggle value="list" onChange={() => {}} />);
    expect(screen.getByText('metrics.viewList')).toHaveAttribute('data-state', 'active');
    expect(screen.getByText('metrics.viewChart')).toHaveAttribute('data-state', 'inactive');
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
