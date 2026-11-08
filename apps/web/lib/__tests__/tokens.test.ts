import { describe, it, expect, beforeEach } from 'vitest';

//---------------
// Tests for the persona video token pricing model.
//  - Faceless (no face, per post)         = 1 token
//  - Face ok (480p)                       = 2 tokens
//  - Face very good (720p)                = 3 tokens
//  - Full lip-sync, face ok               = 8 tokens
//  - Full lip-sync, face very good        = 15 tokens
// No face MIX anymore: personas are always faced, so the price is a lookup on
// (faceless, face quality, fullLipsync). It is the only copy: the engine
// refunds the charged amount stored on the slot, never a recomputed price.
//---------------

import {
  computeVideoTokens,
  netLedgerSpent,
  useTokenStore,
  FACELESS_PRICE,
  FACE_QUALITY_PRICES,
  FULL_LIPSYNC_PRICES,
  DEFAULT_TOKEN_BALANCE,
} from '@/lib/tokens';

describe('constant prices', () => {
  it('faceless custa 1 token', () => {
    expect(FACELESS_PRICE).toBe(1);
  });

  it('face ok custa 2 tokens e very_good custa 3', () => {
    expect(FACE_QUALITY_PRICES.ok).toBe(2);
    expect(FACE_QUALITY_PRICES.very_good).toBe(3);
  });

  it('full lip-sync custa 8 tokens ok e 15 tokens very_good', () => {
    expect(FULL_LIPSYNC_PRICES.ok).toBe(8);
    expect(FULL_LIPSYNC_PRICES.very_good).toBe(15);
  });

  it('default initial balance is 100 tokens', () => {
    expect(DEFAULT_TOKEN_BALANCE).toBe(100);
  });
});

describe('computeVideoTokens', () => {
  it('faceless custa 1 token, em qualquer qualidade (não há rosto a resolver)', () => {
    expect(computeVideoTokens(true, 'ok')).toBe(1);
    expect(computeVideoTokens(true, 'very_good')).toBe(1);
  });

  it('com o rosto, ok custa 2 tokens', () => {
    expect(computeVideoTokens(false, 'ok')).toBe(2);
  });

  it('com o rosto, very_good custa 3 tokens', () => {
    expect(computeVideoTokens(false, 'very_good')).toBe(3);
  });

  it('full lip-sync custa 8 tokens ok e 15 tokens very_good', () => {
    expect(computeVideoTokens(false, 'ok', true)).toBe(8);
    expect(computeVideoTokens(false, 'very_good', true)).toBe(15);
  });

  it('full lip-sync com faceless continua a custar 1 token (combinação rejeitada antes da cobrança)', () => {
    expect(computeVideoTokens(true, 'ok', true)).toBe(1);
    expect(computeVideoTokens(true, 'very_good', true)).toBe(1);
  });

  it('o preço nunca é zero nem fracionário', () => {
    // The function returns a whole-token lookup; both branches are integers,
    // so the previous "round up so fractions are never charged" rule is
    // structural now, not arithmetic.
    for (const faceless of [true, false]) {
      for (const quality of ['ok', 'very_good'] as const) {
        for (const full of [false, true]) {
          const cost = computeVideoTokens(faceless, quality, full);
          expect(Number.isInteger(cost)).toBe(true);
          expect(cost).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });
});

describe('useTokenStore', () => {
  beforeEach(() => {
    useTokenStore.getState().resetTokens();
  });

  it('starts with the default balance', () => {
    expect(useTokenStore.getState().balance).toBe(DEFAULT_TOKEN_BALANCE);
  });

  it('spendTokens deduz do saldo', () => {
    const ok = useTokenStore.getState().spendTokens(0.5);
    expect(ok).toBe(true);
    expect(useTokenStore.getState().balance).toBe(99.5);
  });

  it('spendTokens returns false when the balance is insufficient', () => {
    const ok = useTokenStore.getState().spendTokens(200);
    expect(ok).toBe(false);
    expect(useTokenStore.getState().balance).toBe(DEFAULT_TOKEN_BALANCE);
  });

  it('spendTokens with the exact amount zeroes the balance', () => {
    const ok = useTokenStore.getState().spendTokens(DEFAULT_TOKEN_BALANCE);
    expect(ok).toBe(true);
    expect(useTokenStore.getState().balance).toBe(0);
  });

  it('addTokens soma ao saldo', () => {
    useTokenStore.getState().addTokens(10);
    expect(useTokenStore.getState().balance).toBe(110);
  });

  it('resetTokens restores the default balance', () => {
    useTokenStore.getState().spendTokens(3);
    useTokenStore.getState().resetTokens();
    expect(useTokenStore.getState().balance).toBe(DEFAULT_TOKEN_BALANCE);
  });
});

describe('netLedgerSpent', () => {
  it('returns 0 for an empty ledger', () => {
    expect(netLedgerSpent([])).toBe(0);
  });

  it('returns the spend magnitude when nothing was refunded', () => {
    expect(netLedgerSpent([{ type: 'video_generation', amount: -2 }])).toBe(2);
  });

  it('returns 0 when the spend was fully refunded', () => {
    expect(
      netLedgerSpent([
        { type: 'video_generation', amount: -2 },
        { type: 'generation_refund', amount: 2 },
      ]),
    ).toBe(0);
  });

  it('returns the remainder when the refund was partial', () => {
    expect(
      netLedgerSpent([
        { type: 'video_generation', amount: -2 },
        { type: 'generation_refund', amount: 1 },
      ]),
    ).toBe(1);
  });

  it('coerces string amounts from PostgREST and ignores other row types', () => {
    expect(
      netLedgerSpent([
        { type: 'video_generation', amount: '-2' },
        { type: 'generation_refund', amount: '2' },
        { type: 'purchase', amount: 100 },
      ]),
    ).toBe(0);
  });

  it('counts a non-numeric amount as 0', () => {
    expect(netLedgerSpent([{ type: 'video_generation', amount: 'n/a' }])).toBe(0);
  });
});
