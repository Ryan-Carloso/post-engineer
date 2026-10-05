import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

//---------------
// AccountPanel tests — the shared account area shown in the desktop
// sidebar footer and on the /account page (mobile entry point).
// Written BEFORE the implementation (TDD).
//---------------

const { pushMock, signOutMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  signOutMock: vi.fn(),
}));

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
  useRouter: () => ({ push: pushMock }),
  usePathname: () => '/account',
}));

vi.mock('@/lib/api', () => ({
  useSessionQuery: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  createSupabaseClient: () => ({
    auth: { signOut: signOutMock },
  }),
}));

vi.mock('@/lib/ui', () => ({
  ProfileIcon: () => <span data-testid="icon-profile" />,
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

import { AccountPanel } from '../account-panel';
import { useSessionQuery } from '@/lib/api';

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  Wrapper.displayName = 'AccountPanelWrapper';
  return Wrapper;
}

const SESSION_USER = {
  id: 'user-1',
  email: 'user@example.com',
  user_metadata: {
    avatar_url: 'https://example.com/avatar.png',
    name: 'Test User',
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  signOutMock.mockResolvedValue({ error: null });
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, balance: 45, free: 0 }),
  });
  vi.mocked(useSessionQuery).mockReturnValue({
    data: SESSION_USER,
    isLoading: false,
  } as never);
  process.env.APP_VERSION = '9.9.9';
});

afterEach(() => {
  delete process.env.APP_VERSION;
});

describe('AccountPanel', () => {
  it("renders the user's name and avatar image", () => {
    render(<AccountPanel />, { wrapper: createWrapper() });
    expect(screen.getByText('Test User')).toBeInTheDocument();
    const avatar = screen.getByAltText('Test User');
    expect(avatar).toHaveAttribute('src', 'https://example.com/avatar.png');
  });

  it('falls back to the initial-letter circle when there is no avatar_url', () => {
    vi.mocked(useSessionQuery).mockReturnValue({
      data: {
        ...SESSION_USER,
        user_metadata: { name: 'Test User' },
      },
      isLoading: false,
    } as never);
    render(<AccountPanel />, { wrapper: createWrapper() });
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('T')).toBeInTheDocument();
  });

  it('renders the user block as a link to /account', () => {
    render(<AccountPanel />, { wrapper: createWrapper() });
    const link = screen.getByTestId('profile-user-link');
    expect(link).toHaveAttribute('href', '/account');
    expect(link).toHaveTextContent('Test User');
  });

  it('renders the token balance fetched from the API', async () => {
    render(<AccountPanel />, { wrapper: createWrapper() });
    await waitFor(() => {
      expect(screen.getByTestId('token-balance')).toHaveTextContent('45');
    });
  });

  it('renders the version badge when showVersionBadge is set', () => {
    render(<AccountPanel showVersionBadge />, { wrapper: createWrapper() });
    expect(screen.getByTestId('version-badge')).toHaveTextContent('BETA - 9.9.9');
  });

  it('does not render the version badge by default', () => {
    render(<AccountPanel />, { wrapper: createWrapper() });
    expect(screen.queryByTestId('version-badge')).not.toBeInTheDocument();
  });

  it('renders the PT/EN locale switcher', () => {
    render(<AccountPanel />, { wrapper: createWrapper() });
    expect(screen.getByRole('button', { name: 'PT' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'EN' })).toBeInTheDocument();
  });

  it('signs out and routes to /login when the sign-out button is clicked', async () => {
    render(<AccountPanel />, { wrapper: createWrapper() });
    fireEvent.click(screen.getByTitle('nav.signOut'));
    await waitFor(() => {
      expect(signOutMock).toHaveBeenCalled();
    });
    expect(pushMock).toHaveBeenCalledWith('/login');
  });

  it('renders no user block or sign-out button when there is no session user', () => {
    vi.mocked(useSessionQuery).mockReturnValue({
      data: null,
      isLoading: false,
    } as never);
    render(<AccountPanel />, { wrapper: createWrapper() });
    expect(screen.queryByTestId('profile-user-link')).not.toBeInTheDocument();
    expect(screen.queryByTitle('nav.signOut')).not.toBeInTheDocument();
    // Tokens and locale stay available regardless of session state.
    expect(screen.getByTestId('token-balance')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'PT' })).toBeInTheDocument();
  });
});
