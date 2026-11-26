import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { SharedMetricsView, SharedRateLimited } from '@/components/ui/shared-metrics-view';
import { I18nProvider } from '@/lib/i18n/provider';
import { STORAGE_KEY } from '@/lib/i18n/types';
import type { ShareView } from '@/lib/share-links/share-view-types';

function viewWith(overrides: Partial<ShareView> = {}): ShareView {
  return {
    window: '7d',
    weekStart: '2026-11-16T00:00:00.000Z',
    weekEnd: '2026-11-23T00:00:00.000Z',
    summary: { measurements: 3, views: 12345, engagement: 678 },
    byProvider: [
      { provider: 'youtube', measurements: 2, views: 12000, engagement: 600 },
      { provider: 'instagram', measurements: 1, views: 345, engagement: 78 },
    ],
    asOf: '2026-11-18T08:00:00.000Z',
    metricsTruncated: false,
    posts: [
      { title: 'Morning routine', slotAt: '2026-11-18T09:00:00.000Z', status: 'published', providers: ['youtube', 'instagram'] },
      { title: null, slotAt: '2026-11-19T09:00:00.000Z', status: 'ready', providers: ['bluesky'] },
      { title: 'Broken one', slotAt: '2026-11-20T09:00:00.000Z', status: 'failed', providers: [] },
    ],
    postsTruncated: false,
    ...overrides,
  };
}

function renderView(ui: ReactElement, locale: 'en' | 'pt'): void {
  window.localStorage.setItem(STORAGE_KEY, locale);
  render(<I18nProvider>{ui}</I18nProvider>);
}

describe('SharedMetricsView', () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it('shows the summary, the networks and the week posts in English', async () => {
    renderView(<SharedMetricsView view={viewWith()} />, 'en');
    expect(await screen.findByText('Shared summary')).toBeInTheDocument();
    expect(screen.getByText('Read-only')).toBeInTheDocument();
    const metrics = screen.getByTestId('shared-metrics');
    expect(within(metrics).getByText('12,345')).toBeInTheDocument();
    expect(within(metrics).getByText('678')).toBeInTheDocument();
    const providerRows = screen.getAllByTestId('shared-provider-row');
    expect(providerRows).toHaveLength(2);
    expect(providerRows[0]).toHaveTextContent('YouTube');
    expect(providerRows[1]).toHaveTextContent('Instagram');
    const posts = screen.getAllByTestId('shared-post-row');
    expect(posts).toHaveLength(3);
    expect(posts[0]).toHaveTextContent('Morning routine');
    expect(posts[0]).toHaveTextContent('Published');
    expect(posts[1]).toHaveTextContent('Untitled');
    expect(posts[2]).toHaveTextContent('Failed');
  });

  it('formats numbers and copy in Portuguese', async () => {
    renderView(<SharedMetricsView view={viewWith()} />, 'pt');
    expect(await screen.findByText('Resumo compartilhado')).toBeInTheDocument();
    expect(screen.getByText('Somente leitura')).toBeInTheDocument();
    expect(within(screen.getByTestId('shared-metrics')).getByText('12.345')).toBeInTheDocument();
    expect(screen.getAllByTestId('shared-post-row')[1]).toHaveTextContent('Sem título');
  });

  it('switches language with the PT and EN buttons', async () => {
    renderView(<SharedMetricsView view={viewWith()} />, 'pt');
    await screen.findByText('Resumo compartilhado');
    fireEvent.click(screen.getByRole('button', { name: 'EN' }));
    expect(await screen.findByText('Shared summary')).toBeInTheDocument();
  });

  it('renders no action button or link to the account, only the language switch', async () => {
    renderView(<SharedMetricsView view={viewWith()} />, 'en');
    await screen.findByText('Shared summary');
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['PT', 'EN']);
  });

  it('shows the empty states when there is nothing to show', async () => {
    renderView(
      <SharedMetricsView view={viewWith({ summary: { measurements: 0, views: 0, engagement: 0 }, byProvider: [], asOf: null, posts: [] })} />,
      'en',
    );
    expect(await screen.findByText('No measured videos yet.')).toBeInTheDocument();
    expect(screen.getByText('No posts this week.')).toBeInTheDocument();
    expect(screen.queryByTestId('shared-provider-row')).not.toBeInTheDocument();
  });

  it('warns when metrics or posts were truncated', async () => {
    renderView(<SharedMetricsView view={viewWith({ metricsTruncated: true, postsTruncated: true })} />, 'en');
    expect(await screen.findByText('Showing the 500 most recent measurements only.')).toBeInTheDocument();
    expect(screen.getByText('Showing only the first 100 posts of the week.')).toBeInTheDocument();
  });

  it('does not warn when nothing was truncated', async () => {
    renderView(<SharedMetricsView view={viewWith()} />, 'en');
    await screen.findByText('Shared summary');
    expect(screen.queryByText(/most recent measurements only/)).not.toBeInTheDocument();
    expect(screen.queryByText(/first 100 posts/)).not.toBeInTheDocument();
  });

  it('labels the network of a post for assistive technology', async () => {
    renderView(<SharedMetricsView view={viewWith()} />, 'en');
    const first = (await screen.findAllByTestId('shared-post-row'))[0];
    expect(within(first).getByText('YouTube', { selector: '.sr-only' })).toBeInTheDocument();
    expect(within(first).getByText('Instagram', { selector: '.sr-only' })).toBeInTheDocument();
  });
});

describe('SharedMetricsView week range', () => {
  afterEach(() => {
    window.localStorage.clear();
    vi.unstubAllEnvs();
  });

  it('shows the UTC week Monday to Sunday even for a viewer west of UTC', async () => {
    vi.stubEnv('TZ', 'America/Sao_Paulo');
    renderView(<SharedMetricsView view={viewWith()} />, 'en');
    expect(await screen.findByText('Nov 16, 2026 to Nov 22, 2026')).toBeInTheDocument();
  });
});

describe('SharedRateLimited', () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it('tells the visitor to wait, in both languages', async () => {
    renderView(<SharedRateLimited />, 'en');
    expect(await screen.findByTestId('shared-rate-limited')).toHaveTextContent('Too many visits in a short time. Wait a minute and try again.');
    fireEvent.click(screen.getByRole('button', { name: 'PT' }));
    expect(await screen.findByText('Muitos acessos em pouco tempo. Aguarde um minuto e tente de novo.')).toBeInTheDocument();
  });
});
