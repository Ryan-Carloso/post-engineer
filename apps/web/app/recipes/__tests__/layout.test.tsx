import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const getUser = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({ auth: { getUser } }),
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

describe('/recipes layout', () => {
  beforeEach(() => {
    getUser.mockReset();
  });

  it('wraps signed-in visitors in the AppShell so the sidebar tabs stay', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    render(await RecipesLayout({ children: <p>content</p> }));
    expect(screen.getByTestId('app-shell')).toContainElement(screen.getByText('content'));
    expect(screen.queryByTestId('site-footer')).not.toBeInTheDocument();
  });

  it('renders the public frame with footer for signed-out visitors', async () => {
    getUser.mockResolvedValue({
      data: { user: null },
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

  it('logs a real auth error and falls back to the public frame', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    getUser.mockResolvedValue({
      data: { user: null },
      error: { name: 'AuthApiError', message: 'boom' },
    });
    render(await RecipesLayout({ children: <p>content</p> }));
    expect(consoleError).toHaveBeenCalledWith('[recipes] getUser failed, rendering public frame', {
      message: 'boom',
    });
    expect(screen.getByTestId('site-footer')).toBeInTheDocument();
    consoleError.mockRestore();
  });
});
