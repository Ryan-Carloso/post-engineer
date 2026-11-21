// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';

vi.mock('next/image', () => ({
  default: ({ alt, ...props }: React.ComponentProps<'img'>) => <img alt={alt} {...props} />,
}));

vi.mock('@/lib/supabase/client', () => ({
  createSupabaseClient: () => ({ auth: { signInWithOAuth: vi.fn() } }),
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

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('next=/oauth/authorize'),
}));

import Login from '../page';

describe('app/login/page — server render', () => {
  it('renders the GitHub login button and no debug line without a window global', () => {
    expect(typeof window).toBe('undefined');
    const html = renderToString(<Login />);
    expect(html).toContain('login.githubButton');
    expect(html).not.toContain('oauth-redirect-debug');
  });
});
