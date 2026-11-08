'use client';

import Link from 'next/link';
import { useI18n } from '@/lib/i18n/provider';
import SiteFooter from '@/components/site-footer';

export default function TermsPage() {
  const { t } = useI18n();

  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-16">
        <Link href="/" className="text-sm text-muted-text hover:text-ink">
          ← Post Engineer
        </Link>
        <h1 className="mt-6 text-3xl font-bold tracking-tight text-ink sm:text-4xl">
          {t('legal.termsTitle')}
        </h1>
        <p className="mt-2 text-sm text-faint">{t('legal.termsUpdated')}</p>
        <div className="mt-8 space-y-4 rounded-3xl border border-hairline bg-card p-6 leading-relaxed text-ink-soft shadow-sm sm:p-8">
          {t('legal.termsBody').split('\n\n').map((paragraph) => (
            <p key={paragraph.slice(0, 32)}>{paragraph}</p>
          ))}
        </div>
        <p className="mt-6 text-sm text-muted-text">
          {t('footer.support')}:{' '}
          <a href="mailto:madebyryandev@gmail.com" className="font-medium text-brand hover:underline">
            madebyryandev@gmail.com
          </a>
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
