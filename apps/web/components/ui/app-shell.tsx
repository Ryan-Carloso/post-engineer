'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Ellipsis } from 'lucide-react';
import { useI18n } from '@/lib/i18n/provider';
import { AccountPanel, MobileProfileLink } from '@/components/ui/account-panel';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { InsufficientTokensDialog } from '@/components/ui/insufficient-tokens-dialog';
import { SUPPORT_EMAIL } from '@/components/ui/pricing-contact';
import VersionBadge from '@/components/ui/version-badge';
import AppLogo from '@/components/ui/app-logo';
import {
  AccountsIcon,
  CalendarIcon,
  ChartIcon,
  CoinsIcon,
  HistoryIcon,
  KeyIcon,
  SparklesIcon,
} from '@/lib/ui';

//---------------
// NavItem — definition of a sidebar tab
//---------------
interface NavItem {
  href: string;
  labelKey: 'nav.accounts' | 'nav.persona' | 'nav.posts' | 'nav.history' | 'nav.metrics' | 'nav.prompts' | 'nav.billing';
  hintKey: 'nav.accountsHint' | 'nav.personaHint' | 'nav.postsHint' | 'nav.historyHint' | 'nav.metricsHint' | 'nav.promptsHint';
  icon: () => React.JSX.Element;
}

const HISTORY_HREF = '/posts/history';

// onRoute — the path is the route or one of its subroutes, matched by whole
// segments (/account never matches /accounts).
function onRoute(route: string, pathname: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`);
}

// isNavActive — a tab is current on its route and subroutes. /posts/history
// is its own entry, so it never also lights up the Posts (calendar) tab.
// The Personas tab (/personas) also covers the /persona editor routes.
function isNavActive(href: string, pathname: string): boolean {
  if (href === '/posts' && onRoute(HISTORY_HREF, pathname)) return false;
  if (href === '/personas') return onRoute(href, pathname) || onRoute('/persona', pathname);
  return onRoute(href, pathname);
}

// Routes reached through the mobile "More" sheet instead of a bottom tab.
const MORE_ROUTES = [HISTORY_HREF, '/metrics', '/billing'];

//---------------
// AppShell — authenticated shell with Arc-browser-style fixed sidebar.
// Shared by the (main) layout.
//---------------
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-dvh overflow-hidden bg-surface">
      <MainSidebar />
      <main className="min-w-0 flex-1 overflow-y-auto bg-surface">
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
// MainSidebar — card-surface sidebar (theme token, light/dark) with vertical tabs, Arc-inspired
//---------------
const MainSidebar = () => {
  const pathname = usePathname();
  const { t } = useI18n();

  const navItems: Array<NavItem> = [
    { href: '/posts', labelKey: 'nav.posts', hintKey: 'nav.postsHint', icon: CalendarIcon },
    { href: HISTORY_HREF, labelKey: 'nav.history', hintKey: 'nav.historyHint', icon: HistoryIcon },
    { href: '/accounts', labelKey: 'nav.accounts', hintKey: 'nav.accountsHint', icon: AccountsIcon },
    { href: '/personas', labelKey: 'nav.persona', hintKey: 'nav.personaHint', icon: SparklesIcon },
    { href: '/metrics', labelKey: 'nav.metrics', hintKey: 'nav.metricsHint', icon: ChartIcon },
    { href: '/recipes', labelKey: 'nav.prompts', hintKey: 'nav.promptsHint', icon: KeyIcon },
  ];

  return (
    <aside className="sticky top-0 hidden h-dvh w-[clamp(260px,22vw,320px)] shrink-0 flex-col overflow-hidden border-r border-hairline bg-card shadow-[8px_0_28px_rgba(20,32,51,0.03)] md:flex">
      <div
        data-testid="nav-brand"
        aria-label={t('nav.brand')}
        className="group flex shrink-0 items-center gap-3 px-5 pt-8 pb-6 text-left transition-colors hover:bg-brand-soft lg:gap-3 lg:px-6 lg:pt-8 lg:pb-6"
      >
        <span className="shrink-0 transition-transform group-hover:rotate-3">
          <AppLogo size={48} className="shadow-[0_10px_24px_rgba(20,32,51,0.18)] lg:size-[56px]" />
        </span>
        <div className="hidden min-w-0 md:block">
          <p className="text-[19px] leading-tight font-bold tracking-[-0.03em] text-ink">
            {t('nav.brand')}
            <VersionBadge />
          </p>
          <p className="text-[13px] leading-snug text-muted-text lg:text-[14px]">{t('nav.brandSubtitle')}</p>
        </div>
      </div>

      <nav className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3.5 py-4 lg:px-4 lg:py-6">
        {navItems.map((item) => (
          <SidebarTab key={item.href} item={item} isActive={isNavActive(item.href, pathname)} />
        ))}
      </nav>

      <div data-sidebar-footer className="max-h-[50%] min-h-0 shrink space-y-3 overflow-y-auto border-t border-hairline bg-card p-4 lg:p-5">
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
      className={`group relative flex items-center gap-3 rounded-[20px] px-4 py-3.5 transition-colors lg:gap-4 lg:rounded-[20px] lg:px-5 lg:py-3.5 ${
        isActive
          ? 'bg-brand-soft text-ink'
          : 'text-muted-text hover:bg-surface hover:text-ink'
      }`}
    >
      <span className={`shrink-0 [&>svg]:size-6 lg:[&>svg]:size-7 ${isActive ? 'text-brand' : 'text-muted-text group-hover:text-ink'}`}>
        <Icon />
      </span>
      <span className="hidden min-w-0 text-[16px] leading-snug font-medium tracking-[-0.02em] md:block lg:text-[18px]">{t(item.labelKey)}</span>
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
    <header data-testid="mobile-header" className="flex items-center border-b border-line bg-card/90 px-5 py-4 shadow-[0_2px_12px_rgba(13,43,69,0.04)] backdrop-blur md:hidden">
      <div className="flex min-w-0 items-center gap-2.5">
        <AppLogo size={28} className="rounded-lg" />
        <span className="truncate text-sm font-bold text-primary">{t('nav.brand')}</span>
        <VersionBadge />
      </div>
      <MobileProfileLink />
    </header>
  );
};

//---------------
// MobileNavigation — fixed bottom navigation: four uniform tabs plus "More",
// a bottom sheet linking History, Metrics and Tokens (/billing). The profile
// (/account) is the avatar in the mobile header.
//---------------
const MOBILE_TAB_CLASS = 'flex min-w-0 flex-1 flex-col items-center gap-0.5 px-1 text-center text-xs leading-tight';

const MobileNavigation = () => {
  const { t } = useI18n();
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  // Any navigation (a link inside the sheet included) closes the sheet.
  useEffect(() => setMoreOpen(false), [pathname]);

  const tabs: Array<{
    href: string;
    labelKey: NavItem['labelKey'];
    // Short label for tabs whose full label wraps in a ~70px tab.
    // The sidebar keeps the full label.
    shortLabelKey?: 'nav.promptsShort';
    icon: () => React.JSX.Element;
  }> = [
    { href: '/posts', labelKey: 'nav.posts', icon: CalendarIcon },
    { href: '/personas', labelKey: 'nav.persona', icon: SparklesIcon },
    { href: '/accounts', labelKey: 'nav.accounts', icon: AccountsIcon },
    { href: '/recipes', labelKey: 'nav.prompts', shortLabelKey: 'nav.promptsShort', icon: KeyIcon },
  ];
  const moreLinks: Array<{ href: string; labelKey: NavItem['labelKey']; icon: () => React.JSX.Element }> = [
    { href: HISTORY_HREF, labelKey: 'nav.history', icon: HistoryIcon },
    { href: '/metrics', labelKey: 'nav.metrics', icon: ChartIcon },
    { href: '/billing', labelKey: 'nav.billing', icon: CoinsIcon },
  ];
  const moreActive = MORE_ROUTES.some((route) => onRoute(route, pathname));

  return (
    <nav aria-label={t('nav.primaryNavigation')} className="fixed inset-x-0 bottom-0 z-30 flex items-start justify-around border-t border-line bg-card/95 px-1 pt-2 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = isNavActive(tab.href, pathname) && !moreActive;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={isActive ? 'page' : undefined}
            className={`${MOBILE_TAB_CLASS} ${isActive ? 'font-semibold text-primary' : 'text-muted-text'}`}
          >
            <span className="[&>svg]:size-5"><Icon /></span>
            <span className="whitespace-nowrap">{t(tab.shortLabelKey ?? tab.labelKey)}</span>
          </Link>
        );
      })}
      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetTrigger className={`${MOBILE_TAB_CLASS} ${moreActive ? 'font-semibold text-primary' : 'text-muted-text'}`}>
          <Ellipsis className="size-5" aria-hidden />
          <span className="whitespace-nowrap">{t('nav.more')}</span>
        </SheetTrigger>
        <SheetContent side="bottom" aria-describedby={undefined} className="rounded-t-3xl bg-card pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">
          <SheetTitle className="text-base text-primary">{t('nav.moreTitle')}</SheetTitle>
          <ul className="mt-4 grid grid-cols-3 gap-2">
            {moreLinks.map((link) => {
              const Icon = link.icon;
              const isActive = onRoute(link.href, pathname);
              return (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    aria-current={isActive ? 'page' : undefined}
                    className={`flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-medium ${isActive ? 'bg-brand-soft text-ink' : 'bg-surface text-muted-text'}`}
                  >
                    <span className="[&>svg]:size-5"><Icon /></span>
                    {t(link.labelKey)}
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="mt-4">
            <SidebarLegalLinks />
          </div>
        </SheetContent>
      </Sheet>
    </nav>
  );
};

//---------------
// SidebarLegalLinks — privacy, terms and support links in the sidebar footer
//---------------
const SidebarLegalLinks = () => {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-xs text-faint">
      <Link href="/privacy" className="hover:text-ink">{t('footer.privacy')}</Link>
      <Link href="/terms" className="hover:text-ink">{t('footer.terms')}</Link>
      <a href={`mailto:${SUPPORT_EMAIL}`} className="hover:text-ink">{t('footer.support')}</a>
    </div>
  );
};
