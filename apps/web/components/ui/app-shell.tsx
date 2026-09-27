'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { useSessionQuery } from '@/lib/api';
import { useI18n } from '@/lib/i18n/provider';
import { LOCALES } from '@/lib/i18n';
import { useDebugStore } from '@/lib/debug-store';
import { TokenBalance } from '@/app/(main)/token-balance';
import { InsufficientTokensDialog } from '@/components/ui/insufficient-tokens-dialog';
import {
  AccountsIcon,
  BoltIcon,
  CoinsIcon,
  HistoryIcon,
  HomeIcon,
  SparklesIcon,
  BugIcon,
  KeyIcon,
} from '@/lib/ui';

//---------------
// NavItem — definition of a sidebar tab
//---------------
interface NavItem {
  href: string;
  labelKey: 'nav.home' | 'nav.accounts' | 'nav.persona' | 'nav.posts' | 'nav.billing' | 'nav.apiKeys' | 'nav.debug';
  hintKey: 'nav.homeHint' | 'nav.accountsHint' | 'nav.personaHint' | 'nav.postsHint' | 'nav.billingHint' | 'nav.apiKeysHint' | 'nav.debugHint';
  icon: () => React.JSX.Element;
}

//---------------
// AppShell — authenticated shell with Arc-browser-style fixed sidebar.
// Shared by the (main) layout.
//---------------
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-dvh overflow-hidden bg-[#f7f8fa]">
      <MainSidebar />
      <main className="min-w-0 flex-1 overflow-y-auto bg-[#f7f8fa]">
        <MobileHeader />
        <div className="w-full px-4 pt-4 pb-20 sm:px-6 md:px-8 md:pt-8 md:pb-10 lg:px-10">{children}</div>
      </main>
      <MobileNavigation />
      <InsufficientTokensDialog />
    </div>
  );
}

/* -----------------
   Local Components
------------------ */

//---------------
// MainSidebar — dark sidebar with vertical tabs, Arc-inspired
//---------------
const MainSidebar = () => {
  const pathname = usePathname();
  const { t, locale, setLocale } = useI18n();
  const registerClick = useDebugStore((s) => s.registerClick);
  const debugMode = useDebugStore((s) => s.debugMode);

  const navItems: Array<NavItem> = [
    { href: '/', labelKey: 'nav.home', hintKey: 'nav.homeHint', icon: HomeIcon },
    { href: '/accounts', labelKey: 'nav.accounts', hintKey: 'nav.accountsHint', icon: AccountsIcon },
    { href: '/personas', labelKey: 'nav.persona', hintKey: 'nav.personaHint', icon: SparklesIcon },
    { href: '/posts', labelKey: 'nav.posts', hintKey: 'nav.postsHint', icon: HistoryIcon },
    { href: '/billing', labelKey: 'nav.billing', hintKey: 'nav.billingHint', icon: CoinsIcon },
    { href: '/api-keys', labelKey: 'nav.apiKeys', hintKey: 'nav.apiKeysHint', icon: KeyIcon },
  ];

  return (
    <aside className="sticky top-0 hidden h-screen w-[clamp(300px,30vw,400px)] shrink-0 flex-col border-r border-[#edf0f4] bg-white shadow-[8px_0_28px_rgba(20,32,51,0.03)] md:flex">
      <button
        type="button"
        data-testid="nav-brand"
        onClick={registerClick}
        aria-label={t('nav.brand')}
        className="group flex items-center gap-3 px-5 pt-8 pb-6 text-left transition-colors hover:bg-[#fff8f7] lg:gap-4 lg:px-10 lg:pt-10 lg:pb-8"
      >
        <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[#ff544c] text-white shadow-[0_10px_24px_rgba(255,84,76,0.18)] transition-transform group-hover:rotate-3 lg:size-[68px] lg:rounded-[27px] [&>svg]:size-6 lg:[&>svg]:size-9">
          <BoltIcon />
        </span>
        <div className="hidden min-w-0 md:block">
          <p className="text-[19px] leading-tight font-bold tracking-[-0.03em] text-[#101728]">{t('nav.brand')}</p>
          <p className="text-[15px] leading-snug text-[#718096] lg:text-[16px]">{t('nav.brandSubtitle')}</p>
        </div>
      </button>

      <nav className="flex-1 space-y-1.5 px-3.5 py-6 lg:space-y-2 lg:px-7 lg:py-8">
        {navItems.map((item) => {
          const isActive = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          return (
            <SidebarTab key={item.href} item={item} isActive={isActive} />
          );
        })}
        {debugMode ? <DebugModeIndicator /> : null}
      </nav>

      <div className="space-y-3 border-t border-[#edf0f4] bg-white p-4 lg:p-6">
        <LocaleSwitcher locale={locale} setLocale={setLocale} />
        <TokenBalance />
        <SidebarUser />
        <SidebarLegalLinks />
      </div>
    </aside>
  );
};

//---------------
// SidebarTab — individual tab with icon, label and active highlight
//---------------
const SidebarTab = ({ item, isActive }: { item: NavItem; isActive: boolean }) => {
  const { t } = useI18n();
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      title={t(item.labelKey)}
      className={`group relative flex items-center gap-3 rounded-[20px] px-4 py-3.5 transition-colors lg:gap-5 lg:rounded-[24px] lg:px-8 lg:py-5 ${
        isActive
          ? 'bg-[#fff3f2] text-[#101728]'
          : 'text-[#657184] hover:bg-[#f8fafc] hover:text-[#101728]'
      }`}
    >
      <span className={`shrink-0 [&>svg]:size-6 lg:[&>svg]:size-8 ${isActive ? 'text-[#ff544c]' : 'text-[#657184] group-hover:text-[#101728]'}`}>
        <Icon />
      </span>
      <span className="hidden min-w-0 text-[16px] leading-snug font-medium tracking-[-0.02em] md:block lg:text-[20px]">{t(item.labelKey)}</span>
    </Link>
  );
};

//---------------
// DebugModeIndicator — visual indicator (non-clickable) that debug mode
// is unlocked: BugIcon + "DEBUG MODE" in the sidebar tab style.
//---------------
const DebugModeIndicator = () => (
  <div
    role="status"
    aria-label="DEBUG MODE active"
    className="flex items-center gap-3 rounded-[20px] bg-amber-50 px-4 py-3 lg:gap-5 lg:rounded-[24px] lg:px-8 lg:py-5"
  >
    <span className="shrink-0 text-amber-600 [&>svg]:size-6 lg:[&>svg]:size-8">
      <BugIcon />
    </span>
    <span className="hidden min-w-0 text-[16px] leading-snug font-semibold tracking-[0.08em] text-amber-700 md:block lg:text-[18px]">
      DEBUG MODE
    </span>
  </div>
);

//---------------
// MobileHeader — compact brand for small screens.
//---------------
const MobileHeader = () => {
  const { t } = useI18n();
  return (
    <header className="flex items-center border-b border-[#d8e4ec] bg-white/90 px-5 py-4 shadow-[0_2px_12px_rgba(13,43,69,0.04)] backdrop-blur md:hidden">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-[#ff5a4e] text-white [&>svg]:size-4"><BoltIcon /></span>
        <span className="truncate text-sm font-bold text-[#0d2b45]">{t('nav.brand')}</span>
      </div>
    </header>
  );
};

//---------------
// MobileNavigation — fixed bottom navigation with uniform tabs.
//---------------
const MobileNavigation = () => {
  const { t } = useI18n();
  const pathname = usePathname();

  const tabs: Array<{
    href: string;
    labelKey: NavItem['labelKey'];
    icon: () => React.JSX.Element;
    isActive: boolean;
  }> = [
    { href: '/', labelKey: 'nav.home', icon: HomeIcon, isActive: pathname === '/' },
    { href: '/personas', labelKey: 'nav.persona', icon: SparklesIcon, isActive: pathname.startsWith('/persona') },
    { href: '/posts', labelKey: 'nav.posts', icon: HistoryIcon, isActive: pathname.startsWith('/posts') },
    { href: '/accounts', labelKey: 'nav.accounts', icon: AccountsIcon, isActive: pathname.startsWith('/accounts') },
    { href: '/api-keys', labelKey: 'nav.apiKeys', icon: KeyIcon, isActive: pathname.startsWith('/api-keys') },
    { href: '/billing', labelKey: 'nav.billing', icon: CoinsIcon, isActive: pathname.startsWith('/billing') },
  ];

  return (
    <nav aria-label={t('nav.primaryNavigation')} className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-around border-t border-[#d8e4ec] bg-white/95 px-2 pt-2 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={tab.isActive ? 'page' : undefined}
            className={`flex flex-col items-center gap-0.5 px-3 text-xs ${tab.isActive ? 'font-semibold text-[#0d2b45]' : 'text-[#60758a]'}`}
          >
            <span className="[&>svg]:size-5"><Icon /></span>
            <span>{t(tab.labelKey)}</span>
          </Link>
        );
      })}
    </nav>
  );
};

//---------------
// LocaleSwitcher — PT/EN language switcher in the sidebar footer.
//---------------
const LocaleSwitcher = ({
  locale,
  setLocale,
}: {
  locale: string;
  setLocale: (locale: 'pt' | 'en') => void;
}) => (
  <div className="flex items-center justify-center gap-1 rounded-xl border border-[#edf0f4] bg-[#f8fafc] p-1 md:justify-start">
    {LOCALES.map((option) => {
      const isActive = option.value === locale;
      return (
        <button
          key={option.value}
          type="button"
          onClick={() => setLocale(option.value)}
          aria-pressed={isActive}
          className={`flex-1 rounded-lg px-2 py-1 text-[11px] font-semibold transition-colors md:flex-none md:px-3 ${
            isActive
              ? 'bg-white text-[#101728] shadow-sm'
              : 'text-[#718096] hover:bg-white hover:text-[#101728]'
          }`}
        >
          {option.label}
        </button>
      );
    })}
  </div>
);

//---------------
// SidebarLegalLinks — privacy, terms and support links in the sidebar footer
//---------------
const SidebarLegalLinks = () => {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-xs text-[#8a94a8]">
      <Link href="/privacy" className="hover:text-[#101728]">{t('footer.privacy')}</Link>
      <Link href="/terms" className="hover:text-[#101728]">{t('footer.terms')}</Link>
      <a href="mailto:support@post-engineer.com" className="hover:text-[#101728]">{t('footer.support')}</a>
    </div>
  );
};

//---------------
// SidebarUser — logged-in user with avatar and sign out
//---------------
const SidebarUser = () => {
  const sessionQuery = useSessionQuery();
  const router = useRouter();
  const { t } = useI18n();

  const user = sessionQuery.data;

  if (!user) {
    return null;
  }

  // Type guards to extract avatar and name from user_metadata
  const metadata = user.user_metadata;
  const avatarUrl =
    typeof metadata?.avatar_url === 'string' ? metadata.avatar_url : undefined;
  const userName =
    typeof metadata?.name === 'string'
      ? metadata.name
      : typeof metadata?.user_name === 'string'
        ? metadata.user_name
        : typeof metadata?.provider_id === 'string'
          ? metadata.provider_id
          : undefined;

  const handleSignOut = async () => {
    const { createSupabaseClient } = await import('@/lib/supabase/client');
    const supabase = createSupabaseClient();
    await supabase.auth.signOut();
    router.push('/login');
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 border-t border-[#edf0f4] px-1 pt-4 lg:gap-3 lg:pt-5">
        {avatarUrl ? (
          <div className="relative size-10 shrink-0 overflow-hidden rounded-full bg-[#e8edf2] ring-2 ring-white lg:size-12">
            <Image
              src={avatarUrl}
              alt={userName || 'User'}
              fill
              sizes="32px"
              className="object-cover"
            />
          </div>
        ) : (
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#e8edf2] text-sm font-semibold text-[#657184] ring-2 ring-white lg:size-12">
            {userName?.charAt(0).toUpperCase() || 'U'}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[15px] leading-tight font-semibold tracking-[-0.02em] text-[#101728] lg:text-[18px]">
            {userName || 'GitHub User'}
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={handleSignOut}
        title={t('nav.signOut')}
        className="flex w-full items-center gap-3.5 rounded-[18px] bg-[#f8fafc] px-4 py-3 text-left text-[15px] text-[#718096] transition-colors hover:bg-[#f1f4f7] hover:text-[#101728] lg:gap-5 lg:rounded-[22px] lg:px-8 lg:py-4 lg:text-[18px]"
      >
        <svg className="size-5 lg:size-7" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.7} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0-4-4m4 4H7m6 4v1a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3h4a3 3 0 0 1 3 3v1" />
        </svg>
        {t('nav.signOut')}
      </button>
    </div>
  );
};
