import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const getClaims = vi.fn();
const getUser = vi.fn();

function claimsFor(sub: string): { claims: { sub: string }; header: { alg: string }; signature: Uint8Array } {
  return { claims: { sub }, header: { alg: 'ES256' }, signature: new Uint8Array() };
}

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({ auth: { getClaims, getUser } }),
}));
vi.mock('@/components/ui/app-shell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-shell">{children}</div>
  ),
}));
vi.mock('@/components/site-footer', () => ({
  default: () => <div data-testid="site-footer" />,
}));

import RecipesLayout from '../layout';
import { useSignedIn } from '../viewer-context';

function Probe(): React.ReactElement {
  return <p>{useSignedIn() ? 'signed-in' : 'signed-out'}</p>;
}

describe('/recipes layout', () => {
  beforeEach(() => {
    getClaims.mockReset();
    getUser.mockReset();
  });

  it('wraps signed-in visitors in the AppShell so the sidebar tabs stay', async () => {
    getClaims.mockResolvedValue({ data: claimsFor('u1'), error: null });
    render(await RecipesLayout({ children: <p>content</p> }));
    expect(screen.getByTestId('app-shell')).toContainElement(screen.getByText('content'));
    expect(screen.queryByTestId('site-footer')).not.toBeInTheDocument();
  });

  it('tells the page a signed-in visitor is signed in', async () => {
    getClaims.mockResolvedValue({ data: claimsFor('u1'), error: null });
    render(await RecipesLayout({ children: <Probe /> }));
    expect(screen.getByTestId('app-shell')).toContainElement(screen.getByText('signed-in'));
  });

  it('tells the page a signed-out visitor is signed out', async () => {
    getClaims.mockResolvedValue({
      data: null,
      error: { name: 'AuthSessionMissingError', message: 'Auth session missing!' },
    });
    render(await RecipesLayout({ children: <Probe /> }));
    expect(screen.getByText('signed-out')).toBeInTheDocument();
  });

  it('renders the public frame with footer for signed-out visitors', async () => {
    getClaims.mockResolvedValue({
      data: null,
      error: {
        name: 'AuthSessionMissingError',
        message: 'Auth session missing!',
      },
    });
    render(await RecipesLayout({ children: <p>content</p> }));
    expect(screen.queryByTestId('app-shell')).not.toBeInTheDocument();
    expect(screen.getByTestId('site-footer')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '← Post Engineer' })).toHaveAttribute('href', '/');
  });

  it('verifies the visitor from the JWT claims without fetching the user record', async () => {
    getClaims.mockResolvedValue({ data: claimsFor('u1'), error: null });
    render(await RecipesLayout({ children: <Probe /> }));
    expect(getClaims).toHaveBeenCalledTimes(1);
    expect(getUser).not.toHaveBeenCalled();
  });

  it('treats a visitor with no session cookie as signed out without logging', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    getClaims.mockResolvedValue({ data: null, error: null });
    render(await RecipesLayout({ children: <Probe /> }));
    expect(screen.getByText('signed-out')).toBeInTheDocument();
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('logs a real auth error and falls back to the public frame', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    getClaims.mockResolvedValue({
      data: null,
      error: { name: 'AuthApiError', message: 'boom' },
    });
    render(await RecipesLayout({ children: <p>content</p> }));
    expect(consoleError).toHaveBeenCalledWith('[recipes] getClaims failed, rendering public frame', {
      message: 'boom',
    });
    expect(screen.getByTestId('site-footer')).toBeInTheDocument();
    consoleError.mockRestore();
  });
});
