import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/lib/i18n/provider';
import type { ShareView } from '@/lib/share-links/share-view-types';

const { notFoundMock, resolveMock, headersMock } = vi.hoisted(() => ({
  notFoundMock: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  resolveMock: vi.fn(),
  headersMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({ notFound: notFoundMock }));
vi.mock('next/headers', () => ({ headers: headersMock }));
vi.mock('@/lib/share-links/resolve-shared-page', () => ({ resolveSharedPage: resolveMock }));
vi.mock('@/lib/supabase/service', () => ({ createSupabaseServiceClient: vi.fn(() => ({ marker: 'service' })) }));

import SharedPage, { metadata } from '../page';

const TOKEN = 'a'.repeat(43);

const VIEW: ShareView = {
  window: '7d',
  weekStart: '2026-11-16T00:00:00.000Z',
  weekEnd: '2026-11-23T00:00:00.000Z',
  summary: { measurements: 1, views: 10, engagement: 2 },
  byProvider: [{ provider: 'youtube', measurements: 1, views: 10, engagement: 2 }],
  asOf: null,
  metricsTruncated: false,
  posts: [],
  postsTruncated: false,
};

describe('/s/[token] page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    headersMock.mockResolvedValue(new Headers({ 'x-forwarded-for': '203.0.113.9' }));
  });

  it('asks the resolver for the token with the request headers', async () => {
    resolveMock.mockResolvedValue({ kind: 'view', view: VIEW });
    await SharedPage({ params: Promise.resolve({ token: TOKEN }) });
    const [token, request, supabase] = resolveMock.mock.calls[0] as [string, Request, unknown, Date];
    expect(token).toBe(TOKEN);
    expect(request.headers.get('x-forwarded-for')).toBe('203.0.113.9');
    expect(supabase).toEqual({ marker: 'service' });
  });

  it('renders the shared view for an active link', async () => {
    resolveMock.mockResolvedValue({ kind: 'view', view: VIEW });
    const element = await SharedPage({ params: Promise.resolve({ token: TOKEN }) });
    render(<I18nProvider>{element}</I18nProvider>);
    expect(await screen.findByTestId('shared-metrics')).toBeInTheDocument();
    expect(notFoundMock).not.toHaveBeenCalled();
  });

  it('renders a 404 for an unknown, revoked or expired link', async () => {
    resolveMock.mockResolvedValue({ kind: 'not-found' });
    await expect(SharedPage({ params: Promise.resolve({ token: TOKEN }) })).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFoundMock).toHaveBeenCalledTimes(1);
  });

  it('renders the rate limit notice instead of the data when rate limited', async () => {
    resolveMock.mockResolvedValue({ kind: 'rate-limited' });
    const element = await SharedPage({ params: Promise.resolve({ token: TOKEN }) });
    render(<I18nProvider>{element}</I18nProvider>);
    expect(await screen.findByTestId('shared-rate-limited')).toBeInTheDocument();
    expect(screen.queryByTestId('shared-metrics')).not.toBeInTheDocument();
  });

  it('lets a lookup failure surface as an error instead of a not found', async () => {
    resolveMock.mockRejectedValue(new Error('share link lookup failed: db down'));
    await expect(SharedPage({ params: Promise.resolve({ token: TOKEN }) })).rejects.toThrow('share link lookup failed');
    expect(notFoundMock).not.toHaveBeenCalled();
  });

  it('asks search engines not to index or follow the page', () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.referrer).toBe('no-referrer');
  });

  it('gives the link preview a title and one generic line, with no numbers', () => {
    const description = String(metadata.openGraph?.description);
    expect(metadata.openGraph?.title).toBe('Post Engineer');
    expect(description).toBe('Resumo de métricas e posts da semana');
    expect(description).not.toMatch(/\d/);
  });
});
