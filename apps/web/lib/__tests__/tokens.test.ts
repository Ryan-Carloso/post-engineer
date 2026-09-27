import { describe, it, expect, beforeEach } from 'vitest';

//---------------
// Tests for the persona video token pricing model.
//  - Faceless (no face)         = 0.5 token
//  - Face ok (480p)             = 1 token
//  - Face very good (720p)      = 2 tokens
//  - Hybrid = weighted average by faceMixPercent (0–100%).
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

  it('face ok custa 1 token e very_good custa 2', () => {
    expect(FACE_QUALITY_PRICES.ok).toBe(2);
    expect(FACE_QUALITY_PRICES.very_good).toBe(3);
  });

  it('default initial balance is 100 tokens', () => {
    expect(DEFAULT_TOKEN_BALANCE).toBe(100);
  });
});

describe('computeVideoTokens', () => {
  it('100% faceless custa 1 token, em qualquer qualidade', () => {
    expect(computeVideoTokens(0, 'ok')).toBe(1);
    expect(computeVideoTokens(0, 'very_good')).toBe(1);
  });

  it('100% face ok custa 2 tokens', () => {
    expect(computeVideoTokens(100, 'ok')).toBe(2);
  });

  it('100% face very_good custa 3 tokens', () => {
    expect(computeVideoTokens(100, 'very_good')).toBe(3);
  });

  it('50% face ok rounds up to 2 tokens', () => {
    expect(computeVideoTokens(50, 'ok')).toBe(2);
  });

  it('60% face ok rounds up to 2 tokens', () => {
    expect(computeVideoTokens(60, 'ok')).toBe(2);
  });

  it('50% face very_good rounds up to 2 tokens', () => {
    expect(computeVideoTokens(50, 'very_good')).toBe(2);
  });

  it('clamps percentages above 100 to 100', () => {
    expect(computeVideoTokens(120, 'ok')).toBe(2);
    expect(computeVideoTokens(150, 'very_good')).toBe(3);
  });

  it('clamps negative percentages to 0', () => {
    expect(computeVideoTokens(-20, 'ok')).toBe(1);
  });

  it('rounds up so fractions are never charged', () => {
    expect(computeVideoTokens(33, 'very_good')).toBe(2);
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
