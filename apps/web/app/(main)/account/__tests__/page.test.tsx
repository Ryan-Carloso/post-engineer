import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

//---------------
// /account page tests — the Perfil/Profile area reachable from the
// mobile header avatar. Written BEFORE the implementation (TDD).
//---------------

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: React.ComponentProps<'a'> & { href: string }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

vi.mock('next/image', () => ({
  // eslint-disable-next-line jsx-a11y/alt-text, @next/next/no-img-element
  default: (props: React.ComponentProps<'img'>) => <img {...props} />,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/account',
}));

vi.mock('@/lib/api', () => ({
  useSessionQuery: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  createSupabaseClient: () => ({
    auth: { signOut: vi.fn().mockResolvedValue({ error: null }) },
  }),
}));

vi.mock('@/lib/ui', () => ({
  ProfileIcon: () => <span data-testid="icon-profile" />,
  KeyIcon: () => <span data-testid="icon-key" />,
}));

vi.mock('@/lib/i18n/provider', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const react = require('react') as typeof import('react');
  const t = (key: string) => key;
  const useI18n = () => {
    const [locale, setLocale] = react.useState<'pt' | 'en'>('pt');
    return { locale, setLocale, t };
  };
  function I18nProvider({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
  }
  I18nProvider.displayName = 'I18nProvider';
  return { useI18n, I18nProvider };
});

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import AccountPage from '../page';
import { useSessionQuery } from '@/lib/api';

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  Wrapper.displayName = 'AccountPageWrapper';
  return Wrapper;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, balance: 12, free: 0 }),
  });
  vi.mocked(useSessionQuery).mockReturnValue({
    data: {
      id: 'user-1',
      email: 'user@example.com',
      user_metadata: { name: 'Page User' },
    },
    isLoading: false,
  } as never);
});

describe('app/(main)/account — AccountPage', () => {
  it('renders the profile heading', () => {
    render(<AccountPage />, { wrapper: createWrapper() });
    expect(screen.getByTestId('account-page')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'account.title' })).toBeInTheDocument();
    expect(screen.getByText('account.subtitle')).toBeInTheDocument();
  });

  it('renders the shared account panel: user, tokens, version, locale, sign out', () => {
    render(<AccountPage />, { wrapper: createWrapper() });
    expect(screen.getByText('Page User')).toBeInTheDocument();
    expect(screen.getByTestId('token-balance')).toBeInTheDocument();
    expect(screen.getByTestId('version-badge')).toHaveTextContent('BETA');
    expect(screen.getByRole('button', { name: 'PT' })).toBeInTheDocument();
    expect(screen.getByTitle('nav.signOut')).toBeInTheDocument();
    const apiKeysLink = screen.getByTestId('profile-api-keys-link');
    expect(apiKeysLink).toHaveAttribute('href', '/api-keys');
  });
});
