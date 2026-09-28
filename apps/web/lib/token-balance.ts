//---------------
// Token Balance — fetches the real balance from the /api/billing/tokens API.
// Replaces the useTokenStore mock for the UI.
// Keeps computeVideoTokens (pure math) in lib/tokens.ts.
//---------------

import { toFiniteNumber } from '@/lib/tokens';
import { logger } from '@/lib/logger';

export interface TokenBalance {
  balance: number;
  free: number;
}

const EMPTY_BALANCE: TokenBalance = {
  balance: 0,
  free: 0,
};

//---------------
// fetchTokenBalance — fetches the user's real balance from the API.
// On error, returns a zero balance (fail-safe so the UI does not break).
//---------------
export async function fetchTokenBalance(): Promise<TokenBalance> {
  try {
    const res = await fetch('/api/billing/tokens');
    if (!res.ok) return EMPTY_BALANCE;
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
