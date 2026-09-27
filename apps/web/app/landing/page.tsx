'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useI18n } from '@/lib/i18n/provider';
import { BoltIcon, FacebookIcon, InstagramIcon } from '@/lib/ui';
import { LOCALES } from '@/lib/i18n';
import { TokenPackCards, EnterpriseCard, packActionClassName } from '@/components/ui/token-pack-cards';
import {
  ArrowRight,
  Calendar,
  CalendarDays,
  ChartBar,
  Check,
  ChevronDown,
  Menu,
  Music2,
  Send,
  Sparkles,
  User,
  X,
} from 'lucide-react';
import SiteFooter from '@/components/site-footer';

//---------------
// Ícones de marca sem correspondente no lucide — SVGs locais
//---------------
const YouTubeIcon = () => (
  <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
    <path
      fill="#FF0000"
      d="M23.5 6.19a3.02 3.02 0 0 0-2.12-2.14C19.5 3.55 12 3.55 12 3.55s-7.5 0-9.38.5A3.02 3.02 0 0 0 .5 6.19C0 8.07 0 12 0 12s0 3.93.5 5.81a3.02 3.02 0 0 0 2.12 2.14c1.88.5 9.38.5 9.38.5s7.5 0 9.38-.5a3.02 3.02 0 0 0 2.12-2.14C24 15.93 24 12 24 12s0-3.93-.5-5.81zM9.55 15.57V8.43L15.82 12l-6.27 3.57z"
    />
  </svg>
);

const XIcon = () => (
  <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
    <path
      fill="#101728"
      d="M18.9 1.15h3.68l-8.04 9.19L24 22.85h-7.41l-5.8-7.58-6.64 7.58H.47l8.6-9.83L0 1.15h7.59l5.24 6.93 6.07-6.93zm-1.29 19.5h2.04L6.49 3.24H4.3l13.31 17.41z"
    />
  </svg>
);

const LinkedInIcon = () => (
  <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
    <path
      fill="#0A66C2"
      d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.47-.9 1.63-1.85 3.36-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56v11.45z"
    />
  </svg>
);

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-[#f7f8fa]">
      <LandingHeader />
      <main className="flex-1">
        <LandingHero />
        <LandingPlatforms />
        <LandingHowItWorks />
        <LandingFeatures />
        <LandingPricing />
        <LandingFaq />
        <LandingFinalCta />
      </main>
      <SiteFooter />
    </div>
  );
}

/* -----------------
   Local Components
------------------ */

//---------------
// LandingHeader — topo fixo com navegação por âncoras e CTAs.
// No mobile (<md) a navegação desktop colapsa num menu hambúrguer para
// caber em 390px sem scroll horizontal.
//---------------
const LandingHeader = () => {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const links: Array<{ href: string; label: string }> = [
    { href: '#features', label: t('landing.navFeatures') },
    { href: '#pricing', label: t('landing.navPricing') },
    { href: '#how', label: t('landing.navHow') },
    { href: '#faq', label: t('landing.navFaq') },
  ];
  return (
    <header className="sticky top-0 z-30 border-b border-[#edf0f4] bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-2 px-4 sm:px-5 md:h-20">
        <Link
          href="/landing"
          onClick={() => setMenuOpen(false)}
          className="flex min-w-0 items-center gap-2"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#ff544c] text-white shadow-[0_6px_16px_rgba(255,84,76,0.25)]">
            <BoltIcon />
          </span>
          <span className="truncate text-[17px] font-bold tracking-[-0.02em] text-[#101728]">
            PostEngineer
          </span>
        </Link>
        <nav data-testid="landing-desktop-nav" className="hidden items-center gap-7 md:flex">
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-[#414d63] transition-colors hover:text-[#101728]"
            >
              {link.label}
            </a>
          ))}
        </nav>
        <div data-testid="landing-desktop-actions" className="hidden items-center gap-2.5 md:flex">
          <HeaderLocaleSwitcher />
          <Link
            href="/login"
            className="rounded-xl bg-white px-4 py-2 text-sm font-semibold whitespace-nowrap text-[#101728] shadow-[0_1px_3px_rgba(20,32,51,0.08)] ring-1 ring-[#edf0f4] transition-colors hover:bg-[#f8fafc]"
          >
            {t('landing.signIn')}
          </Link>
          <Link
            href="/login"
            className="rounded-xl bg-[#ff544c] px-4 py-2 text-sm font-semibold whitespace-nowrap text-white shadow-[0_6px_16px_rgba(255,84,76,0.25)] transition-colors hover:bg-[#e04540]"
          >
            {t('landing.cta')}
          </Link>
        </div>
        <div className="flex shrink-0 items-center gap-2 md:hidden">
          <Link
            href="/login"
            className="rounded-xl bg-[#ff544c] px-3.5 py-2 text-[13px] font-semibold whitespace-nowrap text-white shadow-[0_6px_16px_rgba(255,84,76,0.25)] transition-colors hover:bg-[#e04540]"
          >
            {t('landing.cta')}
          </Link>
          <button
            type="button"
            data-testid="landing-mobile-menu-button"
            aria-expanded={menuOpen}
            aria-label={menuOpen ? t('landing.menuClose') : t('landing.menuOpen')}
            onClick={() => setMenuOpen((open) => !open)}
            className="flex size-9 items-center justify-center rounded-xl text-[#101728] ring-1 ring-[#edf0f4] transition-colors hover:bg-[#f8fafc]"
          >
            {menuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </div>
      {menuOpen && (
        <div data-testid="landing-mobile-menu" className="border-t border-[#edf0f4] bg-white md:hidden">
          <nav className="mx-auto flex max-w-6xl flex-col px-4 sm:px-5">
            {links.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setMenuOpen(false)}
                className="border-b border-[#f1f4f7] py-3 text-sm font-medium text-[#414d63] last:border-0"
              >
                {link.label}
              </a>
            ))}
          </nav>
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 pt-1 pb-5 sm:px-5">
            <HeaderLocaleSwitcher />
            <Link
              href="/login"
              onClick={() => setMenuOpen(false)}
              className="rounded-xl bg-white px-4 py-2 text-sm font-semibold whitespace-nowrap text-[#101728] shadow-[0_1px_3px_rgba(20,32,51,0.08)] ring-1 ring-[#edf0f4]"
            >
              {t('landing.signIn')}
            </Link>
          </div>
        </div>
      )}
    </header>
  );
};

//---------------
// HeaderLocaleSwitcher — seletor PT/EN do header
//---------------
const HeaderLocaleSwitcher = () => {
  const { locale, setLocale } = useI18n();
  return (
    <div className="flex items-center gap-0.5 rounded-lg bg-[#f1f4f7] p-0.5">
      {LOCALES.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => setLocale(option.value)}
          aria-pressed={option.value === locale}
          className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
            option.value === locale
              ? 'bg-white text-[#101728] shadow-sm'
              : 'text-[#718096] hover:text-[#101728]'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
};

//---------------
// LandingHero — headline, benefícios, CTAs e mockup do produto
//---------------
const LandingHero = () => {
  const { t } = useI18n();
  const checks: Array<'check1' | 'check2' | 'check3'> = ['check1', 'check2', 'check3'];
  return (
    <section className="relative overflow-hidden bg-linear-to-b from-white to-[#f7f8fa]">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 py-16 lg:grid-cols-2 lg:py-24">
        <div>
          <span className="inline-flex rounded-full bg-[#fff0ef] px-4 py-1.5 text-xs font-semibold text-[#cf342e]">
            {t('landing.badge')}
          </span>
          <h1 className="leading-1.1 mt-5 text-4xl font-extrabold tracking-tight text-[#101728] sm:text-5xl">
            {t('landing.title')}
          </h1>
          <p className="mt-5 max-w-lg text-lg leading-relaxed text-[#657184]">
            {t('landing.subtitle')}
          </p>
          <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2">
            {checks.map((check) => (
              <li key={check} className="flex items-center gap-1.5 text-sm font-medium text-[#414d63]">
                <span className="flex size-4 items-center justify-center rounded-full bg-[#10b981]">
                  <Check className="size-3 text-white" strokeWidth={3} />
                </span>
                {t(`landing.${check}`)}
              </li>
            ))}
          </ul>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/login"
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#ff544c] px-7 py-3.5 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(255,84,76,0.3)] transition-colors hover:bg-[#e04540]"
            >
              {t('landing.cta')}
              <ArrowRight className="size-4" />
            </Link>
          </div>
          <p className="mt-4 text-xs text-[#8a94a8]">{t('landing.noCard')}</p>
          <div className="mt-8 flex items-center gap-3">
            <HeroAvatars />
            <div>
              <div className="flex gap-0.5 text-[#f59e0b]" aria-hidden="true">
                {[0, 1, 2, 3, 4].map((star) => (
                  <svg key={star} className="size-4 fill-current" viewBox="0 0 20 20">
                    <path d="M10 1.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L10 14.9l-5.2 2.7 1-5.8L1.5 7.7l5.9-.9L10 1.5z" />
                  </svg>
                ))}
              </div>
              <p className="mt-1 text-xs text-[#657184]">{t('landing.socialProof')}</p>
            </div>
          </div>
        </div>
        <HeroMockup />
      </div>
    </section>
  );
};

//---------------
// HeroAvatars — grupo de avatares com iniciais para prova social
//---------------
const HeroAvatars = () => {
  const people = [
    { initial: 'A', bg: 'bg-[#f59e0b]' },
    { initial: 'M', bg: 'bg-[#10b981]' },
    { initial: 'C', bg: 'bg-[#6366f1]' },
    { initial: 'R', bg: 'bg-[#ff544c]' },
  ];
  return (
    <div className="flex -space-x-2.5">
      {people.map((person) => (
        <span
          key={person.initial}
          className={`flex size-9 items-center justify-center rounded-full text-xs font-bold text-white ring-2 ring-white ${person.bg}`}
        >
          {person.initial}
        </span>
      ))}
    </div>
  );
};

//---------------
// HeroMockup — mockup do dashboard com badge de crescimento e card de agendamento
//---------------
const HeroMockup = () => {
  const { t } = useI18n();
  const stats = [
    { value: '48', label: t('landing.statsVideos'), delta: '+32%' },
    { value: '125.4K', label: t('landing.statsViews'), delta: '+68%' },
    { value: '12.6K', label: t('landing.statsEngagement'), delta: '+40%' },
  ];
  const posts = [
    { title: '5 hábitos que mudam minha vida', time: 'Hoje, 14:00', network: 'YouTube' },
    { title: 'Rotina matinal para mais energia', time: 'Hoje, 18:00', network: 'Instagram' },
  ];
  return (
    <div className="relative mx-auto hidden w-full max-w-lg lg:block">
      {/* Badge de crescimento */}
      <div className="absolute top-16 -left-6 z-10 rounded-2xl bg-white px-4 py-3 shadow-[0_12px_32px_rgba(20,32,51,0.12)] ring-1 ring-[#edf0f4]">
        <div className="flex items-center gap-2.5">
          <ChartBar className="size-5 text-[#6366f1]" />
          <div>
            <p className="text-sm font-bold text-[#101728]">+68%</p>
            <p className="text-[11px] text-[#8a94a8]">{t('landing.statsGrowth').replace('+68% ', '')}</p>
          </div>
        </div>
      </div>

      {/* Dashboard */}
      <div className="rounded-3xl bg-white p-5 shadow-[0_24px_64px_rgba(20,32,51,0.12)] ring-1 ring-[#edf0f4]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-lg bg-[#ff544c] text-white [&>svg]:size-4">
              <BoltIcon />
            </span>
            <span className="text-sm font-bold text-[#101728]">PostEngineer</span>
          </div>
          <div className="flex gap-1.5 text-[11px] font-medium text-[#657184]">
            <span className="rounded-full bg-[#ff544c] px-2.5 py-1 text-white">7 dias</span>
            <span className="rounded-full bg-[#f1f4f7] px-2.5 py-1">30 dias</span>
            <span className="rounded-full bg-[#f1f4f7] px-2.5 py-1">90 dias</span>
          </div>
        </div>
        <p className="mt-1 text-[11px] text-[#8a94a8]">Autopilot</p>

        <div className="mt-4 grid grid-cols-3 gap-2.5">
          {stats.map((stat) => (
            <div key={stat.label} className="rounded-2xl bg-[#f8fafc] p-3 ring-1 ring-[#edf0f4]">
              <p className="text-[10px] font-medium text-[#8a94a8]">{stat.label}</p>
              <p className="mt-0.5 text-lg font-extrabold text-[#101728]">{stat.value}</p>
              <p className="text-[10px] font-semibold text-[#10b981]">↑ {stat.delta}</p>
            </div>
          ))}
        </div>

        <p className="mt-4 text-xs font-semibold text-[#101728]">{t('landing.statsChannels')}</p>
        <div className="mt-2 space-y-2">
          <div className="flex items-center justify-between rounded-xl bg-[#f8fafc] px-3 py-2.5 ring-1 ring-[#edf0f4]">
            <div className="flex items-center gap-2">
              <span className="flex size-6 items-center justify-center rounded-md bg-white">
                <YouTubeIcon />
              </span>
              <div>
                <p className="text-xs font-semibold text-[#101728]">YouTube</p>
                <p className="text-[10px] text-[#8a94a8]">@meucanal</p>
              </div>
              <span className="ml-1 rounded-full bg-[#ecfdf5] px-2 py-0.5 text-[9px] font-semibold text-[#10b981]">Ativo</span>
            </div>
            <span className="h-4 w-7 rounded-full bg-[#10b981]" />
          </div>
          <div className="flex items-center justify-between rounded-xl bg-[#f8fafc] px-3 py-2.5 ring-1 ring-[#edf0f4]">
            <div className="flex items-center gap-2">
              <span className="flex size-6 items-center justify-center rounded-md bg-white">
                <InstagramIcon />
              </span>
              <div>
                <p className="text-xs font-semibold text-[#101728]">Instagram</p>
                <p className="text-[10px] text-[#8a94a8]">@meuperfil</p>
              </div>
              <span className="ml-1 rounded-full bg-[#ecfdf5] px-2 py-0.5 text-[9px] font-semibold text-[#10b981]">Ativo</span>
            </div>
            <span className="h-4 w-7 rounded-full bg-[#10b981]" />
          </div>
        </div>

        <p className="mt-4 text-xs font-semibold text-[#101728]">{t('landing.statsUpcoming')}</p>
        <div className="mt-2 space-y-2">
          {posts.map((post) => (
            <div key={post.title} className="flex items-center gap-2.5 rounded-xl bg-[#f8fafc] px-3 py-2.5 ring-1 ring-[#edf0f4]">
              <span className="size-8 shrink-0 rounded-lg bg-linear-to-br from-[#101728] to-[#3b4a66]" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-[#101728]">{post.title}</p>
                <p className="text-[10px] text-[#8a94a8]">{post.time}</p>
              </div>
              <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ${post.network === 'YouTube' ? 'bg-[#fee2e2] text-[#cf342e]' : 'bg-[#fce7f3] text-[#be185d]'}`}>
                {post.network}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Card "Agendado" */}
      <div className="absolute -right-2 -bottom-5 z-10 flex items-center gap-2.5 rounded-2xl bg-white px-4 py-3 shadow-[0_12px_32px_rgba(20,32,51,0.14)] ring-1 ring-[#edf0f4]">
        <span className="flex size-9 items-center justify-center rounded-full bg-[#ecfdf5]">
          <CalendarDays className="size-4 text-[#10b981]" />
        </span>
        <div>
          <p className="text-xs font-bold text-[#101728]">{t('landing.statsScheduled')}</p>
          <p className="text-[11px] text-[#8a94a8]">{t('landing.statsToday')}</p>
        </div>
      </div>
    </div>
  );
};

//---------------
// LandingPlatforms — faixa com as plataformas suportadas
//---------------
const LandingPlatforms = () => {
  const { t } = useI18n();
  const platforms = [
    { icon: <YouTubeIcon />, label: 'YouTube' },
    { icon: <InstagramIcon />, label: 'Instagram' },
    { icon: <Music2 className="size-5 text-[#101728]" />, label: 'TikTok' },
    { icon: <FacebookIcon />, label: 'Facebook' },
    { icon: <XIcon />, label: 'X (Twitter)' },
    { icon: <LinkedInIcon />, label: 'LinkedIn' },
  ];
  return (
    <section className="border-y border-[#edf0f4] bg-white py-10">
      <p className="text-center text-xs font-semibold tracking-[0.2em] text-[#8a94a8] uppercase">
        {t('landing.platformsTitle')}
      </p>
      <div className="mx-auto mt-6 flex max-w-4xl flex-wrap items-center justify-center gap-x-10 gap-y-5 px-5">
        {platforms.map((platform) => (
          <span key={platform.label} className="flex items-center gap-2 font-semibold text-[#414d63]">
            {platform.icon}
            {platform.label}
          </span>
        ))}
        <span className="rounded-full bg-[#f1f4f7] px-3 py-1 text-xs font-medium text-[#718096]">
          {t('landing.platformsSoon')}
        </span>
      </div>
    </section>
  );
};

//---------------
// LandingHowItWorks — seção "Como funciona" com 3 passos numerados
//---------------
const LandingHowItWorks = () => {
  const { t } = useI18n();
  const steps = [
    { number: '1', titleKey: 'how1Title' as const, hintKey: 'how1Hint' as const, icon: <User className="size-5 text-[#657184]" /> },
    { number: '2', titleKey: 'how2Title' as const, hintKey: 'how2Hint' as const, icon: <Calendar className="size-5 text-[#657184]" /> },
    { number: '3', titleKey: 'how3Title' as const, hintKey: 'how3Hint' as const, icon: <Send className="size-5 text-[#657184]" /> },
  ];
  return (
    <section id="how" className="scroll-mt-24 bg-linear-to-b from-[#f1f4f7] to-[#f7f8fa] py-20">
      <div className="mx-auto max-w-6xl px-5">
        <div className="text-center">
          <span className="inline-flex rounded-full bg-[#fff0ef] px-4 py-1.5 text-xs font-semibold tracking-wide text-[#cf342e] uppercase">
            {t('landing.howBadge')}
          </span>
          <h2 className="mt-4 text-3xl font-extrabold tracking-tight text-[#101728] sm:text-4xl">
            {t('landing.howTitle')}
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-[#657184]">{t('landing.howSubtitle')}</p>
        </div>
        <div className="mt-12 grid gap-6 sm:grid-cols-3">
          {steps.map((step) => (
            <div key={step.number} className="rounded-3xl bg-white p-7 shadow-[0_4px_20px_rgba(20,32,51,0.05)] ring-1 ring-[#edf0f4]">
              <div className="flex items-start justify-between">
                <span className="flex size-10 items-center justify-center rounded-full bg-[#fee2e2] text-lg font-bold text-[#cf342e]">
                  {step.number}
                </span>
                <span className="flex size-10 items-center justify-center rounded-xl bg-[#f1f4f7]">
                  {step.icon}
                </span>
              </div>
              <h3 className="mt-5 text-lg font-bold text-[#101728]">{t(`landing.${step.titleKey}`)}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[#657184]">{t(`landing.${step.hintKey}`)}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

//---------------
// LandingFeatures — três benefícios principais em linha
//---------------
const LandingFeatures = () => {
  const { t } = useI18n();
  const features = [
    { titleKey: 'featureGenerate' as const, hintKey: 'featureGenerateHint' as const, icon: <Sparkles className="size-5 text-[#6366f1]" />, bg: 'bg-[#eef2ff]' },
    { titleKey: 'featureSchedule' as const, hintKey: 'featureScheduleHint' as const, icon: <CalendarDays className="size-5 text-[#6366f1]" />, bg: 'bg-[#eef2ff]' },
    { titleKey: 'featureGrow' as const, hintKey: 'featureGrowHint' as const, icon: <ChartBar className="size-5 text-[#6366f1]" />, bg: 'bg-[#eef2ff]' },
  ];
  return (
    <section id="features" className="scroll-mt-24 bg-white py-16">
      <div className="mx-auto grid max-w-6xl gap-10 px-5 sm:grid-cols-3">
        {features.map((feature) => (
          <div key={feature.titleKey} className="flex gap-4">
            <span className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${feature.bg}`}>
              {feature.icon}
            </span>
            <div>
              <h3 className="font-bold text-[#101728]">{t(`landing.${feature.titleKey}`)}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-[#657184]">
                {t(`landing.${feature.hintKey}`)}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};

//---------------
// LandingPricing — prepaid token packs with one-time Stripe checkout
//---------------
const LandingPricing = () => {
  const { t } = useI18n();
  return (
    <section id="pricing" className="scroll-mt-24 bg-linear-to-b from-[#f1f4f7] to-[#f7f8fa] py-20">
      <div className="mx-auto max-w-6xl px-5">
        <div className="text-center">
          <span className="inline-flex rounded-full bg-[#fff0ef] px-4 py-1.5 text-xs font-semibold tracking-wide text-[#cf342e] uppercase">
            {t('landing.pricingBadge')}
          </span>
          <h2 className="mt-4 text-3xl font-extrabold tracking-tight text-[#101728] sm:text-4xl">
            {t('landing.pricingTitle')}
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-[#657184]">{t('landing.pricingSubtitle')}</p>
        </div>
        <div className="mx-auto mt-12 max-w-6xl">
          <TokenPackCards
            renderAction={(pack) => (
              <Link href="/login" className={packActionClassName(pack.id === 'pack_50')}>
                {t('pricing.buyPack', { count: pack.tokens })}
              </Link>
            )}
          />
          <EnterpriseCard />
        </div>
      </div>
    </section>
  );
};

//---------------
// LandingFaq — perguntas frequentes com <details>
//---------------
const LandingFaq = () => {
  const { t } = useI18n();
  const faqs: Array<{ q: 'faq1Q' | 'faq2Q' | 'faq3Q' | 'faq4Q'; a: 'faq1A' | 'faq2A' | 'faq3A' | 'faq4A' }> = [
    { q: 'faq1Q', a: 'faq1A' },
    { q: 'faq2Q', a: 'faq2A' },
    { q: 'faq3Q', a: 'faq3A' },
    { q: 'faq4Q', a: 'faq4A' },
  ];
  return (
    <section id="faq" className="scroll-mt-24 bg-white py-20">
      <div className="mx-auto max-w-3xl px-5">
        <h2 className="text-center text-3xl font-extrabold tracking-tight text-[#101728]">
          {t('landing.faqTitle')}
        </h2>
        <div className="mt-10 space-y-3">
          {faqs.map((faq) => (
            <details
              key={faq.q}
              className="group rounded-2xl border border-[#edf0f4] bg-[#f8fafc] px-5 py-4 [&_summary::-webkit-details-marker]:hidden"
            >
              <summary className="flex cursor-pointer items-center justify-between gap-4 text-sm font-semibold text-[#101728]">
                {t(`landing.${faq.q}`)}
                <ChevronDown className="size-4 shrink-0 text-[#8a94a8] transition-transform group-open:rotate-180" />
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-[#657184]">{t(`landing.${faq.a}`)}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
};

//---------------
// LandingFinalCta — chamada final antes do rodapé
//---------------
const LandingFinalCta = () => {
  const { t } = useI18n();
  return (
    <section className="px-5 pb-20">
      <div className="mx-auto max-w-5xl rounded-[32px] bg-linear-to-b from-[#fff5f4] to-[#ffeceb] px-6 py-14 text-center">
        <p className="text-xs font-semibold tracking-[0.2em] text-[#cf342e] uppercase">
          {t('landing.cta')}
        </p>
        <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-[#101728] sm:text-4xl">
          {t('landing.ctaFinalTitle')}
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-[#657184]">{t('landing.ctaFinalSubtitle')}</p>
        <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/login"
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#ff544c] px-7 py-3.5 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(255,84,76,0.3)] transition-colors hover:bg-[#e04540]"
          >
            {t('landing.cta')}
            <ArrowRight className="size-4" />
          </Link>
          <p className="text-xs text-[#8a94a8]">{t('landing.ctaFinalNote')}</p>
        </div>
      </div>
    </section>
  );
};
