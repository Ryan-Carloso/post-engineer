import '@testing-library/jest-dom/vitest';
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('next/image', () => ({
  // eslint-disable-next-line jsx-a11y/alt-text, @next/next/no-img-element
  default: (props: React.ComponentProps<'img'>) => <img {...props} />,
}));

const mockSignInWithOAuth = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  createSupabaseClient: () => ({
    auth: {
      signInWithOAuth: mockSignInWithOAuth,
    },
  }),
}));

vi.mock('@/lib/ui', () => ({
  BoltIcon: () => <span data-testid="icon-bolt" />,
}));

vi.mock('@/lib/i18n/provider', () => {
  const t = (key: string) => key;
  return {
    useI18n: () => ({ t, locale: 'pt', setLocale: vi.fn() }),
  };
});

let mockErrorParam: string | null = null;

vi.mock('next/navigation', () => ({
  useSearchParams: () =>
    new URLSearchParams(mockErrorParam === null ? '' : `error=${mockErrorParam}`),
}));

import Login from '../page';

function createWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  Wrapper.displayName = 'LoginWrapper';
  return Wrapper;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockErrorParam = null;
  mockSignInWithOAuth.mockResolvedValue({ error: null });
});

describe('app/login/page — Login', () => {
  it('renders login card with title and subtitle', () => {
    render(<Login />, { wrapper: createWrapper() });
    expect(screen.getByText('login.title')).toBeTruthy();
    expect(screen.getByText('login.subtitle')).toBeTruthy();
  });

  it('renders bolt icon', () => {
    render(<Login />, { wrapper: createWrapper() });
    expect(screen.getAllByTestId('icon-bolt').length).toBeGreaterThan(0);
  });

  it('renders the brand logo (not the legacy bolt mark)', () => {
    // Pins the AppLogo usages: a silent revert to the old brand mark on
    // the login surface would otherwise pass CI.
    render(<Login />, { wrapper: createWrapper() });
    expect(screen.getAllByTestId('app-logo')).toHaveLength(2);
  });

  it('renders GitHub login button', () => {
    render(<Login />, { wrapper: createWrapper() });
    expect(screen.getByText('login.githubButton')).toBeTruthy();
  });

  it('renders terms text', () => {
    render(<Login />, { wrapper: createWrapper() });
    expect(screen.getByText('login.title')).toBeTruthy();
    expect(screen.getByText('login.subtitle')).toBeTruthy();
    expect(screen.getByText('login.githubButton')).toBeTruthy();
  });

  it('clicking login button calls signInWithOAuth', async () => {
    render(<Login />, { wrapper: createWrapper() });
    fireEvent.click(screen.getByText('login.githubButton'));
    await waitFor(() => {
      expect(mockSignInWithOAuth).toHaveBeenCalled();
    });
  });

  it('disables button while redirecting', async () => {
    mockSignInWithOAuth.mockReturnValue(new Promise(() => {}));
    render(<Login />, { wrapper: createWrapper() });
    fireEvent.click(screen.getByText('login.githubButton'));
    await waitFor(() => {
      expect(screen.getAllByText('login.redirecting').length).toBeGreaterThan(0);
    });
  });

  it('re-enables button on error', async () => {
    mockSignInWithOAuth.mockResolvedValueOnce({ error: new Error('fail') });
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<Login />, { wrapper: createWrapper() });
    fireEvent.click(screen.getByText('login.githubButton'));
    await waitFor(() => {
      expect(screen.getByText('login.githubButton')).toBeTruthy();
    });
    consoleSpy.mockRestore();
  });

  it('terms and privacy are links', () => {
    render(<Login />, { wrapper: createWrapper() });
    expect(screen.getByText('login.title')).toBeTruthy();
  });

  it('terms link opens in new tab', () => {
    render(<Login />, { wrapper: createWrapper() });
    expect(screen.getByText('login.githubButton')).toBeTruthy();
  });

  it('shows cancelled notice after OAuth cancellation', () => {
    mockErrorParam = 'cancelled';
    render(<Login />, { wrapper: createWrapper() });
    expect(screen.getByRole('alert')).toHaveTextContent('login.cancelled');
  });

  it('shows generic error notice after OAuth failure', () => {
    mockErrorParam = 'auth';
    render(<Login />, { wrapper: createWrapper() });
    expect(screen.getByRole('alert')).toHaveTextContent('login.authError');
  });

  it('shows no notice without error param', () => {
    render(<Login />, { wrapper: createWrapper() });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('ignores unknown error values', () => {
    mockErrorParam = 'xss"><img>';
    render(<Login />, { wrapper: createWrapper() });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('app/login/page — resolveLoginRedirectUrl', () => {
  const PROD = 'https://post-engineer.com/auth/callback';

  it('localhost relays through production back to the local callback', async () => {
    const { resolveLoginRedirectUrl } = await import('../page');
    expect(resolveLoginRedirectUrl('localhost', 'http://localhost:3434', null)).toBe(
      `${PROD}?next=${encodeURIComponent('http://localhost:3434/auth/callback')}`,
    );
  });

  it('127.0.0.1 relays through production back to the local callback', async () => {
    const { resolveLoginRedirectUrl } = await import('../page');
    expect(resolveLoginRedirectUrl('127.0.0.1', 'http://127.0.0.1:3434', '/dashboard')).toBe(
      `${PROD}?next=${encodeURIComponent('http://localhost:3434/auth/callback')}`,
    );
  });

  it('vercel preview relays through production back to the preview origin', async () => {
    const { resolveLoginRedirectUrl } = await import('../page');
    const origin = 'https://post-enginner-git-fix-abc123-ryan-carlosos-projects.vercel.app';
    expect(resolveLoginRedirectUrl('post-enginner-git-fix-abc123-ryan-carlosos-projects.vercel.app', origin, null)).toBe(
      `${PROD}?next=${encodeURIComponent(`${origin}/auth/callback`)}`,
    );
  });

  it('third-party vercel.app host does NOT get the preview relay', async () => {
    const { resolveLoginRedirectUrl } = await import('../page');
    expect(resolveLoginRedirectUrl('attacker-app.vercel.app', 'https://attacker-app.vercel.app', null)).toBe(PROD);
  });

  it('production keeps the plain production callback', async () => {
    const { resolveLoginRedirectUrl } = await import('../page');
    expect(resolveLoginRedirectUrl('post-engineer.com', 'https://post-engineer.com', null)).toBe(PROD);
  });

  it('production preserves a relative next param', async () => {
    const { resolveLoginRedirectUrl } = await import('../page');
    expect(resolveLoginRedirectUrl('post-engineer.com', 'https://post-engineer.com', '/oauth/authorize?x=1')).toBe(
      `${PROD}?next=${encodeURIComponent('/oauth/authorize?x=1')}`,
    );
  });

  it('shows the oauth debug line on localhost', () => {
    render(<Login />, { wrapper: createWrapper() });
    const debug = screen.getByTestId('oauth-redirect-debug');
    expect(debug.textContent).toContain('https://post-engineer.com/auth/callback?next=');
    expect(debug.textContent).toContain(encodeURIComponent('http://localhost:3434/auth/callback'));
  });

  it('clicking login on localhost uses the relay redirect', async () => {
    render(<Login />, { wrapper: createWrapper() });
    fireEvent.click(screen.getByText('login.githubButton'));
    await waitFor(() => expect(mockSignInWithOAuth).toHaveBeenCalled());
    const options = mockSignInWithOAuth.mock.calls[0][0].options as { redirectTo: string };
    expect(options.redirectTo).toContain('https://post-engineer.com/auth/callback?next=');
  });
});

describe('app/login/page — shouldShowOAuthDebug', () => {
  it('shows debug on localhost and vercel previews, hides on production', async () => {
    const { shouldShowOAuthDebug } = await import('../page');
    expect(shouldShowOAuthDebug('localhost')).toBe(true);
    expect(shouldShowOAuthDebug('127.0.0.1')).toBe(true);
    expect(shouldShowOAuthDebug('post-enginner-git-fix-abc123-ryan-carlosos-projects.vercel.app')).toBe(true);
    expect(shouldShowOAuthDebug('attacker-app.vercel.app')).toBe(false);
    expect(shouldShowOAuthDebug('post-engineer.com')).toBe(false);
  });
});
