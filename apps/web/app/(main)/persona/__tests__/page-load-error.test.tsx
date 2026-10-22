import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('embla-carousel-autoplay', () => ({
  default: vi.fn(() => ({ stop: vi.fn() })),
}));

vi.mock('embla-carousel-react', () => ({
  default: vi.fn(() => [vi.fn(), undefined]),
}));

vi.mock('next/image', () => ({
  // eslint-disable-next-line jsx-a11y/alt-text, @next/next/no-img-element
  default: (props: React.ComponentProps<'img'>) => <img {...props} />,
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/persona',
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/lib/scroll-to-error', () => ({
  scrollToErrorField: vi.fn(),
}));

vi.mock('@/lib/ui', () => ({
  AlertIcon: () => <span data-testid="icon-alert" />,
  CheckIcon: () => <span data-testid="icon-check" />,
  ImageIcon: () => <span data-testid="icon-image" />,
  UploadIcon: () => <span data-testid="icon-upload" />,
  SpinnerIcon: () => <span data-testid="icon-spinner" />,
  SparklesIcon: () => <span data-testid="icon-sparkles" />,
  MicIcon: () => <span data-testid="icon-mic" />,
  FilmIcon: () => <span data-testid="icon-film" />,
  SECTION_LABEL_CLASS: '',
  INPUT_CLASS: '',
  formatFileSize: (v: number) => `${v} B`,
}));

vi.mock('@/lib/i18n/provider', () => {
  const t = (key: string) => key;
  function I18nProvider({ children }: { children: ReactNode }) {
    return <>{children}</>;
  }
  I18nProvider.displayName = 'I18nProvider';
  const useI18n = vi.fn(() => ({ t, locale: 'pt', setLocale: vi.fn() }));
  return { useI18n, I18nProvider };
});

//---------------
// Load-error regression tests: real React Query + real lib/api, only the
// network (fetch) is stubbed. The mocked-hooks suite in page.test.tsx
// cannot catch this: the error page used to subscribe to the same queries
// it guards, so mounting it refetched the errored query, flipped it back
// to pending, and unmounted the error page — an infinite loop that never
// showed the error. These tests pin the fixed behavior: the error page
// renders stably, with exactly one failed fetch, and retry refetches once.
//---------------

import PersonaPage from '../page';
import { I18nProvider } from '@/lib/i18n/provider';

let fetchMock: ReturnType<typeof vi.fn>;

function createWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <I18nProvider>{children}</I18nProvider>
      </QueryClientProvider>
    );
  }
  Wrapper.displayName = 'LoadErrorWrapper';
  return Wrapper;
}

function voicesCalls(): number {
  return fetchMock.mock.calls.filter((call) => call[0] === '/api/persona/voices').length;
}

describe('persona page load error (real queries)', () => {
  beforeEach(() => {
    fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/persona/voices') {
        return new Response(JSON.stringify({ error: 'voices down' }), { status: 500 });
      }
      if (url === '/api/persona/list') {
        return new Response(JSON.stringify({ authenticated: true, personas: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the error page once and does not refetch in a loop', async () => {
    render(<PersonaPage />, { wrapper: createWrapper() });
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'persona.loadError' })).toBeInTheDocument();
    });
    // Let any refetch loop spin up: with the bug, hundreds of voices
    // requests fired within two seconds.
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(voicesCalls()).toBe(1);
  });

  it('retry refetches the failed voices query once and shows the error again', async () => {
    const user = userEvent.setup();
    render(<PersonaPage />, { wrapper: createWrapper() });
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'persona.loadError' })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: 'persona.tryAgain' }));
    await waitFor(() => {
      expect(voicesCalls()).toBe(2);
    });
    // The retry fails too, so the error page comes back after the
    // transient skeleton shown while the refetch is in flight.
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'persona.loadError' })).toBeInTheDocument();
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(voicesCalls()).toBe(2);
  });
});
