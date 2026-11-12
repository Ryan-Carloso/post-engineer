'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { fetchTokenBalance } from '@/lib/token-balance';
import { toFiniteNumber } from '@/lib/tokens';
import { useI18n } from '@/lib/i18n/provider';

//---------------
// TokenBalance — prepaid wallet balance. `compact` renders the one-row form
// the sidebar uses (the tall card is what pushed the last nav item off a
// 900px viewport); the full card stays on /account.
//---------------
export function TokenBalance({ compact = false }: { compact?: boolean }) {
  const [balance, setBalance] = useState(0);
  const { t } = useI18n();

  useEffect(() => {
    fetchTokenBalance().then((data) => {
      setBalance(toFiniteNumber(data.balance, 0));
    });
  }, []);

  if (compact) {
    return (
      <Link
        href="/billing"
        data-testid="token-balance"
        aria-label={`${t('tokens.balance')}: ${formatBalance(balance)}`}
        className="flex items-center gap-2.5 rounded-2xl border border-hairline bg-surface px-3 py-2 transition-colors hover:border-line"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-ink">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="size-4" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 3.75 20.25 8v8L12 20.25 3.75 16V8L12 3.75Z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="m3.75 8 8.25 4.25L20.25 8M12 12.25v8" />
          </svg>
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-muted-text">{t('tokens.balance')}</span>
        <span className="shrink-0 text-[17px] leading-none font-semibold tracking-[-0.02em] text-ink tabular-nums">
          {formatBalance(balance)}
        </span>
      </Link>
    );
  }

  return (
    <Link
      href="/billing"
      data-testid="token-balance"
      aria-label={t('tokens.balance')}
      className="block overflow-hidden rounded-[28px] border border-hairline bg-surface shadow-[0_8px_24px_rgba(20,32,51,0.03)] transition-colors hover:border-line"
    >
      <div className="flex items-center gap-3 px-5 pt-5 lg:gap-4 lg:px-7 lg:pt-6">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-brand-soft text-ink lg:size-[56px] lg:rounded-[20px]">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="size-6 lg:size-7" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 3.75 20.25 8v8L12 20.25 3.75 16V8L12 3.75Z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="m3.75 8 8.25 4.25L20.25 8M12 12.25v8" />
            </svg>
          </span>
          <div className="min-w-0">
            <span className="block text-[14px] leading-snug font-medium text-muted-text lg:text-[16px]">{t('tokens.balance')}</span>
            <span className="block text-[28px] leading-none font-semibold tracking-[-0.06em] text-ink lg:text-[34px]">
              {formatBalance(balance)}
            </span>
          </div>
        </div>
      </div>

      <div className="px-5 pt-4 pb-5 lg:px-7 lg:pt-5 lg:pb-6">
        <div className="mt-3 text-[13px] text-muted-text lg:text-[15px]">{t('tokens.available')}</div>
      </div>
    </Link>
  );
}

// Ex.: 100 → '100', 98.5 → '98.5', 0 → '0' — sem zeros redundantes.
function formatBalance(balance: unknown): string {
  const safe = toFiniteNumber(balance, 0);
  return String(Math.round(safe * 100) / 100);
}
