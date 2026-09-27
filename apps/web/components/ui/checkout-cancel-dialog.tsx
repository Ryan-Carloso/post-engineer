'use client';

import { useState, type ReactNode } from 'react';
import { useI18n } from '@/lib/i18n/provider';
import { whatsappUrl } from '@/lib/whatsapp';

export type CancelReason = 'price' | 'testing' | 'other';

interface CheckoutCancelDialogProps {
  open: boolean;
  onClose: () => void;
}

//---------------
// CheckoutCancelDialog — opened when Stripe redirects back with
// ?checkout=canceled. Asks why the user canceled (price / testing / other)
// and offers a one-tap WhatsApp handoff with the reason pre-filled.
//---------------
export function CheckoutCancelDialog({ open, onClose }: CheckoutCancelDialogProps): ReactNode {
  const { t } = useI18n();
  const [reason, setReason] = useState<CancelReason>('price');
  const [details, setDetails] = useState<string>('');

  if (!open) return null;

  const reasonLabel =
    reason === 'price'
      ? t('pricing.cancelReasonPrice')
      : reason === 'testing'
        ? t('pricing.cancelReasonTesting')
        : t('pricing.cancelReasonOther');

  const trimmedDetails = details.trim();
  const baseMessage = t('pricing.whatsappCancel', { reason: reasonLabel });
  const message = trimmedDetails ? `${baseMessage} — ${trimmedDetails}` : baseMessage;
  const href = whatsappUrl(message);

  const options: Array<{ value: CancelReason; label: string; testid: string }> = [
    { value: 'price', label: t('pricing.cancelReasonPrice'), testid: 'cancel-reason-price' },
    { value: 'testing', label: t('pricing.cancelReasonTesting'), testid: 'cancel-reason-testing' },
    { value: 'other', label: t('pricing.cancelReasonOther'), testid: 'cancel-reason-other' },
  ];

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="cancel-dialog-title"
      aria-describedby="cancel-dialog-desc"
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/60 p-4"
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <h2 id="cancel-dialog-title" className="text-lg font-semibold text-neutral-900">
          {t('pricing.cancelDialogTitle')}
        </h2>
        <p id="cancel-dialog-desc" className="mt-1 text-sm leading-6 text-neutral-600">
          {t('pricing.cancelDialogDesc')}
        </p>

        <fieldset className="mt-4">
          <legend className="sr-only">{t('pricing.cancelDialogTitle')}</legend>
          <div className="space-y-2">
            {options.map((option) => (
              <label
                key={option.value}
                className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-sm font-medium transition-colors ${
                  reason === option.value
                    ? 'border-[#ff514a] bg-[#fff5f4] text-[#101728]'
                    : 'border-neutral-200 text-neutral-700 hover:bg-neutral-50'
                }`}
              >
                <input
                  type="radio"
                  name="cancel-reason"
                  value={option.value}
                  checked={reason === option.value}
                  onChange={() => setReason(option.value)}
                  data-testid={option.testid}
                  className="size-4 accent-[#ff514a]"
                />
                {option.label}
              </label>
            ))}
          </div>
        </fieldset>

        <label htmlFor="cancel-details" className="mt-4 block text-xs font-semibold text-neutral-700">
          {t('pricing.cancelDetailsLabel')}
        </label>
        <textarea
          id="cancel-details"
          data-testid="cancel-details"
          value={details}
          onChange={(event) => setDetails(event.target.value)}
          placeholder={t('pricing.cancelDetailsPlaceholder')}
          rows={3}
          maxLength={500}
          className="mt-1.5 w-full resize-none rounded-xl border border-neutral-200 px-3.5 py-2.5 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-[#ff514a] focus:outline-none"
        />

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            data-testid="cancel-dialog-close"
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-neutral-200 px-5 py-2.5 text-sm font-semibold text-neutral-700 transition-colors hover:bg-neutral-50"
          >
            {t('pricing.cancelClose')}
          </button>
          {href && (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              data-testid="cancel-whatsapp-cta"
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[#25D366] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#20bd5b]"
            >
              {t('pricing.cancelWhatsappCta')}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
