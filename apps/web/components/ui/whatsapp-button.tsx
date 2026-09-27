'use client';

import type { ReactNode } from 'react';
import { useI18n } from '@/lib/i18n/provider';
import { whatsappUrl } from '@/lib/whatsapp';

//---------------
// WhatsAppFloatingButton — persistent access to WhatsApp support.
// Rendered in the root layout, shown on all pages (landing, login,
// logged-in area). Raised on mobile so it does not cover the logged-in
// area's bottom navigation. Renders nothing when the support number is
// not configured (NEXT_PUBLIC_WHATSAPP_NUMBER unset).
//---------------
export default function WhatsAppFloatingButton(): ReactNode {
  const { t } = useI18n();
  const message = t('pricing.whatsappHelp');
  const href = whatsappUrl(message);
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label="WhatsApp"
      className="fixed right-6 bottom-28 z-40 flex size-14 items-center justify-center rounded-full bg-[#25D366] text-white shadow-[0_12px_32px_rgba(37,211,102,0.4)] transition-transform hover:scale-105 hover:bg-[#20bd5b] focus-visible:ring-4 focus-visible:ring-[#25D366]/30 focus-visible:outline-none sm:right-8 sm:bottom-32 md:right-10 md:bottom-10 md:size-16"
    >
      <svg viewBox="0 0 24 24" fill="currentColor" className="size-7 md:size-8" aria-hidden="true">
        <path d="M20.5 3.5A11.8 11.8 0 0 0 12.1 0C5.5 0 .1 5.4.1 12c0 2.1.6 4.1 1.6 5.9L0 24l6.3-1.7a12 12 0 0 0 5.8 1.5h.1c6.6 0 11.9-5.4 11.9-12 0-3.2-1.3-6.1-3.6-8.3Zm-8.4 18.3h-.1c-1.8 0-3.6-.5-5.1-1.4l-.4-.2-3.7 1 1-3.6-.2-.4A9.8 9.8 0 0 1 2 12C2 6.5 6.5 2 12.1 2c2.7 0 5.1 1 7 2.9s2.9 4.3 2.9 7c0 5.5-4.4 9.9-9.9 9.9Zm5.4-7.4c-.3-.2-1.7-.8-2-.9-.3-.1-.5-.2-.7.2-.2.3-.8.9-.9 1.1-.2.2-.3.2-.6.1-1.6-.8-2.7-1.4-3.8-3.2-.3-.5.3-.5.8-1.6.1-.2.1-.4 0-.6-.1-.2-.7-1.7-1-2.3-.3-.6-.5-.5-.7-.5h-.6c-.2 0-.6.1-.8.4-.3.3-1.1 1.1-1.1 2.6s1.1 3 1.3 3.2c.2.2 2.2 3.4 5.4 4.8 2 .9 2.8 1 3.8.8.6-.1 1.7-.7 1.9-1.3.2-.6.2-1.2.1-1.3-.1-.2-.3-.3-.6-.4Z" />
      </svg>
      <span className="absolute top-0.5 right-0.5 size-3.5 rounded-full border-2 border-white bg-emerald-400" aria-hidden="true" />
    </a>
  );
}
