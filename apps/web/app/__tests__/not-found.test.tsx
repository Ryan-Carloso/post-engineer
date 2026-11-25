import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const { getClaims } = vi.hoisted(() => ({ getClaims: vi.fn() }));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({ auth: { getClaims } }),
}));

vi.mock('@/components/ui/app-shell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-shell">{children}</div>
  ),
}));

vi.mock('@/components/not-found-view', () => ({
  NotFoundView: ({ signedIn }: { signedIn: boolean }) => (
    <div data-testid="not-found-view" data-signed-in={String(signedIn)} />
  ),
}));

import NotFound, { metadata } from '../not-found';

async function renderPage(): Promise<void> {
  render(await NotFound());
}

describe('app/not-found', () => {
  beforeEach(() => {
    getClaims.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the signed-in view inside the app shell when the session has a subject', async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: 'user-1' } }, error: null });

    await renderPage();

    expect(screen.getByTestId('app-shell')).toContainElement(screen.getByTestId('not-found-view'));
    expect(screen.getByTestId('not-found-view')).toHaveAttribute('data-signed-in', 'true');
    expect(console.error).not.toHaveBeenCalled();
  });

  it('renders the signed-out view without the app shell when there is no session', async () => {
    getClaims.mockResolvedValue({ data: null, error: null });

    await renderPage();

    expect(screen.queryByTestId('app-shell')).not.toBeInTheDocument();
    expect(screen.getByTestId('not-found-view')).toHaveAttribute('data-signed-in', 'false');
    expect(console.error).not.toHaveBeenCalled();
  });

  it('treats a missing session as signed out without logging it', async () => {
    getClaims.mockResolvedValue({
      data: null,
      error: { name: 'AuthSessionMissingError', status: 400, message: 'Auth session missing!' },
    });

    await renderPage();

    expect(screen.getByTestId('not-found-view')).toHaveAttribute('data-signed-in', 'false');
    expect(console.error).not.toHaveBeenCalled();
  });

  it('treats a claims object without a subject as signed out', async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: '' } }, error: null });

    await renderPage();

    expect(screen.getByTestId('not-found-view')).toHaveAttribute('data-signed-in', 'false');
  });

  it('logs only the name and status of a non-transient auth error as an error and renders signed out', async () => {
    const secret = 'api_key=super-secret-value';
    getClaims.mockResolvedValue({
      data: null,
      error: { name: 'AuthApiError', status: 400, message: secret },
    });

    await renderPage();

    expect(screen.getByTestId('not-found-view')).toHaveAttribute('data-signed-in', 'false');
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith('[not-found] getClaims failed, rendering signed out', {
      name: 'AuthApiError',
      status: 400,
    });
    expect(console.warn).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(secret);
  });

  it.each([
    { name: 'AuthApiError', status: 429 },
    { name: 'AuthApiError', status: 503 },
    { name: 'AuthRetryableFetchError', status: 0 },
  ])('logs a transient auth failure ($name $status) as a warning, not an error', async (failure) => {
    const secret = 'api_key=super-secret-value';
    getClaims.mockResolvedValue({ data: null, error: { ...failure, message: secret } });

    await renderPage();

    expect(screen.getByTestId('not-found-view')).toHaveAttribute('data-signed-in', 'false');
    expect(console.error).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith('[not-found] getClaims failed, rendering signed out', failure);
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain(secret);
  });

  it('keeps the 404 page out of search indexes', () => {
    expect(metadata.robots).toEqual({ index: false });
  });
});
