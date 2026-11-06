import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';

vi.mock('@/lib/session-expiry', () => ({ notifyIfSessionExpired: vi.fn() }));
vi.mock('@/lib/i18n/provider', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('../popup', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../popup')>();
  // No real window: a blocked popup ends the flow right after the start call.
  return { ...actual, openOAuthPopup: vi.fn(() => null) };
});

import { useOAuthFlow } from '../oauth-flow';
import { notifyIfSessionExpired } from '@/lib/session-expiry';

function wrapper({ children }: { children: ReactNode }): ReactNode {
  return QueryClientProvider({ client: new QueryClient(), children }) as ReactNode;
}

const CONFIG = {
  startUrl: '/api/google-oauth/start',
  popupTitle: 'YouTube',
  successType: 'youtube-oauth-success',
  errorType: 'youtube-oauth-error',
  queryKey: ['social-accounts'] as const,
};

function stubStart(status: number, body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body })),
  );
}

beforeEach(() => {
  vi.mocked(notifyIfSessionExpired).mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useOAuthFlow start step', () => {
  it('joins the session-expiry redirect when the start route answers 401', async () => {
    stubStart(401, { success: false, error: 'Unauthorized' });
    const { result } = renderHook(() => useOAuthFlow(CONFIG), { wrapper });
    await act(async () => {
      await result.current.startOAuth();
    });
    expect(notifyIfSessionExpired).toHaveBeenCalledTimes(1);
    expect(vi.mocked(notifyIfSessionExpired).mock.calls[0][0].status).toBe(401);
    expect(result.current.error).not.toBeNull();
  });

  it('does not notify when the start route succeeds', async () => {
    stubStart(200, { success: true, auth_url: 'https://accounts.google.com/o/oauth2/auth' });
    const { result } = renderHook(() => useOAuthFlow(CONFIG), { wrapper });
    await act(async () => {
      await result.current.startOAuth();
    });
    expect(notifyIfSessionExpired).not.toHaveBeenCalled();
  });
});
