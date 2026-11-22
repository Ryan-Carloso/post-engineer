import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import ShareLinksSection from '@/components/ui/share-links-section';
import { I18nProvider } from '@/lib/i18n/provider';
import { STORAGE_KEY } from '@/lib/i18n/types';

vi.mock('@/lib/api', () => ({ usePersonasQuery: vi.fn() }));

import { usePersonasQuery } from '@/lib/api';

const LINK_ID = '33333333-3333-4333-8333-333333333333';
const PERSONA = '22222222-2222-4222-8222-222222222222';
const TOKEN = 'a'.repeat(43);

interface FetchPlan {
  list?: unknown[];
  listStatus?: number;
  create?: { status: number; body: unknown };
  revoke?: { status: number; body: unknown };
}

function link(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: LINK_ID,
    personaIds: null,
    createdAt: '2026-11-20T10:00:00.000Z',
    expiresAt: null,
    revokedAt: null,
    lastViewedAt: null,
    ...overrides,
  };
}

function installFetch(plan: FetchPlan): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (url === '/api/share-links' && method === 'GET') {
      return new Response(JSON.stringify({ success: true, links: plan.list ?? [] }), { status: plan.listStatus ?? 200 });
    }
    if (url === '/api/share-links' && method === 'POST') {
      const create = plan.create ?? { status: 500, body: {} };
      return new Response(JSON.stringify(create.body), { status: create.status });
    }
    const revoke = plan.revoke ?? { status: 500, body: {} };
    return new Response(JSON.stringify(revoke.body), { status: revoke.status });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderSection(locale: 'en' | 'pt' = 'en'): void {
  window.localStorage.setItem(STORAGE_KEY, locale);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }): ReactNode => (
    <QueryClientProvider client={client}>
      <I18nProvider>{children}</I18nProvider>
    </QueryClientProvider>
  );
  render(<ShareLinksSection />, { wrapper });
}

const CREATED = {
  success: true,
  id: LINK_ID,
  token: TOKEN,
  path: `/s/${TOKEN}`,
  url: `https://post-engineer.com/s/${TOKEN}`,
  personaIds: null,
  createdAt: '2026-11-22T00:00:00.000Z',
  expiresAt: null,
};

describe('ShareLinksSection', () => {
  beforeEach(() => {
    vi.mocked(usePersonasQuery).mockReturnValue({ data: [{ id: PERSONA, name: 'Maria' }] } as unknown as ReturnType<typeof usePersonasQuery>);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it('shows the empty state in English', async () => {
    installFetch({ list: [] });
    renderSection('en');
    expect(await screen.findByTestId('share-links-empty-state')).toHaveTextContent('No links yet');
    expect(screen.getByRole('heading', { name: 'Public link' })).toBeInTheDocument();
  });

  it('shows the empty state in Portuguese', async () => {
    installFetch({ list: [] });
    renderSection('pt');
    expect(await screen.findByText('Nenhum link criado')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Link público' })).toBeInTheDocument();
  });

  it('shows the load error and no list when the request fails', async () => {
    installFetch({ listStatus: 500 });
    renderSection('en');
    expect(await screen.findByText('Could not load your links. Try again in a moment.')).toBeInTheDocument();
  });

  it('creates a link, shows the full url once and offers it to copy', async () => {
    const fetchMock = installFetch({ create: { status: 201, body: CREATED } });
    renderSection('en');
    await screen.findByTestId('share-links-empty-state');
    fireEvent.click(screen.getByTestId('create-share-link-btn'));
    const input = (await screen.findByTestId('share-link-url')) as HTMLInputElement;
    expect(input.value).toBe(`${window.location.origin}/s/${TOKEN}`);
    expect(screen.getByText('Copy it now: for safety, this link will not be shown again.')).toBeInTheDocument();
    const post = fetchMock.mock.calls.find((call) => (call[1] as RequestInit | undefined)?.method === 'POST');
    expect(JSON.parse((post?.[1] as RequestInit).body as string)).toEqual({});
  });

  it('sends the chosen persona as the link scope', async () => {
    const fetchMock = installFetch({ create: { status: 201, body: { ...CREATED, personaIds: [PERSONA] } } });
    renderSection('en');
    await screen.findByTestId('share-links-empty-state');
    fireEvent.change(screen.getByTestId('share-link-persona'), { target: { value: PERSONA } });
    fireEvent.click(screen.getByTestId('create-share-link-btn'));
    await screen.findByTestId('share-link-url');
    const post = fetchMock.mock.calls.find((call) => (call[1] as RequestInit | undefined)?.method === 'POST');
    expect(JSON.parse((post?.[1] as RequestInit).body as string)).toEqual({ personaIds: [PERSONA] });
  });

  it('shows the localized limit message with the number on a 409', async () => {
    installFetch({ create: { status: 409, body: { success: false, code: 'SHARE_LINK_LIMIT' } } });
    renderSection('pt');
    await screen.findByText('Nenhum link criado');
    fireEvent.click(screen.getByTestId('create-share-link-btn'));
    expect(await screen.findByTestId('share-links-error')).toHaveTextContent('Você já tem 10 links ativos. Revogue um antes de criar outro.');
    expect(screen.queryByTestId('share-link-url')).not.toBeInTheDocument();
  });

  it('shows a localized generic message, never the raw server error, on any other failure', async () => {
    installFetch({ create: { status: 500, body: { success: false, error: 'relation share_links does not exist' } } });
    renderSection('en');
    await screen.findByTestId('share-links-empty-state');
    fireEvent.click(screen.getByTestId('create-share-link-btn'));
    const alert = await screen.findByTestId('share-links-error');
    expect(alert).toHaveTextContent('Could not create the link. Try again.');
    expect(alert).not.toHaveTextContent('relation');
  });

  it('shows a localized generic message when the network fails', async () => {
    installFetch({});
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'GET') return new Response(JSON.stringify({ success: true, links: [] }));
      throw new TypeError('Failed to fetch');
    }));
    renderSection('en');
    await screen.findByTestId('share-links-empty-state');
    fireEvent.click(screen.getByTestId('create-share-link-btn'));
    const alert = await screen.findByTestId('share-links-error');
    expect(alert).toHaveTextContent('Could not create the link. Try again.');
    expect(alert).not.toHaveTextContent('Failed to fetch');
  });

  it('lists links with their scope, status, expiry and last view', async () => {
    installFetch({
      list: [
        link({ personaIds: [PERSONA], lastViewedAt: '2026-11-21T10:00:00.000Z', expiresAt: '2099-01-01T00:00:00.000Z' }),
        link({ id: 'revoked-1', revokedAt: '2026-11-21T00:00:00.000Z' }),
        link({ id: 'expired-1', expiresAt: '2020-01-01T00:00:00.000Z' }),
      ],
    });
    renderSection('en');
    const active = await screen.findByTestId(`share-link-row-${LINK_ID}`);
    expect(within(active).getByText('1 persona(s)')).toBeInTheDocument();
    expect(within(active).getByText('Active')).toBeInTheDocument();
    expect(within(active).getByText(/Last opened:/)).toBeInTheDocument();
    expect(within(active).getByText(/Expires/)).toBeInTheDocument();
    expect(within(screen.getByTestId('share-link-row-revoked-1')).getByText('Revoked')).toBeInTheDocument();
    expect(within(screen.getByTestId('share-link-row-expired-1')).getByText('Expired')).toBeInTheDocument();
    expect(within(screen.getByTestId('share-link-row-revoked-1')).getByText('Never opened')).toBeInTheDocument();
  });

  it('offers revoke only on an active link', async () => {
    installFetch({ list: [link(), link({ id: 'revoked-1', revokedAt: '2026-11-21T00:00:00.000Z' }), link({ id: 'expired-1', expiresAt: '2020-01-01T00:00:00.000Z' })] });
    renderSection('en');
    await screen.findByTestId(`share-link-row-${LINK_ID}`);
    expect(screen.getByTestId(`revoke-share-link-btn-${LINK_ID}`)).toBeInTheDocument();
    expect(screen.queryByTestId('revoke-share-link-btn-revoked-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('revoke-share-link-btn-expired-1')).not.toBeInTheDocument();
  });

  it('asks for confirmation, then revokes and refreshes the list', async () => {
    const fetchMock = installFetch({ list: [link()], revoke: { status: 200, body: { success: true, alreadyRevoked: false } } });
    renderSection('en');
    fireEvent.click(await screen.findByTestId(`revoke-share-link-btn-${LINK_ID}`));
    const dialog = await screen.findByTestId('disconnect-dialog');
    expect(dialog).toHaveTextContent('Revoke this link?');
    expect(dialog).toHaveTextContent('Anyone with the link loses access right away. This cannot be undone.');
    expect(fetchMock.mock.calls.some((call) => (call[1] as RequestInit | undefined)?.method === 'DELETE')).toBe(false);
    fireEvent.click(screen.getByTestId('disconnect-confirm-button'));
    await waitFor(() => {
      expect(fetchMock.mock.calls.filter((call) => (call[1] as RequestInit | undefined)?.method === 'DELETE')).toHaveLength(1);
    });
    expect(fetchMock.mock.calls.find((call) => (call[1] as RequestInit | undefined)?.method === 'DELETE')?.[0]).toBe(`/api/share-links/${LINK_ID}`);
    await waitFor(() => expect(screen.queryByTestId('disconnect-dialog')).not.toBeInTheDocument());
    await waitFor(() => {
      expect(fetchMock.mock.calls.filter((call) => (call[1] as RequestInit | undefined)?.method === undefined).length).toBeGreaterThan(1);
    });
  });

  it('cancels the revoke dialog without sending anything', async () => {
    const fetchMock = installFetch({ list: [link()] });
    renderSection('en');
    fireEvent.click(await screen.findByTestId(`revoke-share-link-btn-${LINK_ID}`));
    fireEvent.click(await screen.findByTestId('disconnect-cancel-button'));
    await waitFor(() => expect(screen.queryByTestId('disconnect-dialog')).not.toBeInTheDocument());
    expect(fetchMock.mock.calls.some((call) => (call[1] as RequestInit | undefined)?.method === 'DELETE')).toBe(false);
  });

  it('shows a localized message and keeps the link listed when the revoke fails', async () => {
    installFetch({ list: [link()], revoke: { status: 500, body: { success: false, error: 'internal boom' } } });
    renderSection('pt');
    fireEvent.click(await screen.findByTestId(`revoke-share-link-btn-${LINK_ID}`));
    fireEvent.click(await screen.findByTestId('disconnect-confirm-button'));
    const alert = await screen.findByTestId('share-links-error');
    expect(alert).toHaveTextContent('Não foi possível revogar o link. Tente novamente.');
    expect(alert).not.toHaveTextContent('boom');
    expect(screen.getByTestId(`share-link-row-${LINK_ID}`)).toBeInTheDocument();
  });

  it('disables the create button and the persona select while a link is being created', async () => {
    installFetch({ list: [] });
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) =>
      (init?.method ?? 'GET') === 'GET'
        ? Promise.resolve(new Response(JSON.stringify({ success: true, links: [] })))
        : new Promise<Response>(() => undefined),
    ));
    renderSection('en');
    await screen.findByTestId('share-links-empty-state');
    fireEvent.click(screen.getByTestId('create-share-link-btn'));
    await waitFor(() => expect(screen.getByTestId('create-share-link-btn')).toBeDisabled());
    expect(screen.getByTestId('share-link-persona')).toBeDisabled();
  });

  it('closes the revoke dialog with Escape', async () => {
    installFetch({ list: [link()] });
    renderSection('en');
    fireEvent.click(await screen.findByTestId(`revoke-share-link-btn-${LINK_ID}`));
    const dialog = await screen.findByTestId('disconnect-dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('disconnect-dialog')).not.toBeInTheDocument());
  });
});
