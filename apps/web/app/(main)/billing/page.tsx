'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { fetchTokenBalance, type TokenBalance } from '@/lib/token-balance';
import type { TokenPackId } from '@/lib/billing';
import { TokenPackCards, EnterpriseCard, packActionClassName } from '@/components/ui/token-pack-cards';
import { CheckoutCancelDialog } from '@/components/ui/checkout-cancel-dialog';
import { TokenHistory } from './token-history';
import { useI18n } from '@/lib/i18n/provider';

export default function BillingPage() {
  return (
    <Suspense fallback={<BillingSkeleton />}>
      <BillingContent />
    </Suspense>
  );
}

//---------------
// BillingContent — composes the complete token storefront.
//---------------
const BillingContent = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const checkoutState = searchParams.get('checkout');
  const returningFromCheckout = checkoutState === 'success';
  const canceledCheckout = checkoutState === 'canceled';
  const billingQuery = useQuery<TokenBalance>({
    queryKey: ['billing', 'tokens'],
    queryFn: fetchTokenBalance,
    staleTime: 30_000,
    refetchInterval: returningFromCheckout ? 3000 : false,
  });

  useEffect(() => {
    if (!returningFromCheckout) return;
    const timeout = window.setTimeout(() => router.replace('/billing'), 20_000);
    return () => window.clearTimeout(timeout);
  }, [returningFromCheckout, router]);

  if (billingQuery.isLoading) return <BillingSkeleton />;

  return (
    <div className="mx-auto w-full max-w-7xl pb-10">
      <BillingHero />
      <BillingNotices />
      <BillingBenefits />
      <BillingPacks />
      <TokenHistory />
      <EnterpriseCard />
      <CheckoutCancelDialog open={canceledCheckout} onClose={() => router.replace('/billing')} />
    </div>
  );
};

//---------------
// BillingHero — explains the value of tokens and shows the current balance.
//---------------
const BillingHero = () => {
  const { t } = useI18n();
  const billingQuery = useQuery<TokenBalance>({
    queryKey: ['billing', 'tokens'],
    queryFn: fetchTokenBalance,
    staleTime: 30_000,
  });
  return (
    <section className="grid gap-10 pt-6 pb-12 lg:grid-cols-[1fr_1.03fr] lg:items-center lg:gap-14 lg:pt-12 lg:pb-16">
      <div className="max-w-[650px]">
        <p className="mb-4 text-sm font-bold tracking-[0.04em] text-[#ff4e48]">{t('pricing.heroEyebrow')}</p>
        <h1 className="leading-0.98 text-[clamp(2.6rem,5vw,4.25rem)] font-extrabold tracking-[-0.065em] text-[#101728]">
          {t('pricing.heroTitle')}
        </h1>
        <p className="mt-6 max-w-[590px] text-lg leading-relaxed text-[#657184] lg:text-[21px]">{t('pricing.heroDescription')}</p>
        <div className="mt-7 inline-flex items-center gap-3 rounded-2xl border border-[#e4e9ef] bg-white px-4 py-3 shadow-[0_8px_24px_rgba(20,32,51,0.05)]">
          <span className="flex size-10 items-center justify-center rounded-xl bg-[#fff0ef] text-[#ff514a]"><TokenIcon /></span>
          <span>
            <span className="block text-xs font-medium text-[#718096]">{t('pricing.currentPlan')}</span>
            <strong className="text-xl text-[#101728]">{billingQuery.data?.balance ?? 0} {t('pricing.tokens')}</strong>
          </span>
        </div>
      </div>
      <BillingIllustration />
    </section>
  );
};

//---------------
// BillingIllustration — editorial CSS illustration for the create-to-publish flow.
//---------------
const BillingIllustration = () => {
  const { t } = useI18n();
  return (
    <div className="relative min-h-[250px] overflow-hidden rounded-[28px] bg-linear-to-br from-[#fff0ed] via-[#fff7f4] to-[#f5e9f4] p-6 sm:min-h-75 sm:p-10">
      <div className="absolute -top-16 -right-12 size-56 rounded-full bg-white/45 blur-2xl" />
      <div className="relative flex h-full min-h-[205px] items-center justify-center gap-4 sm:gap-8">
        <div className="absolute top-4 left-2 max-w-[150px] -rotate-6 font-serif text-xl leading-tight font-bold text-[#191b23] sm:top-8 sm:left-7 sm:text-2xl">{t('pricing.illustrationCaption')}</div>
        <div className="relative z-10 w-[57%] max-w-80 rotate-[-8deg] rounded-2xl bg-white p-3 shadow-[0_16px_28px_rgba(65,48,53,0.14)] sm:p-4">
          <div
            className="relative flex aspect-[1.55] items-center justify-center overflow-hidden rounded-xl bg-cover bg-center"
            style={{ backgroundImage: "url('https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=85')" }}
          >
            <div className="absolute inset-0 bg-linear-to-tr from-[#173346]/45 via-transparent to-[#f4b28d]/10" />
            <span className="relative flex size-14 items-center justify-center rounded-full bg-[#101d28]/75 text-white shadow-lg ring-1 ring-white/30"><PlayIcon /></span>
          </div>
          <div className="mt-2 h-2 w-2/3 rounded-full bg-[#dfe3e7]" />
        </div>
        <div className="relative z-20 w-[35%] max-w-45 space-y-3">
          <div className="flex items-center gap-2 rounded-xl border border-[#e9e0e2] bg-white/90 p-3 text-xs font-semibold text-[#293243] shadow-sm sm:gap-3 sm:px-4 sm:text-sm"><span className="text-[#ff514a]"><SparkIcon /></span>{t('pricing.illustrationGenerate')}</div>
          <div className="flex items-center gap-2 rounded-xl border border-[#e9e0e2] bg-white/90 p-3 text-xs font-semibold text-[#293243] shadow-sm sm:gap-3 sm:px-4 sm:text-sm"><span className="text-[#ff514a]"><CalendarIcon /></span>{t('pricing.illustrationSchedule')}</div>
          <div className="flex items-center gap-2 rounded-xl border border-[#e9e0e2] bg-white/90 p-3 text-xs font-semibold text-[#293243] shadow-sm sm:gap-3 sm:px-4 sm:text-sm"><span className="text-[#ff514a]"><SendIcon /></span>{t('pricing.illustrationPublish')}</div>
        </div>
      </div>
    </div>
  );
};

//---------------
// BillingBenefits — makes the product promise scannable before pricing.
//---------------
const BillingBenefits = () => {
  const { t } = useI18n();
  const benefits: Array<{ title: string; text: string; icon: React.ReactNode }> = [
    { title: t('pricing.benefitGenerateTitle'), text: t('pricing.benefitGenerateText'), icon: <BoltIcon /> },
    { title: t('pricing.benefitPublishTitle'), text: t('pricing.benefitPublishText'), icon: <CalendarIcon /> },
    { title: t('pricing.benefitNoSubscriptionTitle'), text: t('pricing.benefitNoSubscriptionText'), icon: <StarIcon /> },
  ];
  return <section className="my-2 grid grid-cols-1 gap-x-5 gap-y-8 border-y border-[#e9edf1] py-9 sm:grid-cols-2 lg:my-4 lg:grid-cols-3 lg:gap-8 lg:py-10">{benefits.map((benefit) => <div key={benefit.title} className="flex items-start gap-3"><span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[#fff0ef] text-[#ff514a]">{benefit.icon}</span><span><strong className="block text-sm font-bold text-[#101728] sm:text-base">{benefit.title}</strong><span className="mt-1 block text-xs leading-relaxed text-[#718096] sm:text-sm">{benefit.text}</span></span></div>)}</section>;
};

//---------------
// BillingNotices — communicates checkout completion or cancellation.
//---------------
const BillingNotices = () => {
  const { t } = useI18n();
  const checkoutState = useSearchParams().get('checkout');
  return <>{checkoutState === 'success' && <div role="status" className="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-800">{t('pricing.successDesc')}</div>}{checkoutState === 'canceled' && <div role="status" className="mb-6 rounded-2xl border border-neutral-200 bg-neutral-50 px-5 py-4 text-sm text-neutral-700">{t('pricing.cancelDesc')}</div>}</>;
};

//---------------
// BillingPacks — renders the server-known packs and checkout actions.
//---------------
const BillingPacks = () => {
  const { t } = useI18n();
  const router = useRouter();
  const [loading, setLoading] = useState<TokenPackId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const handleCheckout = async (packId: TokenPackId): Promise<void> => {
    setLoading(packId); setError(null);
    try {
      const response = await fetch('/api/billing/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ packId }) });
      const data: unknown = await response.json();
      const result = typeof data === 'object' && data !== null ? data as { url?: unknown; error?: unknown } : {};
      if (!response.ok || typeof result.url !== 'string') { setError(typeof result.error === 'string' ? result.error : t('pricing.checkoutError')); return; }
      router.push(result.url);
    } catch { setError(t('pricing.checkoutError')); } finally { setLoading(null); }
  };
  return (
    <section className="pt-12 lg:pt-14">
      <div className="flex flex-wrap items-end justify-between gap-4"><div><h2 className="text-2xl font-extrabold tracking-[-0.04em] text-[#101728] sm:text-3xl">{t('pricing.packHeading')}</h2><p className="mt-2 text-sm text-[#657184] sm:text-base">{t('pricing.packDescription')}</p></div><span className="rounded-xl border border-[#e2e7ed] bg-white px-3 py-2 text-xs font-medium text-[#4c596b] shadow-sm">ⓘ {t('pricing.packHint')}</span></div>
      {error !== null && <div role="alert" className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">{error}</div>}
      <TokenPackCards
        renderAction={(pack, { popular }) => (
          <button type="button" onClick={() => void handleCheckout(pack.id)} disabled={loading !== null} className={packActionClassName(popular)}>
            {loading === pack.id ? '...' : t('pricing.buyPack', { count: pack.tokens })}
          </button>
        )}
      />
    </section>
  );
};

const TokenIcon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-6" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M12 3.75 20.25 8v8L12 20.25 3.75 16V8L12 3.75Z" /><path strokeLinecap="round" strokeLinejoin="round" d="m3.75 8 8.25 4.25L20.25 8M12 12.25v8" /></svg>;
const BoltIcon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-6" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="m13 2-8 11h6l-1 9 8-11h-6l1-9Z" /></svg>;
const CalendarIcon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-6" aria-hidden="true"><rect width="18" height="17" x="3" y="4" rx="3" /><path strokeLinecap="round" d="M16 2v4M8 2v4M3 9h18" /><path strokeLinecap="round" d="M8 13h.01M12 13h.01M16 13h.01M8 17h.01M12 17h.01" /></svg>;
const StarIcon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-6" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9L12 3Z" /></svg>;
const SparkIcon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-5" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="m12 3 1.3 5.7L19 10l-5.7 1.3L12 17l-1.3-5.7L5 10l5.7-1.3L12 3ZM19 16l.6 2.4L22 19l-2.4.6L19 22l-.6-2.4L16 19l2.4-.6L19 16Z" /></svg>;
const SendIcon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-5" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="m21 3-7.5 18-3.7-7.8L2 9.5 21 3Z" /><path strokeLinecap="round" d="M9.8 13.2 21 3" /></svg>;
const PlayIcon = () => <svg viewBox="0 0 24 24" fill="currentColor" className="size-6" aria-hidden="true"><path d="m9 6 9 6-9 6V6Z" /></svg>;

//---------------
// BillingSkeleton — placeholder shown while the wallet query loads.
//---------------
const BillingSkeleton = () => <div className="space-y-8" aria-hidden="true"><div className="grid gap-8 lg:grid-cols-2"><div className="h-72 animate-pulse rounded-3xl bg-neutral-200" /><div className="h-72 animate-pulse rounded-3xl bg-neutral-200" /></div><div className="h-24 animate-pulse rounded-3xl bg-neutral-200" /><div className="grid grid-cols-1 gap-6 md:grid-cols-3"><div className="h-80 animate-pulse rounded-3xl bg-neutral-200" /><div className="h-80 animate-pulse rounded-3xl bg-neutral-200" /><div className="h-80 animate-pulse rounded-3xl bg-neutral-200" /></div></div>;
