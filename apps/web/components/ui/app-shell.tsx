'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Ellipsis } from 'lucide-react';
import { useI18n } from '@/lib/i18n/provider';
import { AccountPanel, MobileProfileLink } from '@/components/ui/account-panel';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { SUPPORT_EMAIL } from '@/components/ui/pricing-contact';
import VersionBadge from '@/components/ui/version-badge';
import AppLogo from '@/components/ui/app-logo';
import { AccessNotice } from '@/components/access-notice';
import { APPROVAL_QUEUE_LIMIT, useApprovalQueue } from '@/lib/approval-queue';
import {
  AccountsIcon,
  BoltIcon,
  CalendarIcon,
  ChartIcon,
  KeyIcon,
  SparklesIcon,
} from '@/lib/ui';

interface NavItem {
  href: string;
  labelKey: 'nav.accounts' | 'nav.persona' | 'nav.posts' | 'nav.metrics' | 'nav.experiments' | 'nav.prompts';
  hintKey: 'nav.accountsHint' | 'nav.personaHint' | 'nav.postsHint' | 'nav.metricsHint' | 'nav.experimentsHint' | 'nav.promptsHint';
  icon: () => React.JSX.Element;
}

function onRoute(route: string, pathname: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`);
}

function isNavActive(href: string, pathname: string): boolean {
  if (href === '/personas') return onRoute(href, pathname) || onRoute('/persona', pathname);
  return onRoute(href, pathname);
}

const MORE_ROUTES = ['/metrics', '/experiments'];

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-dvh overflow-hidden bg-surface">
      <MainSidebar />
      <main className="min-w-0 flex-1 overflow-y-auto bg-surface">
        <MobileHeader />
        <div className="w-full px-4 pt-4 pb-20 sm:px-6 md:px-8 md:pt-8 md:pb-10 lg:px-10">
          <AccessNotice />
          {children}
        </div>
      </main>
      <MobileNavigation />
    </div>
  );
}

const MainSidebar = () => {
  const pathname = usePathname();
  const { t } = useI18n();
  const approval = useApprovalQueue();

  const navItems: Array<NavItem> = [
    { href: '/posts', labelKey: 'nav.posts', hintKey: 'nav.postsHint', icon: CalendarIcon },
    { href: '/accounts', labelKey: 'nav.accounts', hintKey: 'nav.accountsHint', icon: AccountsIcon },
    { href: '/personas', labelKey: 'nav.persona', hintKey: 'nav.personaHint', icon: SparklesIcon },
    { href: '/metrics', labelKey: 'nav.metrics', hintKey: 'nav.metricsHint', icon: ChartIcon },
    { href: '/experiments', labelKey: 'nav.experiments', hintKey: 'nav.experimentsHint', icon: BoltIcon },
    { href: '/recipes', labelKey: 'nav.prompts', hintKey: 'nav.promptsHint', icon: KeyIcon },
  ];

  return (
    <aside className="sticky top-0 hidden h-dvh w-[clamp(260px,22vw,320px)] shrink-0 flex-col overflow-hidden border-r border-hairline bg-card shadow-[8px_0_28px_rgba(20,32,51,0.03)] md:flex">
      <div
        data-testid="nav-brand"
        aria-label={t('nav.brand')}
        className="flex shrink-0 items-center gap-3 px-5 pt-6 pb-4 text-left lg:px-6"
      >
        <span className="shrink-0">
          <AppLogo size={40} className="shadow-[0_10px_24px_rgba(20,32,51,0.18)] lg:size-[44px]" />
        </span>
        <div className="hidden min-w-0 md:block">
          <p className="text-[19px] leading-tight font-bold tracking-[-0.03em] text-ink">{t('nav.brand')}</p>
          <p className="text-[13px] leading-snug text-muted-text lg:text-[14px]">{t('nav.brandSubtitle')}</p>
        </div>
      </div>

      <nav className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3.5 py-4 lg:px-4 lg:py-6">
        {navItems.map((item) => (
          <SidebarTab
            key={item.href}
            item={item}
            isActive={isNavActive(item.href, pathname)}
            badgeCount={item.href === '/posts' ? approval.count : 0}
          />
        ))}
      </nav>

      <div data-sidebar-footer className="max-h-[62%] min-h-0 shrink overflow-y-auto border-t border-hairline bg-card px-4 py-3 lg:px-5">
        <AccountPanel hideSidebarApiKeysRow compact />
        <div className="mt-3"><SidebarLegalLinks /></div>
      </div>
    </aside>
  );
};

const SidebarTab = ({ item, isActive, badgeCount }: { item: NavItem; isActive: boolean; badgeCount: number }) => {
  const { t } = useI18n();
  const Icon = item.icon;
  const badgeLabel = badgeCount >= APPROVAL_QUEUE_LIMIT ? `${APPROVAL_QUEUE_LIMIT}+` : String(badgeCount);
  return (
    <Link
      href={item.href}
      title={t(item.labelKey)}
      aria-label={badgeCount > 0 ? t('posts.approvalNavBadge', { count: badgeCount }) : undefined}
      className={`group relative flex items-center gap-3 rounded-[20px] px-4 transition-colors lg:gap-4 lg:rounded-[20px] lg:px-5 ${
        isActive
          ? 'bg-brand-soft text-ink'
          : 'text-muted-text hover:bg-surface hover:text-ink'
      } py-2.5`}
    >
      <span className={`shrink-0 [&>svg]:size-6 lg:[&>svg]:size-7 ${isActive ? 'text-brand' : 'text-muted-text group-hover:text-ink'}`}>
        <Icon />
      </span>
      <span className="hidden min-w-0 text-[16px] leading-snug font-medium tracking-[-0.02em] md:block lg:text-[18px]">{t(item.labelKey)}</span>
      {badgeCount > 0 && (
        <span
          data-testid="nav-posts-approval-badge"
          className="ml-auto inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-warning-soft px-1.5 text-xs font-bold text-warning tabular-nums"
        >
          {badgeLabel}
        </span>
      )}
    </Link>
  );
};

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

const MOBILE_TAB_CLASS = 'flex min-w-0 flex-1 flex-col items-center gap-0.5 px-1 text-center text-xs leading-tight';

const MobileNavigation = () => {
  const { t } = useI18n();
  const pathname = usePathname();
  const approval = useApprovalQueue();
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => setMoreOpen(false), [pathname]);

  const tabs: Array<{
    href: string;
    labelKey: NavItem['labelKey'];
    shortLabelKey?: 'nav.promptsShort';
    icon: () => React.JSX.Element;
  }> = [
    { href: '/posts', labelKey: 'nav.posts', icon: CalendarIcon },
    { href: '/personas', labelKey: 'nav.persona', icon: SparklesIcon },
    { href: '/accounts', labelKey: 'nav.accounts', icon: AccountsIcon },
    { href: '/recipes', labelKey: 'nav.prompts', shortLabelKey: 'nav.promptsShort', icon: KeyIcon },
  ];
  const moreLinks: Array<{ href: string; labelKey: NavItem['labelKey']; icon: () => React.JSX.Element }> = [
    { href: '/metrics', labelKey: 'nav.metrics', icon: ChartIcon },
    { href: '/experiments', labelKey: 'nav.experiments', icon: BoltIcon },
  ];
  const moreActive = MORE_ROUTES.some((route) => onRoute(route, pathname));

  return (
    <nav aria-label={t('nav.primaryNavigation')} className="fixed inset-x-0 bottom-0 z-30 flex items-start justify-around border-t border-line bg-card/95 px-1 pt-2 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = isNavActive(tab.href, pathname) && !moreActive;
        const tabBadgeCount = tab.href === '/posts' ? approval.count : 0;
        const tabBadgeLabel =
          tabBadgeCount >= APPROVAL_QUEUE_LIMIT ? `${APPROVAL_QUEUE_LIMIT}+` : String(tabBadgeCount);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={isActive ? 'page' : undefined}
            aria-label={tabBadgeCount > 0 ? t('posts.approvalNavBadge', { count: tabBadgeCount }) : undefined}
            className={`${MOBILE_TAB_CLASS} ${isActive ? 'font-semibold text-primary' : 'text-muted-text'}`}
          >
            <span className="relative [&>svg]:size-5">
              <Icon />
              {tabBadgeCount > 0 && (
                <span
                  data-testid="nav-posts-approval-badge-mobile"
                  className="absolute -top-1.5 -right-2.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-warning-soft px-1 text-[10px] font-bold text-warning tabular-nums"
                >
                  {tabBadgeLabel}
                </span>
              )}
            </span>
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
          <ul className="mt-4 grid grid-cols-2 gap-2">
            {moreLinks.map((link) => {
              const Icon = link.icon;
              const isActive = onRoute(link.href, pathname);
              return (
                <li key={link.href} className="min-w-0">
                  <Link
                    href={link.href}
                    aria-current={isActive ? 'page' : undefined}
                    className={`flex min-w-0 items-center gap-2 rounded-2xl p-3 text-sm font-medium ${isActive ? 'bg-brand-soft text-ink' : 'bg-surface text-muted-text'}`}
                  >
                    <span className="shrink-0 [&>svg]:size-5"><Icon /></span>
                    <span className="min-w-0 truncate">{t(link.labelKey)}</span>
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
