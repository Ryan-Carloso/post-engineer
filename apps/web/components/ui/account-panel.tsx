'use client';

import ThemeSwitcher from '@/components/theme-switcher';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useSessionQuery } from '@/lib/api';
import { useI18n } from '@/lib/i18n/provider';
import { LOCALES } from '@/lib/i18n';
import { TokenBalance } from '@/app/(main)/token-balance';
import VersionBadge from '@/components/ui/version-badge';
import { CoinsIcon, KeyIcon, ProfileIcon } from '@/lib/ui';

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
      <div className={`relative shrink-0 overflow-hidden rounded-full bg-sunken ring-2 ring-card ${className}`}>
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
      className={`flex shrink-0 items-center justify-center rounded-full bg-sunken font-semibold text-muted-text ring-2 ring-card ${className}`}
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
    <div className="flex items-center justify-center gap-1 rounded-xl border border-hairline bg-surface p-1 md:justify-start">
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
                ? 'bg-card text-ink shadow-sm'
                : 'text-muted-text hover:bg-card hover:text-ink'
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
    // scope: 'local' — sign out only THIS session (the default 'global'
    // would also end the user's sessions on every other device).
    await supabase.auth.signOut({ scope: 'local' });
    router.push('/login');
  };

  return (
    <button
      type="button"
      onClick={handleSignOut}
      title={t('nav.signOut')}
      className="flex w-full items-center gap-3.5 rounded-[18px] bg-surface px-4 py-3 text-left text-[15px] font-semibold leading-snug text-ink transition-colors hover:bg-sunken"
    >
      <svg className="size-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.7} aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0-4-4m4 4H7m6 4v1a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3h4a3 3 0 0 1 3 3v1" />
      </svg>
      {t('nav.signOut')}
    </button>
  );
}

//---------------
// SignOutAllButton — ends the user's sessions on EVERY device
// (scope 'global'), so it asks for confirmation first. The dialog
// follows the destructive-dialog rules: initial focus on the safe
// action, Escape closes (not while signing out), Tab stays trapped,
// and every control is disabled while the sign-out is in flight.
//---------------
export function SignOutAllButton() {
  const router = useRouter();
  const { t } = useI18n();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // The dialog is mounted only while open: focus the safe action and
    // listen for keys while it is up.
    if (!confirming) return;
    cancelButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pending) {
        setConfirming(false);
        return;
      }
      if (event.key === 'Tab' && dialogRef.current) {
        const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled])',
        );
        if (focusables.length === 0) {
          // While pending every control is disabled: Tab must not escape
          // the dialog (keep focus where it is).
          event.preventDefault();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        // Focus landed OUTSIDE the dialog (e.g. on document.body — some
        // browsers/reset paths leave it there): Tab must not escape the
        // modal, pull focus back inside.
        if (!dialogRef.current.contains(document.activeElement)) {
          event.preventDefault();
          (event.shiftKey ? last : first)?.focus();
          return;
        }
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [confirming, pending]);

  const handleConfirm = async () => {
    setPending(true);
    setFailed(false);
    try {
      const { createSupabaseClient } = await import('@/lib/supabase/client');
      const supabase = createSupabaseClient();
      // supabase-js resolves with { error } instead of throwing: a failed
      // revocation must keep the dialog open so the user can retry —
      // other devices are still signed in.
      const { error } = await supabase.auth.signOut({ scope: 'global' });
      if (error) {
        setFailed(true);
        return;
      }
      setConfirming(false);
      router.push('/login');
    } catch {
      // Unexpected failure (client construction, network crash): same
      // retryable error state.
      setFailed(true);
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setFailed(false);
          setConfirming(true);
        }}
        title={t('account.signOutAllDevices')}
        data-testid="sign-out-all-button"
        className="w-full px-4 py-1 text-left text-sm font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-ink hover:underline"
      >
        <svg className="size-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.7} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.36 6.36-.7-.7M6.34 6.34l-.7-.7m12.72 0-.7.7M6.34 17.66l-.7.7M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" />
        </svg>
        {t('account.signOutAllDevices')}
      </button>
      {confirming && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="sign-out-all-title"
          aria-describedby="sign-out-all-desc"
          data-testid="sign-out-all-dialog"
          className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/60 p-4"
        >
          <div ref={dialogRef} className="w-full max-w-md rounded-2xl bg-card p-6 shadow-xl">
            <h2 id="sign-out-all-title" className="text-lg font-semibold text-ink">
              {t('account.signOutAllDevicesTitle')}
            </h2>
            <p id="sign-out-all-desc" className="mt-1 text-sm leading-6 text-muted-text">
              {t('account.signOutAllDevicesDesc')}
            </p>
            {failed && (
              <p
                role="alert"
                data-testid="sign-out-all-error"
                className="mt-3 text-sm font-medium text-destructive"
              >
                {t('account.signOutAllDevicesError')}
              </p>
            )}
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                ref={cancelButtonRef}
                type="button"
                onClick={() => setConfirming(false)}
                disabled={pending}
                data-testid="sign-out-all-cancel"
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-line px-5 py-2.5 text-sm font-semibold text-ink-soft transition-colors hover:bg-surface disabled:opacity-50"
              >
                {t('account.signOutAllDevicesCancel')}
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={pending}
                data-testid="sign-out-all-confirm"
                className="inline-flex min-h-11 items-center justify-center rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-hover disabled:opacity-50"
              >
                {t('account.signOutAllDevicesConfirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
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
      className="ml-auto flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-sunken text-muted-text ring-2 ring-card"
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
export function AccountPanel({
  showVersionBadge = false,
  hideSidebarApiKeysRow = false,
}: {
  showVersionBadge?: boolean;
  hideSidebarApiKeysRow?: boolean;
}) {
  const { t } = useI18n();
  const sessionQuery = useSessionQuery();
  const user = sessionQuery.data;
  const { avatarUrl, userName } = getUserDisplay(user?.user_metadata);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1"><LocaleSwitcher /></div>
        <ThemeSwitcher className="shrink-0" />
      </div>
      <TokenBalance />
      {showVersionBadge && (
        <div className="flex items-center justify-between rounded-[28px] border border-hairline bg-surface px-5 py-3">
          <span className="text-sm font-medium text-muted-text">{t('account.version')}</span>
          <VersionBadge />
        </div>
      )}
      {user && (
        <div className="space-y-3 pb-0.5">
          <Link
            href="/account"
            data-testid="profile-user-link"
            aria-label={t('nav.profile')}
            className="flex items-center gap-3 border-t border-hairline px-1 pt-4 lg:gap-3 lg:pt-5"
          >
            <AvatarCircle avatarUrl={avatarUrl} userName={userName} className="size-10 text-sm lg:size-12" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] leading-tight font-semibold tracking-[-0.02em] text-ink lg:text-[18px]">
                {userName || 'GitHub User'}
              </p>
            </div>
          </Link>
          {!hideSidebarApiKeysRow && <ApiKeysRow />}
          <BillingRow />
          <SignOutButton />
          <SignOutAllButton />
        </div>
      )}
    </div>
  );
}

//---------------
// ApiKeysRow — link to the API key manager inside the profile area. The
// key manager lives in step 1 of the prompts hub (/recipes), next to the
// setup prompt that uses the key.
//---------------
export function ApiKeysRow() {
  const { t } = useI18n();
  return (
    <Link
      href="/recipes"
      data-testid="profile-api-keys-link"
      className="flex w-full items-center gap-3.5 rounded-[18px] bg-surface px-4 py-3 text-left text-[15px] leading-snug text-muted-text transition-colors hover:bg-sunken hover:text-ink"
    >
      <span className="shrink-0 [&>svg]:size-5">
        <KeyIcon />
      </span>
      {t('nav.prompts')}
    </Link>
  );
}

//---------------
// BillingRow — link to /billing inside the profile area. The Billing
// tab was removed from the navs to curb tab sprawl; the route itself
// is unchanged, and buying tokens plus viewing history stay one tap
// away from the account panel, exactly like API Keys above.
//---------------
export function BillingRow() {
  const { t } = useI18n();
  return (
    <Link
      href="/billing"
      data-testid="profile-billing-link"
      className="flex w-full items-center gap-3.5 rounded-[18px] bg-surface px-4 py-3 text-left text-[15px] leading-snug text-muted-text transition-colors hover:bg-sunken hover:text-ink"
    >
      <span className="shrink-0 [&>svg]:size-5">
        <CoinsIcon />
      </span>
      {t('account.billingLink')}
    </Link>
  );
}
