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
  default: ({ alt, ...props }: React.ComponentProps<'img'>) => <img alt={alt} {...props} />,
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

vi.mock('@/lib/approval-queue', () => ({
  APPROVAL_QUEUE_LIMIT: 200,
  useApprovalQueue: vi.fn(() => ({ slots: [], count: 0, isLoading: false, isError: false })),
  isSlotExpired: vi.fn(() => false),
}));

vi.mock('@/lib/ui', () => ({
  AccountsIcon: () => <span data-testid="icon-accounts" />,
  BoltIcon: () => <span data-testid="icon-bolt" />,
  KeyIcon: () => <span data-testid="icon-key" />,
  GlobeIcon: () => <span data-testid="icon-globe" />,
  CoinsIcon: () => <span data-testid="icon-coins" />,
  ComposeIcon: () => <span data-testid="icon-compose" />,
  ProfileIcon: () => <span data-testid="icon-profile" />,
  ChartIcon: () => <span data-testid="icon-chart" />,
  CalendarIcon: () => <span data-testid="icon-calendar" />,
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

vi.mock('@/lib/i18n/provider', async () => {
  const react = await vi.importActual<typeof import('react')>('react');
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
import { SUPPORT_EMAIL } from '@/components/ui/pricing-contact';
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

  it('renders the sidebar tabs in order: Posts, Networks, Personas, Metrics, Prompts', () => {
    render(<MainLayout>child</MainLayout>, { wrapper: createWrapper() });
    const sidebar = screen.getByTestId('nav-brand').closest('aside');
    const nav = within(sidebar as HTMLElement).getByRole('navigation');
    const titles = within(nav)
      .getAllByRole('link')
      .map((link) => link.getAttribute('title'));
    expect(titles).toEqual(['nav.posts', 'nav.accounts', 'nav.persona', 'nav.metrics', 'nav.prompts']);
  });

  it('support link uses the shared support email, not a hardcoded copy', () => {
    render(<MainLayout>child</MainLayout>, { wrapper: createWrapper() });
    const sidebar = screen.getByTestId('nav-brand').closest('aside');
    const supportLinks = within(sidebar as HTMLElement).getAllByText('footer.support');
    expect(supportLinks.length).toBeGreaterThan(0);
    for (const link of supportLinks) {
      expect(link.closest('a')).toHaveAttribute('href', `mailto:${SUPPORT_EMAIL}`);
    }
  });

  it('lists Posts as the first navigation tab, linking to /posts', () => {
    render(<MainLayout>child</MainLayout>, { wrapper: createWrapper() });
    const sidebar = screen.getByTestId('nav-brand').closest('aside');
    const firstTab = within(sidebar as HTMLElement).getAllByRole('link')[0];
    expect(firstTab).toHaveAttribute('title', 'nav.posts');
    expect(firstTab).toHaveAttribute('href', '/posts');
  });

  it('posts tab links to /posts', () => {
    render(<MainLayout>child</MainLayout>, { wrapper: createWrapper() });
    const postsLink = screen.getAllByText('nav.posts')[0].closest('a');
    expect(postsLink?.getAttribute('href')).toBe('/posts');
  });

  it('prompts tab links to /recipes', () => {
    render(<MainLayout>child</MainLayout>, { wrapper: createWrapper() });
    const promptsLink = screen.getAllByText('nav.prompts')[0].closest('a');
    expect(promptsLink?.getAttribute('href')).toBe('/recipes');
  });

  it('does not render a Billing tab in the sidebar nav', () => {
    render(<MainLayout>child</MainLayout>, { wrapper: createWrapper() });
    const sidebar = screen.getByTestId('nav-brand').closest('aside');
    const nav = within(sidebar as HTMLElement).getByRole('navigation');
    expect(within(nav).queryByText('nav.billing')).toBeNull();
  });

  it('does not duplicate the API keys row in the sidebar footer when the nav tab already links there', () => {
    vi.mocked(useSessionQuery).mockReturnValue({
      data: {
        id: 'u1',
        email: 'test@example.com',
        user_metadata: { name: 'User' },
      },
      isLoading: false,
    } as never);
    render(<MainLayout>child</MainLayout>, { wrapper: createWrapper() });
    const footer = document.querySelector('[data-sidebar-footer]');
    expect(footer).not.toBeNull();
    expect(within(footer as HTMLElement).queryByTestId('profile-api-keys-link')).not.toBeInTheDocument();
    expect(screen.getAllByTitle('nav.prompts').length).toBeGreaterThanOrEqual(1);
  });

  it('renders locale switcher', () => {
    render(<MainLayout>child</MainLayout>, { wrapper: createWrapper() });
    expect(screen.getByText('PT')).toBeTruthy();
    expect(screen.getByText('EN')).toBeTruthy();
  });

  it('renders no token balance badge and no billing link', () => {
    render(<MainLayout>child</MainLayout>, { wrapper: createWrapper() });
    expect(screen.queryByTestId('token-balance')).toBeNull();
    expect(screen.queryByTestId('profile-billing-link')).toBeNull();
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
    const sidebarImg = within(screen.getByTestId('profile-user-link')).getByRole('img', { name: 'A' });
    expect(sidebarImg).toHaveAttribute('src', 'https://example.com/avatar.png');
    const headerImg = within(screen.getByTestId('mobile-profile-link')).getByRole('img', { name: 'A' });
    expect(headerImg).toHaveAttribute('src', 'https://example.com/avatar.png');
  });

  it('scrolls the sidebar footer so sign out stays reachable', () => {
    vi.mocked(useSessionQuery).mockReturnValue({
      data: { id: 'u1', email: 'test@example.com', user_metadata: { name: 'User' } },
      isLoading: false,
    } as never);
    render(<MainLayout>child</MainLayout>, { wrapper: createWrapper() });
    const footer = document.querySelector('[data-sidebar-footer]');
    expect(footer).not.toBeNull();
    expect(footer?.className.split(/\s+/)).toContain('overflow-y-auto');
    expect(within(footer as HTMLElement).getByTitle('nav.signOut')).toBeInTheDocument();
    const aside = screen.getByTestId('nav-brand').closest('aside');
    expect(aside?.className.split(/\s+/)).toContain('overflow-hidden');
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
    expect(personaLink?.className).toContain('bg-brand-soft');
    const accountsLink = screen.getAllByText('nav.accounts')[0].closest('a');
    expect(accountsLink?.className).not.toContain('bg-brand-soft');
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

    it('renders tab links in order: Posts, Metrics, Networks, Prompts', () => {
      render(<MainLayout>child</MainLayout>, { wrapper: createWrapper() });
      const labels = within(getMobileNav())
        .getAllByRole('link')
        .map((link) => link.textContent);
      expect(labels).toEqual(['nav.posts', 'nav.metrics', 'nav.accounts', 'nav.promptsShort']);
    });

    it('has no Billing tab in the mobile nav (moved to the profile area)', () => {
      render(<MainLayout>child</MainLayout>, { wrapper: createWrapper() });
      expect(within(getMobileNav()).queryByText('nav.billing')).toBeNull();
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
      expect(links.length).toBe(4);
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

    it('on /personas highlights Personas in the sidebar and More in the bottom bar', () => {
      vi.mocked(usePathname).mockReturnValue('/personas');
      render(<MainLayout>child</MainLayout>, { wrapper: createWrapper() });
      expect(within(getMobileNav()).getByRole('button', { name: 'nav.more' }).className).toContain('font-semibold');
      const sidebar = within(screen.getByTestId('nav-brand').closest('aside') as HTMLElement);
      expect(sidebar.getByTitle('nav.persona').className).toContain('bg-brand-soft');
      expect(sidebar.getByTitle('nav.metrics').className).not.toContain('bg-brand-soft');
    });

    it.each([
      ['/posts/abc', '/posts'],
      ['/personas/abc', '/personas'],
      ['/accounts/abc', '/accounts'],
      ['/recipes/daily-news', '/recipes'],
    ])('on %s marks only the %s tab as current in both navs', (pathname, href) => {
      vi.mocked(usePathname).mockReturnValue(pathname);
      render(<MainLayout>child</MainLayout>, { wrapper: createWrapper() });

      const mobileLinks = within(getMobileNav()).getAllByRole('link');
      for (const link of mobileLinks) {
        const active = link.getAttribute('href') === href;
        expect(link.getAttribute('aria-current')).toBe(active ? 'page' : null);
        expect(link.className).toContain('flex-col');
        expect(link.className).toContain(active ? 'font-semibold' : 'text-muted-text');
      }

      const sidebar = screen.getByTestId('nav-brand').closest('aside');
      const sidebarLinks = within(within(sidebar as HTMLElement).getByRole('navigation')).getAllByRole('link');
      const activeSidebar = sidebarLinks.filter((link) => link.className.includes('bg-brand-soft'));
      expect(activeSidebar.map((link) => link.getAttribute('href'))).toEqual([href]);
      for (const link of sidebarLinks) {
        const active = activeSidebar.includes(link);
        const iconSpan = link.querySelector('span');
        expect(link.className).toContain(active ? 'bg-brand-soft' : 'hover:bg-surface');
        expect(iconSpan?.className).toContain('shrink-0');
        expect(iconSpan?.className).toContain(active ? 'text-brand' : 'group-hover:text-ink');
      }
    });

    it('marks no tab as current on the root path', () => {
      vi.mocked(usePathname).mockReturnValue('/');
      render(<MainLayout>child</MainLayout>, { wrapper: createWrapper() });
      const current = within(getMobileNav())
        .getAllByRole('link')
        .filter((link) => link.getAttribute('aria-current') === 'page');
      expect(current).toHaveLength(0);
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

  it('shows a profile avatar link to /account, falling back to the initial', () => {
    mockSessionUser({ id: 'user-1', user_metadata: { name: 'Header User' } });
    render(<MainLayout>child</MainLayout>, { wrapper: createWrapper() });
    const link = within(getMobileHeader()).getByTestId('mobile-profile-link');
    expect(link).toHaveAttribute('href', '/account');
    expect(link).toHaveAttribute('aria-label', 'nav.profile');
    expect(within(link).queryByRole('img')).toBeNull();
    expect(within(link).getByText('H')).toBeInTheDocument();
  });

  it('More opens a sheet linking Personas (not the profile, no billing)', async () => {
    render(<MainLayout>child</MainLayout>, { wrapper: createWrapper() });
    fireEvent.click(screen.getByRole('button', { name: 'nav.more' }));
    const sheet = await screen.findByRole('dialog', { name: 'nav.moreTitle' });
    expect(within(sheet).getByText('nav.persona').closest('a')).toHaveAttribute('href', '/personas');
    expect(within(sheet).queryByText('nav.profile')).toBeNull();
    expect(within(sheet).queryByText('nav.billing')).toBeNull();
  });

  it('More sheet links lay out in two columns with truncating labels', async () => {
    render(<MainLayout>child</MainLayout>, { wrapper: createWrapper() });
    fireEvent.click(screen.getByRole('button', { name: 'nav.more' }));
    const sheet = await screen.findByRole('dialog', { name: 'nav.moreTitle' });
    const list = sheet.querySelector('ul');
    expect(list?.className).toContain('grid-cols-2');
    expect(list?.className).not.toContain('grid-cols-3');
    for (const labelKey of ['nav.persona']) {
      const label = within(sheet).getByText(labelKey);
      expect(label.className).toContain('truncate');
      expect(label.className).toContain('min-w-0');
      const link = label.closest('a') as HTMLElement;
      expect(link.className).toContain('min-w-0');
      const icon = link.querySelector('span');
      expect(icon?.className).toContain('shrink-0');
      expect(link.closest('li')?.className).toContain('min-w-0');
    }
  });

  it('More sheet marks the current link with the active style and aria-current', async () => {
    vi.mocked(usePathname).mockReturnValue('/personas');
    render(<MainLayout>child</MainLayout>, { wrapper: createWrapper() });
    fireEvent.click(screen.getByRole('button', { name: 'nav.more' }));
    const sheet = await screen.findByRole('dialog', { name: 'nav.moreTitle' });
    const activeLink = within(sheet).getByText('nav.persona').closest('a') as HTMLElement;
    expect(activeLink).toHaveAttribute('aria-current', 'page');
    expect(activeLink.className).toContain('bg-brand-soft');
    expect(activeLink.className).not.toContain('bg-surface');
  });

  it('on the /persona editor the More sheet marks Personas as current', async () => {
    vi.mocked(usePathname).mockReturnValue('/persona');
    render(<MainLayout>child</MainLayout>, { wrapper: createWrapper() });
    fireEvent.click(screen.getByRole('button', { name: 'nav.more' }));
    const sheet = await screen.findByRole('dialog', { name: 'nav.moreTitle' });
    const personasLink = within(sheet).getByText('nav.persona').closest('a') as HTMLElement;
    expect(personasLink).toHaveAttribute('href', '/personas');
    expect(personasLink).toHaveAttribute('aria-current', 'page');
    expect(personasLink.className).toContain('bg-brand-soft');
  });

  it('sidebar user block links to /account', () => {
    mockSessionUser({
      id: 'user-1',
      user_metadata: { name: 'Sidebar User' },
    });
    render(<MainLayout>child</MainLayout>, { wrapper: createWrapper() });
    expect(screen.getByTestId('profile-user-link')).toHaveAttribute('href', '/account');
  });

  it('mobile bottom navigation has four tab links plus the More button', () => {
    render(<MainLayout>child</MainLayout>, { wrapper: createWrapper() });
    const nav = screen.getByRole('navigation', { name: 'nav.primaryNavigation' });
    const links = within(nav).getAllByRole('link');
    expect(links).toHaveLength(4);
    expect(links[0]).toHaveTextContent('nav.posts');
    expect(within(nav).getByRole('button', { name: 'nav.more' })).toBeInTheDocument();
  });
});
