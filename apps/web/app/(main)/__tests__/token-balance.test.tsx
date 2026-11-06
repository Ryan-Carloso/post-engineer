import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

//---------------
// Testes do badge de tokens na sidebar.
// Agora usa fetchTokenBalance (API real) em vez do mock useTokenStore.
//---------------

vi.mock('@/lib/i18n/provider', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const react = require('react') as typeof import('react');
  const t = (key: string) => key;
  const useI18n = () => {
    const [locale, setLocale] = react.useState<'pt' | 'en'>('pt');
    return { locale, setLocale, t };
  };
  function I18nProvider({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
  }
  I18nProvider.displayName = 'I18nProvider';
  return { useI18n, I18nProvider };
});

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: React.ComponentProps<'a'> & { href: string }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Only notifyIfSessionExpired is doubled; the module's redirect behavior is
// pinned in lib/__tests__/session-expiry.test.tsx.
vi.mock('@/lib/session-expiry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/session-expiry')>();
  return {
    ...actual,
    notifyIfSessionExpired: vi.fn(),
  };
});

import { TokenBalance } from '../token-balance';
import { notifyIfSessionExpired } from '@/lib/session-expiry';

describe('TokenBalance', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('exibe o saldo retornado pela API', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, plan: 'starter', balance: 45, used: 15, periodEnd: null }),
    });

    render(<TokenBalance />);

    await waitFor(() => {
      expect(screen.getByTestId('token-balance')).toHaveTextContent('45');
    });
    expect(screen.getByText('tokens.balance')).toBeInTheDocument();
  });

  it('mostra saldo zero quando API retorna free', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, plan: 'free', balance: 0, used: 0, periodEnd: null }),
    });

    render(<TokenBalance />);

    await waitFor(() => {
      expect(screen.getByTestId('token-balance')).toHaveTextContent('0');
    });
  });

  it('mostra saldo zero quando fetch falha', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));

    render(<TokenBalance />);

    await waitFor(() => {
      expect(screen.getByTestId('token-balance')).toHaveTextContent('0');
    });
  });

  it('dispara a sessão expirada uma única vez quando a API responde 401', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 401, json: async () => ({ success: false }) });

    render(<TokenBalance />);

    // Zero balance (fail-safe contract) while the session handler runs.
    await waitFor(() => expect(notifyIfSessionExpired).toHaveBeenCalledTimes(1));
    const response = vi.mocked(notifyIfSessionExpired).mock.calls[0]?.[0];
    expect((response as Response).status).toBe(401);
  });

  it('does not render subscription-era percentage state', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, plan: 'free', balance: 0, used: 0, periodEnd: null }),
    });

    render(<TokenBalance />);

    await waitFor(() => {
      expect(screen.getByTestId('token-balance')).toHaveTextContent('0');
    });
    expect(screen.getByTestId('token-balance')).not.toHaveTextContent('NaN');
  });

  it('coage saldo string do PostgREST', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, plan: 'starter', balance: '22.5', used: '7.5', periodEnd: null }),
    });

    render(<TokenBalance />);

    await waitFor(() => {
      expect(screen.getByTestId('token-balance')).toHaveTextContent('22.5');
    });
  });

  it('linka para a página de billing', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, plan: 'free', balance: 0, used: 0, periodEnd: null }),
    });

    render(<TokenBalance />);

    await waitFor(() => {
      expect(screen.getByTestId('token-balance').closest('a')).toHaveAttribute('href', '/billing');
    });
  });
});

describe('TokenBalance — free tokens badge', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('NÃO mostra badge de grátis quando o saldo é 100% pago', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, balance: 50, free: 0 }),
    });

    render(<TokenBalance />);

    await waitFor(() => {
      expect(screen.getByTestId('token-balance')).toHaveTextContent('50');
    });
    expect(screen.queryByTestId('free-tokens-badge')).toBeNull();
  });
});
