import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

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

import PromptVersionHistory from '../components/prompt-version-history';

const ID = (n: number): string => `55555555-5555-4555-8555-55555555555${n}`;
const NOW = new Date().toISOString();
const BODIES: Record<number, string> = {
  1: 'Write a short hook about coffee.',
  2: 'Write a punchy hook about coffee.',
};
const CURRENT_BODY = 'Write a punchy hook about cold coffee.';

function entry(version: number, current = false): Record<string, unknown> {
  const preview = current ? CURRENT_BODY : BODIES[version];
  return {
    versionId: ID(version),
    version,
    title: 'Coffee',
    createdAt: NOW,
    preview,
    previewTruncated: false,
    bodyLength: preview.length,
    current,
  };
}

function versionResponse(version: number): Response {
  return Response.json({
    success: true,
    version: { versionId: ID(version), version, title: 'Coffee', createdAt: NOW, body: BODIES[version], current: false },
  });
}

let urls: string[];
let routes: Record<string, () => Response>;

function renderHistory(currentVersion = 3): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PromptVersionHistory slug="coffee" currentVersion={currentVersion} currentTitle="Coffee" currentBody={CURRENT_BODY} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  urls = [];
  routes = {
    '/api/prompts/coffee/versions': () =>
      Response.json({ success: true, currentVersion: 3, versions: [entry(3, true), entry(2), entry(1)], truncated: false, nextCursor: null }),
    '/api/prompts/coffee/versions/1': () => versionResponse(1),
    '/api/prompts/coffee/versions/2': () => versionResponse(2),
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      urls.push(url);
      const respond = routes[url];
      return respond === undefined ? Response.json({ success: false }, { status: 404 }) : respond();
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function changes(kind: 'added' | 'removed'): string[] {
  return Array.from(screen.getByTestId('text-diff').querySelectorAll(`[data-diff="${kind}"]`)).map((node) => node.textContent ?? '');
}

describe('PromptVersionHistory compare', () => {
  it('compares the previous version with the current text and reads only the previous one', async () => {
    renderHistory();
    fireEvent.click(await screen.findByTestId('prompt-version-compare-open'));
    expect(await screen.findByTestId('text-diff-summary')).toHaveTextContent('+1 words, −0 words');
    expect(changes('added')).toEqual(['cold ']);
    expect(changes('removed')).toEqual([]);
    expect(screen.getByText('Version 2 → version 3')).toBeInTheDocument();
    expect(urls).toEqual(['/api/prompts/coffee/versions', '/api/prompts/coffee/versions/2']);
  });

  it('shows the changes a row introduced against the version before it', async () => {
    renderHistory();
    fireEvent.click(await screen.findByTestId('prompt-version-changes-2'));
    expect(await screen.findByTestId('text-diff-summary')).toHaveTextContent('+1 words, −1 words');
    expect(changes('removed')).toEqual(['short']);
    expect(changes('added')).toEqual(['punchy']);
    expect(screen.getByText('Version 1 → version 2')).toBeInTheDocument();
  });

  it('offers no changes button on the first version', async () => {
    renderHistory();
    await screen.findByTestId('prompt-version-1');
    expect(screen.queryByTestId('prompt-version-changes-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('prompt-version-changes-3')).toBeInTheDocument();
  });

  it('compares any two versions picked in the selects', async () => {
    renderHistory();
    fireEvent.click(await screen.findByTestId('prompt-version-compare-open'));
    const from = await screen.findByTestId<HTMLSelectElement>('prompt-version-compare-from');
    expect(Array.from(from.options).map((option) => option.textContent)).toEqual(['Version 3 (current)', 'Version 2', 'Version 1']);
    fireEvent.change(from, { target: { value: '1' } });
    expect(await screen.findByText('Version 1 → version 3')).toBeInTheDocument();
    expect(await screen.findByTestId('text-diff-summary')).toHaveTextContent('+2 words, −1 words');
    expect(changes('removed')).toEqual(['short']);
  });

  it('says the texts are the same when one version is compared with itself', async () => {
    renderHistory();
    fireEvent.click(await screen.findByTestId('prompt-version-compare-open'));
    fireEvent.change(await screen.findByTestId('prompt-version-compare-from'), { target: { value: '3' } });
    expect(await screen.findByTestId('text-diff-summary')).toHaveTextContent('Both versions have the same text.');
    expect(changes('added')).toEqual([]);
  });

  it('shows a localized error and no diff when a version cannot load', async () => {
    routes['/api/prompts/coffee/versions/2'] = () => Response.json({ success: false, code: 'PROMPT_VERSION_NOT_FOUND', error: 'db exploded' }, { status: 404 });
    renderHistory();
    fireEvent.click(await screen.findByTestId('prompt-version-compare-open'));
    const error = await screen.findByTestId('prompt-version-compare-error');
    expect(error).toHaveTextContent('This version no longer exists.');
    expect(screen.queryByText(/exploded/)).not.toBeInTheDocument();
    expect(screen.queryByTestId('text-diff')).not.toBeInTheDocument();
  });

  it('closes the comparison and offers to open it again', async () => {
    renderHistory();
    fireEvent.click(await screen.findByTestId('prompt-version-compare-open'));
    const panel = await screen.findByTestId('prompt-version-compare');
    fireEvent.click(within(panel).getByTestId('prompt-version-compare-close'));
    expect(screen.queryByTestId('prompt-version-compare')).not.toBeInTheDocument();
    expect(screen.getByTestId('prompt-version-compare-open')).toBeInTheDocument();
  });

  it('offers no comparison while the prompt has a single version', async () => {
    routes['/api/prompts/coffee/versions'] = () =>
      Response.json({ success: true, currentVersion: 1, versions: [entry(1, true)], truncated: false, nextCursor: null });
    renderHistory(1);
    await screen.findByTestId('prompt-version-1');
    expect(screen.queryByTestId('prompt-version-compare-open')).not.toBeInTheDocument();
  });
});
