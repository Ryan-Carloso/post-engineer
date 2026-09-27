import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

vi.mock('@/lib/i18n/provider', () => ({
  useI18n: () => ({
    t: (key: string, vars?: Record<string, string | number>) => {
      const dict: Record<string, string> = {
        'pricing.historyHeading': 'Token history',
        'pricing.historyDescription': 'Every token movement on your account.',
        'pricing.historyTypePurchase': 'Purchase',
        'pricing.historyTypeVideoGeneration': 'Video generation',
        'pricing.historyTypeRefund': 'Refund',
        'pricing.historyTypePlanGrant': 'Plan grant',
        'pricing.historyTypeAdjustment': 'Adjustment',
        'pricing.historyTypeUnknown': 'Other',
        'pricing.historyEmpty': 'No token transactions yet.',
        'pricing.historyLoadMore': 'Load more',
        'pricing.historyLoading': 'Loading token history…',
        'pricing.historyLoadingMore': 'Loading more…',
        'pricing.historyError': 'Could not load your token history.',
        'pricing.historyRetry': 'Try again',
        'pricing.historyShowing': 'Showing {shown} of {total}',
      };
      let out = dict[key] ?? key;
      if (vars) {
        for (const [name, value] of Object.entries(vars)) out = out.split(`{${name}}`).join(String(value));
      }
      return out;
    },
  }),
}));

import { TokenHistory } from '../token-history';

function Wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

interface TxFixture {
  id: string;
  amount: number;
  type: string;
  description: string | null;
  reason: string | null;
  generationId: string | null;
  createdAt: string;
}

function tx(overrides: Partial<TxFixture> & { id: string }): TxFixture {
  return {
    amount: 0,
    type: 'purchase',
    description: null,
    reason: null,
    generationId: null,
    createdAt: '2026-09-24T10:00:00.000Z',
    ...overrides,
  };
}

function pageResponse(transactions: TxFixture[], total: number, offset: number) {
  return { ok: true, json: async () => ({ success: true, transactions, total, limit: 20, offset }) };
}

const purchaseTx = tx({ id: 'tx-purchase', amount: 10, type: 'purchase', description: 'Starter pack purchase' });
const generationTx = tx({ id: 'tx-generation', amount: -2, type: 'video_generation', description: 'AI video render', createdAt: '2026-09-24T09:00:00.000Z' });
const refundTx = tx({ id: 'tx-refund', amount: 2, type: 'generation_refund', description: 'Refund for rejected generation', createdAt: '2026-09-24T08:00:00.000Z' });

describe('TokenHistory', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('shows a loading state while fetching', () => {
    mockFetch.mockReturnValue(new Promise(() => {}));
    render(<TokenHistory />, { wrapper: Wrapper });

    expect(screen.getByText('Loading token history…')).toBeInTheDocument();
  });

  it('renders transactions with type badges and signed amounts', async () => {
    mockFetch.mockResolvedValue(pageResponse([purchaseTx, generationTx, refundTx], 3, 0));
    render(<TokenHistory />, { wrapper: Wrapper });

    await waitFor(() => expect(screen.getByText('Starter pack purchase')).toBeInTheDocument());

    expect(screen.getByText('Purchase')).toBeInTheDocument();
    expect(screen.getByText('Video generation')).toBeInTheDocument();
    expect(screen.getByText('Refund')).toBeInTheDocument();

    const credit = screen.getByText('+10');
    expect(credit).toBeInTheDocument();
    expect(credit.className).toMatch(/emerald|green/);

    const debit = screen.getByText('-2');
    expect(debit).toBeInTheDocument();
    expect(debit.className).toMatch(/red/);

    const refund = screen.getByText('+2');
    expect(refund).toBeInTheDocument();
    expect(refund.className).toMatch(/emerald|green/);

    expect(screen.getByText('Showing 3 of 3')).toBeInTheDocument();
  });

  it('shows an empty state when there are no transactions', async () => {
    mockFetch.mockResolvedValue(pageResponse([], 0, 0));
    render(<TokenHistory />, { wrapper: Wrapper });

    await waitFor(() => expect(screen.getByText('No token transactions yet.')).toBeInTheDocument());
    expect(screen.queryByText('Load more')).toBeNull();
  });

  it('shows an error state with a retry button when loading fails', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network down'));
    render(<TokenHistory />, { wrapper: Wrapper });

    await waitFor(() => expect(screen.getByText('Could not load your token history.')).toBeInTheDocument());

    mockFetch.mockResolvedValueOnce(pageResponse([purchaseTx], 1, 0));
    fireEvent.click(screen.getByText('Try again'));

    await waitFor(() => expect(screen.getByText('Starter pack purchase')).toBeInTheDocument());
  });

  it('appends the next page when loading more', async () => {
    mockFetch.mockImplementation((url: string) => {
      const offset = new URL(url, 'http://localhost').searchParams.get('offset');
      if (offset === '2') return Promise.resolve(pageResponse([refundTx], 3, 2));
      return Promise.resolve(pageResponse([purchaseTx, generationTx], 3, 0));
    });
    render(<TokenHistory />, { wrapper: Wrapper });

    await waitFor(() => expect(screen.getByText('Starter pack purchase')).toBeInTheDocument());
    expect(screen.getByText('Showing 2 of 3')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Load more'));

    await waitFor(() => expect(screen.getByText('Refund for rejected generation')).toBeInTheDocument());
    expect(screen.getByText('Showing 3 of 3')).toBeInTheDocument();
    expect(screen.queryByText('Load more')).toBeNull();
    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('offset=2'));
  });

  it('renders the transaction date for each row', async () => {
    mockFetch.mockResolvedValue(pageResponse([purchaseTx], 1, 0));
    render(<TokenHistory />, { wrapper: Wrapper });

    await waitFor(() => expect(screen.getByText('Starter pack purchase')).toBeInTheDocument());
    expect(screen.getByText(/2026/)).toBeInTheDocument();
  });
});
