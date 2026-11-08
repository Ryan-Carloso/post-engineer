'use client';

import Link from 'next/link';
import { useI18n } from '@/lib/i18n/provider';

//---------------
// SiteFooter — rodapé público com links legais e e-mail de suporte
//---------------
export default function SiteFooter() {
  const { t } = useI18n();

  return (
    <footer className="w-full border-t border-hairline bg-card px-5 py-6">
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-2 text-sm text-muted-text sm:flex-row sm:justify-center sm:gap-6">
        <Link href="/privacy" className="hover:text-ink">
          {t('footer.privacy')}
        </Link>
        <Link href="/terms" className="hover:text-ink">
          {t('footer.terms')}
        </Link>
        <a href="mailto:madebyryandev@gmail.com" className="hover:text-ink">
          madebyryandev@gmail.com
        </a>
      </div>
      <p className="mt-2 text-center text-xs text-faint">
        {t('footer.rights', { year: new Date().getFullYear() })}
      </p>
    </footer>
  );
}
