'use client';

import { useState } from 'react';
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nProvider } from '@/lib/i18n/provider';
import { shouldRetryQuery } from '@/lib/query-retry';
import { handleSessionExpiredError } from '@/lib/session-expiry';

interface ProvidersProps {
  children: React.ReactNode;
}

export default function Providers({ children }: ProvidersProps) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        // One host-wide reaction to a dead session: any query erroring 401
        // sends the user to /login once (lib/session-expiry), with ?next=
        // returning to this screen after sign-in.
        queryCache: new QueryCache({ onError: handleSessionExpiredError }),
        defaultOptions: {
          queries: {
            // No retry on 4xx (permanent); one retry on network errors/5xx.
            retry: shouldRetryQuery,
            refetchOnWindowFocus: false,
            staleTime: 60_000,
          },
        },
      })
  );

  return (
    <I18nProvider>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </I18nProvider>
  );
}
