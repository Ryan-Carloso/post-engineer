'use client';

import { useState } from 'react';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
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
        // returning to this screen after sign-in. Mutations that throw an
        // HttpStatusError go through the same handler; mutations that
        // swallow the failure notify from lib/api.ts / lib/cloned-voices-client.ts.
        queryCache: new QueryCache({ onError: handleSessionExpiredError }),
        mutationCache: new MutationCache({ onError: handleSessionExpiredError }),
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
    // next-themes toggles the `dark` class on <html> (matches the `.dark`
    // token set in globals.css), follows the OS on first visit and injects the
    // inline script that applies the class before first paint (no flash).
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem storageKey="theme" disableTransitionOnChange>
      <I18nProvider>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}
