'use client';

import type { ReactNode } from 'react';
import { useI18n } from '@/lib/i18n/provider';
import { DISCORD_INVITE_URL, GITHUB_URL, whatsappUrl } from '@/lib/public-links';

export const SUPPORT_EMAIL = 'madebyryandev@gmail.com';

export function PricingContactCard(): ReactNode {
  const { t } = useI18n();
  return (
    <div
      data-testid="pricing-contact"
      className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-2 lg:gap-6"
    >
      <article className="flex min-h-55 flex-col rounded-[22px] border border-line bg-card p-7 shadow-[0_8px_24px_rgba(20,32,51,0.04)] sm:p-8">
        <h3 className="text-xl font-extrabold text-ink">
          {t('landing.pricingContactTitle')}
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-muted-text">
          {t('landing.pricingContactText')}
        </p>
        <div className="mt-auto flex flex-col gap-3 pt-6 sm:flex-row sm:flex-wrap">
          <a
            href={whatsappUrl(t('landing.pricingWhatsappBeta'))}
            target="_blank"
            rel="noreferrer"
            data-testid="pricing-whatsapp-cta"
            className="inline-flex items-center justify-center rounded-xl bg-brand px-5 py-3 text-sm font-bold text-white hover:bg-brand-hover"
          >
            {t('landing.pricingWhatsappCta')} ↗
          </a>
          <a
            href={DISCORD_INVITE_URL}
            target="_blank"
            rel="noreferrer"
            data-testid="pricing-discord-cta"
            className="inline-flex items-center justify-center rounded-xl bg-brand px-5 py-3 text-sm font-bold text-white hover:bg-brand-hover"
          >
            {t('landing.pricingDiscordCta')} ↗
          </a>
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            data-testid="pricing-email-cta"
            className="inline-flex items-center justify-center rounded-xl bg-brand-soft px-5 py-3 text-sm font-bold text-ink hover:bg-destructive-soft"
          >
            {t('landing.pricingEmailCta')} · {SUPPORT_EMAIL}
          </a>
        </div>
      </article>
      <article className="flex min-h-55 flex-col rounded-[22px] border border-line bg-card p-7 shadow-[0_8px_24px_rgba(20,32,51,0.04)] sm:p-8">
        <h3 className="text-xl font-extrabold text-ink">
          {t('landing.pricingGithubTitle')}
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-muted-text">
          {t('landing.pricingGithubText')}
        </p>
        <div className="mt-auto pt-6">
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            data-testid="pricing-github-cta"
            className="inline-flex items-center justify-center rounded-xl border border-line px-5 py-3 text-sm font-bold text-ink hover:bg-surface"
          >
            {t('landing.pricingGithubCta')} ↗
          </a>
        </div>
      </article>
    </div>
  );
}
