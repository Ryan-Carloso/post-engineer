import { create } from 'zustand';

//---------------
// Token pricing model for the persona video.
//  - Faceless (no face, 100% stock)   = 1 token
//  - With the persona's face "ok" (480p)    = 2 tokens
//  - With the persona's face "very_good" (720p) = 3 tokens
//
// There is no face MIX anymore (migration 007 dropped the persona column):
// a persona always has a face, and "no face" is a boolean the user picks per
// post — so the price is a straight lookup, not a weighted average.
//---------------

export const FACELESS_PRICE = 1;

export const FACE_QUALITY_PRICES = {
  ok: 2,
  very_good: 3,
} as const;

export type FaceQuality = keyof typeof FACE_QUALITY_PRICES;

export const DEFAULT_TOKEN_BALANCE = 100;

//---------------
// toFiniteNumber — safe coercion of values coming from the API/Supabase.
// Postgres numerics arrive as strings via PostgREST; null/undefined/NaN → fallback.
//---------------
export function toFiniteNumber(value: unknown, fallback = 0): number {
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : fallback;
}

//---------------
// computeTokenPercentage — % of tokens remaining, always 0–100, never NaN.
// maxTokens <= 0 (e.g. free plan with 0 tokens/month) → 0 instead of 0/0 = NaN.
//---------------
export function computeTokenPercentage(balance: unknown, maxTokens: unknown): number {
  const safeBalance = toFiniteNumber(balance, 0);
  const safeMax = toFiniteNumber(maxTokens, 0);
  if (!Number.isFinite(safeBalance) || !Number.isFinite(safeMax) || safeMax <= 0) return 0;
  return Math.min(100, Math.max(0, (safeBalance / safeMax) * 100));
}

//---------------
// computeVideoTokens — cost of ONE video: the faceless price when the post
// asked for no face, otherwise the persona's face quality. The server calls
// the same formula (apps/engine .../fill_schedule/support.py token_cost), so
// an estimate that disagrees with the charge is a bug in one of the two.
//---------------
export function computeVideoTokens(faceless: boolean, faceQuality: FaceQuality): number {
  return faceless ? FACELESS_PRICE : FACE_QUALITY_PRICES[faceQuality];
}

//---------------
// Token Store — mocked user balance.
//---------------

interface TokenState {
  balance: number;
  spendTokens: (cost: number) => boolean;
  addTokens: (amount: number) => void;
  resetTokens: () => void;
}

export const useTokenStore = create<TokenState>((set, get) => ({
  balance: DEFAULT_TOKEN_BALANCE,

  spendTokens: (cost) => {
    const { balance } = get();
    if (balance < cost) return false;
    set({ balance: Math.round((balance - cost) * 100) / 100 });
    return true;
  },

  addTokens: (amount) => {
    const { balance } = get();
    set({ balance: Math.round((balance + amount) * 100) / 100 });
  },

  resetTokens: () => set({ balance: DEFAULT_TOKEN_BALANCE }),
}));
