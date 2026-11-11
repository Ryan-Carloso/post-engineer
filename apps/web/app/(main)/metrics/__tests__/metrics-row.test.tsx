import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

//---------------
// Tests for MetricsRow: views as the main number with inline engagement,
// and the YouTube retention line plus the on-demand retention curve.
// The retention-curve query stays real; the network (fetch) and i18n
// are mocked. t() returns the key, with {vars} appended when interpolated.
//---------------

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

import { MetricsRow } from '../metrics-row';
import type { MetricsRowView } from '@/lib/metrics/metrics-query';

function row(overrides: Partial<MetricsRowView> = {}): MetricsRowView {
  return {
    postId: 'post-1', personaId: '11111111-2222-4333-8444-555555555555', provider: 'youtube', accountId: 'UC1', externalId: 'v1',
    scriptAngle: 'myth', views: 100, likes: 10, comments: 3, saves: 1, collectedAt: '2026-10-21T12:00:00Z',
    analyticsViews: null, engagedViews: null, stayedToWatchPct: null, averageViewDurationSeconds: null,
    averageViewPercentage: null, contentType: null, analyticsStatus: null, provisional: false,
    ...overrides,
  };
}

function renderRow(overrides: Partial<MetricsRowView> = {}): ReturnType<typeof render> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ul>
        <MetricsRow
          row={row(overrides)}
          title="myth"
          subtitle="Alpha · Chan One"
          formatNumber={(value) => value.toLocaleString('en-US')}
          formatDate={() => 'Oct 21, 2026'}
        />
      </ul>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MetricsRow', () => {
  it('shows engaged views, the derived stayed-to-watch label and the provisional chip on YouTube rows', () => {
    renderRow({
      analyticsStatus: 'ok', analyticsViews: 1000, engagedViews: 641, stayedToWatchPct: 64.1,
      contentType: 'SHORTS', provisional: true,
    });
    expect(screen.getByText('metrics.engagedViewsValue {"count":"641"}')).toBeInTheDocument();
    expect(screen.getByText('metrics.stayedToWatchDerived:')).toBeInTheDocument();
    expect(screen.getByText('64.1%')).toBeInTheDocument();
    expect(screen.getByText('metrics.provisional')).toHaveAttribute('title', 'metrics.provisionalHint');
    // Shorts get the no-curve note instead of a curve toggle.
    expect(screen.getByText('metrics.curveShortsNote')).toBeInTheDocument();
    expect(screen.queryByText('metrics.curveShow')).toBeNull();
    expect(screen.queryByText('metrics.reconnectTitle')).toBeNull();
  });

  it('marks non-measured analytics as unavailable', () => {
    renderRow({ analyticsStatus: 'not_owned' });
    expect(screen.getByText('metrics.retentionUnavailable')).toBeInTheDocument();
  });

  it('opens the retention curve of a long-form video on demand', async () => {
    const fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify(
      url.startsWith('/api/metrics/retention-curve')
        ? { success: true, points: [{ ratio: 0.01, audienceWatchRatio: 1, relativeRetentionPerformance: 0.5 }], provisional: true }
        : { success: false },
    )));
    vi.stubGlobal('fetch', fetchMock);
    renderRow({ analyticsStatus: 'ok', contentType: 'VIDEO_ON_DEMAND', stayedToWatchPct: 50 });
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
      : new Response(JSON.stringify({ success: false }), { status: 500 }))));
    renderRow({ analyticsStatus: 'ok', contentType: 'VIDEO_ON_DEMAND' });
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
      : new Response(JSON.stringify({ success: false }), { status: 500 }))));
    renderRow({ analyticsStatus: 'ok', contentType: 'VIDEO_ON_DEMAND' });
    fireEvent.click(await screen.findByRole('button', { name: 'metrics.curveShow' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('metrics.curveError');
    expect(alert.className).toContain('text-destructive');
    expect(alert.className).not.toContain('text-warning');
  });

  it('colors the reconnect curve message as a warning', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url.startsWith('/api/metrics/retention-curve')
      ? new Response(JSON.stringify({ success: false, code: 'YOUTUBE_ANALYTICS_SCOPE_MISSING' }), { status: 403 })
      : new Response(JSON.stringify({ success: false }), { status: 500 }))));
    renderRow({ analyticsStatus: 'ok', contentType: 'VIDEO_ON_DEMAND' });
    fireEvent.click(await screen.findByRole('button', { name: 'metrics.curveShow' }));

    const alert = await screen.findByRole('alert');
    expect(alert.className).toContain('text-warning');
  });

  it('says so when a long-form video has no retention points', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(
      url.startsWith('/api/metrics/retention-curve')
        ? { success: true, points: [], provisional: false }
        : { success: false },
    ))));
    renderRow({ analyticsStatus: 'ok', contentType: 'VIDEO_ON_DEMAND' });
    fireEvent.click(await screen.findByRole('button', { name: 'metrics.curveShow' }));

    expect(await screen.findByText('metrics.curveEmpty')).toBeInTheDocument();
  });

  it('shows views with the Views label and likes, comments and saves joined inline', () => {
    renderRow();
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText('metrics.viewsLabel')).toBeInTheDocument();
    expect(screen.getByText(
      'metrics.likesValue {"count":"10"} · metrics.commentsValue {"count":"3"} · metrics.savesValue {"count":"1"}',
    )).toBeInTheDocument();
  });

  it('skips a null engagement value without leaving a dangling separator', () => {
    renderRow({ likes: null, comments: 3, saves: 1 });
    expect(screen.getByText(
      'metrics.commentsValue {"count":"3"} · metrics.savesValue {"count":"1"}',
    )).toBeInTheDocument();
  });

  it('renders no engagement line when nothing was reported', () => {
    const { container } = renderRow({ likes: null, comments: null, saves: null });
    expect(container.querySelector('p.mt-0\\.5')).toBeNull();
  });

  it('shows no retention line for a non-YouTube row even when Analytics is ok', () => {
    renderRow({ provider: 'instagram', analyticsStatus: 'ok' });
    expect(screen.queryByText('metrics.stayedToWatchDerived:')).toBeNull();
    expect(screen.queryByText('metrics.retentionUnavailable')).toBeNull();
  });

  it('shows no retention line for a YouTube row without an Analytics status', () => {
    renderRow({ analyticsStatus: null });
    expect(screen.queryByText('metrics.stayedToWatchDerived:')).toBeNull();
    expect(screen.queryByText('metrics.retentionUnavailable')).toBeNull();
  });

  it('says the stayed-to-watch share was not reported when YouTube has no value', () => {
    renderRow({ analyticsStatus: 'ok', contentType: 'SHORTS', stayedToWatchPct: null });
    expect(screen.getByText('metrics.stayedToWatchDerived:')).toBeInTheDocument();
    expect(screen.getByText('metrics.notReported')).toBeInTheDocument();
  });
});
