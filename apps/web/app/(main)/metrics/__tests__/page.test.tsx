import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

//---------------
// Tests for the Metrics page: totals tiles, the sorted per-video list
// and the Filters Sheet over GET /api/metrics. The React Query hook
// stays real; the network (fetch), the personas/accounts hooks and i18n
// are mocked. t() returns the key, with {vars} appended when interpolated.
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

// cmdk scrolls the active item into view when the list opens; jsdom
// has no Element.scrollIntoView, so stub it for the Combobox tests.
window.HTMLElement.prototype.scrollIntoView = vi.fn();
// Radix Select calls hasPointerCapture on pointerdown; jsdom has none,
// so the trigger never opens without these stubs.
window.HTMLElement.prototype.hasPointerCapture = () => false;
window.HTMLElement.prototype.setPointerCapture = () => {};
window.HTMLElement.prototype.releasePointerCapture = () => {};

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

// Radix Tabs activates on mousedown, not on click alone in jsdom.
function activateTab(label: string): void {
  const trigger = screen.getByText(label);
  fireEvent.mouseDown(trigger);
  fireEvent.click(trigger);
}

// The Filters Sheet (Radix Dialog) renders its content in a portal;
// the persona Combobox and the provider Select live inside it.
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
  // Radix Select opens on pointerdown; fireEvent alone does not open it
  // in jsdom, so drive it with user-event.
  const user = userEvent.setup();
  await user.click(screen.getByLabelText('metrics.filterProvider'));
  const options = await screen.findAllByRole('option');
  const option = options.find((el) => el.textContent === label);
  expect(option).toBeDefined();
  await user.click(option as HTMLElement);
  fireEvent.click(screen.getByText('metrics.filtersApply'));
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

    // The list heading renders while loading; wait for the tiles, which
    // only exist once the rows arrive.
    await waitFor(() => expect(screen.getByText('metrics.statVideos')).toBeInTheDocument());
    // Totals, not averages: 3 videos, 100 + 300 views, engagement
    // 10 + 3 + 1 + 5 + 0 + 0 = 19 (nulls skipped, never counted as 0).
    expect(screen.getByText('metrics.statVideos')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('400')).toBeInTheDocument();
    expect(screen.getByText('19')).toBeInTheDocument();
    // Sorted by views: 300 first, then 100, then the null-views row.
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('300');
    expect(items[1]).toHaveTextContent('100');
    expect(items[2]).toHaveTextContent('metrics.notReported');
    // Fallback title is "{Network} · {date}", never "No angle".
    expect(screen.getByText('Instagram · Oct 21, 2026')).toBeInTheDocument();
    expect(screen.queryByText('metrics.noAngle')).toBeNull();
    // Angle text, fallbacks for null persona, account labels (known id
    // resolves to its label, unknown id falls back to the raw id).
    expect(screen.getAllByText('myth').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Alpha/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/metrics.noPersona/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Chan One/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/did:plc:x/).length).toBeGreaterThan(0);
    // Engagement inline as small numbers on the rows that reported it.
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
    // The toolbar holds no filter fields: they live in the Sheet.
    expect(screen.queryByText('metrics.filterPersona')).toBeNull();
    await openFiltersSheet();
    expect(screen.getByText('metrics.filterPersona')).toBeInTheDocument();
    expect(screen.getByText('metrics.filterProvider')).toBeInTheDocument();
    expect(screen.queryByText('metrics.filterAccount')).toBeNull();
    expect(screen.queryByText('metrics.filterAngle')).toBeNull();
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
    // The coverage card renders after the video list in the document.
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
    await waitFor(() => expect(screen.getByText(/metrics\.asOf/)).toBeInTheDocument());
    expect(screen.queryByText('metrics.coverageTitle')).toBeNull();
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
    await waitFor(() => expect(screen.getByText('metrics.tableTitle')).toBeInTheDocument());
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

    // Window switch refetches with window=7d.
    activateTab('metrics.window7d');
    await waitFor(() => expect(lastFetchUrl(fetchMock)).toBe('/api/metrics?window=7d'));

    // Persona filter through the Sheet (a real persona).
    await applyPersonaFilter('Beta');
    await waitFor(() => expect(lastFetchUrl(fetchMock)).toContain(`persona=${PERSONA_B}`));
    // The applied filter shows as a removable chip.
    expect(screen.getByText('Beta')).toBeInTheDocument();
    expect(screen.getByText('metrics.clearFilters')).toBeInTheDocument();

    // Provider filter through the Sheet.
    await applyProviderFilter('Instagram');
    await waitFor(() => expect(lastFetchUrl(fetchMock)).toContain('provider=instagram'));

    // Clear filters resets every filter (window kept). The unfiltered 7d
    // query is still cache-fresh (staleTime 60s), so no new fetch fires:
    // assert the reset through the controls instead of the network.
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
