import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('@/lib/i18n/provider', async () => {
  const { dictionaries } = await import('@/lib/i18n');
  return {
    useI18n: () => ({
      locale: 'en' as const,
      setLocale: vi.fn(),
      t: (key: string, vars?: Record<string, string | number>) => {
        const [section, name] = key.split('.');
        const table = dictionaries.en[section as keyof typeof dictionaries.en] as Record<string, string>;
        const text = table[name] ?? key;
        return vars === undefined ? text : text.replace(/\{(\w+)\}/g, (_m, variable: string) => String(vars[variable]));
      },
    }),
  };
});
vi.mock('@/lib/session-expiry', () => ({ notifyIfSessionExpired: vi.fn() }));
const params = vi.hoisted(() => ({ slug: '' }));
vi.mock('next/navigation', () => ({ useParams: () => params }));

import PromptDetailPage from '../[slug]/page';
import UserPromptRow from '../components/user-prompt-row';

const VERSION_ID = '44444444-4444-4444-8444-444444444444';

let requested: string[];
let reply: { status: number; body: unknown };

function detail(source: 'own' | 'community', visibility: 'private' | 'public', verified = false): Record<string, unknown> {
  return {
    slug: 'luna-spicy-sfw-a-tease',
    title: 'Luna Summer: test A',
    description: 'A/B test A for Luna Summer.',
    prompt: 'Write a curiosity tease hook.',
    body: 'Write a curiosity tease hook.',
    source,
    visibility,
    verified,
    versionId: VERSION_ID,
    version: 3,
  };
}

function renderPage(slug: string): void {
  params.slug = slug;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PromptDetailPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  requested = [];
  reply = { status: 200, body: { success: true, prompt: detail('own', 'private') } };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      requested.push(url);
      return Response.json(reply.body, { status: reply.status });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('prompt detail page for user prompts', () => {
  it('shows an own private prompt with its full text, version and copy block', async () => {
    renderPage('luna-spicy-sfw-a-tease');
    expect(await screen.findByRole('heading', { level: 1, name: 'Luna Summer: test A' })).toBeInTheDocument();
    expect(requested).toEqual(['/api/prompts/luna-spicy-sfw-a-tease']);
    expect(screen.getByText('Private')).toBeInTheDocument();
    expect(screen.getByText('Version 3')).toBeInTheDocument();
    expect(screen.getByText('A/B test A for Luna Summer.')).toBeInTheDocument();
    expect(screen.getByTestId('full-prompt')).toHaveTextContent('Write a curiosity tease hook.');
    expect(screen.queryByText(/not verified by post-engineer/)).not.toBeInTheDocument();
  });

  it('marks a community prompt and warns that it is not verified', async () => {
    reply = { status: 200, body: { success: true, prompt: detail('community', 'public') } };
    renderPage('luna-spicy-sfw-a-tease');
    expect(await screen.findByText('Community')).toBeInTheDocument();
    expect(screen.getByText(/not verified by post-engineer/)).toBeInTheDocument();
    expect(screen.queryByText('Public')).not.toBeInTheDocument();
  });

  it('marks a verified prompt and shows no unverified warning', async () => {
    reply = { status: 200, body: { success: true, prompt: detail('community', 'public', true) } };
    renderPage('luna-spicy-sfw-a-tease');
    expect(await screen.findByText('Verified')).toBeInTheDocument();
    expect(screen.queryByText('Community')).not.toBeInTheDocument();
    expect(screen.queryByText(/not verified by post-engineer/)).not.toBeInTheDocument();
  });

  it('shows not found for an unknown user prompt', async () => {
    reply = { status: 404, body: { success: false, code: 'PROMPT_NOT_FOUND' } };
    renderPage('missing-prompt');
    expect(await screen.findByRole('alert')).toHaveTextContent('This prompt does not exist yet.');
    expect(screen.queryByTestId('full-prompt')).not.toBeInTheDocument();
  });

  it('shows a localized error, not the raw failure, when the load fails', async () => {
    reply = { status: 500, body: { success: false, error: 'Internal database explosion' } };
    renderPage('luna-spicy-sfw-a-tease');
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Try again.');
    expect(screen.queryByText(/explosion/)).not.toBeInTheDocument();
  });

  it('never asks the API for a slug a user prompt cannot have', () => {
    renderPage('Not_A_Slug');
    expect(screen.getByText('This prompt does not exist yet.')).toBeInTheDocument();
    expect(requested).toEqual([]);
  });

  it('loads a slug that once was an official prompt from the API like any other', async () => {
    reply = { status: 200, body: { success: true, prompt: { ...detail('community', 'public'), slug: 'daily-news' } } };
    renderPage('daily-news');
    expect(await screen.findByTestId('full-prompt')).toHaveTextContent('Write a curiosity tease hook.');
    expect(requested).toEqual(['/api/prompts/daily-news']);
  });

});

describe('user prompt card', () => {
  it('links the title to the prompt detail page', () => {
    render(
      <ul>
        <UserPromptRow
          prompt={{ slug: 'luna-spicy-sfw-b-pov', title: 'Luna test B', description: '', source: 'own', visibility: 'private', verified: false }}
          busy={false}
          copied={false}
          onCopy={vi.fn()}
        />
      </ul>,
    );
    const link = screen.getByTestId('user-prompt-link-luna-spicy-sfw-b-pov');
    expect(link).toHaveAttribute('href', '/recipes/luna-spicy-sfw-b-pov');
    expect(link).toHaveTextContent('Luna test B');
  });
});
