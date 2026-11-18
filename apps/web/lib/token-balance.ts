import { toFiniteNumber } from '@/lib/tokens';
import { logger } from '@/lib/logger';
import { notifyIfSessionExpired } from '@/lib/session-expiry';

export interface TokenBalance {
  balance: number;
  free: number;
}

const EMPTY_BALANCE: TokenBalance = {
  balance: 0,
  free: 0,
};

export async function fetchTokenBalance(): Promise<TokenBalance> {
  try {
    const res = await fetch('/api/billing/tokens');
    if (!res.ok) {
      notifyIfSessionExpired(res);
      return EMPTY_BALANCE;
    }
    const data = await res.json() as {
      success?: boolean;
      balance?: unknown;
      free?: unknown;
    };
    if (!data.success) return EMPTY_BALANCE;
    return {
      balance: toFiniteNumber(data.balance, 0),
      free: toFiniteNumber(data.free, 0),
    };
  } catch (error) {
    logger.warn('[billing] token balance fetch failed', { error });
    return EMPTY_BALANCE;
  }
}
