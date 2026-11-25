'use client';

import Link from 'next/link';
import AppLogo from '@/components/ui/app-logo';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n/provider';

const DOCS_HREF = '/api-documentation.txt';

export function NotFoundView({ signedIn }: { signedIn: boolean }) {
  const { t } = useI18n();

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col items-center gap-6 px-4 py-16 text-center">
      <AppLogo size={56} />
      <p className="text-sm font-semibold text-brand">404</p>
      <h1 className="text-2xl font-semibold text-ink">{t('notFound.title')}</h1>
      <p className="text-sm text-muted-text">{t(signedIn ? 'notFound.descriptionSignedIn' : 'notFound.description')}</p>
      <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
        {signedIn ? (
          <Button asChild>
            <Link href="/">{t('notFound.goToDashboard')}</Link>
          </Button>
        ) : (
          <Button asChild>
            <Link href="/login">{t('notFound.createAccount')}</Link>
          </Button>
        )}
        <Button asChild variant="outline">
          <a href={DOCS_HREF}>{t('notFound.viewDocs')}</a>
        </Button>
        <Button asChild variant="ghost">
          <Link href="/landing">{t('notFound.backToLanding')}</Link>
        </Button>
      </div>
    </div>
  );
}
