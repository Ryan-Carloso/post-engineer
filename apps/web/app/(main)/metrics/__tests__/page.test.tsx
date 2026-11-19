import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('@/lib/api', () => ({
  usePersonasQuery: vi.fn(),
  useSocialAccountsQuery: vi.fn(),
}));

vi.mock('@/lib/i18n/provider', () => {
  function I18nProvider({ children }: { children: ReactNode }) {
    return <>{children}</>;
  }
  I18nProvider.displayName = 'I18nProvider';
  const useI18n = vi.fn(() => ({
    t: (key: string, vars?: Record<string, unknown>) => (vars === undefined ? key : `${key} ${JSON.stringify(vars)}`),
    locale: 'en',
    setLocale: vi.fn(),
  }));
  return { useI18n, I18nProvider };
});

vi.mock('@/lib/ui', () => ({
  AlertIcon: () => <span data-testid="icon-alert" />,
  ChartIcon: () => <span data-testid="icon-chart" />,
  SpinnerIcon: () => <span data-testid="icon-spinner" />,
}));

vi.mock('@/components/ui/retention-curve-chart', () => ({
  RetentionCurveChart: ({ points }: { points: unknown[] }) => <div data-testid="retention-curve">{points.length} points</div>,
}));

vi.mock('@/components/provider-icon', () => ({
  ProviderIcon: ({ provider }: { provider: string }) => <span data-testid={`provider-${provider}`} />,
}));

// Recharts needs a layout jsdom has no size for, so the real charts
// render nothing there. Data-driven stand-ins keep the chart titles
// and the top-videos bar clicks drivable (same pattern as
// metrics-charts.test.tsx).
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
    // Mirrors Recharts: the series (<Bar>) gets (datum, index, event) on
    // click; the chart-level BarChart onClick gets (chartState, event) and
    // is never a per-bar handler, so the stand-in ignores it. BarChart
    // hands its data to the series the way the real chart does.
    Bar: ({ chartData, onClick }: { chartData?: Array<Record<string, unknown>>; onClick?: (data: unknown, index: number) => void }) => (
      <DatumButtons data={chartData} onClick={onClick} />
    ),
    BarChart: ({ data, children }: { data?: Array<Record<string, unknown>>; children?: ReactNode }) => (
      <div data-testid="bar-chart">
        {Children.map(children, (child) => (isValidElement(child) ? cloneElement(child, { chartData: data } as Record<string, unknown>) : child))}
      </div>
    ),
    CartesianGrid: nullComponent,
    Cell: nullComponent,
    Pie: nullComponent,
    PieChart: ({ data, children }: { data?: Array<Record<string, unknown>>; children?: ReactNode }) => (
      <div data-testid="pie-chart"><DatumButtons data={data} />{children}</div>
    ),
    ResponsiveContainer: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    Legend: nullComponent,
    Tooltip: nullComponent,
    XAxis: nullComponent,
    YAxis: nullComponent,
  };
});

import MetricsPage from '../page';
import { usePersonasQuery, useSocialAccountsQuery } from '@/lib/api';
import { useI18n } from '@/lib/i18n/provider';
import type { CoverageItem, MetricsRowView } from '@/lib/metrics/metrics-query';

function setLocale(locale: 'en' | 'pt'): void {
  vi.mocked(useI18n).mockReturnValue({
    t: (key: string, vars?: Record<string, unknown>) => (vars === undefined ? key : `${key} ${JSON.stringify(vars)}`),
    locale,
    setLocale: vi.fn(),
  } as never);
}

window.HTMLElement.prototype.scrollIntoView = vi.fn();
window.HTMLElement.prototype.hasPointerCapture = () => false;
window.HTMLElement.prototype.setPointerCapture = () => {};
window.HTMLElement.prototype.releasePointerCapture = () => {};

const PERSONA_A = '11111111-2222-4333-8444-555555555555';
const PERSONA_B = '22222222-3333-4444-8555-666666666666';

const PUBLISHED_AT = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

function row(overrides: Partial<MetricsRowView> = {}): MetricsRowView {
  return {
    postId: 'post-1', personaId: PERSONA_A, provider: 'youtube', accountId: 'UC1', externalId: 'v1',
    scriptAngle: 'myth', publishedAt: PUBLISHED_AT, views: 100, likes: 10, comments: 3, saves: 1, collectedAt: '2026-10-21T12:00:00Z',
    analyticsViews: null, engagedViews: null, stayedToWatchPct: null, averageViewDurationSeconds: null,
    averageViewPercentage: null, contentType: null, analyticsStatus: null, provisional: false,
    ...overrides,
  };
}

function coverageItem(overrides: Partial<CoverageItem> = {}): CoverageItem {
  return {
    postId: 'post-9', personaId: PERSONA_A, provider: 'youtube', accountId: 'UC1', externalId: 'v9',
    scriptAngle: 'myth', reason: 'retrying',
    publishedAt: '2026-10-21T12:00:00.000Z',
    windowOpensAt: '2026-10-22T12:00:00.000Z', windowClosesAt: '2026-10-23T12:00:00.000Z',
    ...overrides,
  };
}

function renderPage(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MetricsPage />
    </QueryClientProvider>,
  );
}

function stubMetricsFetch(body: unknown, status = 200): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function lastFetchUrl(fetchMock: ReturnType<typeof vi.fn>): string {
  const calls = fetchMock.mock.calls as unknown as Array<[string]>;
  return calls[calls.length - 1][0];
}

function activateTab(label: string): void {
  const trigger = screen.getByText(label);
  fireEvent.mouseDown(trigger);
  fireEvent.click(trigger);
}

async function openFiltersSheet(): Promise<void> {
  fireEvent.click(screen.getByText('metrics.filtersButton'));
  await waitFor(() => expect(screen.getByText('metrics.filtersTitle')).toBeInTheDocument());
}

async function applyPersonaFilter(label: string): Promise<void> {
  await openFiltersSheet();
  fireEvent.click(screen.getByRole('combobox', { name: 'metrics.filterPersona' }));
  const options = await screen.findAllByRole('option');
  const option = options.find((el) => el.textContent === label);
  expect(option).toBeDefined();
  fireEvent.click(option as HTMLElement);
  fireEvent.click(screen.getByText('metrics.filtersApply'));
}

async function applyProviderFilter(label: string): Promise<void> {
  await openFiltersSheet();
  const user = userEvent.setup();
  await user.click(screen.getByLabelText('metrics.filterProvider'));
  const options = await screen.findAllByRole('option');
  const option = options.find((el) => el.textContent === label);
  expect(option).toBeDefined();
  await user.click(option as HTMLElement);
  fireEvent.click(screen.getByText('metrics.filtersApply'));
}

beforeEach(() => {
  // The saved preference defaults the suite to the list view the
  // row-focused tests below assert against; the view tests that
  // cover the default and the stored choice set their own value.
  window.localStorage.clear();
  window.localStorage.setItem('metrics-view-mode', 'list');
  setLocale('en');
  vi.mocked(usePersonasQuery).mockReturnValue({
    data: [
      { id: PERSONA_A, name: 'Alpha' },
      { id: PERSONA_B, name: 'Beta' },
    ],
  } as never);
  vi.mocked(useSocialAccountsQuery).mockReturnValue({
    data: {
      accounts: [
        { provider: 'youtube', recordId: 'r1', channelId: 'UC1', channelName: 'Chan One' },
        { provider: 'instagram', recordId: 'r2', igUserId: 'ig1', username: 'me' },
      ],
    },
  } as never);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MetricsPage', () => {
  it('shows a spinner while the first load is pending', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    renderPage();
    expect(screen.getByTestId('icon-spinner')).toBeInTheDocument();
    expect(screen.getByText('metrics.title')).toBeInTheDocument();
  });

  it('links the experiments entry card to /experiments', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    renderPage();
    const link = screen.getByText('experiments.entryTitle').closest('a');
    expect(link).toHaveAttribute('href', '/experiments');
    expect(link?.className).toContain('justify-between');
    expect(screen.getByText('experiments.entryBody')).toBeInTheDocument();
    expect(screen.getByText('experiments.entryAction')).toBeInTheDocument();
  });

  it('renders total tiles and the per-video rows sorted by views, highest first', async () => {
    const rows = [
      row(),
      row({
        postId: 'post-2', personaId: null, provider: 'instagram', accountId: 'ig1', externalId: 'v2',
        scriptAngle: null, views: 300, likes: null, comments: null, saves: null,
      }),
      row({
        postId: 'post-3', personaId: PERSONA_B, provider: 'bluesky', accountId: 'did:plc:x', externalId: 'v3',
        scriptAngle: 'tutorial', views: null, likes: 5, comments: 0, saves: 0,
      }),
    ];
    stubMetricsFetch({ success: true, rows, truncated: false });
    renderPage();

    await waitFor(() => expect(screen.getByText('metrics.statMeasurements')).toBeInTheDocument());
    expect(screen.getByText('metrics.statMeasurements')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('400')).toBeInTheDocument();
    expect(screen.getByText('19')).toBeInTheDocument();
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('300');
    expect(items[1]).toHaveTextContent('100');
    expect(items[2]).toHaveTextContent('metrics.notReported');
    expect(screen.getByText('Instagram · Oct 21, 2026')).toBeInTheDocument();
    expect(screen.queryByText('metrics.noAngle')).toBeNull();
    expect(screen.getAllByText('myth').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Alpha/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/metrics.noPersona/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Chan One/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/did:plc:x/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/metrics\.likesValue/).length).toBe(2);
  });

  it('shows 248 total views for the screenshot fixture', async () => {
    const rows = [3, 0, 134, 1, 0, 0, 110, 0].map((views, i) =>
      row({ postId: `post-${i}`, views, likes: 0, comments: 0, saves: 0 }),
    );
    stubMetricsFetch({ success: true, rows, truncated: false });
    renderPage();

    await waitFor(() => expect(screen.getByText('248')).toBeInTheDocument());
    expect(screen.getByText('8')).toBeInTheDocument();
  });

  it('formats big totals with the en-US grouping', async () => {
    stubMetricsFetch({
      success: true,
      rows: [row({ views: 1200 }), row({ postId: 'post-2', views: 300 })],
      truncated: false,
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('1,500')).toBeInTheDocument());
  });

  it('formats big totals with the pt-BR grouping', async () => {
    setLocale('pt');
    stubMetricsFetch({
      success: true,
      rows: [row({ views: 1200 }), row({ postId: 'post-2', views: 300 })],
      truncated: false,
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('1.500')).toBeInTheDocument());
  });

  it('only offers the Persona and Network filters', async () => {
    stubMetricsFetch({ success: true, rows: [row()], truncated: false });
    renderPage();
    await waitFor(() => expect(screen.getByText('metrics.tableTitle')).toBeInTheDocument());
    expect(screen.queryByText('metrics.filterPersona')).toBeNull();
    await openFiltersSheet();
    expect(screen.getByText('metrics.filterPersona')).toBeInTheDocument();
    expect(screen.getByText('metrics.filterProvider')).toBeInTheDocument();
    expect(screen.queryByText('metrics.filterAccount')).toBeNull();
    expect(screen.queryByText('metrics.filterAngle')).toBeNull();
  });

  it('switches between the list and the chart view, remembering the choice', async () => {
    window.localStorage.clear();
    stubMetricsFetch({
      success: true,
      rows: [row({ views: 1200 }), row({ postId: 'post-2', views: 300 })],
      truncated: false,
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('metrics.chartsOverTimeTitle')).toBeInTheDocument());
    // Default view (nothing stored) is the chart.
    expect(screen.queryByText('metrics.tableTitle')).toBeNull();
    expect(screen.getByText('metrics.chartsBreakdownTitle')).toBeInTheDocument();
    expect(screen.getByText('metrics.chartsTopTitle')).toBeInTheDocument();
    activateTab('metrics.viewList');
    expect(screen.getByText('metrics.tableTitle')).toBeInTheDocument();
    expect(screen.queryByText('metrics.chartsOverTimeTitle')).toBeNull();
    expect(window.localStorage.getItem('metrics-view-mode')).toBe('list');
    activateTab('metrics.viewChart');
    expect(screen.getByText('metrics.chartsOverTimeTitle')).toBeInTheDocument();
    expect(window.localStorage.getItem('metrics-view-mode')).toBe('chart');
  });

  it('opens in the chart view when it is the stored choice', async () => {
    window.localStorage.setItem('metrics-view-mode', 'chart');
    stubMetricsFetch({
      success: true,
      rows: [row({ views: 1200 }), row({ postId: 'post-2', views: 300 })],
      truncated: false,
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('metrics.chartsOverTimeTitle')).toBeInTheDocument());
  });

  it('opens in the list view when list is the stored choice', async () => {
    window.localStorage.setItem('metrics-view-mode', 'list');
    stubMetricsFetch({
      success: true,
      rows: [row({ views: 1200 })],
      truncated: false,
    });
    renderPage();
    // The stored list is applied after mount (never during the first
    // render), so the list shows once effects run.
    await waitFor(() => expect(screen.getByText('metrics.tableTitle')).toBeInTheDocument());
    expect(screen.queryByText('metrics.chartsOverTimeTitle')).toBeNull();
  });

  it('shows the truncation caption in the chart view when the payload was truncated', async () => {
    window.localStorage.clear();
    stubMetricsFetch({
      success: true,
      rows: [row({ views: 1200 }), row({ postId: 'post-2', views: 300 })],
      truncated: true,
    });
    renderPage();
    // Wait for the rows to load: only then do the chart bodies (and
    // their footnotes) render — the titles render while loading too.
    await waitFor(() => expect(screen.getByRole('button', { name: /myth 1200/ })).toBeInTheDocument());
    expect(screen.getAllByText(/metrics\.chartsTruncated/)).toHaveLength(3);
  });

  it('shows the error state in the chart view when the metrics load fails', async () => {
    window.localStorage.clear();
    stubMetricsFetch({ success: false, error: 'nope' }, 500);
    renderPage();
    await waitFor(() => expect(screen.getAllByText('metrics.loadError')).toHaveLength(3));
  });

  it('shows no truncation caption while the chart data is still loading', async () => {
    window.localStorage.clear();
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    renderPage();
    await waitFor(() => expect(screen.getAllByText('metrics.chartsLoading')).toHaveLength(3));
    expect(screen.queryByText(/metrics\.chartsTruncated/)).toBeNull();
  });

  it('renders each list row with the scroll anchor id the charts use', async () => {
    stubMetricsFetch({
      success: true,
      rows: [row({ postId: 'post-1' }), row({ postId: 'post-2', provider: 'instagram', accountId: 'ig1', externalId: 'v2' })],
      truncated: false,
    });
    renderPage();
    // Wait for the rows themselves (the list heading renders while loading).
    await waitFor(() => expect(document.getElementById('metric-row-post-1-youtube-v1')).toBeInTheDocument());
    expect(document.getElementById('metric-row-post-2-instagram-v2')).toBeInTheDocument();
  });

  it('shows no truncation caption in the list view when the payload was not truncated', async () => {
    stubMetricsFetch({ success: true, rows: [row()], truncated: false });
    renderPage();
    await waitFor(() => expect(screen.getByText('metrics.tableTitle')).toBeInTheDocument());
    expect(screen.queryByText(/metrics\.truncated/)).toBeNull();
  });

  it('shows the chart view when localStorage throws', async () => {
    const getItem = vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    try {
      window.localStorage.clear();
      stubMetricsFetch({
        success: true,
        rows: [row({ views: 1200 })],
        truncated: false,
      });
      renderPage();
      await waitFor(() => expect(screen.getByText('metrics.chartsOverTimeTitle')).toBeInTheDocument());
    } finally {
      getItem.mockRestore();
    }
  });

  it('clicking a top-videos bar shows the list without overwriting the saved preference', async () => {
    window.localStorage.clear();
    // Capture the scrolled-to element: the bar click must center the
    // clicked row in the list view.
    const scrolled: HTMLElement[] = [];
    const scrollIntoView = vi.fn(function scrollCapture(this: HTMLElement) {
      scrolled.push(this);
    });
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView as never;
    stubMetricsFetch({
      success: true,
      rows: [row({ views: 1200 }), row({ postId: 'post-2', views: 300 })],
      truncated: false,
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('metrics.chartsOverTimeTitle')).toBeInTheDocument());
    // Wait for the rows to load: only then do the top bars render (the
    // chart titles render while loading too).
    await waitFor(() => expect(screen.getByRole('button', { name: /myth 1200/ })).toBeInTheDocument());
    // The top bar for the 1200-view row (its label is the script angle).
    fireEvent.click(screen.getByRole('button', { name: /myth 1200/ }));
    expect(screen.getByText('metrics.tableTitle')).toBeInTheDocument();
    expect(screen.queryByText('metrics.chartsOverTimeTitle')).toBeNull();
    // The peek at the list must not persist: nothing was ever saved,
    // so the stored preference stays absent rather than becoming 'list'.
    expect(window.localStorage.getItem('metrics-view-mode')).toBeNull();
    // The list tab is the active one now.
    expect(screen.getByText('metrics.viewList')).toHaveAttribute('data-state', 'active');
    // The clicked row is centered in the viewport.
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' }));
    expect(scrolled).toHaveLength(1);
    expect(scrolled[0]?.id).toBe('metric-row-post-1-youtube-v1');
  });

  it('shows the coverage card below the list, with attention and waiting groups, and the as-of line', async () => {
    stubMetricsFetch({
      success: true, rows: [row()], truncated: false,
      coverage: [
        coverageItem({ reason: 'retrying' }),
        coverageItem({
          postId: 'post-10', provider: 'instagram', accountId: 'ig1', externalId: null,
          reason: 'publish-failed', scriptAngle: null,
        }),
        coverageItem({ postId: 'post-11', accountId: 'unknown-acct', reason: 'pending' }),
      ],
      coverageTruncated: true, asOf: '2026-10-21T12:00:00Z',
    });
    renderPage();

    await waitFor(() => expect(screen.getByText('metrics.coverageTitle')).toBeInTheDocument());
    expect(screen.getByText('metrics.coverageSummary {"count":3,"window":"24h"}')).toBeInTheDocument();
    expect(screen.getByText('metrics.coverageAttentionTitle')).toBeInTheDocument();
    expect(screen.getByText('metrics.coverageWaitingTitle')).toBeInTheDocument();
    expect(screen.getByText('metrics.coverageReasonRetrying')).toBeInTheDocument();
    expect(screen.getByText('metrics.coverageReasonPublishFailed')).toBeInTheDocument();
    expect(screen.getByText('metrics.coverageReasonPending')).toBeInTheDocument();
    expect(screen.getByText(/unknown-acct/)).toBeInTheDocument();
    expect(screen.getByText(/metrics\.truncated/)).toBeInTheDocument();
    expect(screen.getByText('metrics.coverageYoutubeHint')).toBeInTheDocument();
    expect(screen.getByText('metrics.coveragePublishFailedHint')).toBeInTheDocument();
    expect(screen.getByText(/metrics\.asOf/)).toBeInTheDocument();
    expect(screen.getAllByText(/metrics\.tableCollected/).length).toBeGreaterThan(0);
    const table = screen.getByText('metrics.tableTitle');
    const coverage = screen.getByText('metrics.coverageTitle');
    expect(table.compareDocumentPosition(coverage) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('formats dates in pt-BR when the locale is pt', async () => {
    setLocale('pt');
    stubMetricsFetch({
      success: true, rows: [row()], truncated: false,
      coverage: [coverageItem({ reason: 'retrying' })],
      coverageTruncated: false, asOf: '2026-10-21T12:00:00Z',
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('metrics.coverageTitle')).toBeInTheDocument());
    expect(screen.getAllByText(/21 de out\. de 2026/).length).toBe(2);
  });

  it('hides the coverage card when nothing is missing, but still dates the data', async () => {
    stubMetricsFetch({ success: true, rows: [row()], truncated: false, coverage: [], coverageTruncated: false, asOf: '2026-10-21T12:00:00Z' });
    renderPage();
    await waitFor(() => expect(screen.getByText(/metrics\.asOf/)).toBeInTheDocument());
    expect(screen.queryByText('metrics.coverageTitle')).toBeNull();
  });

  it('notes when the row cap truncated the result', async () => {
    stubMetricsFetch({ success: true, rows: [row()], truncated: true });
    renderPage();
    await waitFor(() => expect(screen.getByText('metrics.truncated {"limit":500}')).toBeInTheDocument());
  });

  it('labels the three total tiles and dates the data only when an as-of time exists', async () => {
    stubMetricsFetch({ success: true, rows: [row()], truncated: false });
    renderPage();
    await waitFor(() => expect(screen.getByText('metrics.statMeasurements')).toBeInTheDocument());
    expect(screen.getByText('metrics.statTotalViews')).toBeInTheDocument();
    expect(screen.getByText('metrics.statEngagement')).toBeInTheDocument();
    expect(screen.getByText('metrics.statMeasurementsHint')).toBeInTheDocument();
    expect(screen.getByText('metrics.statEngagementHint')).toBeInTheDocument();
    expect(screen.getByText('metrics.windowCaption')).toBeInTheDocument();
    expect(screen.queryByText(/metrics\.asOf/)).toBeNull();
  });

  it('hides the total tiles when no videos were measured', async () => {
    stubMetricsFetch({ success: true, rows: [], truncated: false });
    renderPage();
    await waitFor(() => expect(screen.getByText('metrics.empty')).toBeInTheDocument());
    expect(screen.queryByText('metrics.statMeasurements')).toBeNull();
  });

  it('shows the applied provider as a chip with the active-count badge, and removes it from the chip', async () => {
    const fetchMock = stubMetricsFetch({ success: true, rows: [row()], truncated: false });
    renderPage();
    await waitFor(() => expect(screen.getByText('metrics.tableTitle')).toBeInTheDocument());
    await applyProviderFilter('Instagram');
    await waitFor(() => expect(lastFetchUrl(fetchMock)).toContain('provider=instagram'));
    expect(screen.getByText('Instagram')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'metrics.filtersActive {"count":1}' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'metrics.filtersRemoveFilter {"label":"Instagram"}' }));
    await waitFor(() => expect(screen.queryByText('Instagram')).toBeNull());
  });

  it('removes the persona filter from its chip', async () => {
    const fetchMock = stubMetricsFetch({ success: true, rows: [row()], truncated: false });
    renderPage();
    await waitFor(() => expect(screen.getByText('metrics.tableTitle')).toBeInTheDocument());
    await applyPersonaFilter('Beta');
    await waitFor(() => expect(lastFetchUrl(fetchMock)).toContain(`persona=${PERSONA_B}`));
    expect(screen.getByText('Beta')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'metrics.filtersRemoveFilter {"label":"Beta"}' }));
    await waitFor(() => expect(screen.queryByText('Beta')).toBeNull());
  });

  it('falls back to the unknown-persona copy for a persona id it does not know', async () => {
    stubMetricsFetch({ success: true, rows: [row({ personaId: 'unknown-persona' })], truncated: false });
    renderPage();
    await waitFor(() => expect(screen.getByText(/metrics\.unknownPersona/)).toBeInTheDocument());
  });

  it('labels the no-persona chip with the no-persona copy', async () => {
    stubMetricsFetch({ success: true, rows: [row()], truncated: false });
    renderPage();
    await waitFor(() => expect(screen.getByText('metrics.tableTitle')).toBeInTheDocument());
    await applyPersonaFilter('metrics.noPersona');
    expect(screen.getByText('metrics.noPersona')).toBeInTheDocument();
    expect(screen.queryByText('metrics.unknownPersona')).toBeNull();
  });

  it('shows the filtered empty state for a provider-only filter', async () => {
    stubMetricsFetch({ success: true, rows: [], truncated: false });
    renderPage();
    await waitFor(() => expect(screen.getByText('metrics.empty')).toBeInTheDocument());
    await applyProviderFilter('Instagram');
    await waitFor(() => expect(screen.getByText('metrics.emptyFiltered')).toBeInTheDocument());
  });

  it('switches back to the 24h window', async () => {
    const fetchMock = stubMetricsFetch({ success: true, rows: [row()], truncated: false });
    renderPage();
    await waitFor(() => expect(screen.getByText('metrics.tableTitle')).toBeInTheDocument());
    activateTab('metrics.window7d');
    await waitFor(() => expect(lastFetchUrl(fetchMock)).toBe('/api/metrics?window=7d'));
    activateTab('metrics.window24h');
    await waitFor(() => expect(screen.getByText('metrics.window24h')).toHaveAttribute('data-state', 'active'));
    expect(screen.getByText('metrics.window7d')).toHaveAttribute('data-state', 'inactive');
  });

  it('shows the empty state, and the filtered empty state once a filter is set', async () => {
    stubMetricsFetch({ success: true, rows: [], truncated: false });
    renderPage();
    await waitFor(() => expect(screen.getByText('metrics.empty')).toBeInTheDocument());

    await applyPersonaFilter('metrics.noPersona');
    await waitFor(() => expect(screen.getByText('metrics.emptyFiltered')).toBeInTheDocument());
  });

  it('shows an error panel and retries on demand', async () => {
    const fetchMock = stubMetricsFetch({ success: false, error: 'nope' }, 500);
    renderPage();
    await waitFor(() => expect(screen.getByText('metrics.loadError')).toBeInTheDocument());
    expect(screen.getByRole('alert')).toBeInTheDocument();

    fetchMock.mockImplementation(async () => new Response(
      JSON.stringify({ success: true, rows: [row()], truncated: false }),
      { status: 200 },
    ));
    fireEvent.click(screen.getByText('metrics.retry'));
    // The retry must actually refetch: waiting for the rows (the tiles
    // only exist with rows) proves recovery, not the always-rendered
    // list heading.
    await waitFor(() => expect(screen.getByText('metrics.statMeasurements')).toBeInTheDocument());
  });

  it('sends the window and the sheet filters to the API, and clears them from the chips', async () => {
    const fetchMock = stubMetricsFetch({
      success: true,
      rows: [row(), row({ postId: 'post-2', scriptAngle: 'tutorial', views: 50 })],
      truncated: false,
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('metrics.tableTitle')).toBeInTheDocument());
    expect(lastFetchUrl(fetchMock)).toBe('/api/metrics?window=24h');

    activateTab('metrics.window7d');
    await waitFor(() => expect(lastFetchUrl(fetchMock)).toBe('/api/metrics?window=7d'));

    await applyPersonaFilter('Beta');
    await waitFor(() => expect(lastFetchUrl(fetchMock)).toContain(`persona=${PERSONA_B}`));
    expect(screen.getByText('Beta')).toBeInTheDocument();
    expect(screen.getByText('metrics.clearFilters')).toBeInTheDocument();

    await applyProviderFilter('Instagram');
    await waitFor(() => expect(lastFetchUrl(fetchMock)).toContain('provider=instagram'));

    fireEvent.click(screen.getByText('metrics.clearFilters'));
    await waitFor(() => expect(screen.queryByText('metrics.clearFilters')).toBeNull());
  });

  it('offers the 28d window and fetches it', async () => {
    const fetchMock = stubMetricsFetch({ success: true, rows: [row()], truncated: false });
    renderPage();
    await waitFor(() => expect(screen.getByText('metrics.tableTitle')).toBeInTheDocument());
    activateTab('metrics.window28d');
    await waitFor(() => expect(lastFetchUrl(fetchMock)).toBe('/api/metrics?window=28d'));
  });

  it('shows one reconnect prompt and "—" instead of zeros for a token without the Analytics scope', async () => {
    stubMetricsFetch({
      success: true,
      rows: [
        row({ analyticsStatus: 'scope_missing' }),
        row({ postId: 'post-2', analyticsStatus: 'scope_missing' }),
      ],
      truncated: false,
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('metrics.reconnectTitle')).toBeInTheDocument());
    expect(screen.getAllByText('metrics.reconnectTitle')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'metrics.reconnectAction' })).toHaveAttribute('href', '/accounts');
    expect(screen.getAllByText('metrics.reconnectNeeded')).toHaveLength(2);
    expect(screen.queryByText('0%')).toBeNull();
  });

});
