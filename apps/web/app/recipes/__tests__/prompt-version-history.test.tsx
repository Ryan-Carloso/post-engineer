import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

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

function entry(version: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    versionId: ID(version),
    version,
    title: 'Current title',
    createdAt: NOW,
    preview: `text of version ${version}`,
    previewTruncated: false,
    bodyLength: 20,
    current: false,
    ...overrides,
  };
}

const PAGE = {
  success: true,
  currentVersion: 3,
  versions: [entry(3, { current: true, preview: 'current text' }), entry(2, { title: 'Old title' }), entry(1)],
  truncated: false,
  nextCursor: null,
};

interface Seen {
  method: string;
  url: string;
  body: unknown;
}

let seen: Seen[];
let routes: Record<string, () => Response | Promise<Response>>;

function route(method: string, url: string, respond: () => Response | Promise<Response>): void {
  routes[`${method} ${url}`] = respond;
}

function renderHistory(props: Partial<{ currentBody: string; currentTitle: string; currentVersion: number }> = {}): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PromptVersionHistory
        slug="my-prompt"
        currentVersion={props.currentVersion ?? 3}
        currentTitle={props.currentTitle ?? 'Current title'}
        currentBody={props.currentBody ?? 'current text'}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  seen = [];
  routes = {};
  route('GET', '/api/prompts/my-prompt/versions', () => Response.json(PAGE));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      seen.push({ method, url, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
      const respond = routes[`${method} ${url}`];
      return respond === undefined ? Response.json({ success: false }, { status: 404 }) : respond();
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('PromptVersionHistory list', () => {
  it('lists the versions newest first and marks the current one', async () => {
    renderHistory();
    const rows = await screen.findAllByTestId(/^prompt-version-\d+$/);
    expect(rows.map((row) => row.getAttribute('data-testid'))).toEqual(['prompt-version-3', 'prompt-version-2', 'prompt-version-1']);
    expect(within(rows[0]).getByText('Version 3')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Current')).toBeInTheDocument();
    expect(within(rows[1]).queryByText('Current')).not.toBeInTheDocument();
    expect(within(rows[1]).getByText('text of version 2')).toBeInTheDocument();
  });

  it('shows the title only on a row whose title differs from the current one', async () => {
    renderHistory();
    expect(await screen.findByText('Title then: Old title')).toBeInTheDocument();
    expect(screen.getAllByText(/Title then:/)).toHaveLength(1);
  });

  it('writes the date as a relative time', async () => {
    renderHistory();
    const row = await screen.findByTestId('prompt-version-2');
    expect(within(row).getByText('now')).toBeInTheDocument();
  });

  it('tells there are no earlier versions when only the current one exists', async () => {
    route('GET', '/api/prompts/my-prompt/versions', () =>
      Response.json({ ...PAGE, currentVersion: 1, versions: [entry(1, { current: true, preview: 'current text' })] }),
    );
    renderHistory({ currentVersion: 1 });
    expect(await screen.findByText(/No earlier versions yet/)).toBeInTheDocument();
  });

  it('shows a localized error and never the raw server text when the list fails', async () => {
    route('GET', '/api/prompts/my-prompt/versions', () => Response.json({ success: false, error: 'Internal database explosion' }, { status: 500 }));
    renderHistory();
    expect(await screen.findByTestId('prompt-version-error')).toHaveTextContent('Something went wrong. Try again.');
    expect(screen.queryByText(/explosion/)).not.toBeInTheDocument();
  });

  it('loads older versions with the cursor and appends them', async () => {
    route('GET', '/api/prompts/my-prompt/versions', () =>
      Response.json({ ...PAGE, versions: [entry(3, { current: true, preview: 'current text' })], truncated: true, nextCursor: 3 }),
    );
    route('GET', '/api/prompts/my-prompt/versions?before=3', () =>
      Response.json({ ...PAGE, versions: [entry(2), entry(1)], truncated: false, nextCursor: null }),
    );
    renderHistory();
    fireEvent.click(await screen.findByTestId('prompt-version-older'));
    await screen.findByTestId('prompt-version-1');
    expect(seen.map((call) => call.url)).toEqual(['/api/prompts/my-prompt/versions', '/api/prompts/my-prompt/versions?before=3']);
    expect(screen.getAllByTestId(/^prompt-version-\d+$/)).toHaveLength(3);
    expect(screen.queryByTestId('prompt-version-older')).not.toBeInTheDocument();
  });

  it('does not offer older versions on the last page', async () => {
    renderHistory();
    await screen.findByTestId('prompt-version-3');
    expect(screen.queryByTestId('prompt-version-older')).not.toBeInTheDocument();
  });
});

describe('PromptVersionHistory full text', () => {
  it('fetches one version when asked to view it, shows its text and hides it again', async () => {
    route('GET', '/api/prompts/my-prompt/versions/2', () =>
      Response.json({ success: true, version: { versionId: ID(2), version: 2, title: 'Old title', createdAt: NOW, body: 'the full text of version two', current: false } }),
    );
    renderHistory();
    fireEvent.click(await screen.findByTestId('prompt-version-toggle-2'));
    expect(await screen.findByTestId('prompt-version-full-2')).toHaveTextContent('the full text of version two');
    expect(seen.map((call) => call.url)).toContain('/api/prompts/my-prompt/versions/2');
    fireEvent.click(screen.getByTestId('prompt-version-toggle-2'));
    expect(screen.queryByTestId('prompt-version-full-2')).not.toBeInTheDocument();
  });

  it('does not fetch a version until it is opened', async () => {
    renderHistory();
    await screen.findByTestId('prompt-version-3');
    expect(seen.map((call) => call.url)).toEqual(['/api/prompts/my-prompt/versions']);
  });

  it('shows a localized error when the full text cannot load', async () => {
    route('GET', '/api/prompts/my-prompt/versions/2', () => Response.json({ success: false, code: 'PROMPT_VERSION_NOT_FOUND' }, { status: 404 }));
    renderHistory();
    fireEvent.click(await screen.findByTestId('prompt-version-toggle-2'));
    expect(await screen.findByTestId('prompt-version-full-error-2')).toHaveTextContent('This version no longer exists.');
  });
});

describe('PromptVersionHistory restore', () => {
  it('offers Restore on old rows, not on the current row', async () => {
    renderHistory();
    await screen.findByTestId('prompt-version-3');
    expect(screen.queryByTestId('prompt-version-restore-3')).not.toBeInTheDocument();
    expect(screen.getByTestId('prompt-version-restore-2')).toBeInTheDocument();
    expect(screen.getByTestId('prompt-version-restore-1')).toBeInTheDocument();
  });

  it('offers no Restore on the current row even when its preview differs from the loaded text', async () => {
    renderHistory({ currentBody: 'a different loaded text' });
    await screen.findByTestId('prompt-version-3');
    expect(screen.queryByTestId('prompt-version-restore-3')).not.toBeInTheDocument();
    expect(screen.getByTestId('prompt-version-restore-2')).toBeInTheDocument();
  });

  it('offers no Restore on an old row whose whole text equals the current text', async () => {
    renderHistory({ currentBody: 'text of version 1' });
    await screen.findByTestId('prompt-version-3');
    expect(screen.queryByTestId('prompt-version-restore-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('prompt-version-restore-2')).toBeInTheDocument();
  });

  it('still offers Restore when the preview is cut, even if the preview matches the start of the current text', async () => {
    route('GET', '/api/prompts/my-prompt/versions', () =>
      Response.json({ ...PAGE, versions: [entry(3, { current: true }), entry(2, { preview: 'text of version 1', previewTruncated: true })] }),
    );
    renderHistory({ currentBody: 'text of version 1' });
    expect(await screen.findByTestId('prompt-version-restore-2')).toBeInTheDocument();
  });

  it('opens a confirmation that names the next version, with focus on Cancel, and Escape closes it', async () => {
    renderHistory();
    fireEvent.click(await screen.findByTestId('prompt-version-restore-1'));
    const dialog = await screen.findByTestId('restore-dialog');
    expect(within(dialog).getByText('Restore version 1?')).toBeInTheDocument();
    expect(within(dialog).getByText('Creates version 4 with this text. The title stays. Experiment results count it as a new prompt.')).toBeInTheDocument();
    expect(screen.getByTestId('restore-cancel-button')).toHaveFocus();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('restore-dialog')).not.toBeInTheDocument());
    expect(seen.some((call) => call.method === 'POST')).toBe(false);
  });

  it('restores with expectedCurrentVersion set to the current version and closes the dialog', async () => {
    route('POST', '/api/prompts/my-prompt/versions/1/restore', () =>
      Response.json({
        success: true,
        restored: true,
        prompt: { slug: 'my-prompt', title: 'Current title', description: '', source: 'own', visibility: 'private', verified: false, prompt: 'x', body: 'x', versionId: ID(4), version: 4 },
      }),
    );
    renderHistory();
    fireEvent.click(await screen.findByTestId('prompt-version-restore-1'));
    fireEvent.click(await screen.findByTestId('restore-confirm-button'));
    await waitFor(() => expect(screen.queryByTestId('restore-dialog')).not.toBeInTheDocument());
    const post = seen.find((call) => call.method === 'POST');
    expect(post).toEqual({ method: 'POST', url: '/api/prompts/my-prompt/versions/1/restore', body: { expectedCurrentVersion: 3 } });
    expect(screen.queryByTestId('prompt-version-notice')).not.toBeInTheDocument();
  });

  it('refreshes the history after a restore that succeeded', async () => {
    route('POST', '/api/prompts/my-prompt/versions/1/restore', () =>
      Response.json({
        success: true,
        restored: true,
        prompt: { slug: 'my-prompt', title: 'Current title', description: '', source: 'own', visibility: 'private', verified: false, prompt: 'x', body: 'x', versionId: ID(4), version: 4 },
      }),
    );
    renderHistory();
    fireEvent.click(await screen.findByTestId('prompt-version-restore-1'));
    fireEvent.click(await screen.findByTestId('restore-confirm-button'));
    await waitFor(() => expect(seen.filter((call) => call.method === 'GET' && call.url.endsWith('/versions'))).toHaveLength(2));
  });

  it('tells the text already was the current one when nothing was restored', async () => {
    route('POST', '/api/prompts/my-prompt/versions/1/restore', () =>
      Response.json({
        success: true,
        restored: false,
        prompt: { slug: 'my-prompt', title: 'Current title', description: '', source: 'own', visibility: 'private', verified: false, prompt: 'x', body: 'x', versionId: ID(3), version: 3 },
      }),
    );
    renderHistory();
    fireEvent.click(await screen.findByTestId('prompt-version-restore-1'));
    fireEvent.click(await screen.findByTestId('restore-confirm-button'));
    const notice = await screen.findByTestId('prompt-version-notice');
    expect(notice).toHaveTextContent('Already the current text.');
    expect(notice).toHaveAttribute('data-tone', 'info');
  });

  it('shows the localized conflict message and reloads the history on a 409', async () => {
    route('POST', '/api/prompts/my-prompt/versions/1/restore', () =>
      Response.json({ success: false, error: 'The prompt changed since you loaded it. Reload and try again.', code: 'PROMPT_VERSION_CONFLICT' }, { status: 409 }),
    );
    renderHistory();
    fireEvent.click(await screen.findByTestId('prompt-version-restore-1'));
    fireEvent.click(await screen.findByTestId('restore-confirm-button'));
    const notice = await screen.findByTestId('prompt-version-notice');
    expect(notice).toHaveTextContent('The prompt changed since you loaded it. The history was reloaded: check it and try again.');
    expect(notice).toHaveAttribute('data-tone', 'error');
    await waitFor(() => expect(seen.filter((call) => call.method === 'GET' && call.url.endsWith('/versions'))).toHaveLength(2));
    expect(screen.queryByTestId('restore-dialog')).not.toBeInTheDocument();
  });

  it('shows a localized message, not the raw error, when the restore fails for another reason', async () => {
    route('POST', '/api/prompts/my-prompt/versions/1/restore', () => Response.json({ success: false, error: 'db exploded' }, { status: 500 }));
    renderHistory();
    fireEvent.click(await screen.findByTestId('prompt-version-restore-1'));
    fireEvent.click(await screen.findByTestId('restore-confirm-button'));
    expect(await screen.findByTestId('prompt-version-notice')).toHaveTextContent('Something went wrong. Try again.');
    expect(screen.queryByText(/exploded/)).not.toBeInTheDocument();
  });

  it('disables every control while the restore is pending', async () => {
    let release: (response: Response) => void = () => undefined;
    route('POST', '/api/prompts/my-prompt/versions/1/restore', () => new Promise<Response>((resolve) => { release = resolve; }));
    route('GET', '/api/prompts/my-prompt/versions', () =>
      Response.json({ ...PAGE, truncated: true, nextCursor: 1 }),
    );
    renderHistory();
    fireEvent.click(await screen.findByTestId('prompt-version-restore-1'));
    fireEvent.click(await screen.findByTestId('restore-confirm-button'));
    await waitFor(() => expect(screen.getByTestId('restore-confirm-button')).toBeDisabled());
    expect(screen.getByTestId('restore-cancel-button')).toBeDisabled();
    expect(screen.getByTestId('prompt-version-restore-2')).toBeDisabled();
    expect(screen.getByTestId('prompt-version-older')).toBeDisabled();
    expect(screen.getByTestId('prompt-version-toggle-2')).toBeDisabled();
    await act(async () => {
      release(Response.json({ success: false }, { status: 500 }));
    });
    await screen.findByTestId('prompt-version-notice');
    expect(screen.getByTestId('prompt-version-restore-2')).not.toBeDisabled();
  });
});
