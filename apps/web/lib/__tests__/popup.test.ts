import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  OAuthError,
  toOAuthErrorMessage,
  openOAuthPopup,
  waitForOAuthPopup,
} from '@/lib/oauth/popup';
import type { TranslateFunction } from '@/lib/oauth/popup';

//---------------
// popup.ts — OAuthError, messages, window and callback messages
//---------------

const t: TranslateFunction = (key, vars) =>
  vars ? `${key}:${JSON.stringify(vars)}` : key;

describe('oauth/popup', () => {
  it('OAuthError carrega code e detail', () => {
    const err = new OAuthError('popup-blocked', 'bloqueado');
    expect(err.name).toBe('OAuthError');
    expect(err.code).toBe('popup-blocked');
    expect(err.detail).toBe('bloqueado');
    expect(err.message).toBe('popup-blocked');
  });

  it('toOAuthErrorMessage prioriza o detail', () => {
    expect(toOAuthErrorMessage(new OAuthError('oauth-failed', 'detalhe'), t)).toBe('detalhe');
  });

  it('toOAuthErrorMessage translates each code', () => {
    expect(toOAuthErrorMessage(new OAuthError('start-failed'), t)).toBe('oauth.startFailed');
    expect(toOAuthErrorMessage(new OAuthError('popup-blocked'), t)).toBe('oauth.popupBlocked');
    expect(toOAuthErrorMessage(new OAuthError('popup-closed'), t)).toBe('oauth.popupClosed');
    expect(toOAuthErrorMessage(new OAuthError('oauth-failed'), t)).toBe('oauth.failed');
  });

  it('toOAuthErrorMessage uses a generic fallback for common errors', () => {
    expect(toOAuthErrorMessage(new Error('qualquer'), t)).toBe('oauth.failed');
    expect(toOAuthErrorMessage('string', t)).toBe('oauth.failed');
  });

  describe('openOAuthPopup', () => {
    const openMock = vi.fn();

    beforeEach(() => {
      openMock.mockReset();
      vi.stubGlobal('window', {
        innerWidth: 1200,
        innerHeight: 900,
        open: openMock,
        location: { origin: 'http://localhost' },
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('abre janela centralizada', () => {
      const fakeWindow = { closed: false, close: vi.fn() };
      openMock.mockReturnValue(fakeWindow);

      const popup = openOAuthPopup('http://auth', 'oauth');

      expect(popup).toBe(fakeWindow);
      expect(openMock).toHaveBeenCalledWith(
        'http://auth',
        'oauth',
        'width=600,height=700,left=300,top=100,scrollbars=yes,resizable=yes'
      );
    });

    it('returns null when the popup blocker prevents the window', () => {
      openMock.mockReturnValue(null);
      expect(openOAuthPopup('http://auth', 'oauth')).toBeNull();
    });
  });

  describe('waitForOAuthPopup', () => {
    let listeners: ((event: MessageEvent) => void)[];
    let fakePopup: { closed: boolean; close: () => void };

    function dispatch(event: Partial<MessageEvent>): void {
      for (const listener of listeners) {
        listener(event as MessageEvent);
      }
    }

    beforeEach(() => {
      listeners = [];
      fakePopup = { closed: false, close: vi.fn() };
      vi.stubGlobal('window', {
        innerWidth: 1200,
        innerHeight: 900,
        open: vi.fn(),
        location: { origin: 'http://localhost' },
        addEventListener: (_: string, handler: (event: MessageEvent) => void) => {
          listeners.push(handler);
        },
        removeEventListener: vi.fn(),
      });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('resolves on a success message and closes the popup', async () => {
      const promise = waitForOAuthPopup(fakePopup as unknown as Window, {
        successType: 'oauth:success',
        errorType: 'oauth:error',
      });

      dispatch({ origin: 'http://localhost', data: { type: 'oauth:success' } });
      await expect(promise).resolves.toBeUndefined();
      expect(fakePopup.close).toHaveBeenCalled();
    });

    it('rejects with the detail in the error message', async () => {
      const promise = waitForOAuthPopup(fakePopup as unknown as Window, {
        successType: 'oauth:success',
        errorType: 'oauth:error',
      });

      dispatch({
        origin: 'http://localhost',
        data: { type: 'oauth:error', error: 'it failed anyway' },
      });

      await expect(promise).rejects.toMatchObject({
        code: 'oauth-failed',
        detail: 'it failed anyway',
      });
      expect(fakePopup.close).toHaveBeenCalled();
    });

    it('ignora mensagens de outra origem', async () => {
      const promise = waitForOAuthPopup(fakePopup as unknown as Window, {
        successType: 'oauth:success',
        errorType: 'oauth:error',
      });

      dispatch({ origin: 'http://evil', data: { type: 'oauth:success' } });

      const outcome = await Promise.race([promise, new Promise((r) => setTimeout(r, 20, 'pending'))]);
      expect(outcome).toBe('pending');
    });

    it('ignores a null message', async () => {
      const promise = waitForOAuthPopup(fakePopup as unknown as Window, {
        successType: 'oauth:success',
        errorType: 'oauth:error',
      });

      dispatch({ origin: 'http://localhost', data: null });

      const outcome1 = await Promise.race([promise, new Promise((r) => setTimeout(r, 20, 'pending'))]);
      expect(outcome1).toBe('pending');
    });

    it('ignora tipos desconhecidos', async () => {
      const promise = waitForOAuthPopup(fakePopup as unknown as Window, {
        successType: 'oauth:success',
        errorType: 'oauth:error',
      });

      dispatch({ origin: 'http://localhost', data: { type: 'other' } });

      const outcome = await Promise.race([promise, new Promise((r) => setTimeout(r, 20, 'pending'))]);
      expect(outcome).toBe('pending');
    });

    it('rejects with popup-closed when the window closes', async () => {
      vi.useFakeTimers();
      try {
        const promise = waitForOAuthPopup(fakePopup as unknown as Window, {
          successType: 'oauth:success',
          errorType: 'oauth:error',
        });

        fakePopup.closed = true;
        vi.advanceTimersByTime(1100);

        await expect(promise).rejects.toMatchObject({ code: 'popup-closed' });
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
