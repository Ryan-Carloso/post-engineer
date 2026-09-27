'use client';

import type { ReactNode } from 'react';
import { TOKEN_PACKS, type TokenPackId } from '@/lib/billing';
import { useI18n } from '@/lib/i18n/provider';
import { whatsappUrl } from '@/lib/whatsapp';

//---------------
// Token packs — same cards on the public landing and logged-in billing.
// The only difference is the action: Stripe checkout (logged in) vs. link
// to login.
//---------------
export type TokenPack = (typeof TOKEN_PACKS)[TokenPackId];

interface PackActionState {
  popular: boolean;
}

interface TokenPackCardsProps {
  renderAction: (pack: TokenPack, state: PackActionState) => ReactNode;
}

export function packActionClassName(popular: boolean): string {
  return `mt-auto rounded-xl py-3 text-center text-sm font-bold transition-colors disabled:opacity-50 ${popular ? 'bg-[#ff514a] text-white hover:bg-[#e7443e]' : 'bg-[#fff0ef] text-[#101728] hover:bg-[#ffe2df]'}`;
}

export function PackCheckIcon(): ReactNode {
  return <span className="mr-2 inline-flex size-4 items-center justify-center rounded-full bg-[#ff514a] text-[10px] font-bold text-white">✓</span>;
}

export function TokenPackCards({ renderAction }: TokenPackCardsProps): ReactNode {
  const { t } = useI18n();
  return (
    <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-3 lg:gap-6">
      {Object.values(TOKEN_PACKS).map((pack) => {
        const popular = pack.id === 'pack_50';
        const pricePerToken = (pack.price / pack.tokens).toFixed(2);
        return (
          <article key={pack.id} className={`relative flex min-h-[350px] flex-col rounded-[22px] border p-7 shadow-[0_8px_24px_rgba(20,32,51,0.04)] transition-transform hover:-translate-y-1 sm:p-8 ${popular ? 'border-[#ff514a] bg-[#fff5f4]' : 'border-[#e5eaf0] bg-white'}`}>
            {popular && <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-[#ff514a] px-4 py-1 text-xs font-bold text-white">{t('pricing.popular')}</span>}
            <h3 className="text-xl font-extrabold text-[#101728]">{pack.tokens} {t('pricing.tokens')}</h3>
            <p className="mt-1 text-sm text-[#657184]">{t(`pricing.pack${pack.tokens}Subtitle` as 'pricing.pack10Subtitle' | 'pricing.pack50Subtitle' | 'pricing.pack100Subtitle')}</p>
            <p className="mt-6 text-4xl font-extrabold tracking-[-0.06em] text-[#101728]">${pack.price}</p>
            <p className="mt-1 text-sm text-[#657184]">${pricePerToken} {t('pricing.perToken')}</p>
            <ul className="mt-6 space-y-3 mb-10 text-sm text-[#5c697a]">
              <li><PackCheckIcon />{t('pricing.packVideos', { count: pack.tokens })}</li>
              <li><PackCheckIcon />{t('pricing.packPublish')}</li>
              <li><PackCheckIcon />{t('pricing.packNoExpiry')}</li>
            </ul>
            {renderAction(pack, { popular })}
          </article>
        );
      })}
    </div>
  );
}

//---------------
// EnterpriseCard — human path for high volume (WhatsApp link). Renders
// nothing when the support number is not configured.
//---------------
export function EnterpriseCard(): ReactNode {
  const { t } = useI18n();
  const href = whatsappUrl(t('pricing.whatsappEnterprise'));
  if (!href) return null;
  return (
    <section className="mt-6 flex flex-col gap-5 rounded-[22px] border border-[#e5eaf0] bg-white p-5 shadow-[0_8px_24px_rgba(20,32,51,0.04)] sm:flex-row sm:items-center sm:justify-between sm:p-6">
      <div className="flex items-center gap-4">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[#fff0ef] text-2xl text-[#ff514a]">✦</span>
        <div>
          <h2 className="font-bold text-[#101728]">{t('pricing.enterpriseTitle')}</h2>
          <p className="mt-1 text-sm text-[#718096]">{t('pricing.enterpriseDescription')}</p>
        </div>
      </div>
      <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center rounded-xl border border-[#dce3ea] px-5 py-3 text-sm font-bold text-[#101728] hover:bg-[#f8fafc]">{t('pricing.enterpriseCta')} ↗</a>
    </section>
  );
}
