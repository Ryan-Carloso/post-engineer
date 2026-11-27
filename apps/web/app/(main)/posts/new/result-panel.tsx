'use client';

import Link from 'next/link';
import { CalendarCheck2, CircleAlert, CircleCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { PROVIDER_LABELS } from '@/lib/account-options';
import { isSocialProvider } from '@/lib/contracts/providers';
import { useI18n } from '@/lib/i18n/provider';
import type { PublishResult } from '@/lib/post-composer/request';

function formatSlot(slotAt: string, timezone: string, locale: 'pt' | 'en'): string {
  const date = new Date(slotAt);
  if (Number.isNaN(date.getTime())) return slotAt;
  return new Intl.DateTimeFormat(locale === 'pt' ? 'pt-BR' : 'en-US', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: timezone,
  }).format(date);
}

export function ResultPanel({
  result,
  timezone,
  onAgain,
}: {
  result: PublishResult;
  timezone: string;
  onAgain: () => void;
}) {
  const { t, locale } = useI18n();

  if (result.mode === 'scheduled') {
    const [first] = result.slots;
    return (
      <section
        className="rounded-2xl border border-success/30 bg-success-soft p-6"
        data-testid="composer-result"
      >
        <div className="flex items-start gap-3">
          <CalendarCheck2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-ink">{t('composer.successScheduledTitle')}</h2>
            <p className="mt-1 text-sm text-ink-soft">
              {t('composer.successScheduledBody', {
                date: formatSlot(first?.slotAt ?? new Date().toISOString(), timezone, locale),
              })}
            </p>
            {result.replayed ? (
              <p className="mt-1 text-xs text-muted-text">{t('composer.resultReplayed')}</p>
            ) : null}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {first !== undefined ? (
            <Button asChild size="sm">
              <Link href={`/posts/${encodeURIComponent(first.id)}`}>{t('composer.successViewPost')}</Link>
            </Button>
          ) : null}
          <Button asChild size="sm" variant="outline">
            <Link href="/posts">{t('composer.successScheduledAction')}</Link>
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onAgain}>
            {t('composer.successAgain')}
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section
      className="rounded-2xl border border-line bg-card p-6"
      data-testid="composer-result"
    >
      <div className="flex items-start gap-3">
        {result.success ? (
          <CircleCheck className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
        ) : (
          <CircleAlert className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
        )}
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-ink">
            {result.success ? t('composer.successAsapTitle') : t('composer.successPartialTitle')}
          </h2>
          {result.replayed ? (
            <p className="mt-1 text-xs text-muted-text">{t('composer.resultReplayed')}</p>
          ) : null}
        </div>
      </div>
      <ul className="mt-4 space-y-2">
        {result.publishes.map((provider) => (
          <li key={provider.provider}>
            <p className="text-xs font-semibold tracking-wide text-muted-text uppercase">
              {isSocialProvider(provider.provider)
                ? PROVIDER_LABELS[provider.provider]
                : provider.provider}
            </p>
            <ul className="mt-1 space-y-1">
              {provider.results.map((account) => {
                const link = account.videoUrl ?? account.permalink;
                return (
                  <li
                    key={`${provider.provider}:${account.accountId}`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface px-3 py-2"
                  >
                    <span className="truncate text-sm text-ink">{account.accountId}</span>
                    <span className="flex items-center gap-2 text-xs">
                      <span
                        className={
                          account.success
                            ? 'font-semibold text-success'
                            : 'font-semibold text-destructive'
                        }
                      >
                        {account.success ? t('composer.resultOk') : t('composer.resultFailed')}
                      </span>
                      {link !== undefined ? (
                        <a
                          href={link}
                          target="_blank"
                          rel="noreferrer"
                          className="font-semibold text-accent underline"
                        >
                          {t('composer.successViewPost')}
                        </a>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button asChild size="sm" variant="outline">
          <Link href="/posts">{t('composer.successScheduledAction')}</Link>
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onAgain}>
          {t('composer.successAgain')}
        </Button>
      </div>
    </section>
  );
}
