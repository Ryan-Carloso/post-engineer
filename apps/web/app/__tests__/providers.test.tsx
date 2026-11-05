import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { useQueryClient } from '@tanstack/react-query';
import Providers from '../providers';
import { shouldRetryQuery } from '@/lib/query-retry';
import { HttpStatusError } from '@/lib/errors';
import { useScheduleStatusQuery } from '@/lib/api';

// Only the redirect handler is doubled: the assertions check that Providers
// wires every query error into lib/session-expiry, not the redirect itself.
vi.mock('@/lib/session-expiry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/session-expiry')>();
  return {
    ...actual,
    handleSessionExpiredError: vi.fn(),
  };
});

// lib/api imports the browser supabase client; no test here exercises auth.
vi.mock('@/lib/supabase/client', () => ({
  createSupabaseClient: () => ({ auth: { getSession: vi.fn() } }),
}));

import { handleSessionExpiredError } from '@/lib/session-expiry';

function response(status: number, body: unknown = { success: false, error: 'nope' }): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

describe('app/providers — Providers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders children inside providers', () => {
    render(
      <Providers>
        <span data-testid="inner">content</span>
      </Providers>,
    );
    expect(screen.getByTestId('inner')).toHaveTextContent('content');
  });

  it('wraps children in QueryClientProvider', () => {
    const { container } = render(
      <Providers>
        <div>test</div>
      </Providers>,
    );
    expect(container.textContent).toBe('test');
  });

  it('uses the no-4xx-retry policy as the default query retry (issue #385)', () => {
    let retry: unknown;
    function ReadDefaults(): null {
      retry = useQueryClient().getDefaultOptions().queries?.retry;
      return null;
    }
    render(
      <Providers>
        <ReadDefaults />
      </Providers>,
    );
    expect(retry).toBe(shouldRetryQuery);
  });

  it('routes a 401 query error through handleSessionExpiredError (session-expiry wiring)', async () => {
    const handler = vi.mocked(handleSessionExpiredError);
    handler.mockClear();
    vi.stubGlobal('fetch', vi.fn(async () => response(401)));

    function Dashboard(): null {
      useScheduleStatusQuery();
      return null;
    }
    render(
      <Providers>
        <Dashboard />
      </Providers>,
    );

    await waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    const error = handler.mock.calls[0]?.[0];
    expect(error).toBeInstanceOf(HttpStatusError);
    expect((error as HttpStatusError).status).toBe(401);
  });
});
