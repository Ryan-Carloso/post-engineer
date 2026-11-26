'use client';

import { useI18n } from '@/lib/i18n/provider';
import type { TrialStatus } from '@/lib/trial-status';
import { AlertIcon } from '@/lib/ui';

export interface TrialNoticeViewProps {
  status: TrialStatus;
  contactUrl: string;
}

const CONTACT_LINK_CLASS =
  'inline-flex items-center justify-center rounded-xl bg-brand px-4 py-2 text-sm font-bold text-white hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand';

export function TrialNoticeView({ status, contactUrl }: TrialNoticeViewProps) {
  const { t } = useI18n();
  if (!status.active) {
    return (
      <section
        role="alert"
        data-testid="trial-expired-card"
        className="mb-6 rounded-2xl border border-destructive/30 bg-card p-5 shadow-sm sm:p-6"
      >
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-destructive-soft text-destructive">
            <AlertIcon />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-ink">{t('trial.expiredTitle')}</h2>
            <p className="mt-1 text-sm leading-6 text-muted-text">{t('trial.expiredText')}</p>
            <a href={contactUrl} target="_blank" rel="noreferrer" data-testid="trial-contact-link" className={`mt-4 ${CONTACT_LINK_CLASS}`}>
              {t('trial.contactCta')} ↗
            </a>
          </div>
        </div>
      </section>
    );
  }
  const headline = status.daysLeft <= 1 ? t('trial.bannerLastDay') : t('trial.bannerDaysLeft', { days: status.daysLeft });
  return (
    <div
      role="status"
      data-testid="trial-banner"
      className="mb-6 flex flex-col gap-3 rounded-2xl border border-line bg-card px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="min-w-0 text-ink">
        <span className="font-semibold">{headline}</span> <span className="text-muted-text">{t('trial.bannerHint')}</span>
      </p>
      <a href={contactUrl} target="_blank" rel="noreferrer" data-testid="trial-contact-link" className={`shrink-0 ${CONTACT_LINK_CLASS}`}>
        {t('trial.contactCta')} ↗
      </a>
    </div>
  );
}
