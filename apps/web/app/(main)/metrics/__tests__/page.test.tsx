import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

//---------------
// Tests for the Metrics page: filters, stat tiles, chart and per-video
// list over GET /api/metrics. The React Query hook and the grouping stay
// real; the network (fetch), the personas/accounts hooks and i18n are
// mocked. t() returns the key, with {vars} appended when interpolated.
//---------------

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

import MetricsPage from '../page';
import { usePersonasQuery, useSocialAccountsQuery } from '@/lib/api';
import { useI18n } from '@/lib/i18n/provider';
import { METRICS_NONE } from '@/lib/metrics/metrics-query';
import type { CoverageItem, MetricsRowView } from '@/lib/metrics/metrics-query';

// The i18n mock defaults to 'en'; a test that needs the pt-BR date branch
// flips it and the beforeEach below flips it back.
function setLocale(locale: 'en' | 'pt'): void {
  vi.mocked(useI18n).mockReturnValue({
    t: (key: string, vars?: Record<string, unknown>) => (vars === undefined ? key : `${key} ${JSON.stringify(vars)}`),
    locale,
    setLocale: vi.fn(),
  } as never);
}

const PERSONA_A = '11111111-2222-4333-8444-555555555555';
const PERSONA_B = '22222222-3333-4444-8555-666666666666';

function row(overrides: Partial<MetricsRowView> = {}): MetricsRowView {
  return {
    postId: 'post-1', personaId: PERSONA_A, provider: 'youtube', accountId: 'UC1', externalId: 'v1',
    scriptAngle: 'myth', views: 100, likes: 10, comments: 3, saves: 1, collectedAt: '2026-10-21T12:00:00Z',
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

beforeEach(() => {
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

  it('renders stat tiles, the chart style and the per-video rows on success', async () => {
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

    await waitFor(() => expect(screen.getByText('metrics.tableTitle')).toBeInTheDocument());
    // Stat tiles: 3 videos, average of reported views (100 + 300) / 2, best
    // group by angle is the null-angle group (300) under its i18n label.
    expect(screen.getByText('metrics.statVideos')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('200')).toBeInTheDocument();
    // Row list: angle text, fallbacks for null angle/persona, account labels
    // (known id resolves to its label, unknown id falls back to the raw id).
    expect(screen.getAllByText('myth').length).toBeGreaterThan(0);
    expect(screen.getAllByText('metrics.noAngle').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Alpha/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/metrics.noPersona/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Chan One/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/did:plc:x/).length).toBeGreaterThan(0);
    // Null metric value renders the not-reported label (post-3 views).
    expect(screen.getAllByText('metrics.notReported').length).toBeGreaterThan(0);
    // The chart container rendered the config colors into a style tag.
    const styles = [...document.querySelectorAll('style')].map((el) => el.textContent ?? '');
    expect(styles.some((css) => css.includes('--color-average: #c9d2dc;'))).toBe(true);
  });

  it('shows the coverage card with attention and waiting groups, and the as-of line', async () => {
    stubMetricsFetch({
      success: true, rows: [row()], truncated: false,
      coverage: [
        coverageItem({ reason: 'retrying' }),
        coverageItem({
          postId: 'post-10', provider: 'instagram', accountId: 'ig1', externalId: null,
          reason: 'publish-failed', scriptAngle: null,
        }),
        // Unknown account id: the card falls back to the raw id.
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
    // The YouTube retrying item links the gap to the Analytics connection.
    expect(screen.getByText('metrics.coverageYoutubeHint')).toBeInTheDocument();
    // The failed publish warns the video may be live anyway.
    expect(screen.getByText('metrics.coveragePublishFailedHint')).toBeInTheDocument();
    // As-of line above the table, and the collected date on each row.
    expect(screen.getByText(/metrics\.asOf/)).toBeInTheDocument();
    expect(screen.getAllByText(/metrics\.tableCollected/).length).toBeGreaterThan(0);
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
    // The as-of line (formatDateTime) and the per-row collected date
    // (formatDate) both go through the pt-BR branch: the mocked t()
    // interpolates the formatted date as JSON, so the pt-BR date string
    // itself must appear — once per line. With the en-US branch the same
    // lines read "Oct 21, 2026", so this fails if the branch flips.
    expect(screen.getAllByText(/21 de out\. de 2026/).length).toBe(2);
  });

  it('hides the coverage card when nothing is missing, but still dates the data', async () => {
    stubMetricsFetch({ success: true, rows: [row()], truncated: false, coverage: [], coverageTruncated: false, asOf: '2026-10-21T12:00:00Z' });
    renderPage();
    await waitFor(() => expect(screen.getByText('metrics.tableTitle')).toBeInTheDocument());
    expect(screen.queryByText('metrics.coverageTitle')).toBeNull();
    expect(screen.getByText(/metrics\.asOf/)).toBeInTheDocument();
  });

  it('notes when the row cap truncated the result', async () => {
    stubMetricsFetch({ success: true, rows: [row()], truncated: true });
    renderPage();
    await waitFor(() => expect(screen.getByText(/metrics\.truncated/)).toBeInTheDocument());
  });

  it('shows the empty state, and the filtered empty state once a filter is set', async () => {
    stubMetricsFetch({ success: true, rows: [], truncated: false });
    renderPage();
    await waitFor(() => expect(screen.getByText('metrics.empty')).toBeInTheDocument());

    const personaSelect = screen.getByLabelText(/metrics\.filterPersona/);
    fireEvent.change(personaSelect, { target: { value: METRICS_NONE } });
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
    await waitFor(() => expect(screen.getByText('metrics.tableTitle')).toBeInTheDocument());
  });

  it('sends window, metric-independent filters and grouping choices to the API', async () => {
    const fetchMock = stubMetricsFetch({
      success: true,
      rows: [row(), row({ postId: 'post-2', scriptAngle: 'tutorial', views: 50 })],
      truncated: false,
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('metrics.tableTitle')).toBeInTheDocument());
    expect(lastFetchUrl(fetchMock)).toBe('/api/metrics?window=24h');

    // Window switch refetches with window=7d.
    fireEvent.click(screen.getByText('metrics.window7d'));
    await waitFor(() => expect(lastFetchUrl(fetchMock)).toBe('/api/metrics?window=7d'));

    // Persona filter (a real persona, then the null sentinel).
    fireEvent.change(screen.getByLabelText(/metrics\.filterPersona/), { target: { value: PERSONA_B } });
    await waitFor(() => expect(lastFetchUrl(fetchMock)).toContain(`persona=${PERSONA_B}`));

    // Provider filter resets the account filter and refetches.
    fireEvent.change(screen.getByLabelText(/metrics\.filterProvider/), { target: { value: 'instagram' } });
    await waitFor(() => expect(lastFetchUrl(fetchMock)).toContain('provider=instagram'));

    // Account filter lists only accounts of the chosen provider.
    const accountSelect = screen.getByLabelText(/metrics\.filterAccount/);
    expect(accountSelect).not.toHaveTextContent('Chan One');
    fireEvent.change(accountSelect, { target: { value: 'ig1' } });
    await waitFor(() => expect(lastFetchUrl(fetchMock)).toContain('account=ig1'));

    // Angle filter: a loaded angle, sent verbatim.
    fireEvent.change(screen.getByLabelText(/metrics\.filterAngle/), { target: { value: 'tutorial' } });
    await waitFor(() => expect(lastFetchUrl(fetchMock)).toContain('angle=tutorial'));

    // Metric + group segmented controls switch the displayed metric/group
    // without refetching.
    const callsBefore = fetchMock.mock.calls.length;
    fireEvent.click(screen.getByText('metrics.metricLikes'));
    fireEvent.change(screen.getByLabelText(/metrics\.groupLabel/), { target: { value: 'persona' } });
    expect(fetchMock.mock.calls.length).toBe(callsBefore);
    expect(screen.getByText('metrics.chartTitle {"metric":"metrics.metriclikes","group":"metrics.grouppersona"}')).toBeInTheDocument();

    // Clear filters resets every filter (window kept). The unfiltered 7d
    // query is still cache-fresh (staleTime 60s), so no new fetch fires:
    // assert the reset through the controls instead of the network.
    fireEvent.click(screen.getByText('metrics.clearFilters'));
    await waitFor(() => expect(screen.queryByText('metrics.clearFilters')).toBeNull());
    expect(screen.getByLabelText(/metrics\.filterPersona/)).toHaveValue('all');
    expect(screen.getByLabelText(/metrics\.filterAngle/)).toHaveValue('all');
    expect(screen.getByLabelText(/metrics\.filterProvider/)).toHaveValue('all');
  });

  it('labels groups by persona name and account label in the chart data', async () => {
    stubMetricsFetch({
      success: true,
      rows: [
        row(),
        row({ postId: 'post-2', provider: 'instagram', accountId: 'ig1', externalId: 'v2', views: 50 }),
        // An account the accounts query no longer returns: labelFor
        // falls back to the raw account id.
        row({ postId: 'post-3', accountId: 'UC-gone', externalId: 'v3', views: 10 }),
      ],
      truncated: false,
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('metrics.tableTitle')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/metrics\.groupLabel/), { target: { value: 'persona' } });
    // 'Alpha' now appears in the filter select, the top-group stat and
    // the chart axis (labelFor's persona branch).
    await waitFor(() => expect(screen.getAllByText('Alpha').length).toBeGreaterThan(1));

    fireEvent.change(screen.getByLabelText(/metrics\.groupLabel/), { target: { value: 'account' } });
    await waitFor(() => expect(screen.getAllByText('Chan One').length).toBeGreaterThan(1));
    // The unknown account's raw id labels its chart group (tick text may
    // be split across tspans, so match on the rendered HTML).
    expect(document.body.innerHTML).toContain('UC-gone');

    fireEvent.change(screen.getByLabelText(/metrics\.groupLabel/), { target: { value: 'provider' } });
    await waitFor(() => expect(screen.getAllByText('YouTube').length).toBeGreaterThan(1));
  });

  it('keeps a selected angle listed after filtering hides the other angles', async () => {
    // First fetch lists the 'myth' angle; the filtered fetch returns no
    // rows at all, so 'myth' can only stay in the select via the page's
    // selected-angle prepend path.
    const fetchMock = vi.fn(async (url: string) => new Response(
      JSON.stringify(url.includes('angle=myth')
        ? { success: true, rows: [], truncated: false }
        : { success: true, rows: [row()], truncated: false }),
      { status: 200 },
    ));
    vi.stubGlobal('fetch', fetchMock);
    renderPage();
    await waitFor(() => expect(screen.getByText('metrics.tableTitle')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/metrics\.filterAngle/), { target: { value: 'myth' } });
    await waitFor(() => expect(lastFetchUrl(fetchMock)).toContain('angle=myth'));
    await waitFor(() => expect(screen.getByText('metrics.emptyFiltered')).toBeInTheDocument());
    const angleSelect = screen.getByLabelText(/metrics\.filterAngle/);
    expect(angleSelect).toHaveTextContent('myth');
    expect(angleSelect).toHaveValue('myth');
  });

  it('offers the 28d window and fetches it', async () => {
    const fetchMock = stubMetricsFetch({ success: true, rows: [row()], truncated: false });
    renderPage();
    await waitFor(() => expect(screen.getByText('metrics.tableTitle')).toBeInTheDocument());
    fireEvent.click(screen.getByText('metrics.window28d'));
    await waitFor(() => expect(lastFetchUrl(fetchMock)).toBe('/api/metrics?window=28d'));
  });

  it('shows engaged views, the derived stayed-to-watch label and the provisional chip on YouTube rows', async () => {
    stubMetricsFetch({
      success: true,
      rows: [row({
        analyticsStatus: 'ok', analyticsViews: 1000, engagedViews: 641, stayedToWatchPct: 64.1,
        contentType: 'SHORTS', provisional: true,
      })],
      truncated: false,
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('metrics.engagedViewsValue {"count":"641"}')).toBeInTheDocument());
    expect(screen.getByText('metrics.stayedToWatchDerived:')).toBeInTheDocument();
    expect(screen.getByText('64.1%')).toBeInTheDocument();
    expect(screen.getByText('metrics.provisional')).toHaveAttribute('title', 'metrics.provisionalHint');
    // Shorts get the no-curve note instead of a curve toggle.
    expect(screen.getByText('metrics.curveShortsNote')).toBeInTheDocument();
    expect(screen.queryByText('metrics.curveShow')).toBeNull();
    expect(screen.queryByText('metrics.reconnectTitle')).toBeNull();
  });

  it('charts stayed-to-watch as a percentage with one decimal', async () => {
    stubMetricsFetch({
      success: true,
      rows: [
        row({ analyticsStatus: 'ok', stayedToWatchPct: 60.5 }),
        row({ postId: 'post-2', analyticsStatus: 'ok', stayedToWatchPct: 70.2 }),
      ],
      truncated: false,
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('metrics.tableTitle')).toBeInTheDocument());
    fireEvent.click(screen.getByText('metrics.metricStayedToWatch'));
    // Overall average (60.5 + 70.2) / 2 = 65.35 -> 65.4%, never rounded to a whole number.
    expect(screen.getAllByText('65.4%').length).toBeGreaterThan(0);
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

  it('marks non-measured analytics as unavailable', async () => {
    stubMetricsFetch({ success: true, rows: [row({ analyticsStatus: 'not_owned' })], truncated: false });
    renderPage();
    await waitFor(() => expect(screen.getByText('metrics.retentionUnavailable')).toBeInTheDocument());
  });

  it('opens the retention curve of a long-form video on demand', async () => {
    const fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify(
      url.startsWith('/api/metrics/retention-curve')
        ? { success: true, points: [{ ratio: 0.01, audienceWatchRatio: 1, relativeRetentionPerformance: 0.5 }], provisional: true }
        : { success: true, rows: [row({ analyticsStatus: 'ok', contentType: 'VIDEO_ON_DEMAND', stayedToWatchPct: 50 })], truncated: false },
    )));
    vi.stubGlobal('fetch', fetchMock);
    renderPage();
    const toggle = await screen.findByRole('button', { name: 'metrics.curveShow' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    // Nothing is fetched from Analytics until the user asks.
    expect(fetchMock.mock.calls.some(([url]) => url.startsWith('/api/metrics/retention-curve'))).toBe(false);
    fireEvent.click(toggle);
    await waitFor(() => expect(screen.getByTestId('retention-curve')).toHaveTextContent('1 points'));
    expect(fetchMock).toHaveBeenCalledWith('/api/metrics/retention-curve?account=UC1&video=v1');
    expect(screen.getByRole('button', { name: 'metrics.curveHide' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('shows the reconnect copy when the curve endpoint reports a missing scope', async () => {
    const curveFetch = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url.startsWith('/api/metrics/retention-curve')
      ? (curveFetch(), new Response(JSON.stringify({ success: false, code: 'YOUTUBE_ANALYTICS_SCOPE_MISSING' }), { status: 403 }))
      : new Response(JSON.stringify({ success: true, rows: [row({ analyticsStatus: 'ok', contentType: 'VIDEO_ON_DEMAND' })], truncated: false })))));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'metrics.curveShow' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('metrics.reconnectTitle'));
    expect(curveFetch).toHaveBeenCalledTimes(1);

    // A failed read is an errored (stale) query: closing and reopening the
    // panel retries instead of serving the cached failure.
    fireEvent.click(screen.getByRole('button', { name: 'metrics.curveHide' }));
    fireEvent.click(screen.getByRole('button', { name: 'metrics.curveShow' }));
    await waitFor(() => expect(curveFetch).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('metrics.reconnectTitle'));
  });

  it('shows a plain (non-reconnect) error in the destructive color when the curve read fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url.startsWith('/api/metrics/retention-curve')
      ? new Response(JSON.stringify({ success: false }), { status: 500 })
      : new Response(JSON.stringify({ success: true, rows: [row({ analyticsStatus: 'ok', contentType: 'VIDEO_ON_DEMAND' })], truncated: false })))));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'metrics.curveShow' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('metrics.curveError');
    expect(alert.className).toContain('text-destructive');
    expect(alert.className).not.toContain('text-warning');
  });

  it('colors the reconnect curve message as a warning', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url.startsWith('/api/metrics/retention-curve')
      ? new Response(JSON.stringify({ success: false, code: 'YOUTUBE_ANALYTICS_SCOPE_MISSING' }), { status: 403 })
      : new Response(JSON.stringify({ success: true, rows: [row({ analyticsStatus: 'ok', contentType: 'VIDEO_ON_DEMAND' })], truncated: false })))));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'metrics.curveShow' }));

    const alert = await screen.findByRole('alert');
    expect(alert.className).toContain('text-warning');
  });

  it('says so when a long-form video has no retention points', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(
      url.startsWith('/api/metrics/retention-curve')
        ? { success: true, points: [], provisional: false }
        : { success: true, rows: [row({ analyticsStatus: 'ok', contentType: 'VIDEO_ON_DEMAND' })], truncated: false },
    ))));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'metrics.curveShow' }));

    expect(await screen.findByText('metrics.curveEmpty')).toBeInTheDocument();
  });
});
