import { describe, it, expect, beforeEach } from 'vitest';

//---------------
// Tests for the persona video token pricing model.
//  - Faceless (no face, per post)         = 1 token
//  - Face ok (480p)                       = 2 tokens
//  - Face very good (720p)                = 3 tokens
// No face MIX anymore: personas are always faced, so the price is a lookup on
// (faceless, face quality). The engine mirrors this formula in
// apps/engine .../fill_schedule/support.py token_cost.
//---------------

import {
  computeVideoTokens,
  useTokenStore,
  FACELESS_PRICE,
  FACE_QUALITY_PRICES,
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

  it('o preço nunca é zero nem fracionário', () => {
    // The function returns a whole-token lookup; both branches are integers,
    // so the previous "round up so fractions are never charged" rule is
    // structural now, not arithmetic.
    for (const faceless of [true, false]) {
      for (const quality of ['ok', 'very_good'] as const) {
        const cost = computeVideoTokens(faceless, quality);
        expect(Number.isInteger(cost)).toBe(true);
        expect(cost).toBeGreaterThanOrEqual(1);
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
