// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';

vi.mock('next/image', () => ({
  // eslint-disable-next-line jsx-a11y/alt-text, @next/next/no-img-element
  default: (props: React.ComponentProps<'img'>) => <img {...props} />,
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
  it('renders the GitHub login button without a window global', () => {
    expect(typeof window).toBe('undefined');
    // renderToString does not throw for an error inside a Suspense boundary:
    // it emits the fallback (null), which drops the button from the markup.
    const html = renderToString(<Login />);
    expect(html).toContain('login.githubButton');
  });

  it('omits the oauth debug line from the server markup', () => {
    const html = renderToString(<Login />);
    expect(html).not.toContain('oauth-redirect-debug');
  });
});
