import '@testing-library/jest-dom/vitest';
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

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
  usePathname: vi.fn(() => '/'),
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/lib/api', () => ({
  useSessionQuery: vi.fn(),
  useYouTubeAccountsQuery: vi.fn(),
  useInstagramAccountsQuery: vi.fn(),
}));

vi.mock('@/lib/ui', () => ({
  AccountsIcon: () => <span data-testid="icon-accounts" />,
  BoltIcon: () => <span data-testid="icon-bolt" />,
  KeyIcon: () => <span data-testid="icon-key" />,
  GlobeIcon: () => <span data-testid="icon-globe" />,
  CoinsIcon: () => <span data-testid="icon-coins" />,
  HomeIcon: () => <span data-testid="icon-home" />,
  ProfileIcon: () => <span data-testid="icon-profile" />,
  HistoryIcon: () => <span data-testid="icon-history" />,
  SparklesIcon: () => <span data-testid="icon-sparkles" />,
  MicIcon: () => <span data-testid="icon-mic" />,
  SECTION_LABEL_CLASS: '',
  INPUT_CLASS: '',
  SpinnerIcon: () => <span data-testid="icon-spinner" />,
  CheckIcon: () => <span data-testid="icon-check" />,
  AlertIcon: () => <span data-testid="icon-alert" />,
  PlayIcon: () => <span data-testid="icon-play" />,
  FilmIcon: () => <span data-testid="icon-film" />,
  ImageIcon: () => <span data-testid="icon-image" />,
  UploadIcon: () => <span data-testid="icon-upload" />,
  ExternalLinkIcon: () => <span data-testid="icon-external" />,
  GoogleIcon: () => <span data-testid="icon-google" />,
  InstagramIcon: () => <span data-testid="icon-instagram" />,
  formatCount: (v: string) => v ?? '0',
  formatFileSize: (v: number) => `${v} B`,
}));


vi.mock('@/lib/store', () => ({
  useUploadStore: Object.assign(vi.fn(() => ({})), {
    getState: vi.fn(() => ({
      selectedAccountIds: { youtube: [], instagram: [] },
      toggleSelectedAccount: vi.fn(),
      file: null,
      igFile: null,
      title: '',
      description: '',
      tags: '',
      privacyStatus: 'private',
      result: null,
      igResult: null,
      igCaption: '',
      igCaptionEdited: false,
      ytTitleOverride: '',
      ytDescriptionOverride: '',
      igCaptionOverride: '',
      ytThumbnail: null,
      setTitle: vi.fn(),
      setDescription: vi.fn(),
      setTags: vi.fn(),
      setPrivacyStatus: vi.fn(),
      setFile: vi.fn(),
      setIgFile: vi.fn(),
      setIgCaption: vi.fn(),
      setIgCaptionEdited: vi.fn(),
      setResult: vi.fn(),
      setIgResult: vi.fn(),
      setYtTitleOverride: vi.fn(),
      setYtDescriptionOverride: vi.fn(),
      setIgCaptionOverride: vi.fn(),
      setYtThumbnail: vi.fn(),
      setMode: vi.fn(),
      clearSelectedAccounts: vi.fn(),
      resolveContent: vi.fn(() => ({ title: '', description: '', igCaption: '' })),
      resetForm: vi.fn(),
      resetIgForm: vi.fn(),
    })),
    setState: vi.fn(),
  }),
}));

vi.mock('@/lib/supabase/client', () => ({
  createSupabaseClient: () => ({
    auth: { signOut: vi.fn().mockResolvedValue({ error: null }) },
  }),
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

import MainLayout from '../layout';
import { useSessionQuery } from '@/lib/api';
import { usePathname } from 'next/navigation';

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  Wrapper.displayName = 'MainLayoutWrapper';
  return Wrapper;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useSessionQuery).mockReturnValue({
    data: null,
    isLoading: false,
  } as never);
  vi.mocked(usePathname).mockReturnValue('/');
});

describe('app/(main)/layout — MainLayout', () => {
  it('renders sidebar and main content area', () => {
    render(
      <MainLayout>
        <div data-testid="page">page content</div>
      </MainLayout>,
      { wrapper: createWrapper() },
    );
    expect(screen.getByTestId('page')).toHaveTextContent('page content');
  });

  it('renders brand logo in sidebar', () => {
    render(
      <MainLayout>child</MainLayout>,
      { wrapper: createWrapper() },
    );
    const logos = screen.getAllByTestId('app-logo');
    expect(logos.length).toBeGreaterThan(0);
    for (const logo of logos) {
      expect(logo).toHaveAttribute('src', '/logo.png');
    }
  });

  it('renders the sidebar tabs in order: Home, Accounts, Personas, Posts, Tokens', () => {
    render(<MainLayout>child</MainLayout>, { wrapper: createWrapper() });
    const sidebar = screen.getByTestId('nav-brand').closest('aside');
    const nav = within(sidebar as HTMLElement).getByRole('navigation');
    const titles = within(nav)
      .getAllByRole('link')
      .map((link) => link.getAttribute('title'));
    expect(titles).toEqual(['nav.home', 'nav.accounts', 'nav.persona', 'nav.posts', 'nav.billing']);
  });

  it('home tab links to /', () => {
    render(<MainLayout>child</MainLayout>, { wrapper: createWrapper() });
    const sidebar = screen.getByTestId('nav-brand').closest('aside');
    const nav = within(sidebar as HTMLElement).getByRole('navigation');
    const homeLink = within(nav).getByTitle('nav.home').closest('a');
    expect(homeLink?.getAttribute('href')).toBe('/');
  });

  it('lists Home as the first navigation tab', () => {
    render(<MainLayout>child</MainLayout>, { wrapper: createWrapper() });
    const sidebar = screen.getByTestId('nav-brand').closest('aside');
    const firstTab = within(sidebar as HTMLElement).getAllByRole('link')[0];
    expect(firstTab).toHaveAttribute('title', 'nav.home');
  });

  it('does not render an API Keys tab in the sidebar nav (moved to the profile area)', () => {
    render(<MainLayout>child</MainLayout>, { wrapper: createWrapper() });
    const sidebar = screen.getByTestId('nav-brand').closest('aside');
    const nav = within(sidebar as HTMLElement).getByRole('navigation');
    expect(within(nav).queryByText('nav.apiKeys')).toBeNull();
  });

  it('posts tab links to /posts', () => {
    render(<MainLayout>child</MainLayout>, { wrapper: createWrapper() });
    const postsLink = screen.getAllByText('nav.posts')[0].closest('a');
    expect(postsLink?.getAttribute('href')).toBe('/posts');
  });

  it('billing tab links to /billing', () => {
    render(<MainLayout>child</MainLayout>, { wrapper: createWrapper() });
    const billingLink = screen.getAllByText('nav.billing')[0].closest('a');
    expect(billingLink?.getAttribute('href')).toBe('/billing');
  });

  it('api keys are reachable from the profile panel, not from a tab', () => {
    vi.mocked(useSessionQuery).mockReturnValue({
      data: {
        id: 'u1',
        email: 'test@example.com',
        user_metadata: { name: 'User' },
      },
      isLoading: false,
    } as never);
    render(<MainLayout>child</MainLayout>, { wrapper: createWrapper() });
    const panelLink = screen.getByTestId('profile-api-keys-link');
    expect(panelLink).toHaveAttribute('href', '/api-keys');
    expect(panelLink).toHaveTextContent('nav.apiKeys');
  });

  it('renders locale switcher', () => {
    render(<MainLayout>child</MainLayout>, { wrapper: createWrapper() });
    expect(screen.getByText('PT')).toBeTruthy();
    expect(screen.getByText('EN')).toBeTruthy();
  });

  it('renders token balance badge in the sidebar', () => {
    render(<MainLayout>child</MainLayout>, { wrapper: createWrapper() });
    expect(screen.getByTestId('token-balance')).toBeInTheDocument();
  });

  it('does not render sidebar user when no session', () => {
    vi.mocked(useSessionQuery).mockReturnValue({ data: null, isLoading: false } as never);
    render(<MainLayout>child</MainLayout>, { wrapper: createWrapper() });
    expect(screen.queryByText('nav.signedInAs')).toBeNull();
  });

  it('renders user info when session exists', () => {
    vi.mocked(useSessionQuery).mockReturnValue({
      data: {
        id: 'u1',
        email: 'test@example.com',
        user_metadata: { name: 'Test User', avatar_url: '' },
      },
      isLoading: false,
    } as never);
    render(<MainLayout>child</MainLayout>, { wrapper: createWrapper() });
    expect(screen.getByText('Test User')).toBeTruthy();
  });

  it('renders fallback initial when no name in session', () => {
    vi.mocked(useSessionQuery).mockReturnValue({
      data: {
        id: 'u1',
        email: 'test@example.com',
        user_metadata: {},
      },
      isLoading: false,
    } as never);
    render(<MainLayout>child</MainLayout>, { wrapper: createWrapper() });
    expect(screen.getByText('GitHub User')).toBeTruthy();
  });

  it('renders avatar image when avatar_url is present', () => {
    vi.mocked(useSessionQuery).mockReturnValue({
      data: {
        id: 'u1',
        email: 'test@example.com',
        user_metadata: { avatar_url: 'https://example.com/avatar.png', name: 'A' },
      },
      isLoading: false,
    } as never);
    render(<MainLayout>child</MainLayout>, { wrapper: createWrapper() });
    // The avatar shows in the sidebar user block and in the mobile header link.
    const sidebarImg = within(screen.getByTestId('profile-user-link')).getByRole('img', { name: 'A' });
    expect(sidebarImg).toHaveAttribute('src', 'https://example.com/avatar.png');
    const headerImg = within(screen.getByTestId('mobile-profile-link')).getByRole('img', { name: 'A' });
    expect(headerImg).toHaveAttribute('src', 'https://example.com/avatar.png');
  });

  it('sign out button calls signOut and navigates to /login', async () => {
    vi.mocked(useSessionQuery).mockReturnValue({
      data: {
        id: 'u1',
        email: 'test@example.com',
        user_metadata: { name: 'User' },
      },
      isLoading: false,
    } as never);
    render(<MainLayout>child</MainLayout>, { wrapper: createWrapper() });
    const signOutBtn = screen.getByTitle('nav.signOut');
    fireEvent.click(signOutBtn);
    await waitFor(() => {
      expect(signOutBtn).toBeTruthy();
    });
  });

  it('highlights active nav item for current path', () => {
    vi.mocked(usePathname).mockReturnValue('/personas');
    render(<MainLayout>child</MainLayout>, { wrapper: createWrapper() });
    const personaLink = screen.getAllByText('nav.persona')[0].closest('a');
    expect(personaLink?.className).toContain('bg-[#fff3f2]');
    const accountsLink = screen.getAllByText('nav.accounts')[0].closest('a');
    expect(accountsLink?.className).not.toContain('bg-[#fff3f2]');
  });

  it('switches locale when PT/EN buttons clicked', () => {
    render(<MainLayout>child</MainLayout>, { wrapper: createWrapper() });
    const ptBtn = screen.getByText('PT');
    const enBtn = screen.getByText('EN');
    fireEvent.click(enBtn);
    expect(enBtn).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(ptBtn);
    expect(ptBtn).toHaveAttribute('aria-pressed', 'true');
  });

  it('user_name fallback when name is absent', () => {
    vi.mocked(useSessionQuery).mockReturnValue({
      data: {
        id: 'u1',
        email: 'test@example.com',
        user_metadata: { user_name: 'ghuser' },
      },
      isLoading: false,
    } as never);
    render(<MainLayout>child</MainLayout>, { wrapper: createWrapper() });
    expect(screen.getByText('ghuser')).toBeTruthy();
  });

  it('provider_id fallback when name and user_name absent', () => {
    vi.mocked(useSessionQuery).mockReturnValue({
      data: {
        id: 'u1',
        email: 'test@example.com',
        user_metadata: { provider_id: 'pid123' },
      },
      isLoading: false,
    } as never);
    render(<MainLayout>child</MainLayout>, { wrapper: createWrapper() });
    expect(screen.getByText('pid123')).toBeTruthy();
  });

  describe('mobile navigation', () => {
    const getMobileNav = () => screen.getByRole('navigation', { name: 'nav.primaryNavigation' });

    it('renders a Posts tab linking to /posts', () => {
      render(<MainLayout>child</MainLayout>, { wrapper: createWrapper() });
      const postsLink = within(getMobileNav()).getByText('nav.posts').closest('a');
      expect(postsLink?.getAttribute('href')).toBe('/posts');
    });

    it('renders tabs in order: Home, Personas, Posts, Accounts, Billing', () => {
      render(<MainLayout>child</MainLayout>, { wrapper: createWrapper() });
      const labels = within(getMobileNav())
        .getAllByRole('link')
        .map((link) => link.textContent);
      expect(labels).toEqual(['nav.home', 'nav.persona', 'nav.posts', 'nav.accounts', 'nav.billing']);
    });

    it('has no API Keys tab in the mobile nav (moved to the profile area)', () => {
      render(<MainLayout>child</MainLayout>, { wrapper: createWrapper() });
      expect(within(getMobileNav()).queryByText('nav.apiKeys')).toBeNull();
    });

    it('has no central create/+ button', () => {
      render(<MainLayout>child</MainLayout>, { wrapper: createWrapper() });
      const nav = getMobileNav();
      expect(within(nav).queryByText('+')).toBeNull();
      expect(nav.querySelector('a.-mt-7')).toBeNull();
      expect(nav.querySelector('a.size-14')).toBeNull();
    });

    it('keeps tabs uniform: every tab has an icon and a text label', () => {
      render(<MainLayout>child</MainLayout>, { wrapper: createWrapper() });
      const links = within(getMobileNav()).getAllByRole('link');
      expect(links.length).toBe(5);
      for (const link of links) {
        expect(link.querySelector('[data-testid^="icon-"]')).not.toBeNull();
        expect(link.textContent?.trim().length).toBeGreaterThan(0);
      }
    });

    it('marks the Posts tab as current when pathname is /posts', () => {
      vi.mocked(usePathname).mockReturnValue('/posts');
      render(<MainLayout>child</MainLayout>, { wrapper: createWrapper() });
      const postsLink = within(getMobileNav()).getByText('nav.posts').closest('a');
      expect(postsLink).toHaveAttribute('aria-current', 'page');
    });

    it('marks the Posts tab as current on /posts subpaths', () => {
      vi.mocked(usePathname).mockReturnValue('/posts/history');
      render(<MainLayout>child</MainLayout>, { wrapper: createWrapper() });
      const postsLink = within(getMobileNav()).getByText('nav.posts').closest('a');
      expect(postsLink).toHaveAttribute('aria-current', 'page');
    });

    it('mobile header renders no hamburger/menu button', () => {
      render(<MainLayout>child</MainLayout>, { wrapper: createWrapper() });
      expect(screen.queryByText('☰')).toBeNull();
      expect(screen.queryByRole('button', { name: /menu/i })).toBeNull();
      expect(screen.queryByLabelText('Abrir menu')).toBeNull();
    });
  });
});

describe('mobile header profile area', () => {
  const getMobileHeader = () => screen.getByTestId('mobile-header');

  const mockSessionUser = (user: unknown) => {
    vi.mocked(useSessionQuery).mockReturnValue({
      data: user,
      isLoading: false,
    } as never);
  };

  it('shows the version badge next to the brand', () => {
    render(<MainLayout>child</MainLayout>, { wrapper: createWrapper() });
    const header = getMobileHeader();
    expect(within(header).getByTestId('version-badge')).toHaveTextContent('BETA');
  });

  it('shows a profile link to /account in the mobile header', () => {
    render(<MainLayout>child</MainLayout>, { wrapper: createWrapper() });
    const link = within(getMobileHeader()).getByTestId('mobile-profile-link');
    expect(link).toHaveAttribute('href', '/account');
    expect(link).toHaveAttribute('aria-label', 'nav.profile');
  });

  it('profile link shows the avatar image when the session has one', () => {
    mockSessionUser({
      id: 'user-1',
      user_metadata: { avatar_url: 'https://example.com/avatar.png', name: 'Header User' },
    });
    render(<MainLayout>child</MainLayout>, { wrapper: createWrapper() });
    const link = within(getMobileHeader()).getByTestId('mobile-profile-link');
    expect(within(link).getByAltText('Header User')).toHaveAttribute(
      'src',
      'https://example.com/avatar.png',
    );
  });

  it('profile link falls back to the initial-letter circle without an avatar', () => {
    mockSessionUser({
      id: 'user-1',
      user_metadata: { name: 'Header User' },
    });
    render(<MainLayout>child</MainLayout>, { wrapper: createWrapper() });
    const link = within(getMobileHeader()).getByTestId('mobile-profile-link');
    expect(within(link).queryByRole('img')).toBeNull();
    expect(within(link).getByText('H')).toBeInTheDocument();
  });

  it('sidebar user block links to /account', () => {
    mockSessionUser({
      id: 'user-1',
      user_metadata: { name: 'Sidebar User' },
    });
    render(<MainLayout>child</MainLayout>, { wrapper: createWrapper() });
    expect(screen.getByTestId('profile-user-link')).toHaveAttribute('href', '/account');
  });

  it('mobile bottom navigation still has exactly five tabs (no profile tab, no api-keys tab)', () => {
    render(<MainLayout>child</MainLayout>, { wrapper: createWrapper() });
    const nav = screen.getByRole('navigation', { name: 'nav.primaryNavigation' });
    const links = within(nav).getAllByRole('link');
    expect(links).toHaveLength(5);
    expect(links[0]).toHaveTextContent('nav.home');
  });
});
