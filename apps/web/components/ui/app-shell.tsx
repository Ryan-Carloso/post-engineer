'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useI18n } from '@/lib/i18n/provider';
import { AccountPanel, MobileProfileLink } from '@/components/ui/account-panel';
import { InsufficientTokensDialog } from '@/components/ui/insufficient-tokens-dialog';
import VersionBadge from '@/components/ui/version-badge';
import AppLogo from '@/components/ui/app-logo';
import {
  AccountsIcon,
  CoinsIcon,
  HistoryIcon,
  HomeIcon,
  SparklesIcon,
} from '@/lib/ui';

//---------------
// NavItem — definition of a sidebar tab
//---------------
interface NavItem {
  href: string;
  labelKey: 'nav.home' | 'nav.accounts' | 'nav.persona' | 'nav.posts' | 'nav.billing' | 'nav.debug';
  hintKey: 'nav.homeHint' | 'nav.accountsHint' | 'nav.personaHint' | 'nav.postsHint' | 'nav.billingHint' | 'nav.debugHint';
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
  const { t } = useI18n();

  const navItems: Array<NavItem> = [
    { href: '/', labelKey: 'nav.home', hintKey: 'nav.homeHint', icon: HomeIcon },
    { href: '/accounts', labelKey: 'nav.accounts', hintKey: 'nav.accountsHint', icon: AccountsIcon },
    { href: '/personas', labelKey: 'nav.persona', hintKey: 'nav.personaHint', icon: SparklesIcon },
    { href: '/posts', labelKey: 'nav.posts', hintKey: 'nav.postsHint', icon: HistoryIcon },
    { href: '/billing', labelKey: 'nav.billing', hintKey: 'nav.billingHint', icon: CoinsIcon },
  ];

  return (
    <aside className="sticky top-0 hidden h-screen w-[clamp(300px,30vw,400px)] shrink-0 flex-col border-r border-[#edf0f4] bg-white shadow-[8px_0_28px_rgba(20,32,51,0.03)] md:flex">
      <div
        data-testid="nav-brand"
        aria-label={t('nav.brand')}
        className="group flex items-center gap-3 px-5 pt-8 pb-6 text-left transition-colors hover:bg-[#fff8f7] lg:gap-4 lg:px-10 lg:pt-10 lg:pb-8"
      >
        <span className="shrink-0 transition-transform group-hover:rotate-3">
          <AppLogo size={48} className="shadow-[0_10px_24px_rgba(20,32,51,0.18)] lg:size-[68px]" />
        </span>
        <div className="hidden min-w-0 md:block">
          <p className="text-[19px] leading-tight font-bold tracking-[-0.03em] text-[#101728]">
            {t('nav.brand')}
            <VersionBadge />
          </p>
          <p className="text-[15px] leading-snug text-[#718096] lg:text-[16px]">{t('nav.brandSubtitle')}</p>
        </div>
      </div>

      <nav className="flex-1 space-y-1.5 px-3.5 py-6 lg:space-y-2 lg:px-7 lg:py-8">
        {navItems.map((item) => (
          <SidebarTab key={item.href} item={item} isActive={pathname.startsWith(item.href)} />
        ))}
      </nav>

      <div className="space-y-3 border-t border-[#edf0f4] bg-white p-4 lg:p-6">
        <AccountPanel />
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
// MobileHeader — compact brand for small screens, with the version badge
// and the profile avatar linking to /account.
//---------------
const MobileHeader = () => {
  const { t } = useI18n();
  return (
    <header data-testid="mobile-header" className="flex items-center border-b border-[#d8e4ec] bg-white/90 px-5 py-4 shadow-[0_2px_12px_rgba(13,43,69,0.04)] backdrop-blur md:hidden">
      <div className="flex min-w-0 items-center gap-2.5">
        <AppLogo size={28} className="rounded-lg" />
        <span className="truncate text-sm font-bold text-[#0d2b45]">{t('nav.brand')}</span>
        <VersionBadge />
      </div>
      <MobileProfileLink />
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
    { href: '/posts', labelKey: 'nav.posts', icon: HistoryIcon, isActive: pathname.startsWith('/posts') },
    { href: '/personas', labelKey: 'nav.persona', icon: SparklesIcon, isActive: pathname.startsWith('/persona') },
    { href: '/accounts', labelKey: 'nav.accounts', icon: AccountsIcon, isActive: pathname.startsWith('/accounts') },
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
// SidebarLegalLinks — privacy, terms and support links in the sidebar footer
//---------------
const SidebarLegalLinks = () => {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-xs text-[#8a94a8]">
      <Link href="/privacy" className="hover:text-[#101728]">{t('footer.privacy')}</Link>
      <Link href="/terms" className="hover:text-[#101728]">{t('footer.terms')}</Link>
      <a href="mailto:madebyryandev@gmail.com" className="hover:text-[#101728]">{t('footer.support')}</a>
    </div>
  );
};
