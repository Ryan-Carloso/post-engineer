'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { useI18n } from '@/lib/i18n/provider';
import type { TranslationKey } from '@/lib/i18n';
import type { TokenTransaction, TokenTransactionsPage } from '@/lib/token-transactions';
import { HttpStatusError } from '@/lib/errors';

//---------------
// TokenHistory — the user's full token ledger: purchases, video
// generations and refunds, newest first, with "Load more" pagination.
//---------------

const PAGE_SIZE = 20;

//---------------
// Type guards for the /api/billing/transactions response shape.
//---------------
function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isTransaction(value: unknown): value is TokenTransaction {
  if (typeof value !== 'object' || value === null) return false;
  const tx = value as Record<string, unknown>;
  return (
    typeof tx.id === 'string' &&
    typeof tx.amount === 'number' &&
    typeof tx.type === 'string' &&
    isNullableString(tx.description) &&
    isNullableString(tx.reason) &&
    isNullableString(tx.generationId) &&
    typeof tx.createdAt === 'string'
  );
}

function isTransactionsPage(value: unknown): value is TokenTransactionsPage {
  if (typeof value !== 'object' || value === null) return false;
  const page = value as Record<string, unknown>;
  return (
    page.success === true &&
    Array.isArray(page.transactions) &&
    page.transactions.every(isTransaction) &&
    typeof page.total === 'number' &&
    typeof page.limit === 'number' &&
    typeof page.offset === 'number'
  );
}

export async function fetchTransactionsPage(offset: number): Promise<TokenTransactionsPage> {
  const response = await fetch(`/api/billing/transactions?limit=${PAGE_SIZE}&offset=${offset}`);
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok || !isTransactionsPage(data)) {
    // The used HttpStatusError keeps the shared 4xx/no-retry policy and the
    // host-wide session-expiry redirect working for the billing history too;
    // a 2xx answer with an invalid body keeps its 2xx status (transient).
    throw new HttpStatusError('Failed to load token transactions', response.status);
  }
  return data;
}

//---------------
// Type badge styling — each ledger type gets a distinct badge; refunds
// are visually distinct in green.
//---------------
interface TypeBadgeStyle {
  className: string;
  labelKey: TranslationKey;
}

const TYPE_BADGE_STYLES: Record<string, TypeBadgeStyle> = {
  purchase: { className: 'border-blue-200 bg-blue-50 text-blue-700', labelKey: 'pricing.historyTypePurchase' },
  video_generation: { className: 'border-red-200 bg-red-50 text-red-700', labelKey: 'pricing.historyTypeVideoGeneration' },
  generation_refund: { className: 'border-emerald-200 bg-emerald-50 text-emerald-700', labelKey: 'pricing.historyTypeRefund' },
  refund: { className: 'border-emerald-200 bg-emerald-50 text-emerald-700', labelKey: 'pricing.historyTypeRefund' },
  plan_grant: { className: 'border-violet-200 bg-violet-50 text-violet-700', labelKey: 'pricing.historyTypePlanGrant' },
  manual_adjustment: { className: 'border-line bg-sunken text-ink-soft', labelKey: 'pricing.historyTypeAdjustment' },
};

const UNKNOWN_TYPE_STYLE: TypeBadgeStyle = {
  className: 'border-line bg-surface text-muted-text',
  labelKey: 'pricing.historyTypeUnknown',
};

function formatAmount(amount: number): string {
  return amount > 0 ? `+${amount}` : `${amount}`;
}

function amountClassName(amount: number): string {
  if (amount > 0) return 'text-emerald-600';
  if (amount < 0) return 'text-red-600';
  return 'text-muted-text';
}

//---------------
// TransactionRow — one ledger entry: type badge, date, description and
// the signed amount (green for credits, red for debits).
//---------------
const TransactionRow = ({ tx }: { tx: TokenTransaction }) => {
  const { t } = useI18n();
  const style = TYPE_BADGE_STYLES[tx.type] ?? UNKNOWN_TYPE_STYLE;
  return (
    <li className="flex items-center justify-between gap-4 rounded-2xl border border-line bg-card px-4 py-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${style.className}`}>
            {t(style.labelKey)}
          </span>
          <span className="text-xs text-muted-text">{new Date(tx.createdAt).toLocaleString()}</span>
        </div>
        {tx.description !== null && tx.description !== '' && (
          <p className="mt-1 truncate text-sm font-medium text-ink">{tx.description}</p>
        )}
      </div>
      <span className={`shrink-0 text-base font-bold ${amountClassName(tx.amount)}`}>{formatAmount(tx.amount)}</span>
    </li>
  );
};

export const TokenHistory = () => {
  const { t } = useI18n();
  const historyQuery = useInfiniteQuery({
    queryKey: ['billing', 'transactions'],
    queryFn: ({ pageParam }) => fetchTransactionsPage(pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      const loaded = lastPage.offset + lastPage.transactions.length;
      return loaded < lastPage.total ? loaded : undefined;
    },
    staleTime: 30_000,
  });

  const pages = historyQuery.data?.pages ?? [];
  // Dedupe by id: offset-based pagination can repeat a row if a new
  // transaction lands while the user pages through the ledger.
  const seenIds = new Set<string>();
  const transactions = pages
    .flatMap((page) => page.transactions)
    .filter((tx) => {
      if (seenIds.has(tx.id)) return false;
      seenIds.add(tx.id);
      return true;
    });
  const total = pages[0]?.total ?? 0;

  return (
    <section aria-label={t('pricing.historyHeading')} className="pt-12 lg:pt-14">
      <div>
        <h2 className="text-2xl font-extrabold tracking-[-0.04em] text-ink sm:text-3xl">
          {t('pricing.historyHeading')}
        </h2>
        <p className="mt-2 text-sm text-muted-text sm:text-base">{t('pricing.historyDescription')}</p>
      </div>

      {historyQuery.isPending && (
        <div className="mt-6 space-y-3" role="status">
          <p className="text-sm text-muted-text">{t('pricing.historyLoading')}</p>
          <div className="h-16 animate-pulse rounded-2xl bg-sunken" />
          <div className="h-16 animate-pulse rounded-2xl bg-sunken" />
          <div className="h-16 animate-pulse rounded-2xl bg-sunken" />
        </div>
      )}

      {historyQuery.isError && (
        <div role="alert" className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-5 py-4">
          <p className="text-sm text-red-700">{t('pricing.historyError')}</p>
          <button
            type="button"
            onClick={() => void historyQuery.refetch()}
            className="mt-3 rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
          >
            {t('pricing.historyRetry')}
          </button>
        </div>
      )}

      {!historyQuery.isPending && !historyQuery.isError && transactions.length === 0 && (
        <p className="mt-6 rounded-2xl border border-dashed border-line bg-card px-5 py-8 text-center text-sm text-muted-text">
          {t('pricing.historyEmpty')}
        </p>
      )}

      {transactions.length > 0 && (
        <div className="mt-6">
          <ul className="space-y-3">
            {transactions.map((tx) => (
              <TransactionRow key={tx.id} tx={tx} />
            ))}
          </ul>
          <p className="mt-4 text-center text-xs text-muted-text">
            {t('pricing.historyShowing', { shown: transactions.length, total })}
          </p>
          {historyQuery.hasNextPage && (
            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={() => void historyQuery.fetchNextPage()}
                disabled={historyQuery.isFetchingNextPage}
                className="rounded-xl border border-line bg-card px-6 py-2.5 text-sm font-semibold text-ink-soft shadow-sm hover:bg-surface disabled:opacity-60"
              >
                {historyQuery.isFetchingNextPage ? t('pricing.historyLoadingMore') : t('pricing.historyLoadMore')}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
};
