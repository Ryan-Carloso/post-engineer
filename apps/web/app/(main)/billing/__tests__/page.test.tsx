import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const routerPush = vi.fn();
const routerReplace = vi.fn();
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const { checkoutParam } = vi.hoisted(() => ({ checkoutParam: { value: null as string | null } }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, replace: routerReplace }),
  useSearchParams: () => ({ get: (key: string) => (key === 'checkout' ? checkoutParam.value : null) }),
}));

vi.mock('@/lib/i18n/provider', () => ({
  useI18n: () => ({
    t: (key: string, vars?: Record<string, string | number>) => {
      const dict: Record<string, string> = {
        'pricing.title': 'Buy tokens',
        'pricing.subtitle': 'Prepaid tokens for video generation.',
        'pricing.successDesc': 'Payment received.',
        'pricing.cancelDesc': 'Checkout canceled.',
        'pricing.currentPlan': 'Remaining tokens',
        'pricing.tokens': 'tokens',
        'pricing.perMonth': 'One-time purchase',
        'pricing.activate': 'Buy tokens',
        'pricing.buyPack': 'Buy tokens',
        'pricing.cancelDialogTitle': 'Why did you cancel?',
        'pricing.cancelDialogDesc': 'Tell us why.',
        'pricing.cancelReasonPrice': 'Too expensive',
        'pricing.cancelReasonTesting': 'Just testing',
        'pricing.cancelReasonOther': 'Other',
        'pricing.cancelDetailsLabel': 'Details?',
        'pricing.cancelDetailsPlaceholder': 'Details…',
        'pricing.cancelWhatsappCta': 'Send via WhatsApp',
        'pricing.cancelClose': 'Close',
        'pricing.whatsappCancel': 'Hi! I canceled. Reason: {reason}',
      };
      let out = dict[key] ?? key;
      if (vars) {
        for (const [name, value] of Object.entries(vars)) out = out.split(`{${name}}`).join(String(value));
      }
      return out;
    },
  }),
}));

import BillingPage from '../page';

function Wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('BillingPage', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    routerPush.mockReset();
    routerReplace.mockReset();
    checkoutParam.value = null;
  });

  it('shows the authoritative wallet balance and token packs', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ success: true, balance: 42 }) });
    render(<BillingPage />, { wrapper: Wrapper });

    await waitFor(() => expect(screen.getByText('42 tokens')).toBeInTheDocument());
    expect(screen.getByText('10 tokens')).toBeInTheDocument();
    expect(screen.getByText('50 tokens')).toBeInTheDocument();
    expect(screen.getByText('100 tokens')).toBeInTheDocument();
    expect(screen.queryByText(/renews automatically|per month|monthly/i)).toBeNull();
  });

  it('starts one-time checkout with a server-known pack ID', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, balance: 0 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, transactions: [], total: 0, limit: 20, offset: 0 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, url: 'https://checkout.stripe.com/session' }) });
    render(<BillingPage />, { wrapper: Wrapper });

    await waitFor(() => expect(screen.getByText('10 tokens')).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole('button', { name: 'Buy tokens' })[1]);

    await waitFor(() => expect(mockFetch).toHaveBeenLastCalledWith(
      '/api/billing/checkout',
      expect.objectContaining({ body: JSON.stringify({ packId: 'pack_50' }) }),
    ));
    await waitFor(() => expect(routerPush).toHaveBeenCalledWith('https://checkout.stripe.com/session'));
  });

  it('opens the cancel feedback dialog with WhatsApp CTA on ?checkout=canceled', async () => {
    checkoutParam.value = 'canceled';
    vi.stubEnv('NEXT_PUBLIC_WHATSAPP_NUMBER', '15551234567');
    try {
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({ success: true, balance: 5 }) });
      render(<BillingPage />, { wrapper: Wrapper });

      await waitFor(() => expect(screen.getByRole('alertdialog')).toBeInTheDocument());
      expect(screen.getByText('Checkout canceled.')).toBeInTheDocument();
      const wa = screen.getByTestId('cancel-whatsapp-cta');
      expect(wa).toHaveAttribute('href', expect.stringContaining('https://wa.me/15551234567'));

      fireEvent.click(screen.getByTestId('cancel-dialog-close'));
      await waitFor(() => expect(routerReplace).toHaveBeenCalledWith('/billing'));
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
