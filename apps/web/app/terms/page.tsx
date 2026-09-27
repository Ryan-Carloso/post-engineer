'use client';

import Link from 'next/link';
import { useI18n } from '@/lib/i18n/provider';
import SiteFooter from '@/components/site-footer';

export default function TermsPage() {
  const { t } = useI18n();

  return (
    <div className="flex min-h-screen flex-col bg-[#f7f8fa]">
      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-16">
        <Link href="/" className="text-sm text-[#718096] hover:text-[#101728]">
          ← Post Engineer
        </Link>
        <h1 className="mt-6 text-3xl font-bold tracking-tight text-[#101728] sm:text-4xl">
          {t('legal.termsTitle')}
        </h1>
        <p className="mt-2 text-sm text-[#8a94a8]">{t('legal.termsUpdated')}</p>
        <div className="mt-8 space-y-4 rounded-3xl border border-[#edf0f4] bg-white p-6 leading-relaxed text-[#414d63] shadow-sm sm:p-8">
          {t('legal.termsBody').split('\n\n').map((paragraph) => (
            <p key={paragraph.slice(0, 32)}>{paragraph}</p>
          ))}
        </div>
        <p className="mt-6 text-sm text-[#657184]">
          {t('footer.support')}:{' '}
          <a href="mailto:support@post-engineer.com" className="font-medium text-[#ff544c] hover:underline">
            support@post-engineer.com
          </a>
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
