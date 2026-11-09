import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';

const mockRefresh = vi.fn();
const mockOpenOAuthPopup = vi.fn();
const mockWaitForOAuthPopup = vi.fn();
const mockToOAuthErrorMessage = vi.fn((..._args: unknown[]) => 'msg');

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mockRefresh }),
}));

vi.mock('@/lib/i18n/provider', () => ({
  useI18n: () => ({ t: vi.fn((key: string) => key) }),
}));

vi.mock('@/lib/oauth/popup', () => ({
  OAuthError: class OAuthError extends Error {
    readonly code: string;
    readonly detail?: string;
    constructor(code: string, detail?: string) {
      super(code);
      this.code = code;
      this.detail = detail;
    }
  },
  openOAuthPopup: (...args: unknown[]) => mockOpenOAuthPopup(...args),
  waitForOAuthPopup: (...args: unknown[]) => mockWaitForOAuthPopup(...args),
  toOAuthErrorMessage: (...args: unknown[]) => mockToOAuthErrorMessage(...args),
}));

import { useFacebookOAuth } from '@/lib/oauth/facebook-handler';

function jsonResponse(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => data,
  } as unknown as Response;
}

describe('useFacebookOAuth', () => {
  const wrapper = ({ children }: { children: ReactNode }) => children;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRefresh.mockResolvedValue(undefined);
    mockOpenOAuthPopup.mockReturnValue({ closed: false });
    mockWaitForOAuthPopup.mockResolvedValue(undefined);
  });

  it('starts at the Facebook route, opens the popup and refreshes accounts on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ success: true, auth_url: 'https://www.facebook.com/v23.0/dialog/oauth?x=1' }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useFacebookOAuth(), { wrapper });
    await act(async () => {
      await result.current.startOAuth();
    });

    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/facebook-auth/start');
    expect(mockOpenOAuthPopup).toHaveBeenCalledWith('https://www.facebook.com/v23.0/dialog/oauth?x=1', 'Facebook OAuth');
    expect(mockWaitForOAuthPopup).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        successType: 'facebook-oauth-success',
        errorType: 'facebook-oauth-error',
      }),
    );
    expect(mockRefresh).toHaveBeenCalledWith({ queryKey: ['social-accounts'] });
    expect(result.current.error).toBeNull();
    vi.unstubAllGlobals();
  });

  it('surfaces the popup error and leaves the accounts untouched', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ success: true, auth_url: 'https://x' })));
    mockWaitForOAuthPopup.mockRejectedValue(new Error('No Facebook Pages were found'));
    mockToOAuthErrorMessage.mockReturnValue('Falhou');

    const { result } = renderHook(() => useFacebookOAuth(), { wrapper });
    await act(async () => {
      await result.current.startOAuth();
    });

    expect(result.current.error).toBe('Falhou');
    expect(mockRefresh).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
