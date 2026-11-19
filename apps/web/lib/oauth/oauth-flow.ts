'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useI18n } from '@/lib/i18n/provider';
import { notifyIfSessionExpired } from '@/lib/session-expiry';
import {
  OAuthError,
  openOAuthPopup,
  toOAuthErrorMessage,
  waitForOAuthPopup,
} from './popup';

interface OAuthFlowConfig {
  startUrl: string;
  popupTitle: string;
  successType: string;
  errorType: string;
  queryKey: readonly string[];
}

export function useOAuthFlow({ startUrl, popupTitle, successType, errorType, queryKey }: OAuthFlowConfig) {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startOAuth = async (): Promise<void> => {
    try {
      setIsLoading(true);
      setError(null);

      const authUrlResponse = await fetch(startUrl);
      if (!authUrlResponse.ok) notifyIfSessionExpired(authUrlResponse);
      const authUrlData: {
        success?: boolean;
        auth_url?: string;
        error?: string;
      } = await authUrlResponse.json();

      if (!authUrlData.success || !authUrlData.auth_url) {
        throw new OAuthError('start-failed', authUrlData.error);
      }

      const popup = openOAuthPopup(authUrlData.auth_url, popupTitle);

      if (!popup) {
        throw new OAuthError('popup-blocked');
      }

      await waitForOAuthPopup(popup, { successType, errorType });

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
