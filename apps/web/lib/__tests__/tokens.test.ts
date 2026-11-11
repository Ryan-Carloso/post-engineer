import { describe, it, expect, beforeEach } from 'vitest';

//---------------
// Tests for the persona video token pricing model.
//  - Faceless (no face, per post)         = 1 token
//  - Face ok (480p)                       = 2 tokens
//  - Face very good (720p)                = 3 tokens
//  - Full lip-sync, face ok               = 8 tokens
//  - Full lip-sync, face very good        = 15 tokens
// No face MIX anymore: personas are always faced, so the price is a lookup on
// (videoType, face quality). It is the only copy: the engine
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
  VIDEO_TYPE_ERROR_SUFFIX,
  VIDEO_TYPE_REQUIRED_MESSAGE,
  unknownVideoTypeMessage,
  type VideoType,
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
    expect(computeVideoTokens('faceless', 'ok')).toBe(1);
    expect(computeVideoTokens('faceless', 'very_good')).toBe(1);
  });

  it('hook lip-sync custa 2 tokens ok e 3 tokens very_good', () => {
    expect(computeVideoTokens('hook_lipsync', 'ok')).toBe(2);
    expect(computeVideoTokens('hook_lipsync', 'very_good')).toBe(3);
  });

  it('full lip-sync custa 8 tokens ok e 15 tokens very_good', () => {
    expect(computeVideoTokens('full_lipsync', 'ok')).toBe(8);
    expect(computeVideoTokens('full_lipsync', 'very_good')).toBe(15);
  });

  it('o preço nunca é zero nem fracionário', () => {
    // The function returns a whole-token lookup; both branches are integers,
    // so the previous "round up so fractions are never charged" rule is
    // structural now, not arithmetic.
    for (const videoType of ['faceless', 'hook_lipsync', 'full_lipsync'] as const) {
      for (const quality of ['ok', 'very_good'] as const) {
        const cost = computeVideoTokens(videoType, quality);
        expect(Number.isInteger(cost)).toBe(true);
        expect(cost).toBeGreaterThanOrEqual(1);
      }
    }
  });
});

describe('video_type error messages', () => {
  it('unknownVideoTypeMessage names the bad value and lists every type with its cost', () => {
    expect(unknownVideoTypeMessage('bogus')).toBe(
      "unknown video_type 'bogus'; use full_lipsync (8/15), hook_lipsync (2/3) or faceless (1)",
    );
  });

  it('unknownVideoTypeMessage clips a long bad value so the message survives the 200-char MCP cap', () => {
    const message = unknownVideoTypeMessage('x'.repeat(100));
    expect(message.length).toBeLessThan(200);
    expect(message).toContain("unknown video_type 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';");
  });

  it('unknownVideoTypeMessage never renders null or undefined as the value', () => {
    expect(unknownVideoTypeMessage(null)).toBe(`unknown video_type ''; ${VIDEO_TYPE_ERROR_SUFFIX}`);
    expect(unknownVideoTypeMessage(undefined)).toBe(`unknown video_type ''; ${VIDEO_TYPE_ERROR_SUFFIX}`);
  });

  it('the required message lists every type with its cost', () => {
    expect(VIDEO_TYPE_REQUIRED_MESSAGE).toBe(`videoType is required; ${VIDEO_TYPE_ERROR_SUFFIX}`);
    expect(VIDEO_TYPE_REQUIRED_MESSAGE.length).toBeLessThan(200);
  });

  it('the suffix costs match the price tables', () => {
    // The suffix is hand-written prose, so the prices it quotes must be
    // derived from the same tables computeVideoTokens reads.
    expect(VIDEO_TYPE_ERROR_SUFFIX).toContain(
      `full_lipsync (${FULL_LIPSYNC_PRICES.ok}/${FULL_LIPSYNC_PRICES.very_good})`,
    );
    expect(VIDEO_TYPE_ERROR_SUFFIX).toContain(
      `hook_lipsync (${FACE_QUALITY_PRICES.ok}/${FACE_QUALITY_PRICES.very_good})`,
    );
    expect(VIDEO_TYPE_ERROR_SUFFIX).toContain(`faceless (${FACELESS_PRICE})`);
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
