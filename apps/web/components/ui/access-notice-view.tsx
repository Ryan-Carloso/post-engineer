'use client';

import { useI18n } from '@/lib/i18n/provider';
import type { AccessStatus } from '@/lib/access-status';
import { AlertIcon } from '@/lib/ui';

export interface AccessNoticeViewProps {
  status: AccessStatus;
  contactUrl: string;
  discordUrl: string;
  githubUrl: string;
}

const PRIMARY_LINK_CLASS =
  'inline-flex items-center justify-center rounded-xl bg-brand px-4 py-2 text-sm font-bold text-white hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand';

const SECONDARY_LINK_CLASS =
  'inline-flex items-center justify-center rounded-xl border border-line px-4 py-2 text-sm font-bold text-ink hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand';

export function AccessNoticeView({ status, contactUrl, discordUrl, githubUrl }: AccessNoticeViewProps) {
  const { t } = useI18n();
  if (status.active) return null;
  const awaitingBeta = status.reason === 'beta';
  const title = awaitingBeta ? t('access.betaTitle') : t('access.inactiveTitle');
  const body = awaitingBeta ? t('access.betaText') : t('access.inactiveText');
  return (
    <section
      role="alert"
      data-testid="access-inactive-card"
      className="mb-6 rounded-2xl border border-destructive/30 bg-card p-5 shadow-sm sm:p-6"
    >
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-destructive-soft text-destructive">
          <AlertIcon />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          <p className="mt-1 text-sm leading-6 text-muted-text">{body}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {awaitingBeta ? (
              <>
                <a href={discordUrl} target="_blank" rel="noreferrer" data-testid="access-discord-link" className={PRIMARY_LINK_CLASS}>
                  {t('access.betaDiscordCta')} ↗
                </a>
                <a href={contactUrl} target="_blank" rel="noreferrer" data-testid="access-contact-link" className={SECONDARY_LINK_CLASS}>
                  {t('access.betaWhatsappCta')} ↗
                </a>
                <a href={githubUrl} target="_blank" rel="noreferrer" data-testid="access-github-link" className={SECONDARY_LINK_CLASS}>
                  {t('access.betaGithubCta')} ↗
                </a>
              </>
            ) : (
              <>
                <a href={contactUrl} target="_blank" rel="noreferrer" data-testid="access-contact-link" className={PRIMARY_LINK_CLASS}>
                  {t('access.contactCta')} ↗
                </a>
                <a href={discordUrl} target="_blank" rel="noreferrer" data-testid="access-discord-link" className={PRIMARY_LINK_CLASS}>
                  {t('access.discordCta')} ↗
                </a>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
