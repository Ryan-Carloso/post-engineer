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

import MyPromptsSection from '../components/my-prompts-section';

interface StoredPrompt {
  slug: string;
  title: string;
  description: string;
  prompt: string;
  source: 'own' | 'community';
  visibility: 'private' | 'public';
  verified: boolean;
  versionId: string;
  version: number;
}

let stored: StoredPrompt[];
let requests: Array<{ method: string; path: string; body: unknown }>;
let nextFailure: { status: number; body: unknown } | null;
let failDetail: boolean;

function own(slug: string, visibility: StoredPrompt['visibility'], extra: Partial<StoredPrompt> = {}): StoredPrompt {
  return { slug, title: `Title ${slug}`, description: `About ${slug}`, prompt: `Text of ${slug}`, source: 'own', visibility, verified: false, versionId: '44444444-4444-4444-8444-444444444444', version: 1, ...extra };
}

function summary(entry: StoredPrompt): Record<string, unknown> {
  const { prompt: _text, versionId: _versionId, version: _version, ...rest } = entry;
  return rest;
}

async function handle(url: string, init: RequestInit | undefined): Promise<Response> {
  const method = init?.method ?? 'GET';
  const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
  requests.push({ method, path: url, body });
  if (nextFailure !== null && method !== 'GET') {
    const failure = nextFailure;
    nextFailure = null;
    return Response.json(failure.body, { status: failure.status });
  }
  if (failDetail && method === 'GET' && url !== '/api/prompts') return Response.json({ success: false }, { status: 500 });
  if (url === '/api/prompts' && method === 'GET') return Response.json({ success: true, prompts: stored.map(summary) });
  if (url === '/api/prompts' && method === 'POST') {
    const draft = body as { slug: string; title: string; description: string; prompt: string; visibility: StoredPrompt['visibility'] };
    const created = own(draft.slug, draft.visibility, { title: draft.title, description: draft.description, prompt: draft.prompt });
    stored.push(created);
    return Response.json({ success: true, prompt: created }, { status: 201 });
  }
  const match = /^\/api\/prompts\/([^/]+)$/.exec(url);
  const entry = match === null ? undefined : stored.find((candidate) => candidate.slug === decodeURIComponent(match[1]));
  if (match === null || entry === undefined) return Response.json({ success: false, code: 'PROMPT_NOT_FOUND' }, { status: 404 });
  if (method === 'PATCH') {
    Object.assign(entry, body);
    return Response.json({ success: true, prompt: entry });
  }
  if (method === 'DELETE') {
    stored = stored.filter((candidate) => candidate !== entry);
    return Response.json({ success: true });
  }
  return Response.json({ success: true, prompt: entry });
}

function renderSection(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MyPromptsSection />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  stored = [];
  requests = [];
  nextFailure = null;
  failDetail = false;
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input, init) => handle(String(input), init)));
  Object.defineProperty(window.navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function fill(label: string, value: string): void {
  fireEvent.change(screen.getByLabelText(new RegExp(label, 'i')), { target: { value } });
}

describe('MyPromptsSection', () => {
  it('shows an empty state when the user has no prompts', async () => {
    renderSection();
    expect(await screen.findByText('You have no prompts yet.')).toBeInTheDocument();
  });

  it('lists the own prompts with their visibility badge', async () => {
    stored = [own('mine', 'private'), own('shared', 'public')];
    renderSection();
    expect(await screen.findByTestId('user-prompt-visibility-mine')).toHaveTextContent('Private');
    expect(screen.getByTestId('user-prompt-visibility-shared')).toHaveTextContent('Public');
  });

  it('creates a prompt, closes the form and shows it as private', async () => {
    renderSection();
    await screen.findByText('You have no prompts yet.');
    fireEvent.click(screen.getByTestId('new-user-prompt-btn'));
    fill('Slug', 'my-prompt');
    fill('Title', 'My prompt');
    fill('What it is for', 'About it');
    fill('Prompt text', 'Write three beats.');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByTestId('user-prompt-my-prompt')).toBeInTheDocument();
    expect(screen.queryByTestId('user-prompt-form')).not.toBeInTheDocument();
    expect(screen.getByTestId('user-prompt-visibility-my-prompt')).toHaveTextContent('Private');
    expect(requests.find((request) => request.method === 'POST')?.body).toEqual({
      slug: 'my-prompt',
      title: 'My prompt',
      description: 'About it',
      prompt: 'Write three beats.',
      visibility: 'private',
    });
  });

  it('creates a public prompt in one step and warns that anyone can read it', async () => {
    renderSection();
    await screen.findByText('You have no prompts yet.');
    fireEvent.click(screen.getByTestId('new-user-prompt-btn'));
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
    fill('Slug', 'open-one');
    fill('Title', 'Open one');
    fill('Prompt text', 'Anyone may read this.');
    fireEvent.click(screen.getByLabelText(/Public: anyone can read and copy it/));
    expect(screen.getByRole('note')).toHaveTextContent('Do not put secrets in it');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByTestId('user-prompt-visibility-open-one')).toHaveTextContent('Public');
    expect(requests.find((request) => request.method === 'POST')?.body).toMatchObject({ visibility: 'public' });
  });

  it('keeps Save disabled until the slug is valid and the title and text are filled', async () => {
    renderSection();
    await screen.findByText('You have no prompts yet.');
    fireEvent.click(screen.getByTestId('new-user-prompt-btn'));
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    fill('Slug', 'Bad Slug');
    fill('Title', 'T');
    fill('Prompt text', 'P');
    expect(save).toBeDisabled();
    fill('Slug', 'good-slug');
    expect(save).toBeEnabled();
  });

  it('shows a localized message, never the raw server error, and keeps the form open when the slug is taken', async () => {
    renderSection();
    await screen.findByText('You have no prompts yet.');
    fireEvent.click(screen.getByTestId('new-user-prompt-btn'));
    fill('Slug', 'taken');
    fill('Title', 'T');
    fill('Prompt text', 'P');
    nextFailure = { status: 409, body: { success: false, error: 'duplicate key value violates', code: 'PROMPT_SLUG_TAKEN' } };
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('You already have a prompt with this slug, or another public prompt uses it.');
    expect(screen.queryByText(/duplicate key/)).not.toBeInTheDocument();
    expect(screen.getByTestId('user-prompt-form')).toBeInTheDocument();
  });

  it('edits a prompt: loads its text, locks the slug and sends only title, description and text', async () => {
    stored = [own('mine', 'private')];
    renderSection();
    const row = await screen.findByTestId('user-prompt-mine');
    fireEvent.click(within(row).getByRole('button', { name: 'Edit' }));
    expect(await screen.findByTestId('user-prompt-form')).toBeInTheDocument();
    expect(screen.getByLabelText(/Slug/)).toBeDisabled();
    expect(screen.getByLabelText(/Prompt text/)).toHaveValue('Text of mine');
    fill('Title', 'Renamed');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByTestId('user-prompt-form')).not.toBeInTheDocument());
    expect(requests.find((request) => request.method === 'PATCH')).toMatchObject({
      path: '/api/prompts/mine',
      body: { title: 'Renamed', description: 'About mine', prompt: 'Text of mine', visibility: 'private' },
    });
    expect(await screen.findByText('Renamed')).toBeInTheDocument();
  });

  it('makes a private prompt public and back to private with the row button, no review in between', async () => {
    stored = [own('mine', 'private')];
    renderSection();
    const row = await screen.findByTestId('user-prompt-mine');
    expect(within(row).queryByRole('button', { name: 'Make private' })).not.toBeInTheDocument();
    fireEvent.click(within(row).getByRole('button', { name: 'Make public' }));
    await waitFor(() => expect(screen.getByTestId('user-prompt-visibility-mine')).toHaveTextContent('Public'));
    expect(requests.find((request) => request.method === 'PATCH')?.body).toEqual({ visibility: 'public' });
    fireEvent.click(within(screen.getByTestId('user-prompt-mine')).getByRole('button', { name: 'Make private' }));
    await waitFor(() => expect(screen.getByTestId('user-prompt-visibility-mine')).toHaveTextContent('Private'));
  });

  it('shows a localized message when making a prompt public fails because the slug is taken', async () => {
    stored = [own('mine', 'private')];
    renderSection();
    const row = await screen.findByTestId('user-prompt-mine');
    nextFailure = { status: 409, body: { success: false, error: 'duplicate key value', code: 'PROMPT_SLUG_TAKEN' } };
    fireEvent.click(within(row).getByRole('button', { name: 'Make public' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('another public prompt uses it');
    expect(screen.getByTestId('user-prompt-visibility-mine')).toHaveTextContent('Private');
  });

  it('deletes only after the user confirms', async () => {
    stored = [own('mine', 'private')];
    const confirm = vi.spyOn(window, 'confirm');
    renderSection();
    const row = await screen.findByTestId('user-prompt-mine');
    confirm.mockReturnValueOnce(false);
    fireEvent.click(within(row).getByRole('button', { name: 'Delete' }));
    expect(requests.some((request) => request.method === 'DELETE')).toBe(false);
    confirm.mockReturnValueOnce(true);
    fireEvent.click(within(row).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByTestId('user-prompt-mine')).not.toBeInTheDocument());
    expect(requests.filter((request) => request.method === 'DELETE')).toHaveLength(1);
  });

  it('copies the full prompt text, fetched on demand, since the list carries no text', async () => {
    stored = [own('mine', 'private')];
    renderSection();
    const row = await screen.findByTestId('user-prompt-mine');
    expect(JSON.stringify(requests)).not.toContain('Text of mine');
    fireEvent.click(within(row).getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(window.navigator.clipboard.writeText).toHaveBeenCalledWith('Text of mine'));
    expect(await within(row).findByRole('button', { name: 'Copied!' })).toBeInTheDocument();
  });

  it('filters the own prompts by what the user types and says when nothing matches', async () => {
    stored = [own('alpha', 'private'), own('beta', 'public')];
    renderSection();
    const box = await screen.findByTestId('user-prompts-search');
    fireEvent.change(box, { target: { value: 'ALPHA' } });
    expect(screen.getByTestId('user-prompt-alpha')).toBeInTheDocument();
    expect(screen.queryByTestId('user-prompt-beta')).not.toBeInTheDocument();
    expect(screen.queryByText('No prompt matches your search.')).not.toBeInTheDocument();
    fireEvent.change(box, { target: { value: 'zzz-nothing' } });
    expect(screen.getByText('No prompt matches your search.')).toBeInTheDocument();
    fireEvent.change(box, { target: { value: '' } });
    expect(screen.getByTestId('user-prompt-beta')).toBeInTheDocument();
  });

  it('leaves community prompts to the public prompts section and hides the search box without own prompts', async () => {
    stored = [own('theirs', 'public', { source: 'community' })];
    renderSection();
    expect(await screen.findByText('You have no prompts yet.')).toBeInTheDocument();
    expect(screen.queryByTestId('user-prompt-theirs')).not.toBeInTheDocument();
    expect(screen.queryByTestId('user-prompts-search')).not.toBeInTheDocument();
  });

  it('shows an error with a retry when the list cannot be loaded', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response('<html>502</html>', { status: 502 })));
    renderSection();
    expect(await screen.findByText('Could not load your prompts. Try again.')).toBeInTheDocument();
    stored = [own('mine', 'private')];
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input, init) => handle(String(input), init)));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByTestId('user-prompt-mine')).toBeInTheDocument();
  });

  it('disables the row actions while a change is in flight', async () => {
    stored = [own('mine', 'private')];
    renderSection();
    const row = await screen.findByTestId('user-prompt-mine');
    let release: (response: Response) => void = () => undefined;
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(() => new Promise<Response>((resolve) => { release = resolve; })));
    fireEvent.click(within(row).getByRole('button', { name: 'Make public' }));
    await waitFor(() => expect(within(row).getByRole('button', { name: 'Edit' })).toBeDisabled());
    expect(within(row).getByRole('button', { name: 'Delete' })).toBeDisabled();
    release(Response.json({ success: true, prompt: own('mine', 'public') }));
  });

  it('shows a localized error and keeps the form closed when the prompt text cannot be loaded for editing', async () => {
    stored = [own('mine', 'private')];
    renderSection();
    const row = await screen.findByTestId('user-prompt-mine');
    failDetail = true;
    fireEvent.click(within(row).getByRole('button', { name: 'Edit' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Try again.');
    expect(screen.queryByTestId('user-prompt-form')).not.toBeInTheDocument();
  });

  it('shows a localized error and copies nothing when the prompt text cannot be loaded for copying', async () => {
    stored = [own('mine', 'private')];
    renderSection();
    const row = await screen.findByTestId('user-prompt-mine');
    failDetail = true;
    fireEvent.click(within(row).getByRole('button', { name: 'Copy' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(window.navigator.clipboard.writeText).not.toHaveBeenCalled();
  });

  it('keeps the prompt and shows an error when deleting fails', async () => {
    stored = [own('mine', 'private')];
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderSection();
    const row = await screen.findByTestId('user-prompt-mine');
    nextFailure = { status: 500, body: { success: false, error: 'internal detail' } };
    fireEvent.click(within(row).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Try again.');
    expect(screen.queryByText(/internal detail/)).not.toBeInTheDocument();
    expect(screen.getByTestId('user-prompt-mine')).toBeInTheDocument();
  });

  it('keeps the edit form open with the error when saving an edit fails, and closes it on Cancel', async () => {
    stored = [own('mine', 'private')];
    renderSection();
    const row = await screen.findByTestId('user-prompt-mine');
    fireEvent.click(within(row).getByRole('button', { name: 'Edit' }));
    await screen.findByTestId('user-prompt-form');
    nextFailure = { status: 429, body: { success: false } };
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many requests');
    expect(screen.getByTestId('user-prompt-form')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByTestId('user-prompt-form')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('locks the new prompt button while the form is open', async () => {
    renderSection();
    await screen.findByText('You have no prompts yet.');
    fireEvent.click(screen.getByTestId('new-user-prompt-btn'));
    expect(screen.getByTestId('new-user-prompt-btn')).toBeDisabled();
  });
});
