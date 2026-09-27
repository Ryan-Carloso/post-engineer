'use client';

import { Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { createSupabaseClient } from '@/lib/supabase/client';
import { isOwnVercelPreviewHost } from '@/lib/vercel-preview-host';
import { useI18n } from '@/lib/i18n/provider';
import { LOCALES } from '@/lib/i18n';
import { BoltIcon } from '@/lib/ui';
import { ArrowRight, CalendarDays, ChartBar } from 'lucide-react';

export default function Login() {
  return (
    <div className="flex min-h-screen">
      <LoginHero />
      <section className="relative flex flex-1 flex-col bg-[#f7f8fa]">
        <LoginTopBar />
        <div className="flex flex-1 items-center justify-center px-5 py-12">
          <LoginCard>
            <LoginCardHeader />
            <Suspense fallback={null}>
              <LoginAuthNotice />
            </Suspense>
            <Suspense fallback={null}>
              <GithubLogin />
            </Suspense>
            <LoginAgreeNote />
          </LoginCard>
        </div>
        <LoginBottomBar />
      </section>
    </div>
  );
}

//---------------
// safeNext — only accepts internal relative paths (?next=/oauth/...).
// Absolute URLs and `//evil` are rejected (open redirect).
//---------------
const safeNext = (value: string | null): string | null => {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return null;
  return value;
};

//---------------
// resolveLoginRedirectUrl — where Supabase sends the user after the GitHub
// OAuth round-trip, per environment. Localhost and this project's Vercel
// previews relay through the production callback with ?next= pointing back
// at the origin that started the login; production keeps a relative next
// (e.g. returning from the MCP /oauth/authorize flow).
//---------------
export const PROD_AUTH_CALLBACK = 'https://post-engineer.com/auth/callback';
const LOCAL_AUTH_CALLBACK = 'http://localhost:3434/auth/callback';

export function resolveLoginRedirectUrl(
  hostname: string,
  origin: string,
  next: string | null,
): string {
  const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
  if (isLocal) {
    return `${PROD_AUTH_CALLBACK}?next=${encodeURIComponent(LOCAL_AUTH_CALLBACK)}`;
  }
  if (isOwnVercelPreviewHost(hostname)) {
    return `${PROD_AUTH_CALLBACK}?next=${encodeURIComponent(`${origin}/auth/callback`)}`;
  }
  return next ? `${PROD_AUTH_CALLBACK}?next=${encodeURIComponent(next)}` : PROD_AUTH_CALLBACK;
}

//---------------
// shouldShowOAuthDebug — shows the redirect URL on the login screen outside
// production (localhost and this project's Vercel previews) to validate the
// login flow.
//---------------
export function shouldShowOAuthDebug(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    isOwnVercelPreviewHost(hostname)
  );
}

//---------------
// GithubLogin — OAuth button that preserves ?next= (e.g. returning from the
// MCP OAuth flow at /oauth/authorize). On localhost it keeps the relay
// behavior without appending next.
//---------------
const GithubLogin = () => {
  const supabase = useMemo(() => createSupabaseClient(), []);
  const [pending, setPending] = useState(false);
  const next = safeNext(useSearchParams().get('next'));
  const { t } = useI18n();

  // redirectTo and debug derive from the current host: outside production
  // (localhost and Vercel previews) the URL is shown on screen to validate
  // the login flow.
  const { redirectTo, showDebug } = useMemo(() => {
    const hostname = window.location.hostname;
    const origin = window.location.origin;
    return {
      redirectTo: resolveLoginRedirectUrl(hostname, origin, next),
      showDebug: shouldShowOAuthDebug(hostname),
    };
  }, [next]);

  const handleOAuthLogin = async (provider: 'github') => {
    if (pending) return;
    setPending(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo },
    });

    if (error) {
      console.error(`${provider} OAuth error:`, error);
      setPending(false);
    }
  };

  return (
    <>
      <LoginButton provider="github" disabled={pending} onLogin={handleOAuthLogin} />
      {showDebug ? (
        <p
          data-testid="oauth-redirect-debug"
          className="mt-4 font-mono text-[11px] leading-relaxed break-all text-[#8a94a8]"
        >
          {t('login.oauthRedirectDebug')}: {redirectTo}
        </p>
      ) : null}
    </>
  );
};

/* -----------------
   Local Components
------------------ */

//---------------
// LoginHero — dark left panel with the product pitch
//---------------
const LoginHero = () => {
  const { t } = useI18n();
  const features = [
    { titleKey: 'feature1Title' as const, hintKey: 'feature1Hint' as const, icon: <BoltIcon /> },
    { titleKey: 'feature2Title' as const, hintKey: 'feature2Hint' as const, icon: <CalendarDays className="size-5 text-[#ff6b64]" /> },
    { titleKey: 'feature3Title' as const, hintKey: 'feature3Hint' as const, icon: <ChartBar className="size-5 text-[#ff6b64]" /> },
  ];
  return (
    <aside className="relative hidden w-[52%] flex-col justify-between overflow-hidden bg-[#0d1220] p-12 lg:flex xl:p-16">
      <div
        className="opacity-0.16 pointer-events-none absolute -top-40 right-0 size-[480px] rounded-full bg-[#ff544c] blur-3xl"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute -bottom-52 -left-24 size-[440px] rounded-full bg-[#3b2a7a] opacity-25 blur-3xl"
        aria-hidden="true"
      />

      <div className="relative flex items-center gap-2.5">
        <span className="flex size-10 items-center justify-center rounded-xl bg-white text-[#0d1220] shadow-[0_6px_20px_rgba(255,84,76,0.35)] [&>svg]:size-5">
          <BoltIcon />
        </span>
        <span className="text-xl font-bold tracking-[-0.02em] text-white">Post Engineer</span>
      </div>

      <div className="relative max-w-lg">
        <span className="inline-flex rounded-full bg-white/[0.07] px-4 py-1.5 text-xs font-semibold text-[#ff8a85] ring-1 ring-white/10">
          {t('login.heroBadge')}
        </span>
        <h1 className="leading-1.1 mt-6 text-[42px] font-extrabold tracking-tight text-white xl:text-5xl">
          {t('login.heroTitle')}{' '}
          <span className="bg-linear-to-r from-[#ff6b64] to-[#ff8a85] bg-clip-text text-transparent">
            {t('login.heroTitleAccent')}
          </span>
        </h1>
        <p className="mt-5 text-lg leading-relaxed text-white/60">
          {t('login.heroDescription')}
        </p>

        <ul className="mt-10 space-y-6">
          {features.map((feature) => (
            <li key={feature.titleKey} className="flex items-center gap-4">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[#ff544c]/15 ring-1 ring-[#ff544c]/25 [&>svg]:size-5">
                {feature.icon}
              </span>
              <div>
                <p className="font-semibold text-white">{t(`login.${feature.titleKey}`)}</p>
                <p className="text-sm text-white/55">{t(`login.${feature.hintKey}`)}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="relative flex items-center gap-2 text-[#ff8a85]">
        <svg className="size-8 -scale-x-100" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 14c-1.5-6-6-10-13-11m0 0L9 6.5M6 3 2.5 6" />
        </svg>
        <p className="text-lg font-medium italic">{t('login.heroNote')}</p>
      </div>
    </aside>
  );
};

//---------------
// LoginTopBar — top row of the light panel with sign-up and language
//---------------
const LoginTopBar = () => {
  const { t, locale, setLocale } = useI18n();
  return (
    <div className="flex items-center justify-end gap-4 px-8 pt-7">
      <div className="flex items-center gap-0.5 rounded-lg bg-white p-0.5 ring-1 ring-[#edf0f4]">
        {LOCALES.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setLocale(option.value)}
            aria-pressed={option.value === locale}
            className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
              option.value === locale
                ? 'bg-[#101728] text-white'
                : 'text-[#718096] hover:text-[#101728]'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
      <p className="text-sm text-[#718096]">
        {t('login.noAccount')}{' '}
        <Link
          href="/login"
          className="inline-flex items-center gap-1 font-semibold text-[#ff544c] hover:underline"
        >
          {t('login.createAccount')}
          <ArrowRight className="size-3.5" />
        </Link>
      </p>
    </div>
  );
};

//---------------
// LoginCard — centered white card with the login buttons
//---------------
const LoginCard = ({ children }: { children: React.ReactNode }) => (
  <div className="w-full max-w-md rounded-3xl border border-[#edf0f4] bg-white p-8 shadow-[0_20px_60px_rgba(20,32,51,0.08)] sm:p-10">
    {children}
  </div>
);

//---------------
// LoginCardHeader — brand, title, and subtitle of the card
//---------------
const LoginCardHeader = () => {
  const { t } = useI18n();
  return (
    <div className="mb-8 text-center">
      <div className="flex items-center justify-center gap-2.5">
        <span className="flex size-10 items-center justify-center rounded-xl bg-linear-to-br from-[#ff6b64] to-[#e04540] text-white shadow-[0_8px_20px_rgba(255,84,76,0.35)]">
          <BoltIcon />
        </span>
        <span className="text-xl font-bold tracking-[-0.02em] text-[#101728]">Post Engineer</span>
      </div>
      <h2 className="mt-6 text-3xl font-bold tracking-tight text-[#101728]">
        {t('login.title')}
      </h2>
      <p className="mx-auto mt-2.5 max-w-xs text-sm leading-relaxed text-[#657184]">
        {t('login.subtitle')}
      </p>
    </div>
  );
};

//---------------
// LoginAuthNotice — explains an OAuth return without a session: user
// cancellation (?error=cancelled) or a technical error (?error=auth).
// Only renders for these two values; anything else is ignored (the param
// is never displayed).
//---------------
const LoginAuthNotice = () => {
  const { t } = useI18n();
  const error = useSearchParams().get('error');
  if (error !== 'auth' && error !== 'cancelled') return null;
  const cancelled = error === 'cancelled';
  return (
    <p
      role="alert"
      className={`mb-5 rounded-xl px-4 py-3 text-center text-sm font-medium ${
        cancelled
          ? 'bg-[#f8fafc] text-[#657184] ring-1 ring-[#edf0f4]'
          : 'bg-[#fff0ef] text-[#cf342e] ring-1 ring-[#ffd9d6]'
      }`}
    >
      {t(cancelled ? 'login.cancelled' : 'login.authError')}
    </p>
  );
};

//---------------
// LoginButton — OAuth (GitHub) button. Disables and shows "redirecting"
// while the OAuth round-trip is in flight to prevent double clicks.
//---------------
const LoginButton = ({
  provider,
  disabled,
  onLogin,
}: {
  provider: 'github';
  disabled: boolean;
  onLogin: (provider: 'github') => void;
}) => {
  const { t } = useI18n();
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onLogin(provider)}
      className="mt-3 flex w-full items-center justify-center gap-3 rounded-2xl border border-[#edf0f4] bg-white px-4 py-3.5 text-sm font-semibold text-[#101728] shadow-[0_1px_3px_rgba(20,32,51,0.05)] transition-all first-of-type:mt-0 hover:-translate-y-px hover:border-[#dfe4ec] hover:shadow-[0_6px_16px_rgba(20,32,51,0.08)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 sm:text-base"
    >
      <GithubMark /> 
      <span>
        {disabled ? t('login.redirecting') : t('login.githubButton')}
      </span>
    </button>
  );
};

//---------------
// GithubMark — GitHub icon
//---------------
const GithubMark = () => (
  <svg className="size-5 text-[#101728]" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path
      fillRule="evenodd"
      d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
      clipRule="evenodd"
    />
  </svg>
);

//---------------
// LoginAgreeNote — terms and privacy agreement notice
//---------------
const LoginAgreeNote = () => {
  const { t } = useI18n();
  return (
    <p className="mt-7 border-t border-[#f1f4f7] pt-6 text-center text-xs leading-relaxed text-[#8a94a8]">
      {t('login.agreePrefix')}{' '}
      <Link href="/terms" className="font-medium text-[#ff544c] hover:underline">
        {t('footer.terms')}
      </Link>{' '}
      {t('login.agreeAnd')}{' '}
      <Link href="/privacy" className="font-medium text-[#ff544c] hover:underline">
        {t('footer.privacy')}
      </Link>
      .
    </p>
  );
};

//---------------
// LoginBottomBar — copyright and legal links at the bottom of the light panel
//---------------
const LoginBottomBar = () => {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center gap-3 px-8 pb-7 text-xs text-[#8a94a8] sm:flex-row sm:justify-between">
      <p>{t('footer.rights', { year: new Date().getFullYear() })}</p>
      <div className="flex items-center gap-5">
        <Link href="/privacy" className="hover:text-[#101728]">{t('footer.privacy')}</Link>
        <Link href="/terms" className="hover:text-[#101728]">{t('footer.terms')}</Link>
        <a href="mailto:support@post-engineer.com" className="hover:text-[#101728]">
          {t('footer.support')}
        </a>
      </div>
    </div>
  );
};
