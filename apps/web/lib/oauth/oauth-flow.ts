'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useI18n } from '@/lib/i18n/provider';
import {
  OAuthError,
  openOAuthPopup,
  toOAuthErrorMessage,
  waitForOAuthPopup,
} from './popup';

//---------------
// OAuthFlowConfig — parameterizes the flow per social network: start endpoint,
// the popup title, the callback postMessage types and the query key the
// and the query key the callback must invalidate when finished.
//---------------
interface OAuthFlowConfig {
  startUrl: string;
  popupTitle: string;
  successType: string;
  errorType: string;
  queryKey: readonly string[];
}

//---------------
// useOAuthFlow — shared OAuth flow (YouTube/Instagram):
// opens the network popup, waits for the callback message (which persists
// encrypted on the server) and invalidates the network's account cache.
// Errors are translated via i18n.
//---------------
export function useOAuthFlow({ startUrl, popupTitle, successType, errorType, queryKey }: OAuthFlowConfig) {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startOAuth = async (): Promise<void> => {
    try {
      setIsLoading(true);
      setError(null);

      // Step 1: authorization URL (validates the session)
      const authUrlResponse = await fetch(startUrl);
      const authUrlData: {
        success?: boolean;
        auth_url?: string;
        error?: string;
      } = await authUrlResponse.json();

      if (!authUrlData.success || !authUrlData.auth_url) {
        throw new OAuthError('start-failed', authUrlData.error);
      }

      // Step 2: Open the social network popup
      const popup = openOAuthPopup(authUrlData.auth_url, popupTitle);

      if (!popup) {
        throw new OAuthError('popup-blocked');
      }

      // Step 3: Wait for the callback (success/error via postMessage)
      await waitForOAuthPopup(popup, { successType, errorType });

      // Step 4: OAuth finished — reloads accounts from the server
      await queryClient.invalidateQueries({ queryKey });
    } catch (err) {
      setError(toOAuthErrorMessage(err, t));
    } finally {
      setIsLoading(false);
    }
  };

  return {
    startOAuth,
    isLoading,
    error,
  };
}
