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

import PromptReviewPage from '../page';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

interface QueueEntry {
  id: string;
  slug: string;
  title: string;
  description: string;
  prompt: string;
  contentHash: string;
  authorId: string;
  requestedAt: string;
}

function entry(slug: string, hash: string, prompt = `Full text of ${slug}`): QueueEntry {
  return {
    id: `00000000-0000-4000-8000-00000000000${slug.length}`,
    slug,
    title: `Title ${slug}`,
    description: `About ${slug}`,
    prompt,
    contentHash: hash,
    authorId: 'author-1',
    requestedAt: '2026-11-20T00:00:00Z',
  };
}

let queue: QueueEntry[];
let truncated: boolean;
let queueStatus: number;
let reviewStatus: number;
let reviewBody: unknown;
let requests: Array<{ method: string; path: string; body: unknown }>;

beforeEach(() => {
  queue = [entry('waiting', HASH_A)];
  truncated = false;
  queueStatus = 200;
  reviewStatus = 200;
  reviewBody = { success: true, slug: 'waiting', status: 'approved' };
  requests = [];
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input, init) => {
      const method = init?.method ?? 'GET';
      requests.push({ method, path: String(input), body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
      if (method === 'GET') {
        if (queueStatus !== 200) return Response.json({ success: false, code: 'PROMPT_REVIEWER_REQUIRED' }, { status: queueStatus });
        return Response.json({ success: true, truncated, prompts: queue });
      }
      return Response.json(reviewBody, { status: reviewStatus });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderPage(): void {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PromptReviewPage />
    </QueryClientProvider>,
  );
}

describe('prompt review page', () => {
  it('shows the whole text of every waiting prompt with its author', async () => {
    queue = [entry('waiting', HASH_A, 'Line one\nLine two\nLine three')];
    renderPage();
    const card = await screen.findByTestId('prompt-review-waiting');
    expect(within(card).getByTestId('prompt-review-text-waiting').textContent).toBe('Line one\nLine two\nLine three');
    expect(within(card).getByText('Author: author-1')).toBeInTheDocument();
  });

  it('approves with the content hash that was displayed and reloads the queue', async () => {
    renderPage();
    const card = await screen.findByTestId('prompt-review-waiting');
    queue = [];
    fireEvent.click(within(card).getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('Decision saved.')).toBeInTheDocument();
    const decision = requests.find((request) => request.method === 'POST');
    expect(decision?.body).toEqual({ decision: 'approve', contentHash: HASH_A });
    expect(decision?.path).toBe('/api/admin/prompts/00000000-0000-4000-8000-000000000007/review');
    expect(await screen.findByText('Nothing is waiting for review.')).toBeInTheDocument();
  });

  it('will not send a rejection without a reason', async () => {
    renderPage();
    const card = await screen.findByTestId('prompt-review-waiting');
    fireEvent.click(within(card).getByRole('button', { name: 'Reject' }));
    const send = within(card).getByRole('button', { name: 'Send rejection' });
    expect(send).toBeDisabled();
    fireEvent.change(within(card).getByLabelText(/Reason for the owner/), { target: { value: '   ' } });
    expect(send).toBeDisabled();
    fireEvent.change(within(card).getByLabelText(/Reason for the owner/), { target: { value: 'Too vague' } });
    expect(send).toBeEnabled();
    expect(requests.some((request) => request.method === 'POST')).toBe(false);
  });

  it('rejects with the trimmed reason and the displayed content hash', async () => {
    reviewBody = { success: true, slug: 'waiting', status: 'rejected' };
    renderPage();
    const card = await screen.findByTestId('prompt-review-waiting');
    fireEvent.click(within(card).getByRole('button', { name: 'Reject' }));
    fireEvent.change(within(card).getByLabelText(/Reason for the owner/), { target: { value: '  Too vague  ' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Send rejection' }));
    await screen.findByText('Decision saved.');
    expect(requests.find((request) => request.method === 'POST')?.body).toEqual({ decision: 'reject', contentHash: HASH_A, reason: 'Too vague' });
  });

  it('tells the reviewer to read again, and shows the new text, when the prompt changed under them', async () => {
    reviewStatus = 409;
    reviewBody = { success: false, code: 'PROMPT_REVIEW_STALE', error: 'stale' };
    renderPage();
    const card = await screen.findByTestId('prompt-review-waiting');
    queue = [entry('waiting', HASH_B, 'Edited text the reviewer has not read')];
    fireEvent.click(within(card).getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('This prompt changed or was already reviewed. The list was reloaded.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('prompt-review-text-waiting').textContent).toBe('Edited text the reviewer has not read'));
    expect(requests.filter((request) => request.method === 'GET').length).toBeGreaterThanOrEqual(2);
  });

  it('shows a localized message for any other failure, not the server text', async () => {
    reviewStatus = 500;
    reviewBody = { success: false, error: 'relation user_prompts does not exist' };
    renderPage();
    const card = await screen.findByTestId('prompt-review-waiting');
    fireEvent.click(within(card).getByRole('button', { name: 'Approve' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Try again.');
    expect(screen.queryByText(/relation user_prompts/)).not.toBeInTheDocument();
  });

  it('tells a user who is not a reviewer so, and shows no prompt', async () => {
    queueStatus = 403;
    renderPage();
    expect(await screen.findByText('Only prompt reviewers can open this page.')).toBeInTheDocument();
    expect(screen.queryByTestId('prompt-review-waiting')).not.toBeInTheDocument();
  });

  it('shows an empty state and a truncation notice when the queue is longer than the list', async () => {
    queue = [];
    truncated = true;
    renderPage();
    expect(await screen.findByText('Nothing is waiting for review.')).toBeInTheDocument();
    expect(screen.getByText('There are more prompts waiting than this list shows. Review these first.')).toBeInTheDocument();
  });

  it('disables every decision button while a decision is being saved', async () => {
    queue = [entry('waiting', HASH_A), entry('second-one', HASH_B)];
    renderPage();
    const card = await screen.findByTestId('prompt-review-waiting');
    let release: (response: Response) => void = () => undefined;
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(() => new Promise<Response>((resolve) => { release = resolve; })));
    fireEvent.click(within(card).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(within(screen.getByTestId('prompt-review-second-one')).getByRole('button', { name: 'Approve' })).toBeDisabled());
    release(Response.json({ success: true, slug: 'waiting', status: 'approved' }));
  });
});
