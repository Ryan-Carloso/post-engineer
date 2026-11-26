import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('next/image', () => ({
  default: ({ alt, ...props }: React.ComponentProps<'img'>) => <img alt={alt} {...props} />,
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

function listCalls(): number {
  return fetchMock.mock.calls.filter((call) => call[0] === '/api/persona/list').length;
}

describe('persona page load error (real queries)', () => {
  beforeEach(() => {
    fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/persona/list') {
        return new Response(JSON.stringify({ error: 'list down' }), { status: 500 });
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
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(listCalls()).toBe(1);
  });

  it('retry refetches the failed persona list once and shows the error again', async () => {
    const user = userEvent.setup();
    render(<PersonaPage />, { wrapper: createWrapper() });
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'persona.loadError' })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: 'persona.tryAgain' }));
    await waitFor(() => {
      expect(listCalls()).toBe(2);
    });
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'persona.loadError' })).toBeInTheDocument();
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(listCalls()).toBe(2);
  });
});
