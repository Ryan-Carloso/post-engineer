import { describe, it, expect } from 'vitest';

//---------------
// TDD RED — computeTokenPercentage nunca pode retornar NaN.
// Reproduces the sidebar bug: free plan (0 tokens/month) showed "NaN%".
//---------------

import { computeTokenPercentage, toFiniteNumber } from '@/lib/tokens';

describe('computeTokenPercentage', () => {
  it('returns 0 when maxTokens is 0 (free plan) instead of NaN', () => {
    expect(computeTokenPercentage(0, 0)).toBe(0);
    expect(Number.isNaN(computeTokenPercentage(0, 0))).toBe(false);
  });

  it('returns 0 when maxTokens is negative or invalid', () => {
    expect(computeTokenPercentage(10, -5)).toBe(0);
    expect(computeTokenPercentage(10, NaN)).toBe(0);
    expect(computeTokenPercentage(10, undefined)).toBe(0);
  });

  it('computes 75% for 45 of 60', () => {
    expect(computeTokenPercentage(45, 60)).toBe(75);
  });

  it('caps at 100 when the balance exceeds the maximum', () => {
    expect(computeTokenPercentage(200, 150)).toBe(100);
  });

  it('caps at 0 when the balance is negative', () => {
    expect(computeTokenPercentage(-5, 60)).toBe(0);
  });

  it('returns 0 when the balance is NaN', () => {
    expect(computeTokenPercentage(NaN, 60)).toBe(0);
  });

  it('coerces numeric strings from PostgREST (numeric → string)', () => {
    expect(computeTokenPercentage('45', '60')).toBe(75);
    expect(computeTokenPercentage('45', 60)).toBe(75);
  });
});

describe('toFiniteNumber', () => {
  it('coerces a numeric string', () => {
    expect(toFiniteNumber('45')).toBe(45);
  });

  it('returns the fallback for null/undefined/NaN', () => {
    expect(toFiniteNumber(null)).toBe(0);
    expect(toFiniteNumber(undefined)).toBe(0);
    expect(toFiniteNumber(NaN)).toBe(0);
    expect(toFiniteNumber('abc', 7)).toBe(7);
  });
});
