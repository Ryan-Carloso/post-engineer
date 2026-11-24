'use client';

import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { ACCOUNT_PROFILE_REFRESH_PARAM } from '@/lib/contracts/accounts';
import type { PublicAccountItem } from '@/lib/providers/registry';
import { notifyIfSessionExpired } from '@/lib/session-expiry';
import { logger } from '@/lib/logger';

export const ACCOUNT_PROFILE_REFRESH_URL = `/api/account?${ACCOUNT_PROFILE_REFRESH_PARAM}=1`;

export interface RefreshedAccountsPayload {
  authenticated: boolean;
  accounts: PublicAccountItem[];
  message?: string;
}

export type RefreshAccountProfilesResult =
  | { success: true; payload: RefreshedAccountsPayload }
  | { success: false; error: string };

function isRefreshedAccountsPayload(value: unknown): value is RefreshedAccountsPayload {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return record.authenticated === true && Array.isArray(record.accounts);
}

export async function refreshAccountProfiles(): Promise<RefreshAccountProfilesResult> {
  let response: Response;
  try {
    response = await fetch(ACCOUNT_PROFILE_REFRESH_URL);
  } catch (error) {
    logger.error('[api/account] profile refresh request failed', error);
    return { success: false, error: 'NETWORK_ERROR' };
  }
  notifyIfSessionExpired(response);
  if (!response.ok) {
    logger.error('[api/account] profile refresh failed', new Error(`status ${response.status}`));
    return { success: false, error: `HTTP_${response.status}` };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    logger.error('[api/account] profile refresh returned a non-JSON body', error);
    return { success: false, error: 'INVALID_RESPONSE' };
  }
  if (!isRefreshedAccountsPayload(body)) {
    logger.error('[api/account] profile refresh returned an unexpected body', new Error('INVALID_RESPONSE'));
    return { success: false, error: 'INVALID_RESPONSE' };
  }
  return { success: true, payload: body };
}

export function useRefreshAccountProfilesMutation(): UseMutationResult<RefreshAccountProfilesResult, Error, void> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: refreshAccountProfiles,
    onSuccess: (result) => {
      if (result.success) queryClient.setQueryData(['social-accounts'], result.payload);
    },
  });
}
