import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('next/image', () => ({
  default: ({ alt, ...props }: React.ComponentProps<'img'>) => <img alt={alt} {...props} />,
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
    render(<Login />, { wrapper: createWrapper() });
    expect(screen.getAllByTestId('app-logo')).toHaveLength(2);
  });

  it('renders GitHub login button', () => {
    render(<Login />, { wrapper: createWrapper() });
    expect(screen.getByText('login.githubButton')).toBeTruthy();
  });

  it('renders terms text', () => {
    render(<Login />, { wrapper: createWrapper() });
    const note = screen.getAllByRole('link', { name: 'footer.terms' })[0].closest('p');
    expect(note?.textContent).toContain('login.agreePrefix');
    expect(note?.textContent).toContain('login.agreeAnd');
    expect(screen.getAllByText('footer.terms').length).toBeGreaterThan(0);
    expect(screen.getAllByText('footer.privacy').length).toBeGreaterThan(0);
  });

  it('clicking login button calls signInWithOAuth', async () => {
    render(<Login />, { wrapper: createWrapper() });
    fireEvent.click(screen.getByText('login.githubButton'));
    await waitFor(() => {
      expect(mockSignInWithOAuth).toHaveBeenCalled();
    });
    expect(mockSignInWithOAuth.mock.calls[0][0].provider).toBe('github');
  });

  it('disables button while redirecting', async () => {
    mockSignInWithOAuth.mockReturnValue(new Promise(() => {}));
    render(<Login />, { wrapper: createWrapper() });
    fireEvent.click(screen.getByText('login.githubButton'));
    await waitFor(() => {
      expect(screen.getAllByText('login.redirecting').length).toBeGreaterThan(0);
    });
    expect(screen.getByRole('button', { name: /login\.redirecting/ })).toBeDisabled();
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
    const termsLinks = screen.getAllByRole('link', { name: 'footer.terms' });
    expect(termsLinks).toHaveLength(2);
    for (const link of termsLinks) expect(link).toHaveAttribute('href', '/terms');
    const privacyLinks = screen.getAllByRole('link', { name: 'footer.privacy' });
    expect(privacyLinks).toHaveLength(2);
    for (const link of privacyLinks) expect(link).toHaveAttribute('href', '/privacy');
  });

  it('renders the support mailto link in the bottom bar', () => {
    render(<Login />, { wrapper: createWrapper() });
    expect(screen.getByRole('link', { name: 'footer.support' })).toHaveAttribute(
      'href',
      'mailto:madebyryandev@gmail.com',
    );
    expect(screen.getByText('footer.rights')).toBeTruthy();
  });

  it('renders the hero pitch and feature list', () => {
    render(<Login />, { wrapper: createWrapper() });
    expect(screen.getByText('login.heroBadge')).toBeTruthy();
    expect(screen.getByText('login.heroTitle')).toBeTruthy();
    expect(screen.getByText('login.heroTitleAccent')).toBeTruthy();
    expect(screen.getByText('login.heroDescription')).toBeTruthy();
    expect(screen.getByText('login.heroNote')).toBeTruthy();
    for (const n of [1, 2, 3]) {
      expect(screen.getByText(`login.feature${n}Title`)).toBeTruthy();
      expect(screen.getByText(`login.feature${n}Hint`)).toBeTruthy();
    }
  });

  it('renders locale switcher with the current locale pressed', () => {
    render(<Login />, { wrapper: createWrapper() });
    expect(screen.getByRole('button', { name: 'PT' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'EN' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('login.noAccount')).toBeTruthy();
    expect(screen.getByRole('link', { name: /login\.createAccount/ })).toHaveAttribute(
      'href',
      '/login',
    );
  });

  it('shows cancelled notice after OAuth cancellation', () => {
    mockErrorParam = 'cancelled';
    render(<Login />, { wrapper: createWrapper() });
    expect(screen.getByRole('alert')).toHaveTextContent('login.cancelled');
    expect(screen.getByRole('alert').className).toContain('bg-surface');
  });

  it('shows generic error notice after OAuth failure', () => {
    mockErrorParam = 'auth';
    render(<Login />, { wrapper: createWrapper() });
    expect(screen.getByRole('alert')).toHaveTextContent('login.authError');
    expect(screen.getByRole('alert').className).toContain('bg-brand-soft');
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

  it('opaque origin (hostname "", origin "null") falls through to the production callback', async () => {
    const { resolveLoginRedirectUrl } = await import('../page');
    expect(resolveLoginRedirectUrl('', 'null', null)).toBe(PROD);
    expect(resolveLoginRedirectUrl('', 'null', '/oauth/authorize')).toBe(
      `${PROD}?next=${encodeURIComponent('/oauth/authorize')}`,
    );
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

describe('app/login/page — safeNext', () => {
  it('keeps a relative path that stays on this origin', async () => {
    const { safeNext } = await import('../page');
    expect(safeNext('/oauth/authorize')).toBe('/oauth/authorize');
    expect(safeNext('/dashboard?tab=1#top')).toBe('/dashboard?tab=1#top');
  });

  it('drops a path that leaves the origin or is missing', async () => {
    const { safeNext } = await import('../page');
    expect(safeNext('//evil.com')).toBeNull();
    expect(safeNext('/\\evil.com')).toBeNull();
    expect(safeNext('https://evil.com')).toBeNull();
    expect(safeNext(null)).toBeNull();
  });
});

describe('app/login/page — hydration', () => {
  it('hydrates the server markup without a mismatch and keeps the button usable', async () => {
    const container = document.createElement('div');
    container.innerHTML = renderToString(<Login />);
    document.body.appendChild(container);
    let root: { unmount: () => void } | undefined;
    try {
      expect(container.querySelector('[data-testid="oauth-redirect-debug"]')).toBeNull();

      const recoverableErrors: unknown[] = [];
      root = await act(async () =>
        hydrateRoot(container, <Login />, {
          onRecoverableError: (error) => recoverableErrors.push(error),
        }),
      );

      expect(recoverableErrors).toEqual([]);
      expect(screen.getByTestId('oauth-redirect-debug').textContent).toContain(
        encodeURIComponent('http://localhost:3434/auth/callback'),
      );
      fireEvent.click(screen.getByText('login.githubButton'));
      await waitFor(() => expect(mockSignInWithOAuth).toHaveBeenCalled());
    } finally {
      const mountedRoot = root;
      if (mountedRoot !== undefined) act(() => mountedRoot.unmount());
      container.remove();
    }
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

describe('app/login/page — hostnameFromOrigin', () => {
  it('returns null for a null origin (server snapshot)', async () => {
    const { hostnameFromOrigin } = await import('../page');
    expect(hostnameFromOrigin(null)).toBeNull();
  });

  it('returns the hostname for a valid origin', async () => {
    const { hostnameFromOrigin } = await import('../page');
    expect(hostnameFromOrigin('http://localhost:3434')).toBe('localhost');
    expect(hostnameFromOrigin('https://post-engineer.com')).toBe('post-engineer.com');
  });

  it('returns null for the opaque origin string "null" instead of throwing', async () => {
    const { hostnameFromOrigin } = await import('../page');
    expect(hostnameFromOrigin('null')).toBeNull();
  });

  it('returns null for a malformed origin instead of throwing', async () => {
    const { hostnameFromOrigin } = await import('../page');
    expect(hostnameFromOrigin('not a url')).toBeNull();
  });
});
