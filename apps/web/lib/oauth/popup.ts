'use client';

import type { TranslationKey } from '@/lib/i18n';

//---------------
// OAuthErrorCode — typed codes for OAuth flow errors on the client.
// Each code has its own translation in i18n (`oauth` section).
//---------------

export type OAuthErrorCode =
  | 'start-failed'
  | 'popup-blocked'
  | 'popup-closed'
  | 'oauth-failed';

//---------------
// OAuthError — typed flow error. `detail` carries the original message
// (server or popup error) and is preferably displayed when present.
//---------------

export class OAuthError extends Error {
  readonly code: OAuthErrorCode;
  readonly detail?: string;

  constructor(code: OAuthErrorCode, detail?: string) {
    super(code);
    this.name = 'OAuthError';
    this.code = code;
    this.detail = detail;
  }
}

//---------------
// TranslateFunction — signature of useI18n's `t`, used by the translator
//---------------

export type TranslateFunction = (
  key: TranslationKey,
  vars?: Record<string, string | number>
) => string;

//---------------
// toOAuthErrorMessage — converts the captured error into a translated message.
// Detail messages (server/popup) take priority over the i18n fallback.
//---------------

export function toOAuthErrorMessage(
  err: unknown,
  t: TranslateFunction
): string {
  if (err instanceof OAuthError) {
    if (err.detail) return err.detail;
    switch (err.code) {
      case 'start-failed':
        return t('oauth.startFailed');
      case 'popup-blocked':
        return t('oauth.popupBlocked');
      case 'popup-closed':
        return t('oauth.popupClosed');
      case 'oauth-failed':
        return t('oauth.failed');
    }
  }
  return t('oauth.failed');
}

//---------------
// openOAuthPopup — opens the provider window centered on screen
//---------------

export function openOAuthPopup(
  authUrl: string,
  windowName: string
): Window | null {
  const width = 600;
  const height = 700;
  const left = (window.innerWidth - width) / 2;
  const top = (window.innerHeight - height) / 2;

  const popup = window.open(
    authUrl,
    windowName,
    `width=${width},height=${height},left=${left},top=${top},scrollbars=yes,resizable=yes`
  );

  return popup;
}

//---------------
// OAuthPopupMessage — shape of the postMessage sent by the callback
//---------------

interface OAuthPopupMessage {
  type?: string;
  error?: string;
}

//---------------
// waitForOAuthPopup — waits for the callback message (success or error).
// If the window is closed before finishing, rejects with `popup-closed`.
//---------------

export function waitForOAuthPopup(
  popup: Window,
  options: { successType: string; errorType: string }
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;

    const checkClosed = setInterval(() => {
      if (settled) return;
      if (popup.closed) {
        settled = true;
        clearInterval(checkClosed);
        window.removeEventListener('message', handleMessage);
        reject(new OAuthError('popup-closed'));
      }
    }, 1000);

    const handleMessage = (event: MessageEvent) => {
      if (settled) return;
      if (event.origin !== window.location.origin) {
        return;
      }

      const message = event.data as OAuthPopupMessage | null;
      if (!message) {
        return;
      }

      if (message.type === options.successType) {
        settled = true;
        clearInterval(checkClosed);
        window.removeEventListener('message', handleMessage);
        popup.close();
        resolve();
      } else if (message.type === options.errorType) {
        settled = true;
        clearInterval(checkClosed);
        window.removeEventListener('message', handleMessage);
        popup.close();
        reject(new OAuthError('oauth-failed', message.error));
      } else {
      }
    };

    window.addEventListener('message', handleMessage);
  });
}
