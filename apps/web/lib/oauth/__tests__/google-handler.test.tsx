import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

const mockRefresh = vi.fn();
const mockT = vi.fn((key: string) => key);
const mockOpenOAuthPopup = vi.fn();
const mockWaitForOAuthPopup = vi.fn();
const mockToOAuthErrorMessage = vi.fn((..._args: unknown[]) => 'msg');

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mockRefresh }),
}));

vi.mock('@/lib/i18n/provider', () => ({
  useI18n: () => ({ t: mockT }),
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

import { useYouTubeOAuth } from '@/lib/oauth/google-handler';

function jsonResponse(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => data,
  } as unknown as Response;
}

describe('useYouTubeOAuth', () => {
  const wrapper = ({ children }: { children: ReactNode }) => children;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRefresh.mockResolvedValue(undefined);
    mockOpenOAuthPopup.mockReturnValue({ closed: false });
    mockWaitForOAuthPopup.mockResolvedValue(undefined);
  });

  it('opens popup and refreshes accounts on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({ success: true, auth_url: 'https://accounts.google.com/o/oauth2/auth' }),
      ),
    );

    const { result } = renderHook(() => useYouTubeOAuth(), { wrapper });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();

    await act(async () => {
      await result.current.startOAuth();
    });

    expect(mockOpenOAuthPopup).toHaveBeenCalledWith(
      'https://accounts.google.com/o/oauth2/auth',
      'YouTube OAuth',
    );
    expect(mockWaitForOAuthPopup).toHaveBeenCalled();
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(mockRefresh).toHaveBeenCalledWith({ queryKey: ['youtube-accounts'] });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    vi.unstubAllGlobals();
  });

  it('sets an error when the start response is not successful', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ success: false, error: 'nope' })),
    );
    mockToOAuthErrorMessage.mockReturnValue('Erro: nope');

    const { result } = renderHook(() => useYouTubeOAuth(), { wrapper });

    await act(async () => {
      await result.current.startOAuth();
    });

    expect(mockOpenOAuthPopup).not.toHaveBeenCalled();
    expect(result.current.error).toBe('Erro: nope');
    expect(result.current.isLoading).toBe(false);
    vi.unstubAllGlobals();
  });

  it('sets an error when the popup is blocked', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ success: true, auth_url: 'https://x' })),
    );
    mockOpenOAuthPopup.mockReturnValue(null);
    mockToOAuthErrorMessage.mockReturnValue('Popup bloqueado');

    const { result } = renderHook(() => useYouTubeOAuth(), { wrapper });

    await act(async () => {
      await result.current.startOAuth();
    });

    expect(mockRefresh).not.toHaveBeenCalled();
    expect(result.current.error).toBe('Popup bloqueado');
    expect(result.current.isLoading).toBe(false);
    vi.unstubAllGlobals();
  });

  it('sets an error when waitForOAuthPopup rejects', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ success: true, auth_url: 'https://x' })),
    );
    mockWaitForOAuthPopup.mockRejectedValue(new Error('popup closed'));
    mockToOAuthErrorMessage.mockReturnValue('Janela fechada');

    const { result } = renderHook(() => useYouTubeOAuth(), { wrapper });

    await act(async () => {
      await result.current.startOAuth();
    });

    expect(result.current.error).toBe('Janela fechada');
    expect(result.current.isLoading).toBe(false);
    vi.unstubAllGlobals();
  });

  it('remains typed: allows waiting for state updates', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ success: true, auth_url: 'https://x' })),
    );
    const { result } = renderHook(() => useYouTubeOAuth(), { wrapper });
    expect(result.current).toBeDefined();
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    vi.unstubAllGlobals();
  });
});
