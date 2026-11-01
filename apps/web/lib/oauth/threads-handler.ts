'use client';

import { useOAuthFlow } from './oauth-flow';

//---------------
// useThreadsOAuth — Threads OAuth flow.
//---------------
export function useThreadsOAuth() {
  return useOAuthFlow({
    startUrl: '/api/threads-auth/start',
    popupTitle: 'Threads OAuth',
    successType: 'threads-oauth-success',
    errorType: 'threads-oauth-error',
    queryKey: ['social-accounts'],
  });
}
