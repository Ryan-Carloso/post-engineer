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

vi.mock('@/components/provider-icon', () => ({
  ProviderIcon: ({ provider }: { provider: string }) => <span data-testid={`provider-${provider}`} />,
}));

import MetricsPage from '../page';
import { usePersonasQuery, useSocialAccountsQuery } from '@/lib/api';
import { METRICS_NONE } from '@/lib/metrics/metrics-query';
import type { MetricsRowView } from '@/lib/metrics/metrics-query';

const PERSONA_A = '11111111-2222-4333-8444-555555555555';
const PERSONA_B = '22222222-3333-4444-8555-666666666666';

function row(overrides: Partial<MetricsRowView> = {}): MetricsRowView {
  return {
    postId: 'post-1', personaId: PERSONA_A, provider: 'youtube', accountId: 'UC1', externalId: 'v1',
    scriptAngle: 'myth', views: 100, likes: 10, comments: 3, saves: 1, collectedAt: '2026-10-21T12:00:00Z',
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
});
