'use client';

import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n/provider';
import { useUpgradeDialogStore } from '@/lib/upgrade-dialog-store';
import { whatsappUrl } from '@/lib/whatsapp';

//---------------
// InsufficientTokensDialog — global dialog shown when any flow receives 402
// (insufficient tokens). State comes from useUpgradeDialogStore; the CTA
// goes to /billing (plans/upgrade page).
// "free" variant: free tokens exhausted — own copy + WhatsApp.
//---------------
export function InsufficientTokensDialog() {
  const { t } = useI18n();
  const router = useRouter();
  const isOpen = useUpgradeDialogStore((s) => s.isOpen);
  const variant = useUpgradeDialogStore((s) => s.variant);
  const close = useUpgradeDialogStore((s) => s.close);

  if (!isOpen) return null;

  const isFree = variant === 'free';
  const whatsappHref = whatsappUrl(t('pricing.whatsappTokens'));

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="upgrade-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/60 p-4"
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <h2 id="upgrade-dialog-title" className="text-lg font-semibold text-neutral-900">
          {isFree ? t('tokens.freeExhaustedTitle') : t('persona.errInsufficientTokens')}
        </h2>
        <p className="mt-2 text-sm leading-6 text-neutral-600">
          {isFree ? t('tokens.freeExhaustedHint') : t('persona.upgradeHint')}
        </p>
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={close}
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-neutral-200 px-5 py-2.5 text-sm font-semibold text-neutral-700 transition-colors hover:bg-neutral-50"
          >
            {t('persona.dialogClose')}
          </button>
          {isFree && whatsappHref && (
            <a
              href={whatsappHref}
              target="_blank"
              rel="noreferrer"
              data-testid="whatsapp-cta"
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[#25D366] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#20bd5b]"
            >
              {t('tokens.whatsappCta')}
            </a>
          )}
          <button
            type="button"
            data-testid="upgrade-cta"
            onClick={() => {
              close();
              router.push('/billing');
            }}
            className="inline-flex min-h-11 items-center justify-center rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-hover"
          >
            {isFree ? t('tokens.buyMore') : t('persona.upgradeCta')}
          </button>
        </div>
      </div>
    </div>
  );
}
