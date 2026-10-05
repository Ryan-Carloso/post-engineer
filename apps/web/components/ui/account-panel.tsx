'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useSessionQuery } from '@/lib/api';
import { useI18n } from '@/lib/i18n/provider';
import { LOCALES } from '@/lib/i18n';
import { TokenBalance } from '@/app/(main)/token-balance';
import VersionBadge from '@/components/ui/version-badge';
import { KeyIcon, ProfileIcon } from '@/lib/ui';

//---------------
// AccountPanel — shared account area content ("Perfil"/"Profile").
// Rendered in the desktop sidebar footer and on the /account page,
// which is the mobile entry point (header avatar).
// Composes the existing TokenBalance component and session query;
// the user block links to /account and sign-out routes to /login.
//---------------

interface UserDisplay {
  avatarUrl?: string;
  userName?: string;
}

function getUserDisplay(metadata: unknown): UserDisplay {
  if (typeof metadata !== 'object' || metadata === null) {
    return {};
  }
  const m = metadata as Record<string, unknown>;
  const avatarUrl = typeof m.avatar_url === 'string' ? m.avatar_url : undefined;
  const userName =
    typeof m.name === 'string'
      ? m.name
      : typeof m.user_name === 'string'
        ? m.user_name
        : typeof m.provider_id === 'string'
          ? m.provider_id
          : undefined;
  return { avatarUrl, userName };
}

//---------------
// AvatarCircle — avatar image or initial-letter fallback, same style
// as the former SidebarUser block.
//---------------
function AvatarCircle({
  avatarUrl,
  userName,
  className,
}: {
  avatarUrl?: string;
  userName?: string;
  className: string;
}) {
  if (avatarUrl) {
    return (
      <div className={`relative shrink-0 overflow-hidden rounded-full bg-[#e8edf2] ring-2 ring-white ${className}`}>
        <Image
          src={avatarUrl}
          alt={userName || 'User'}
          fill
          sizes="48px"
          className="object-cover"
        />
      </div>
    );
  }
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full bg-[#e8edf2] font-semibold text-[#657184] ring-2 ring-white ${className}`}
    >
      {userName?.charAt(0).toUpperCase() || 'U'}
    </div>
  );
}

//---------------
// LocaleSwitcher — PT/EN language switcher (moved from app-shell).
//---------------
export function LocaleSwitcher() {
  const { locale, setLocale } = useI18n();
  return (
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
}

//---------------
// SignOutButton — signs out via Supabase and routes to /login.
//---------------
export function SignOutButton() {
  const router = useRouter();
  const { t } = useI18n();

  const handleSignOut = async () => {
    const { createSupabaseClient } = await import('@/lib/supabase/client');
    const supabase = createSupabaseClient();
    await supabase.auth.signOut();
    router.push('/login');
  };

  return (
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
  );
}

//---------------
// MobileProfileLink — avatar button in the mobile header, links to
// /account. Falls back to the initial letter, then a person icon.
//---------------
export function MobileProfileLink() {
  const { t } = useI18n();
  const sessionQuery = useSessionQuery();
  const { avatarUrl, userName } = getUserDisplay(sessionQuery.data?.user_metadata);

  return (
    <Link
      href="/account"
      data-testid="mobile-profile-link"
      aria-label={t('nav.profile')}
      className="ml-auto flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#e8edf2] text-[#657184] ring-2 ring-white"
    >
      {avatarUrl ? (
        <Image
          src={avatarUrl}
          alt={userName || 'User'}
          width={36}
          height={36}
          className="size-full object-cover"
        />
      ) : userName ? (
        <span className="text-sm font-semibold">{userName.charAt(0).toUpperCase()}</span>
      ) : (
        <ProfileIcon />
      )}
    </Link>
  );
}

//---------------
// AccountPanel — locale switcher, token balance, optional version row,
// user block (linking to /account) and sign-out. The user block and
// sign-out only render when a session user exists.
//---------------
export function AccountPanel({ showVersionBadge = false }: { showVersionBadge?: boolean }) {
  const { t } = useI18n();
  const sessionQuery = useSessionQuery();
  const user = sessionQuery.data;
  const { avatarUrl, userName } = getUserDisplay(user?.user_metadata);

  return (
    <div className="space-y-3">
      <LocaleSwitcher />
      <TokenBalance />
      {showVersionBadge && (
        <div className="flex items-center justify-between rounded-[28px] border border-[#f0f2f5] bg-[#f8fafc] px-5 py-3">
          <span className="text-sm font-medium text-[#657184]">{t('account.version')}</span>
          <VersionBadge />
        </div>
      )}
      {user && (
        <div className="space-y-5">
          <Link
            href="/account"
            data-testid="profile-user-link"
            aria-label={t('nav.profile')}
            className="flex items-center gap-3 border-t border-[#edf0f4] px-1 pt-4 lg:gap-3 lg:pt-5"
          >
            <AvatarCircle avatarUrl={avatarUrl} userName={userName} className="size-10 text-sm lg:size-12" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] leading-tight font-semibold tracking-[-0.02em] text-[#101728] lg:text-[18px]">
                {userName || 'GitHub User'}
              </p>
            </div>
          </Link>
          <ApiKeysRow />
          <SignOutButton />
        </div>
      )}
    </div>
  );
}

//---------------
// ApiKeysRow — link to /api-keys inside the profile area. The API Keys
// tab was removed from the navs to curb tab sprawl; the route itself
// is unchanged.
//---------------
export function ApiKeysRow() {
  const { t } = useI18n();
  return (
    <Link
      href="/api-keys"
      data-testid="profile-api-keys-link"
      className="flex w-full items-center gap-3.5 rounded-[18px] bg-[#f8fafc] px-4 py-3 text-left text-[15px] text-[#718096] transition-colors hover:bg-[#f1f4f7] hover:text-[#101728] lg:gap-5 lg:rounded-[22px] lg:px-8 lg:py-4 lg:text-[18px]"
    >
      <span className="[&>svg]:size-5 lg:[&>svg]:size-7">
        <KeyIcon />
      </span>
      {t('nav.apiKeys')}
    </Link>
  );
}
