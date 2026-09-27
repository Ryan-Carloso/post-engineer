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

import { useInstagramOAuth } from '@/lib/oauth/instagram-handler';

function jsonResponse(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => data,
  } as unknown as Response;
}

describe('useInstagramOAuth', () => {
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
        jsonResponse({ success: true, auth_url: 'https://api.instagram.com/oauth' }),
      ),
    );

    const { result } = renderHook(() => useInstagramOAuth(), { wrapper });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();

    await act(async () => {
      await result.current.startOAuth();
    });

    expect(mockOpenOAuthPopup).toHaveBeenCalledWith(
      'https://api.instagram.com/oauth',
      'Instagram OAuth',
    );
    expect(mockWaitForOAuthPopup).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        successType: 'instagram-oauth-success',
        errorType: 'instagram-oauth-error',
      }),
    );
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(mockRefresh).toHaveBeenCalledWith({ queryKey: ['instagram-accounts'] });
    expect(result.current.error).toBeNull();
    vi.unstubAllGlobals();
  });

  it('sets an error when the start response is not successful', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ success: false, error: 'no' })),
    );
    mockToOAuthErrorMessage.mockReturnValue('Falhou');

    const { result } = renderHook(() => useInstagramOAuth(), { wrapper });

    await act(async () => {
      await result.current.startOAuth();
    });

    expect(mockOpenOAuthPopup).not.toHaveBeenCalled();
    expect(result.current.error).toBe('Falhou');
    vi.unstubAllGlobals();
  });

  it('sets an error when the popup is blocked', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ success: true, auth_url: 'https://x' })),
    );
    mockOpenOAuthPopup.mockReturnValue(null);
    mockToOAuthErrorMessage.mockReturnValue('Bloqueado');

    const { result } = renderHook(() => useInstagramOAuth(), { wrapper });

    await act(async () => {
      await result.current.startOAuth();
    });

    expect(mockRefresh).not.toHaveBeenCalled();
    expect(result.current.error).toBe('Bloqueado');
    vi.unstubAllGlobals();
  });

  it('sets an error when waitForOAuthPopup rejects', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ success: true, auth_url: 'https://x' })),
    );
    mockWaitForOAuthPopup.mockRejectedValue(new Error('closed'));
    mockToOAuthErrorMessage.mockReturnValue('Fechada');

    const { result } = renderHook(() => useInstagramOAuth(), { wrapper });

    await act(async () => {
      await result.current.startOAuth();
    });

    expect(result.current.error).toBe('Fechada');
    expect(result.current.isLoading).toBe(false);
    vi.unstubAllGlobals();
  });
});
