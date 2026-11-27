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
        queryCache: new QueryCache({ onError: handleSessionExpiredError }),
        mutationCache: new MutationCache({ onError: handleSessionExpiredError }),
        defaultOptions: {
          queries: {
            retry: shouldRetryQuery,
            refetchOnWindowFocus: false,
            staleTime: 60_000,
          },
        },
      })
  );

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem storageKey="theme" themes={["light", "dark", "neon"]} value={{ light: "light", dark: "dark", neon: "dark neon" }} disableTransitionOnChange>
      <I18nProvider>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}
