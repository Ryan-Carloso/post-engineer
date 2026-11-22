import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('@/lib/i18n/provider', async () => {
  const { dictionaries } = await import('@/lib/i18n');
  return {
    useI18n: () => ({
      locale: 'en' as const,
      setLocale: vi.fn(),
      t: (key: string) => {
        const [section, name] = key.split('.');
        const table = dictionaries.en[section as keyof typeof dictionaries.en] as Record<string, string>;
        return table[name] ?? key;
      },
    }),
  };
});
vi.mock('@/lib/session-expiry', () => ({ notifyIfSessionExpired: vi.fn() }));

import PublicPromptsSection from '../components/public-prompts-section';

const VERSION_ID = '44444444-4444-4444-8444-444444444444';

interface Listed {
  slug: string;
  source: 'own' | 'community';
  visibility: 'private' | 'public';
}

let listed: Listed[];
let listStatus: number;
let detailStatus: number;
let requested: string[];

function summary(entry: Listed): Record<string, unknown> {
  return { slug: entry.slug, title: `Title ${entry.slug}`, description: `About ${entry.slug}`, source: entry.source, visibility: entry.visibility };
}

function renderSection(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PublicPromptsSection />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  listed = [];
  listStatus = 200;
  detailStatus = 200;
  requested = [];
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      requested.push(url);
      if (url === '/api/prompts') {
        if (listStatus !== 200) return Response.json({ success: false }, { status: listStatus });
        return Response.json({ success: true, prompts: listed.map(summary) });
      }
      if (detailStatus !== 200) return Response.json({ success: false, error: 'raw database failure' }, { status: detailStatus });
      const slug = decodeURIComponent(url.replace('/api/prompts/', ''));
      const entry = listed.find((candidate) => candidate.slug === slug);
      if (entry === undefined) return Response.json({ success: false, code: 'PROMPT_NOT_FOUND' }, { status: 404 });
      return Response.json({ success: true, prompt: { ...summary(entry), prompt: `Text of ${slug}`, versionId: VERSION_ID, version: 1 } });
    }),
  );
  Object.defineProperty(window.navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('PublicPromptsSection', () => {
  it('lists every public prompt, the caller own public ones included, and never a private one', async () => {
    listed = [
      { slug: 'daily-news', source: 'community', visibility: 'public' },
      { slug: 'mine-shared', source: 'own', visibility: 'public' },
      { slug: 'mine-private', source: 'own', visibility: 'private' },
    ];
    renderSection();
    expect(await screen.findByTestId('user-prompt-daily-news')).toBeInTheDocument();
    expect(screen.getByTestId('user-prompt-mine-shared')).toBeInTheDocument();
    expect(screen.queryByTestId('user-prompt-mine-private')).not.toBeInTheDocument();
    expect(screen.getByTestId('user-prompt-link-daily-news')).toHaveAttribute('href', '/recipes/daily-news');
    expect(screen.getByText(/not verified by post-engineer/)).toBeInTheDocument();
  });

  it('offers only copy on each card', async () => {
    listed = [{ slug: 'daily-news', source: 'community', visibility: 'public' }];
    renderSection();
    const card = await screen.findByTestId('user-prompt-daily-news');
    expect(within(card).getByRole('button', { name: 'Copy' })).toBeInTheDocument();
    for (const name of ['Edit', 'Delete', 'Make public', 'Make private']) {
      expect(within(card).queryByRole('button', { name })).not.toBeInTheDocument();
    }
  });

  it('copies the full text fetched on demand', async () => {
    listed = [{ slug: 'daily-news', source: 'community', visibility: 'public' }];
    renderSection();
    const card = await screen.findByTestId('user-prompt-daily-news');
    fireEvent.click(within(card).getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(window.navigator.clipboard.writeText).toHaveBeenCalledWith('Text of daily-news'));
    expect(await within(card).findByRole('button', { name: 'Copied!' })).toBeInTheDocument();
    expect(requested).toEqual(['/api/prompts', '/api/prompts/daily-news']);
  });

  it('shows a localized error and copies nothing when the text cannot be loaded', async () => {
    listed = [{ slug: 'daily-news', source: 'community', visibility: 'public' }];
    detailStatus = 500;
    renderSection();
    const card = await screen.findByTestId('user-prompt-daily-news');
    fireEvent.click(within(card).getByRole('button', { name: 'Copy' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Try again.');
    expect(screen.queryByText(/raw database failure/)).not.toBeInTheDocument();
    expect(window.navigator.clipboard.writeText).not.toHaveBeenCalled();
  });

  it('says there are no public prompts yet when the list has none', async () => {
    listed = [{ slug: 'mine-private', source: 'own', visibility: 'private' }];
    renderSection();
    expect(await screen.findByText('No public prompts yet.')).toBeInTheDocument();
  });

  it('shows an error with a retry when the list cannot be loaded', async () => {
    listStatus = 502;
    renderSection();
    expect(await screen.findByText('Could not load your prompts. Try again.')).toBeInTheDocument();
    listStatus = 200;
    listed = [{ slug: 'daily-news', source: 'community', visibility: 'public' }];
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByTestId('user-prompt-daily-news')).toBeInTheDocument();
  });
});
